/**
 * Update News Collection with Thumbnails (Recent Articles Only)
 * 
 * Processes ONLY recently added news articles from MongoDB and adds thumbnail URLs
 * Skips articles that have already been processed (have thumbnails or marked as not_found)
 * Uses hyper-optimized Puppeteer cluster for fast processing
 * 
 * Usage:
 *   node update-news-thumbnails.js
 * 
 * Options (via environment variables):
 *   RECENT_DAYS - Only process articles added in last N days (default: 7)
 *   LIMIT - Number of articles to process (default: all recent without thumbnails)
 *   BATCH_SIZE - Process in batches (default: 100)
 *   MAX_CONCURRENCY - Concurrent Puppeteer instances (default: 10)
 */

import { MongoClient } from 'mongodb';
import axios from 'axios';
import { JSDOM } from 'jsdom';
import { Cluster } from 'puppeteer-cluster';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/test';
const DB_NAME = process.env.DB_NAME || 'test';
const NEWS_COLLECTION = 'news';
const LIMIT = parseInt(process.env.LIMIT || '0'); // 0 = all
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '100'); // Increased default batch size
const MAX_CONCURRENCY = parseInt(process.env.MAX_CONCURRENCY || '10'); // Increased default concurrency
// Only process articles added in the last N days (default: 1 day)
const RECENT_DAYS = parseInt(process.env.RECENT_DAYS || '1');

/**
 * Check if URL is a Google placeholder image
 */
function isGooglePlaceholder(url) {
  if (!url) return false;
  return url.includes('googleusercontent.com') || 
         url.includes('gstatic.com') ||
         url.includes('google.com/images');
}

/**
 * Extract thumbnail from article URL
 */
async function fetchThumbnailFromUrl(url) {
  try {
    const response = await axios.get(url, {
      timeout: 3000, // Reduced timeout for faster processing
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      maxRedirects: 3 // Reduced redirects for speed
    });
    
    const dom = new JSDOM(response.data);
    const document = dom.window.document;
    
    // Try Open Graph image
    const ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage && ogImage.content && !isGooglePlaceholder(ogImage.content)) {
      return ogImage.content;
    }
    
    // Try Twitter card image
    const twitterImage = document.querySelector('meta[name="twitter:image"]') || 
                        document.querySelector('meta[property="twitter:image"]');
    if (twitterImage && twitterImage.content && !isGooglePlaceholder(twitterImage.content)) {
      return twitterImage.content;
    }
    
    // Try meta image
    const metaImage = document.querySelector('meta[name="image"]');
    if (metaImage && metaImage.content && !isGooglePlaceholder(metaImage.content)) {
      return metaImage.content;
    }
    
    // Try to find first large image (excluding Google placeholders)
    const images = document.querySelectorAll('img');
    for (const img of images) {
      const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
      if (src && (src.startsWith('http://') || src.startsWith('https://'))) {
        // Skip Google placeholder images
        if (isGooglePlaceholder(src)) {
          continue;
        }
        
        const width = img.width || img.getAttribute('width');
        const height = img.height || img.getAttribute('height');
        if (width && parseInt(width) > 200 && height && parseInt(height) > 200) {
          return src;
        }
      }
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Extract actual article URL using optimized Puppeteer
 */
async function extractActualUrl({ page, data: googleNewsUrl }) {
  try {
    // Block unnecessary resources for faster loading
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const resourceType = request.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
        request.abort();
      } else {
        request.continue();
      }
    });
    
    // Navigate with faster wait strategy
    await page.goto(googleNewsUrl, { 
      waitUntil: 'domcontentloaded',
      timeout: 5000 // Reduced timeout
    });
    
    // Minimal wait for JavaScript
    await new Promise(resolve => setTimeout(resolve, 500)); // Reduced wait time
    
    const actualUrl = await page.evaluate(() => {
      if (window.location.href && !window.location.href.includes('news.google.com')) {
        return window.location.href;
      }
      
      const canonical = document.querySelector('link[rel="canonical"]');
      if (canonical && canonical.href && !canonical.href.includes('news.google.com')) {
        return canonical.href;
      }
      
      const ogUrl = document.querySelector('meta[property="og:url"]');
      if (ogUrl && ogUrl.content && !ogUrl.content.includes('news.google.com')) {
        return ogUrl.content;
      }
      
      const links = document.querySelectorAll('a[href]');
      for (const link of links) {
        const href = link.href;
        const text = link.textContent.trim().toLowerCase();
        if (href && 
            href.startsWith('http') &&
            !href.includes('news.google.com') && 
            !href.includes('googleusercontent.com') &&
            !href.includes('gstatic.com') &&
            (text.includes('read') || text.includes('full') || text.includes('article') || 
             text.length > 30)) {
          return href;
        }
      }
      
      return null;
    });
    
    return actualUrl || googleNewsUrl;
  } catch (error) {
    return googleNewsUrl;
  }
}

