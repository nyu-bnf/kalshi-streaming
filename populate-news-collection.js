/**
 * Standalone Script: Populate News Collection from Events
 * 
 * This script:
 * 1. Reads events from MongoDB (uses existing `key_words` array)
 * 2. Fetches news from Google News RSS using those keywords
 * 3. Stores news in a separate "news" collection
 * 4. Updates events' `related_news` array with ObjectIds
 * 
 * Usage:
 *   - Make sure .env file has MONGO_URI set
 *   - Run: node populate-news-collection.js
 * 
 * Requirements:
 *   npm install mongodb rss-parser dotenv
 */

import { MongoClient, ObjectId } from 'mongodb';
import Parser from 'rss-parser';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// ============================================================================
// CONFIGURATION
// ============================================================================

const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/Kalshi';
const DB_NAME = process.env.DB_NAME || 'Kalshi'; // Match the existing database name
const EVENTS_COLLECTION = 'events';
const NEWS_COLLECTION = 'news';

// Google News RSS settings
const NEWS_CONFIG = {
  lang: process.env.NEWS_LANG || 'en-US',
  region: process.env.NEWS_REGION || 'US',
  ceid: process.env.NEWS_CEID || 'US:en',
  maxArticlesPerQuery: 20, // Limit articles per search query
  days: parseInt(process.env.NEWS_DAYS || '30'), // Only fetch articles from last N days
};

// ============================================================================
// UTILITIES
// ============================================================================

function sha1(s) {
  return createHash('sha1').update(s).digest('hex');
}

function normalizeUrl(u) {
  try {
    const url = new URL(u);
    
    // If host is news.google.com and has "url=" param, use that param
    if (url.hostname === 'news.google.com') {
      const urlParam = url.searchParams.get('url');
      if (urlParam) {
        return normalizeUrl(urlParam);
      }
    }
    
    // Strip UTM & tracking params
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'ref'];
    trackingParams.forEach(param => url.searchParams.delete(param));
    
    // Lowercase host, keep protocol, pathname, search (minus tracking), hash empty
    url.hostname = url.hostname.toLowerCase();
    url.hash = '';
    
    return url.toString();
  } catch {
    return u; // Return original if URL parsing fails
  }
}

function generateSearchQuery(keyWords) {
  // Join keywords with spaces for Google News search
  return keyWords.join(' ');
}

// ============================================================================
// NEWS FETCHING
// ============================================================================

