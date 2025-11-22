# GitHub Actions Workflow Setup

## Update News Pipeline

This workflow automates the daily update of events, markets, news, and thumbnails.

### Workflow Steps

1. **Update Events and Markets** - Fetches new events and markets from Kalshi API (no duplicates)
2. **Populate News Collection** - Fetches news articles for events (no duplicates)
3. **Update Thumbnails** - Adds thumbnails to newly added news articles (skips already processed)

### Required GitHub Secrets

Add these secrets in your GitHub repository settings (Settings → Secrets and variables → Actions):

1. **MONGO_URI** - Your MongoDB connection string
   - Example: `mongodb+srv://user:password@cluster.mongodb.net/dbname?retryWrites=true&w=majority`

2. **DB_NAME** - Your MongoDB database name
   - Example: `test` or `kalshi`

3. **NEWS_LANG** (Optional) - Language for Google News
   - Default: `en-US`

4. **NEWS_REGION** (Optional) - Region for Google News
   - Default: `US`

5. **NEWS_CEID** (Optional) - Country/region code for Google News
   - Default: `US:en`

### Schedule

The workflow runs daily at 2:00 AM UTC. You can also trigger it manually via the "Actions" tab.

### Manual Trigger

1. Go to the "Actions" tab in your GitHub repository
2. Select "Update News Pipeline" workflow
3. Click "Run workflow"

### Notes

- The workflow prevents duplicates at each step
- Thumbnails are only fetched for new articles (not already processed)
- Failed thumbnail fetches are marked to avoid retrying immediately
- Articles without thumbnails are marked as processed to avoid wasting time