/**
 * Test MongoDB connection and verify database/collection access
 */
async function testMongoConnection(client) {
  try {
    console.log('🔍 Testing MongoDB connection...\n');
    
    // Test connection
    await client.db('admin').command({ ping: 1 });
    console.log('✅ MongoDB connection successful\n');
    
    // Test database access
    const db = client.db(DB_NAME);
    const adminDb = client.db('admin');
    const dbList = await adminDb.admin().listDatabases();
    const dbExists = dbList.databases.some(d => d.name === DB_NAME);
    
    if (!dbExists) {
      console.log(`⚠️  Warning: Database '${DB_NAME}' does not exist yet (will be created on first write)\n`);
    } else {
      console.log(`✅ Database '${DB_NAME}' exists\n`);
    }
    
    // Test collection access
    const newsCollection = db.collection(NEWS_COLLECTION);
    const count = await newsCollection.countDocuments({});
    console.log(`✅ Collection '${NEWS_COLLECTION}' accessible (${count} total documents)\n`);
    
    return { db, newsCollection, count };
  } catch (error) {
    console.error('❌ MongoDB connection test failed:', error.message);
    throw error;
  }
}

async function main() {
  const startTime = Date.now();
  console.log('🖼️  Updating News Collection with Thumbnails (RECENT ARTICLES ONLY)\n');
  console.log(`MongoDB URI: ${MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')}`);
  console.log(`Database: ${DB_NAME}`);
  console.log(`Collection: ${NEWS_COLLECTION}`);
  console.log(`Recent Days: ${RECENT_DAYS} days`);
  console.log(`Limit: ${LIMIT || 'All recent articles without thumbnails'}`);
  console.log(`Batch Size: ${BATCH_SIZE}`);
  console.log(`Concurrency: ${MAX_CONCURRENCY}\n`);
  console.log('='.repeat(80) + '\n');
  
  const client = new MongoClient(MONGODB_URI);
  let cluster;
  
  try {
    await client.connect();
    
    // Test MongoDB connection
    const { db, newsCollection } = await testMongoConnection(client);
    
    // Calculate the cutoff date for "recent" articles (as ISO string for comparison)
    const recentCutoffDate = new Date();
    recentCutoffDate.setDate(recentCutoffDate.getDate() - RECENT_DAYS);
    const recentCutoffISO = recentCutoffDate.toISOString();
    
    console.log(`📅 Processing articles added after: ${recentCutoffISO}`);
    console.log(`   (Last ${RECENT_DAYS} days)\n`);
    
    // Find ONLY recently added articles without thumbnails
    // Only process articles that:
    // 1. Were added recently (created_at or updated_at within RECENT_DAYS)
    // 2. Don't have thumbnails (or have Google placeholders)
    // 3. Haven't been processed before (no thumbnail_fetched_at) OR have Google placeholders
    // 4. Not explicitly marked as thumbnail_not_found: true (unless it's a Google placeholder)
    const query = {
      $and: [
        {
          // Only process recently added articles (dates stored as ISO strings)
          $or: [
            { created_at: { $gte: recentCutoffISO } },
            { updated_at: { $gte: recentCutoffISO } },
            // Fallback: if no date fields, process if never fetched
            {
              $and: [
                { created_at: { $exists: false } },
                { updated_at: { $exists: false } },
                { thumbnail_fetched_at: { $exists: false } }
              ]
            }
          ]
        },
        {
          $or: [
            // No thumbnail
            { thumbnail: { $exists: false } },
            { thumbnail: null },
            { thumbnail: '' },
            // Google placeholder thumbnail (needs replacement)
            { thumbnail: { $regex: /googleusercontent\.com|gstatic\.com|google\.com\/images/i } }
          ]
        },
        {
          // Skip articles that already have real thumbnails
          $or: [
            { thumbnail: { $exists: false } },
            { thumbnail: null },
            { thumbnail: '' },
            { thumbnail: { $regex: /googleusercontent\.com|gstatic\.com|google\.com\/images/i } }
          ]
        },
        {
          $or: [
            // Never processed
            { thumbnail_fetched_at: { $exists: false } },
            { thumbnail_fetched_at: null },
            // Has Google placeholder - allow reprocessing
            { thumbnail: { $regex: /googleusercontent\.com|gstatic\.com|google\.com\/images/i } }
          ]
        },
        {
          // Only exclude "not_found" if it's NOT a Google placeholder
          $or: [
            { thumbnail_not_found: { $ne: true } },
            { thumbnail: { $regex: /googleusercontent\.com|gstatic\.com|google\.com\/images/i } }
          ]
        }
      ]
    };
    
    const totalWithoutThumbnails = await newsCollection.countDocuments(query);
    console.log(`📊 Found ${totalWithoutThumbnails} recent articles without thumbnails\n`);
    
    if (totalWithoutThumbnails === 0) {
      console.log(`✅ No recent articles (last ${RECENT_DAYS} days) need thumbnail processing!`);
      console.log('   All recent articles already have thumbnails or have been processed.');
      return;
    }
    
    // Get articles to process
    // Prioritize recently added articles (created_at or updated_at)
    const articles = await newsCollection
      .find(query)
      .sort({ created_at: -1, updated_at: -1 }) // Process newest first
      .limit(LIMIT || totalWithoutThumbnails)
      .toArray();
    
    console.log(`📋 Processing ${articles.length} articles\n`);
    
    // Preview first 5 articles that will be processed
    console.log('📋 PREVIEW - First 5 articles to process:');
    console.log('='.repeat(80));
    articles.slice(0, 5).forEach((article, idx) => {
      console.log(`${idx + 1}. ${article.title?.substring(0, 60) || 'No title'}...`);
      console.log(`   URL: ${article.canonical_url?.substring(0, 70) || 'No URL'}...`);
      console.log(`   ID: ${article._id}`);
      console.log('');
    });
    if (articles.length > 5) {
      console.log(`   ... and ${articles.length - 5} more articles\n`);
    }
    console.log('='.repeat(80) + '\n');
    
    // Launch Puppeteer cluster with hyper-optimized settings
    console.log('🚀 Launching Puppeteer cluster (HYPER-OPTIMIZED)...\n');
    cluster = await Cluster.launch({
      concurrency: Cluster.CONCURRENCY_CONTEXT,
      maxConcurrency: MAX_CONCURRENCY,
      puppeteerOptions: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--disable-images', // Don't load images
          '--disable-javascript-harmony-shipping',
          '--disable-background-networking',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-breakpad',
          '--disable-client-side-phishing-detection',
          '--disable-component-extensions-with-background-pages',
          '--disable-default-apps',
          '--disable-extensions',
          '--disable-features=TranslateUI',
          '--disable-hang-monitor',
          '--disable-ipc-flooding-protection',
          '--disable-popup-blocking',
          '--disable-prompt-on-repost',
          '--disable-renderer-backgrounding',
          '--disable-sync',
          '--disable-translate',
          '--metrics-recording-only',
          '--mute-audio',
          '--no-first-run',
          '--safebrowsing-disable-auto-update',
          '--enable-automation',
          '--password-store=basic',
          '--use-mock-keychain'
        ]
      }
    });
    
    await cluster.task(extractActualUrl);
    
    let processed = 0;
    let updated = 0;
    let failed = 0;
    let lastProgressLog = 0; // Track when we last logged progress
    
    // Process in batches
    for (let i = 0; i < articles.length; i += BATCH_SIZE) {
      const batch = articles.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(articles.length / BATCH_SIZE);
      
      console.log(`\n📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} articles)...\n`);
      
      // Extract actual URLs concurrently
      const urlPromises = batch.map(async (article) => {
        try {
          const actualUrl = await cluster.execute(article.canonical_url);
          return { article, actualUrl };
        } catch (error) {
          return { article, actualUrl: article.canonical_url, error: error.message };
        }
      });
      
      const urlResults = await Promise.all(urlPromises);
      
      // Fetch thumbnails and update database
      const updatePromises = urlResults.map(async ({ article, actualUrl, error }) => {
        if (error) {
          // Mark as not found to prevent future retries
          const updateDoc = {
            thumbnail: null,
            thumbnail_not_found: true,
            thumbnail_fetched_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          
          console.log(`   ❌ ${article.title?.substring(0, 50) || 'No title'}... - Error: ${error}`);
          console.log(`      📝 Will update MongoDB with: thumbnail=null, thumbnail_not_found=true`);
          
          await newsCollection.updateOne(
            { _id: article._id },
            { $set: updateDoc }
          );
          failed++;
          processed++;
          return;
        }
        
        try {
          const thumbnail = await fetchThumbnailFromUrl(actualUrl);
          
          if (thumbnail) {
            const updateDoc = {
              thumbnail: thumbnail,
              thumbnail_not_found: false,
              thumbnail_fetched_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };
            
            console.log(`   ✅ Found thumbnail: ${article.title?.substring(0, 50) || 'No title'}...`);
            console.log(`      🖼️  ${thumbnail.substring(0, 70)}...`);
            console.log(`      📝 Will update MongoDB with thumbnail URL`);
            
            await newsCollection.updateOne(
              { _id: article._id },
              { $set: updateDoc }
            );
            updated++;
          } else {
            // Mark as not found to prevent future retries
            const updateDoc = {
              thumbnail: null,
              thumbnail_not_found: true,
              thumbnail_fetched_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };
            
            console.log(`   ⚠️  No thumbnail found: ${article.title?.substring(0, 50) || 'No title'}...`);
            console.log(`      📝 Will update MongoDB with: thumbnail=null, thumbnail_not_found=true`);
            
            await newsCollection.updateOne(
              { _id: article._id },
              { $set: updateDoc }
            );
            failed++;
          }
          processed++;
        } catch (error) {
          // Mark as not found on error to prevent future retries
          const updateDoc = {
            thumbnail: null,
            thumbnail_not_found: true,
            thumbnail_fetched_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          
          console.log(`   ❌ Error updating: ${article.title?.substring(0, 50) || 'No title'}... - ${error.message}`);
          console.log(`      📝 Will update MongoDB with: thumbnail=null, thumbnail_not_found=true`);
          
          await newsCollection.updateOne(
            { _id: article._id },
            { $set: updateDoc }
          );
          failed++;
          processed++;
        }
      });
      
      await Promise.all(updatePromises);
      
      // Progress log every 100 articles
      if (processed - lastProgressLog >= 100) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const percentage = ((processed / articles.length) * 100).toFixed(1);
        const rate = (processed / parseFloat(elapsed)).toFixed(1);
        const remaining = articles.length - processed;
        
        // Calculate estimated time remaining in hours and minutes
        let estimatedTimeRemaining = '';
        if (remaining > 0 && parseFloat(rate) > 0) {
          const remainingSeconds = remaining / parseFloat(rate);
          const hours = Math.floor(remainingSeconds / 3600);
          const minutes = Math.floor((remainingSeconds % 3600) / 60);
          const seconds = Math.floor(remainingSeconds % 60);
          
          if (hours > 0) {
            estimatedTimeRemaining = `${hours}h ${minutes}m ${seconds}s`;
          } else if (minutes > 0) {
            estimatedTimeRemaining = `${minutes}m ${seconds}s`;
          } else {
            estimatedTimeRemaining = `${seconds}s`;
          }
        } else {
          estimatedTimeRemaining = '0s';
        }
        
        // Format elapsed time
        const elapsedHours = Math.floor(parseFloat(elapsed) / 3600);
        const elapsedMinutes = Math.floor((parseFloat(elapsed) % 3600) / 60);
        const elapsedSeconds = Math.floor(parseFloat(elapsed) % 60);
        let elapsedFormatted = '';
        if (elapsedHours > 0) {
          elapsedFormatted = `${elapsedHours}h ${elapsedMinutes}m ${elapsedSeconds}s`;
        } else if (elapsedMinutes > 0) {
          elapsedFormatted = `${elapsedMinutes}m ${elapsedSeconds}s`;
        } else {
          elapsedFormatted = `${elapsedSeconds}s`;
        }
        
        console.log('\n' + '='.repeat(80));
        console.log(`📊 PROGRESS UPDATE (Every 100 articles)`);
        console.log('='.repeat(80));
        console.log(`✅ Successfully updated: ${updated} articles`);
        console.log(`⚠️  No thumbnail found: ${failed} articles`);
        console.log(`📊 Total processed: ${processed} / ${articles.length} (${percentage}%)`);
        console.log(`⏱️  Elapsed time: ${elapsedFormatted}`);
        console.log(`⚡ Processing rate: ${rate} articles/second`);
        console.log(`⏳ Estimated time remaining: ${estimatedTimeRemaining}`);
        console.log(`📋 Remaining: ${remaining} articles`);
        console.log('='.repeat(80) + '\n');
        
        lastProgressLog = processed;
      }
      
      // Minimal delay between batches for hyper-optimization
      if (i + BATCH_SIZE < articles.length) {
        await new Promise(resolve => setTimeout(resolve, 100)); // Reduced delay
      }
    }
    
    await cluster.idle();
    await cluster.close();
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    
    // Final summary
    console.log('\n\n' + '='.repeat(80));
    console.log('📊 FINAL SUMMARY');
    console.log('='.repeat(80) + '\n');
    console.log(`✅ Successfully updated: ${updated} articles`);
    console.log(`⚠️  No thumbnail found: ${failed} articles`);
    console.log(`📊 Total processed: ${processed} articles`);
    console.log(`⏱️  Total time: ${totalTime}s`);
    console.log(`⚡ Average: ${(parseFloat(totalTime) / processed).toFixed(1)}s per article`);
    
    // Get final count
    const remaining = await newsCollection.countDocuments(query);
    console.log(`\n📋 Remaining articles without thumbnails: ${remaining}`);
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    if (cluster) {
      await cluster.idle();
      await cluster.close();
    }
    process.exit(1);
  } finally {
    await client.close();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

main().catch(console.error);

