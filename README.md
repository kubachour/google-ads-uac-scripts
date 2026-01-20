# Google Ads App Campaign Asset Automation

Production-ready scripts for managing assets in Google Ads App campaigns programmatically.

> **Real-world tested patterns** from managing thousands of assets across multiple languages and markets.

---

## 🚀 Quick Start

1. **Choose an example script** from [`examples/`](examples/)
2. **Copy the entire script** into Google Ads Scripts editor
3. **Update the CONFIG section** with your credentials and IDs
4. **Set `DRY_RUN: true`** for safe preview
5. **Click "Run"** and review the output
6. **Set `DRY_RUN: false`** and run again to execute

**→ Start with:** [`1-upload-images-from-database.gs`](examples/1-upload-images-from-database.gs) (most common use case)

---

## 📚 What's Included

### 5 Production-Ready Example Scripts

1. **[Upload Images from Database](examples/1-upload-images-from-database.gs)** (479 lines)
   - Sync image assets from external database (Notion, Airtable, etc.)
   - Duplicate detection using unique IDs
   - Multiple aspect ratios per creative
   - Automatic aspect ratio extraction from image dimensions

2. **[Upload Videos from YouTube](examples/2-upload-videos-from-youtube.gs)** (333 lines)
   - Multi-language YouTube playlist support
   - Duplicate detection using YouTube video IDs
   - Automatic pagination for large playlists

3. **[Sync Assets to Database](examples/3-sync-assets-to-database.gs)** (436 lines)
   - Bi-directional sync (Google Ads → Database)
   - Format-specific field updates (16:9, 9:16, 4:5, 1:1)
   - Live campaign status tracking
   - Multi-tier asset matching (ID > Video ID > Name > Fuzzy)

4. **[Monitor & Replace Text Assets](examples/4-monitor-replace-text-assets.gs)** (432 lines)
   - Performance monitoring using `performance_label`
   - Automatic replacement of LOW performers
   - Respects min/max asset limits

5. **[Reconcile Database Sync](examples/5-reconcile-database-sync.gs)** (422 lines)
   - Fix sync discrepancies between systems
   - Read-only for Google Ads (no mutations)
   - Idempotent (safe to run multiple times)

### Comprehensive Reference

- **[PROVEN_API_EXAMPLES.md](PROVEN_API_EXAMPLES.md)** - Working API calls with actual input/output examples

---

## 📖 Table of Contents

