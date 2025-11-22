/**
 * Update News Collection with Thumbnails
 * 
 * Reads existing news articles from MongoDB and adds thumbnail URLs
 * Uses hyper-optimized Puppeteer cluster for fast processing
 * 
 * Usage:
 *   node update-news-thumbnails.js
 * 
 * Options (via environment variables):
 *   LIMIT - Number of articles to process (default: all without thumbnails)
 *   BATCH_SIZE - Process in batches (default: 50)
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
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '50');
const MAX_CONCURRENCY = parseInt(process.env.MAX_CONCURRENCY || '5');

/**
 * Extract thumbnail from article URL
 */
async function fetchThumbnailFromUrl(url) {
  try {
    const response = await axios.get(url, {
      timeout: 5000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      maxRedirects: 5
    });
    
    const dom = new JSDOM(response.data);
    const document = dom.window.document;
    
    // Try Open Graph image
    const ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage && ogImage.content) {
      return ogImage.content;
    }
    
    // Try Twitter card image
    const twitterImage = document.querySelector('meta[name="twitter:image"]') || 
                        document.querySelector('meta[property="twitter:image"]');
    if (twitterImage && twitterImage.content) {
      return twitterImage.content;
    }
    
    // Try meta image
    const metaImage = document.querySelector('meta[name="image"]');
    if (metaImage && metaImage.content) {
      return metaImage.content;
    }
    
    // Try to find first large image
    const images = document.querySelectorAll('img');
    for (const img of images) {
      const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
      if (src && (src.startsWith('http://') || src.startsWith('https://'))) {
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
      timeout: 8000 
    });
    
    // Minimal wait for JavaScript
    await new Promise(resolve => setTimeout(resolve, 800));
    
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

async function main() {
  const startTime = Date.now();
  console.log('🖼️  Updating News Collection with Thumbnails\n');
  console.log(`MongoDB URI: ${MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')}`);
  console.log(`Database: ${DB_NAME}`);
  console.log(`Collection: ${NEWS_COLLECTION}`);
  console.log(`Limit: ${LIMIT || 'All articles without thumbnails'}`);
  console.log(`Batch Size: ${BATCH_SIZE}`);
  console.log(`Concurrency: ${MAX_CONCURRENCY}\n`);
  console.log('='.repeat(80) + '\n');
  
  const client = new MongoClient(MONGODB_URI);
  let cluster;
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');
    
    const db = client.db(DB_NAME);
    const newsCollection = db.collection(NEWS_COLLECTION);
    
    // Find articles without thumbnails
    // Only process articles that:
    // 1. Don't have thumbnails
    // 2. Haven't been processed before (no thumbnail_fetched_at) OR last attempt was >7 days ago
    const query = {
      $and: [
        {
          $or: [
            { thumbnail: { $exists: false } },
            { thumbnail: null },
            { thumbnail: '' }
          ]
        },
        {
          $or: [
            // Never processed
            { thumbnail_fetched_at: { $exists: false } },
            { thumbnail_fetched_at: null },
            // Retry if processed more than 7 days ago (in case we want to retry failed ones)
            { thumbnail_fetched_at: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }
          ]
        }
      ]
    };
    
    const totalWithoutThumbnails = await newsCollection.countDocuments(query);
    console.log(`📊 Found ${totalWithoutThumbnails} articles without thumbnails\n`);
    
    if (totalWithoutThumbnails === 0) {
      console.log('✅ All articles already have thumbnails or have been processed!');
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
    console.log('='.repeat(80) + '\n');
    
    // Launch Puppeteer cluster
    console.log('🚀 Launching Puppeteer cluster...\n');
    cluster = await Cluster.launch({
      concurrency: Cluster.CONCURRENCY_CONTEXT,
      maxConcurrency: MAX_CONCURRENCY,
      puppeteerOptions: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
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
          console.log(`   ❌ ${article.title.substring(0, 50)}... - Error: ${error}`);
          failed++;
          return;
        }
        
        try {
          const thumbnail = await fetchThumbnailFromUrl(actualUrl);
          
          if (thumbnail) {
            await newsCollection.updateOne(
              { _id: article._id },
              {
                $set: {
                  thumbnail: thumbnail,
                  thumbnail_fetched_at: new Date().toISOString(),
                  updated_at: new Date().toISOString()
                }
              }
            );
            console.log(`   ✅ Updated: ${article.title.substring(0, 50)}...`);
            console.log(`      🖼️  ${thumbnail.substring(0, 70)}...`);
            updated++;
          } else {
            // Mark as processed even if no thumbnail found
            await newsCollection.updateOne(
              { _id: article._id },
              {
                $set: {
                  thumbnail: null,
                  thumbnail_fetched_at: new Date().toISOString(),
                  updated_at: new Date().toISOString()
                }
              }
            );
            console.log(`   ⚠️  No thumbnail: ${article.title.substring(0, 50)}...`);
            failed++;
          }
          processed++;
        } catch (error) {
          console.log(`   ❌ Error updating: ${article.title.substring(0, 50)}... - ${error.message}`);
          failed++;
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
      
      // Small delay between batches
      if (i + BATCH_SIZE < articles.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
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

