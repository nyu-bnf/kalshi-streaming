/**
 * Standalone Script: Update Events and Markets
 * 
 * Fetches events and markets from Kalshi API and stores them in MongoDB
 * Prevents duplicates using existing logic
 * 
 * Usage:
 *   node scripts/update-events-markets.js
 */

import dotenv from 'dotenv';
import { connectDB } from '../utils/db.js';
import { updateEventsAndMarkets } from '../services/kalshiService.js';

dotenv.config();

async function main() {
  console.log('🚀 Starting Events and Markets Update\n');
  console.log('='.repeat(80) + '\n');
  
  try {
    // Connect to database
    await connectDB();
    console.log('✅ Connected to MongoDB\n');
    
    // Update events (with duplicate prevention)
    console.log('📋 Updating events...');
    await updateEventsAndMarkets();
    console.log('✅ Events updated\n');
  
    
    console.log('='.repeat(80));
    console.log('✅ All updates completed successfully!\n');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main().catch(console.error);


