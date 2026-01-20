# Proven Google Ads API Examples

Complete reference of working Google Ads API calls with actual input/output examples from production use.

**Note**: All examples use real API structures tested in Google Ads Scripts. Customer IDs, asset IDs, and business names are placeholders.

---

## Table of Contents

1. [Asset Queries (GAQL)](#asset-queries-gaql)
2. [Asset Creation (Mutations)](#asset-creation-mutations)
3. [Asset Updates (Mutations)](#asset-updates-mutations)
4. [Performance Queries](#performance-queries)
5. [Campaign Asset Queries](#campaign-asset-queries)
6. [Common Error Handling](#common-error-handling)

---

## Asset Queries (GAQL)

### Query All Image Assets

**Query:**
```javascript
var query = "SELECT asset.id, asset.name, asset.type, " +
  "asset.image_asset.full_size.width_pixels, " +
  "asset.image_asset.full_size.height_pixels " +
  "FROM asset " +
  "WHERE asset.type = 'IMAGE'";

var result = AdsApp.search(query);

while (result.hasNext()) {
  var row = result.next();
  var asset = row.asset;

  Logger.log('Asset ID: ' + asset.id);
  Logger.log('Name: ' + asset.name);
  Logger.log('Dimensions: ' + asset.imageAsset.fullSize.widthPixels + 'x' + asset.imageAsset.fullSize.heightPixels);
}
```

**Sample Output:**
```
Asset ID: 123456789
Name: explorelocalstreets_id-480_en_16-9.jpg
Dimensions: 1920x1080
```

**Important Notes:**
- ❌ Cannot filter by date (`asset.creation_time` doesn't exist)
- ❌ Cannot filter by creator or source

---

### Query All YouTube Video Assets

**Query:**
```javascript
var query = "SELECT asset.id, asset.name, " +
  "asset.youtube_video_asset.youtube_video_id, " +
  "asset.youtube_video_asset.youtube_video_title " +
  "FROM asset " +
  "WHERE asset.type = 'YOUTUBE_VIDEO'";

var result = AdsApp.search(query);

while (result.hasNext()) {
  var row = result.next();
  var asset = row.asset;

  Logger.log('Asset ID: ' + asset.id);
  Logger.log('YouTube ID: ' + asset.youtubeVideoAsset.youtubeVideoId);
  Logger.log('Title: ' + asset.youtubeVideoAsset.youtubeVideoTitle);
}
```

**Sample Output:**
```
Asset ID: 987654321
YouTube ID: dQw4w9WgXcQ
Title: Mapy.com - Explore Innsbruck
```

---

### Query Assets with Campaign Usage

**Query:**
```javascript
// IMPORTANT: Must include campaign.advertising_channel_sub_type in SELECT
// when using it in WHERE clause (GAQL requirement)
var query = "SELECT asset.id, asset.name, asset.type, " +
  "campaign.id, campaign.name, campaign.status, " +
  "campaign.advertising_channel_sub_type " +
  "FROM campaign_asset " +
  "WHERE campaign.advertising_channel_sub_type IN ('APP_CAMPAIGN', 'APP_CAMPAIGN_FOR_ENGAGEMENT') " +
  "AND campaign.status = 'ENABLED'";

var result = AdsApp.search(query);

while (result.hasNext()) {
  var row = result.next();

  Logger.log('Asset: ' + row.asset.name);
  Logger.log('Campaign: ' + row.campaign.name);
  Logger.log('Status: ' + row.campaign.status);
}
```

**Sample Output:**
```
Asset: navigatelocal_en_16-9.jpg
Campaign: Mapy|US|ENGLISH|iOS|SIGN-UP
Status: ENABLED
```

**Common Error:**
```
QueryError.EXPECTED_REFERENCED_FIELD_IN_SELECT_CLAUSE
```
**Solution:** Add `campaign.advertising_channel_sub_type` to SELECT clause

---

## Asset Creation (Mutations)

### Create Image Asset from Base64

**Code:**
```javascript
// Step 1: Download image (from URL, Drive, etc.)
var imageUrl = 'https://example.com/image.jpg';
var response = UrlFetchApp.fetch(imageUrl);
var imageBlob = response.getBlob();

// Step 2: Base64 encode
var base64Data = Utilities.base64Encode(imageBlob.getBytes());

// Step 3: Create asset
var assetOperation = {
  create: {
    name: 'exploremaps_id-480_en_16-9.jpg',
    type: 'IMAGE',
    imageAsset: {
      data: base64Data
    }
  }
};

var result = AdsApp.mutate({
  assetOperation: assetOperation
});

// Step 4: Check result
if (result.isSuccessful()) {
  Logger.log('Asset created successfully');

  // Extract asset ID from result
  var resourceName = result.sc.Ia.results[0].resourceName;
  var assetId = resourceName.split('/').pop();
  Logger.log('Asset ID: ' + assetId);
} else {
  Logger.log('Error: ' + JSON.stringify(result.sc.Ia.errors));
}
```

**Sample Output (Success):**
```
Asset created successfully
Asset ID: 123456789
```

**Sample Output (Error):**
```javascript
Error: [{
  "errorCode": {
    "imageError": "ASPECT_RATIO_NOT_ALLOWED"
  },
  "message": "Image aspect ratio 3:4 is not allowed. Allowed ratios: 1.91:1, 1:1, 4:5"
}]
```

**Allowed Image Aspect Ratios:**
- `1.91:1` (16:9 equivalent)
- `1:1` (square)
- `4:5` (vertical)

---

### Create YouTube Video Asset

**Code:**
```javascript
var assetOperation = {
  create: {
    name: 'mapy_explore_streets_en_dQw4w9WgXcQ',
    type: 'YOUTUBE_VIDEO',
    youtubeVideoAsset: {
      youtubeVideoId: 'dQw4w9WgXcQ'  // Just the ID, not full URL
    }
  }
};

var result = AdsApp.mutate({
  assetOperation: assetOperation
});

if (result.isSuccessful()) {
  var resourceName = result.sc.Ia.results[0].resourceName;
  var assetId = resourceName.split('/').pop();
  Logger.log('Video asset created: ' + assetId);
} else {
  Logger.log('Error: ' + JSON.stringify(result.sc.Ia.errors));
}
```

**Sample Output:**
```
Video asset created: 987654321
```

**Requirements:**
- Video must be public or unlisted (not private)
- Use 11-character video ID (e.g., `dQw4w9WgXcQ`)
- Do NOT use full URL
- You need to allow G Ads Scripts access to YouTube API 

---

## Asset Updates (Mutations)

### Update Ad Headlines (Text Assets)

**Code:**
```javascript
// IMPORTANT: Text assets use { text: 'content' } format
// Image/video assets use { asset: 'resource-name' } format

var payload = {
  adOperation: {
    update: {
      resourceName: 'customers/1234567890/ads/987654321',
      appAd: {
        headlines: [
          { text: 'Find Local Spots' },
          { text: 'Navigate Any City' },
          { text: 'Explore Smart Routes' }
        ]
      }
    },
    updateMask: 'app_ad.headlines'  // Critical: must match field being updated
  }
};

var result = AdsApp.mutate(payload);

if (result.isSuccessful()) {
  Logger.log('Headlines updated successfully');
} else {
  Logger.log('Error: ' + JSON.stringify(result.sc.Ia.errors));
}
```

**Sample Output:**
```
Headlines updated successfully
```

**Character Limits:**
- Headlines: 30 characters max
- Descriptions: 90 characters max

---

### Update Ad Images (Image Assets)

**Code:**
```javascript
// IMPORTANT: Must include ALL existing images + new ones
// Arrays are replaced, not appended!

var payload = {
  adOperation: {
    update: {
      resourceName: 'customers/1234567890/ads/987654321',
      appAd: {
        images: [
          // Existing images (keep these)
          { asset: 'customers/1234567890/assets/111111111' },
          { asset: 'customers/1234567890/assets/222222222' },
          // New image (add this)
          { asset: 'customers/1234567890/assets/333333333' }
        ]
      }
    },
    updateMask: 'app_ad.images'
  }
};

var result = AdsApp.mutate(payload);
```

**Critical Rule:**
❌ **WRONG** (removes existing images):
```javascript
appAd: {
  images: [
    { asset: 'customers/1234567890/assets/333333333' }  // Only new image
  ]
}
```

✅ **CORRECT** (keeps all images):
```javascript
appAd: {
  images: [
    // ALL existing images
    { asset: 'customers/1234567890/assets/111111111' },
    { asset: 'customers/1234567890/assets/222222222' },
    // Plus new image
    { asset: 'customers/1234567890/assets/333333333' }
  ]
}
```

---

### Update Ad Videos (YouTube Assets)

**Code:**
```javascript
var payload = {
  adOperation: {
    update: {
      resourceName: 'customers/1234567890/ads/987654321',
      appAd: {
        youtubeVideos: [
          // Existing videos (keep these)
          { asset: 'customers/1234567890/assets/444444444' },
          // New video (add this)
          { asset: 'customers/1234567890/assets/555555555' }
        ]
      }
    },
    updateMask: 'app_ad.youtube_videos'  // Note: snake_case in updateMask
  }
};

var result = AdsApp.mutate(payload);
```

**Update Mask Reference:**

| Field Type | Update Mask |
|------------|-------------|
| Headlines | `app_ad.headlines` |
| Descriptions | `app_ad.descriptions` |
| Images | `app_ad.images` |
| Videos | `app_ad.youtube_videos` |

---

## Performance Queries

### Query Text Asset Performance

**Query:**
```javascript
var query =
  "SELECT " +
  "ad_group_ad.ad.id, " +
  "ad_group_ad.ad.name, " +
  "ad_group_ad_asset_view.field_type, " +
  "ad_group_ad_asset_view.performance_label, " +
  "asset.text_asset.text, " +
  "metrics.impressions, " +
  "metrics.clicks, " +
  "metrics.conversions, " +
  "campaign.advertising_channel_sub_type " +
  "FROM ad_group_ad_asset_view " +
  "WHERE campaign.id = 12345678901 " +
  "AND campaign.advertising_channel_sub_type = 'APP_CAMPAIGN' " +
  "AND ad_group_ad.status = 'ENABLED' " +
  "AND segments.date DURING LAST_30_DAYS";

var result = AdsApp.search(query);

while (result.hasNext()) {
  var row = result.next();

  Logger.log('Text: ' + row.asset.textAsset.text);
  Logger.log('Type: ' + row.adGroupAdAssetView.fieldType);  // HEADLINE or DESCRIPTION
  Logger.log('Performance: ' + row.adGroupAdAssetView.performanceLabel);  // LOW/GOOD/BEST
  Logger.log('Impressions: ' + row.metrics.impressions);
  Logger.log('Clicks: ' + row.metrics.clicks);
}
```

**Sample Output:**
```
Text: Find Local Spots Fast
Type: HEADLINE
Performance: BEST
Impressions: 15234
Clicks: 892
```

**Performance Labels:**
- `BEST` - Top performers
- `GOOD` - Above average
- `LOW` - Below average, consider replacing
- `LEARNING` - Not enough data yet
- `UNRATED` - No rating available

---

### Query Image Asset Performance

**Query:**
```javascript
var query =
  "SELECT " +
  "asset.id, " +
  "asset.name, " +
  "ad_group_ad_asset_view.performance_label, " +
  "metrics.impressions, " +
  "metrics.clicks, " +
  "metrics.cost_micros " +
  "FROM ad_group_ad_asset_view " +
  "WHERE asset.type = 'IMAGE' " +
  "AND campaign.id = 12345678901 " +
  "AND segments.date DURING LAST_30_DAYS";

var result = AdsApp.search(query);

while (result.hasNext()) {
  var row = result.next();

  Logger.log('Asset: ' + row.asset.name);
  Logger.log('Performance: ' + row.adGroupAdAssetView.performanceLabel);
  Logger.log('Impressions: ' + row.metrics.impressions);
}
```

**Sample Output:**
```
Asset: exploremaps_id-480_en_16-9.jpg
Performance: GOOD
Impressions: 8456
```

**Note:** `metrics.video_views` is NOT supported in `ad_group_ad_asset_view` table

---

## Campaign Asset Queries

### Get All Assets Used in a Campaign

**Query:**
```javascript
var query =
  "SELECT " +
  "asset.id, " +
  "asset.name, " +
  "asset.type, " +
  "campaign_asset.status, " +
  "campaign.name " +
  "FROM campaign_asset " +
  "WHERE campaign.id = 12345678901";

var result = AdsApp.search(query);

while (result.hasNext()) {
  var row = result.next();

  Logger.log('Asset: ' + row.asset.name);
  Logger.log('Type: ' + row.asset.type);
  Logger.log('Status: ' + row.campaignAsset.status);  // ENABLED, PAUSED, REMOVED
}
```

**Sample Output:**
```
Asset: navigatelocal_en_16-9.jpg
Type: IMAGE
Status: ENABLED
```

---

## Common Error Handling

### Extract Errors from Failed Mutations

**Code:**
```javascript
var result = AdsApp.mutate(operation);

if (!result.isSuccessful()) {
  // Extract error details from undocumented structure
  if (result.sc && result.sc.Ia && result.sc.Ia.errors) {
    result.sc.Ia.errors.forEach(function(err) {
      Logger.log('Error Code: ' + JSON.stringify(err.errorCode));
      Logger.log('Message: ' + err.message);

      // Extract specific error types
      if (err.errorCode.imageError) {
        Logger.log('Image Error: ' + err.errorCode.imageError);
      }
      if (err.errorCode.youtubeVideoError) {
        Logger.log('Video Error: ' + err.errorCode.youtubeVideoError);
      }
      if (err.errorCode.fieldError) {
        Logger.log('Field Error: ' + err.errorCode.fieldError);
      }
    });
  } else {
    Logger.log('Unknown error structure: ' + JSON.stringify(result));
  }
}
```

**Sample Error Output:**
```
Error Code: {"imageError":"ASPECT_RATIO_NOT_ALLOWED"}
Message: Image aspect ratio 3:4 is not allowed
Image Error: ASPECT_RATIO_NOT_ALLOWED
```

---

### Handle Multiple Result Structures

**Code:**
```javascript
function extractAssetIdFromResult(result) {
  try {
    var resourceName = null;

    // Try structure 1: result.sc.Ia.results[0].resourceName
    if (result.sc && result.sc.Ia && result.sc.Ia.results && result.sc.Ia.results.length > 0) {
      resourceName = result.sc.Ia.results[0].resourceName;
    }

    // Try structure 2: result.results[0].resourceName
    if (!resourceName && result.results && result.results.length > 0) {
      resourceName = result.results[0].resourceName;
    }

    // Try structure 3: result.resourceName
    if (!resourceName && result.resourceName) {
      resourceName = result.resourceName;
    }

    if (!resourceName) {
      Logger.log('No resourceName found. Available keys: ' + JSON.stringify(Object.keys(result)));
      return null;
    }

    // Parse resource name: "customers/1234567890/assets/123456789"
    var parts = resourceName.split('/');
    return parts[parts.length - 1];  // Return asset ID

  } catch (e) {
    Logger.log('Error extracting asset ID: ' + e.message);
    return null;
  }
}
```

---

## API Limitations

### Fields That Do NOT Exist

Tested 29 field variations - **only 4 work**:

❌ **NOT Available:**
- Date/time: `asset.creation_time`, `asset.updated_at`, `asset.upload_date`
- User: `asset.created_by`, `asset.owner`, `asset.modified_by`
- Metadata: `asset.source`, `asset.status`, `asset.version`

✅ **Available:**
- `asset.id` - Unique identifier
- `asset.name` - Asset name (immutable after creation)
- `asset.type` - Asset type (IMAGE, YOUTUBE_VIDEO, TEXT, etc.)
- `asset.resource_name` - Full resource path

### Operations Not Supported via API

❌ **Cannot do via API:**
- Delete assets (must use UI: Asset studio → Asset library)
- Update asset names (immutable after creation)
- Filter assets by creation date
- Add metadata fields to assets

✅ **Can do via API:**
- Create assets (images, videos, text)
- Add/remove assets from ads
- Update ad text assets
- Query asset performance

---

## Best Practices

### 1. Always Check Result Structure
```javascript
if (result.isSuccessful()) {
  // Success path
} else {
  // Error path - check multiple structures
}
```

### 2. Use Correct Asset Format
```javascript
// Text assets
{ text: 'content' }

// Image/video assets
{ asset: 'customers/123/assets/456' }
```

### 3. Include ALL Assets in Updates
```javascript
// When updating arrays, include existing + new
appAd: {
  images: [
    ...existingImages,
    ...newImages
  ]
}
```

**API Version**: Google Ads API v16