async function fetchNewsFromGoogle(query) {
  const parser = new Parser();
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${NEWS_CONFIG.lang}&gl=${NEWS_CONFIG.region}&ceid=${NEWS_CONFIG.ceid}`;
  
  console.log(`  📰 Fetching: ${rssUrl}`);
  
  try {
    const feed = await parser.parseURL(rssUrl);
    const articles = [];
    const seenUrls = new Set();
    const cutoffDate = new Date(Date.now() - NEWS_CONFIG.days * 24 * 60 * 60 * 1000);
    
    for (const item of feed.items || []) {
      if (articles.length >= NEWS_CONFIG.maxArticlesPerQuery) break;
      
      const canonicalUrl = normalizeUrl(item.link || '');
      const id = sha1(canonicalUrl);
      
      // Skip duplicates
      if (seenUrls.has(canonicalUrl)) continue;
      seenUrls.add(canonicalUrl);
      
      // Filter by date
      const publishedAt = item.isoDate ? new Date(item.isoDate) : null;
      if (publishedAt && publishedAt < cutoffDate) continue;
      
      articles.push({
        id,
        title: item.title || '',
        canonical_url: canonicalUrl,
        source: item.source || item.creator || item.author,
        snippet: item.contentSnippet,
        published_at: item.isoDate,
        query,
        fetched_at: new Date().toISOString(),
      });
    }
    
    return articles;
  } catch (error) {
    console.error(`  ❌ Error fetching news for query "${query}":`, error);
    return [];
  }
}

// ============================================================================
// MONGODB OPERATIONS
// ============================================================================

async function upsertNewsArticle(
  newsCollection,
  article,
  eventId
) {
  // Try to find existing news by id (SHA1 hash of normalized URL)
  // This is the primary duplicate prevention mechanism
  const existing = await newsCollection.findOne({ id: article.id });
  
  const now = new Date().toISOString();
  
  if (existing) {
    // News article already exists - check if event_id is already linked
    const isAlreadyLinked = existing.event_ids && existing.event_ids.some(
      id => id.toString() === eventId.toString()
    );
    
    if (isAlreadyLinked) {
      // Already linked to this event, skip update
      return { _id: existing._id, isNew: false, wasAlreadyLinked: true };
    }
    
    // Update existing: add event_id to event_ids array if not present
    await newsCollection.updateOne(
      { id: article.id },
      {
        $set: {
          title: article.title, // Update title in case it changed
          snippet: article.snippet,
          updated_at: now,
        },
        $addToSet: { event_ids: eventId }, // Add event_id if not already present
      }
    );
    return { _id: existing._id, isNew: false, wasAlreadyLinked: false };
  } else {
    // Insert new news article - no duplicate found
    const doc = {
      id: article.id, // SHA1 hash of canonical_url (unique identifier)
      title: article.title,
      canonical_url: article.canonical_url,
      source: article.source,
      snippet: article.snippet,
      published_at: article.published_at,
      event_ids: [eventId],
      created_at: now,
      updated_at: now,
    };
    
    const result = await newsCollection.insertOne(doc);
    return { _id: result.insertedId, isNew: true, wasAlreadyLinked: false };
  }
}

async function updateEventRelatedNews(
  eventsCollection,
  eventId,
  newsObjectIds
) {
  await eventsCollection.updateOne(
    { _id: eventId },
    {
      $addToSet: {
        related_news: { $each: newsObjectIds } // Add all news ObjectIds, avoiding duplicates
      },
      $set: {
        updatedAt: new Date(),
      },
    }
  );
}

// ============================================================================
// MAIN PROCESSING
// ============================================================================

async function processEvent(
  eventsCollection,
  newsCollection,
  event
) {
  console.log(`\n📋 Processing: ${event.title}`);
  console.log(`   Event ID: ${event._id}`);
  console.log(`   Keywords: [${event.key_words.join(', ')}]`);
  
  // Check if event already has related_news
  const existingNewsCount = event.related_news?.length || 0;
  if (existingNewsCount > 0) {
    console.log(`   ℹ️  Event already has ${existingNewsCount} linked news articles`);
  }
  
  // Generate search query from keywords
  const searchQuery = generateSearchQuery(event.key_words);
  console.log(`   Search Query: "${searchQuery}"`);
  
  // Fetch news
  const fetchedArticles = await fetchNewsFromGoogle(searchQuery);
  console.log(`   Found ${fetchedArticles.length} articles from RSS`);
  
  if (fetchedArticles.length === 0) {
    console.log(`   ⚠️  No news found, skipping`);
    return;
  }
  
  // Store news articles and collect ObjectIds (avoiding duplicates)
  const newsObjectIds = [];
  let newArticles = 0;
  let existingArticles = 0;
  let skippedDuplicates = 0;
  
  for (const article of fetchedArticles) {
    try {
      const result = await upsertNewsArticle(newsCollection, article, event._id);
      
      if (result.wasAlreadyLinked) {
        // Article already linked to this event, skip
        skippedDuplicates++;
        continue;
      }
      
      newsObjectIds.push(result._id);
      
      if (result.isNew) {
        newArticles++;
      } else {
        existingArticles++;
      }
    } catch (error) {
      // If duplicate key error (unique index violation), article already exists
      if (error.code === 11000 || error.codeName === 'DuplicateKey') {
        // Try to find and link existing article
        const existing = await newsCollection.findOne({ id: article.id });
        if (existing) {
          const isAlreadyLinked = existing.event_ids && existing.event_ids.some(
            id => id.toString() === event._id.toString()
          );
          if (!isAlreadyLinked) {
            newsObjectIds.push(existing._id);
            existingArticles++;
          } else {
            skippedDuplicates++;
          }
        }
      } else {
        console.error(`   ❌ Error storing article "${article.title}":`, error);
      }
    }
  }
  
  // Update event's related_news array (only if we have new links)
  if (newsObjectIds.length > 0) {
    await updateEventRelatedNews(eventsCollection, event._id, newsObjectIds);
    console.log(`   ✅ Linked ${newsObjectIds.length} news articles (${newArticles} new, ${existingArticles} existing, ${skippedDuplicates} already linked)`);
  } else if (skippedDuplicates > 0) {
    console.log(`   ℹ️  All ${skippedDuplicates} articles were already linked to this event`);
  }
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

async function main() {
  console.log('🚀 Starting News Population Script\n');
  console.log(`MongoDB URI: ${MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')}`); // Hide credentials
  console.log(`Database: ${DB_NAME}`);
  console.log(`Events Collection: ${EVENTS_COLLECTION}`);
  console.log(`News Collection: ${NEWS_COLLECTION}\n`);
  
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');
    
    const db = client.db(DB_NAME);
    const eventsCollection = db.collection(EVENTS_COLLECTION);
    const newsCollection = db.collection(NEWS_COLLECTION);
    
    // Check if news collection exists
    const collections = await db.listCollections({ name: NEWS_COLLECTION }).toArray();
    const collectionExists = collections.length > 0;
    
    if (collectionExists) {
      console.log(`📁 Using existing "${NEWS_COLLECTION}" collection\n`);
    } else {
      console.log(`📁 Creating "${NEWS_COLLECTION}" collection (will be created on first insert)\n`);
    }
    
    // Create indexes on news collection for efficient lookups and duplicate prevention
    // These are safe to run multiple times - MongoDB handles existing indexes gracefully
    console.log('🔍 Setting up indexes for duplicate prevention...');
    
    try {
      // PRIMARY: Unique index on SHA1 hash - this is the main duplicate prevention
      await newsCollection.createIndex({ id: 1 }, { unique: true });
      console.log('✅ Index on "id" field (unique) - prevents duplicate news articles');
    } catch (error) {
      // Index already exists or different conflict - that's fine, continue
      console.log('ℹ️  Index on "id" field already exists');
    }
    
    try {
      await newsCollection.createIndex({ canonical_url: 1 });
      console.log('✅ Index on "canonical_url" field');
    } catch (error) {
      // Index might already exist - that's fine
      console.log('ℹ️  Index on "canonical_url" field already exists');
    }
    
    try {
      await newsCollection.createIndex({ event_ids: 1 }); // For querying news by event
      console.log('✅ Index on "event_ids" field');
    } catch (error) {
      // Index might already exist - that's fine
      console.log('ℹ️  Index on "event_ids" field already exists');
    }
    
    // Create index on events collection for related_news queries
    try {
      await eventsCollection.createIndex({ related_news: 1 });
      console.log('✅ Index on "related_news" field in events collection\n');
    } catch (error) {
      // Index might already exist - that's fine
      console.log('ℹ️  Index on "related_news" field already exists\n');
    }
    
    // Fetch all events that have key_words
    const events = await eventsCollection
      .find({ key_words: { $exists: true, $ne: [] } })
      .toArray();
    
    console.log(`📊 Found ${events.length} events with keywords\n`);
    
    if (events.length === 0) {
      console.log('⚠️  No events found with keywords. Exiting.');
      return;
    }
    
    // Process each event
    let processed = 0;
    
    for (const event of events) {
      try {
        await processEvent(eventsCollection, newsCollection, event);
        processed++;
      } catch (error) {
        console.error(`❌ Error processing event ${event._id}:`, error);
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Get final counts
    const newsCount = await newsCollection.countDocuments();
    const eventsWithNews = await eventsCollection.countDocuments({ 
      related_news: { $exists: true, $ne: [] } 
    });
    
    console.log(`\n✨ Completed!`);
    console.log(`   Processed: ${processed}/${events.length} events`);
    console.log(`   Total news articles in collection: ${newsCount}`);
    console.log(`   Events with linked news: ${eventsWithNews}`);
    console.log(`\n📝 Duplicate Prevention Summary:`);
    console.log(`   - Articles identified by SHA1 hash of normalized URL`);
    console.log(`   - Unique index on "id" field prevents database duplicates`);
    console.log(`   - URL normalization removes tracking parameters (utm_*, etc.)`);
    console.log(`   - Event linking uses $addToSet to prevent duplicate links`);
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

// Run the script
main().catch(console.error);