1. [Installation](#installation)
2. [How Google Ads Scripts Work](#how-google-ads-scripts-work)
3. [Best Practices](#best-practices)
4. [Common Issues & Solutions](#common-issues--solutions)
5. [API Limitations](#api-limitations)
6. [DRY RUN Pattern](#dry-run-pattern)
7. [Asset Naming Convention](#asset-naming-convention)
8. [Frequently Asked Questions](#frequently-asked-questions)

---

## Installation

### Step 1: Access Google Ads Scripts

1. Log in to **Google Ads**
2. Navigate to: **Tools** → **Bulk actions** → **Scripts**
3. Click **"+ New script"**

### Step 2: Copy Example Script

1. Choose an example from [`examples/`](examples/)
2. Copy the **entire file contents**
3. Paste into the Google Ads Scripts editor
4. Give it a meaningful name (e.g., "Upload Images from Notion")

### Step 3: Enable Required APIs

**For YouTube scripts:**
1. In the script editor, click **"Advanced APIs"** (left sidebar)
2. Check **"YouTube Data API v3"**
3. If prompted, enable the API in Google Cloud Console

**For external database scripts:**
- No additional APIs needed in Google Ads Scripts
- Just provide your API credentials in the CONFIG section

### Step 4: Configure Settings

Update the `CONFIG` section at the top of the script:

```javascript
var CONFIG = {
  DATABASE: {
    API_KEY: 'your_actual_api_key',
    DATABASE_ID: 'your_actual_database_id'
  },
  DRY_RUN: true  // Start with true for safe preview
};
```

### Step 5: Test Run

1. Click **"Run"** button (▶️)
2. **Grant permissions** when prompted (first run only)
   - Click "Review Permissions"
   - Choose your Google account
   - Click "Advanced" → "Go to [script name] (unsafe)"
   - Click "Allow"
3. Review output in the **Logs** panel
4. If DRY_RUN is true, no changes are made - just preview

### Step 6: Schedule (Optional)

1. Click **"Triggers"** (left sidebar)
2. Click **"+ Add trigger"**
3. Choose frequency: Daily, Weekly, or Monthly
4. Set time of day
5. Click "Save"

---

## How Google Ads Scripts Work

### Script Environment

Google Ads Scripts run on **Google Apps Script** platform:

- **Language**: JavaScript (ES5, no modern ES6+ features)
- **Execution limit**: 6 minutes per run
- **No module imports**: All code must be in one file, all code must be in main() function
- **No PropertiesService**: Use external storage (Sheets, Database) or hardcode config

### Entry Point

```javascript
function main() {
  // Your code starts here
  // This function is called when you click "Run"
}
```

### Available Services

- `AdsApp` - Google Ads API access
- `UrlFetchApp` - HTTP requests
- `Utilities` - Base64, sleep, JSON, etc.
- `Logger` - Console logging
- `YouTube` - YouTube Data API (if enabled)
- `SpreadsheetApp` - Google Sheets access

### Authorization Flow

**First run:**
1. Click "Run"
2. **"Authorization required"** dialog appears
3. Click "Review Permissions"
4. Choose account
5. **Click "Advanced"** (important!)
6. Click **"Go to [script name] (unsafe)"**
7. Click "Allow"

**Why "unsafe"?**
- Google warns about unverified scripts
- Your own scripts are safe
- This is normal for development scripts

---

## Best Practices

### 1. Always Use DRY_RUN First

```javascript
var CONFIG = {
  DRY_RUN: true  // Preview mode - no mutations
};

function uploadAsset(data) {
  if (CONFIG.DRY_RUN) {
    Logger.log('[DRY RUN] Would upload: ' + data.name);
    return { dryRun: true };
  }

  // Actual upload logic
  return AdsApp.mutate(operation);
}
```

**Why?**
- Preview changes before executing. G Ads Script are offering the same function, but things won't happen IN G Ads only. Dry running makes sure you won't create mess in Sheets, Notion or whereever you keep your creatives data

---

### 2. Implement Pagination for External APIs

```javascript
function queryDatabase(filter) {
  var allResults = [];
  var hasMore = true;
  var startCursor = null;

  // Keep fetching until no more results
  while (hasMore) {
    var payload = { page_size: 100 };
    if (startCursor) payload.start_cursor = startCursor;

    var response = makeApiRequest(payload);

    if (response.results) {
      allResults = allResults.concat(response.results);
    }

    hasMore = response.has_more || false;
    startCursor = response.next_cursor || null;

    // Safety limit
    if (allResults.length > 10000) break;
  }

  return allResults;
}
```

**Why?**
- External APIs sometimes have a page limit, like 100 records per request (Howdy, Notion!)
- Without pagination, you'll miss records beyond first page
- **Real bug:** Script skipped high-ID records because pagination was missing

---

### 3. Always Wrap External API Calls in try-catch

```javascript
try {
  var response = YouTube.PlaylistItems.list('snippet', params);

  if (!response || !response.items) {
    Logger.log('Empty response from YouTube API');
    return [];
  }

  // Process response

} catch (e) {
  Logger.log('Error: ' + e.message);
  Logger.log('Possible causes:');
  Logger.log('  - API quota exceeded');
  Logger.log('  - Invalid credentials');
  Logger.log('  - Network timeout');
  return [];  // Graceful degradation
}
```

**Why?**
- External APIs can fail unexpectedly
- Script shouldn't crash on API error
- Other items can still be processed

---

### 4. Use Correct Asset Format

```javascript
// ✓ CORRECT - Text assets
appAd: {
  headlines: [
    { text: 'Find Local Spots' },
    { text: 'Navigate Any City' }
  ]
}

// ✓ CORRECT - Image/video assets
appAd: {
  images: [
    { asset: 'customers/123/assets/456' },
    { asset: 'customers/123/assets/789' }
  ]
}

// ✗ WRONG - Mixed format
appAd: {
  headlines: [
    { asset: 'customers/123/assets/456' }  // Wrong! Use { text: '...' }
  ]
}
```

**Why?**
- Google Ads API has different formats for text vs media assets
- Using wrong format causes mutation errors

---

### 5. Include ALL Existing Assets When Updating

```javascript
// ✗ WRONG - This removes existing images!
appAd: {
  images: [
    { asset: 'customers/123/assets/new-image' }  // Only new image
  ]
}

// ✓ CORRECT - Keep existing + add new
var existingImages = ad.images.map(function(img) {
  return { asset: img.asset };
});

appAd: {
  images: existingImages.concat([
    { asset: 'customers/123/assets/new-image' }
  ])
}
```

**Why?**
- Google Ads API **replaces** arrays, doesn't append
- Forgetting existing assets removes them from the ad

---

### 6. Add Safety Limits

```javascript
var CONFIG = {
  MAX_UPDATES: 100,      // Max updates per run
  MAX_VIDEOS: 50,        // Max videos per playlist
  RATE_LIMIT_MS: 350     // Delay between API calls
};

// Apply limits
for (var i = 0; i < Math.min(items.length, CONFIG.MAX_UPDATES); i++) {
  updateItem(items[i]);

  // Rate limiting
  if (i < items.length - 1) {
    Utilities.sleep(CONFIG.RATE_LIMIT_MS);
  }
}
```

**Why?**
- Prevents accidental mass updates
- Respects API rate limits (e.g., Notion: 3 req/sec)
- Avoids 6-minute execution timeout

---

### 7. Validate Asset Name Length

```javascript
function generateAssetName(name, metadata) {
  var assetName = cleanName + '_' + metadata + '.jpg';

  // Google Ads limit: 255 characters
  if (assetName.length > 255) {
    throw new Error('Asset name too long (' + assetName.length + ' chars)');
  }

  return assetName;
}
```

**Why?**
- Google Ads has 255 character limit
- Long names cause upload failures

---

### 8. Check `result.isSuccessful()` After Mutations

```javascript
var result = AdsApp.mutate(operation);

// ✗ WRONG - Assumes success
Logger.log('Asset uploaded: ' + result.assetId);

// ✓ CORRECT - Check for errors
if (result.isSuccessful()) {
  Logger.log('Asset uploaded successfully');
} else {
  // Extract error details
  if (result.sc && result.sc.Ia && result.sc.Ia.errors) {
    result.sc.Ia.errors.forEach(function(err) {
      Logger.log('Error: ' + err.message);
    });
  }
}
```

**Why?**
- Failed mutations don't throw errors
- Must manually check `isSuccessful()`
- Errors are in undocumented `result.sc.Ia.errors` structure

---

### What You CANNOT Do

Comprehensively tested - **29 field variations, only 4 work**:

❌ **Asset Date/Time Fields** (13 variations tested):
- `asset.creation_time`, `asset.created_time`, `asset.upload_time`
- `asset.created_at`, `asset.updated_at`, `asset.modified_at`
- Cannot filter assets by date in GAQL queries

❌ **Asset Metadata Fields** (16 variations tested):
- `asset.created_by`, `asset.owner`, `asset.source`, `asset.status`
- No audit trail (who created, when modified)

❌ **Delete Assets via API**:
- Must use Google Ads UI: **Asset studio → Asset library**
- Select assets → Click delete button

❌ **Update Asset Names**:
- Asset names are **immutable** after creation
- Cannot rename via API

✅ **What IS Available:**
- `asset.id` - Unique identifier
- `asset.name` - Asset name (read-only after creation)
- `asset.type` - Asset type (IMAGE, YOUTUBE_VIDEO, TEXT)
- `asset.resource_name` - Full resource path

### Workarounds

**To find "recent" assets:**
```javascript
// Use campaign_asset table (shows assets in active campaigns)
var query = "SELECT asset.id, asset.name " +
  "FROM campaign_asset " +
  "WHERE campaign.status = 'ENABLED'";
```

This returns assets actively used in enabled campaigns, serving as a proxy for "recently added". Fun fact: it's of course possible to see them by date in G Ads UI.

**To track metadata:**
- Store metadata in external database
- Use structured asset names: `name_id-123_lang_date_aspect.ext`
- Parse name to extract metadata

---

## DRY RUN Pattern

### What is DRY RUN?

**DRY RUN** (Dry Run) mode previews changes without executing them.

**Benefits:**
- ✅ Safe testing with real data
- ✅ Catch errors before mutations
- ✅ Verify logic and filters
- ✅ No risk to live campaigns

### Implementation

```javascript
var CONFIG = {
  DRY_RUN: true  // Set false to execute
};

function main() {
  Logger.log('=== Starting Script ===');

  if (CONFIG.DRY_RUN) {
    Logger.log('⚠ DRY RUN MODE - No changes will be made');
  }

  var items = getItemsToProcess();

  for (var i = 0; i < items.length; i++) {
    processItem(items[i]);
  }
}

function processItem(item) {
  if (CONFIG.DRY_RUN) {
    Logger.log('[DRY RUN] Would process: ' + item.name);
    return;
  }

  // Actual processing
  var result = AdsApp.mutate(operation);
  Logger.log('Processed: ' + item.name);
}
```

### Best Practices

1. **Always start with DRY_RUN = true**
2. **Review logs carefully**
3. **Test with small data set first**
4. **Set DRY_RUN = false only when confident**
5. **Add DRY_RUN to all mutation functions**

## Frequently Asked Questions

### Can I use ES6+ features (arrow functions, async/await)?

**No.** Google Ads Scripts use Google Apps Script runtime, which only supports ES5 JavaScript.

❌ **NOT Supported:**
```javascript
// Arrow functions
const uploadAsset = (asset) => { ... };

// async/await
async function uploadAsset(asset) {
  await fetch(url);
}

// Template literals
Logger.log(`Asset: ${asset.name}`);

// let/const
let count = 0;
```

✅ **Use Instead:**
```javascript
// Function expressions
var uploadAsset = function(asset) { ... };

// Callbacks (no async/await)
function uploadAsset(asset, callback) {
  var result = UrlFetchApp.fetch(url);
  callback(result);
}

// String concatenation
Logger.log('Asset: ' + asset.name);

// var only
var count = 0;
```
## Contributing

Found an issue or have improvements?

1. Test your changes thoroughly
2. Document with clear examples
3. Include before/after output
4. Submit with context and use case

---

## License

MIT - Use freely, share generously.

**Attribution appreciated but not required.**
