# App Campaign Asset Mutation Guide

> **Note:** All customer IDs, asset IDs, campaign IDs, and resource names in this document are placeholder examples. Replace `1234567890` with your actual Google Ads Customer ID (without dashes) before use.

## Overview

This document provides complete technical guidance for programmatically modifying assets (text, images, videos) in Google Ads App campaigns using the Google Ads API and Google Ads Scripts.

**Key Finding**: App campaign assets ARE mutable via API, but require using the correct service (`AdService`) and update mask format. This was confirmed through Google Ads API forum discussions where Google engineers provided working examples.

---

## Core Concepts

### App Campaign Structure

```
Account
└── App Campaign (advertising_channel_type = MULTI_CHANNEL)
    └── Ad Group (only ONE ad group ad allowed per ad group)
        └── Ad (type = APP_AD)
            ├── headlines[]      (AdTextAsset, max 5)
            ├── descriptions[]   (AdTextAsset, max 5)
            ├── images[]         (AdImageAsset, max 20)
            └── youtubeVideos[]  (AdVideoAsset, max 20)
```

### Asset Types in AppAdInfo

| Field | Type | Max Count | Description |
|-------|------|-----------|-------------|
| `headlines` | `AdTextAsset[]` | 5 | Short text (max 30 chars) |
| `descriptions` | `AdTextAsset[]` | 5 | Longer text (max 90 chars) |
| `images` | `AdImageAsset[]` | 20 | References to IMAGE assets |
| `youtubeVideos` | `AdVideoAsset[]` | 20 | References to YOUTUBE_VIDEO assets |
| `html5MediaBundles` | `AdMediaBundleAsset[]` | 20 | HTML5/Playable assets |

---

## Critical: Correct Service and Update Mask

### ❌ WRONG: Using AdGroupAdService

```javascript
// This FAILS with "IMMUTABLE_FIELD" error
POST /customers/{customerId}/adGroupAds:mutate
{
  "operations": [{
    "update": {
      "resourceName": "customers/123/adGroupAds/456~789",
      "ad": {
        "appAd": { "headlines": [{ "text": "New" }] }
      }
    },
    "updateMask": "ad.app_ad.headlines"  // Wrong path format
  }]
}
```

### ✅ CORRECT: Using AdService

```javascript
// This WORKS
POST /customers/{customerId}/ads:mutate
{
  "operations": [{
    "update": {
      "resourceName": "customers/123/ads/789",  // Just the ad ID
      "appAd": {
        "headlines": [{ "text": "New" }]
      }
    },
    "updateMask": "app_ad.headlines"  // Direct path without "ad." prefix
  }]
}
```

**Key differences:**
1. Use `AdService` (`/ads:mutate`), not `AdGroupAdService` (`/adGroupAds:mutate`)
2. Resource name is just the ad: `customers/{id}/ads/{adId}`
3. Update mask uses `app_ad.X` not `ad.app_ad.X`
4. The `appAd` object is at root level, not nested under `ad`

---

## Google Ads Scripts Implementation

### Setup and Utilities

```javascript
/**
 * Get customer ID in API format (no dashes)
 */
function getCustomerId() {
  return AdsApp.currentAccount().getCustomerId().replace(/-/g, '');
}

/**
 * Find App campaign ad IDs
 */
function getAppCampaignAdIds(campaignName) {
  const query = `
    SELECT 
      ad_group_ad.ad.id,
      ad_group_ad.ad_group,
      campaign.name
    FROM ad_group_ad
    WHERE campaign.advertising_channel_type = 'MULTI_CHANNEL'
      AND campaign.advertising_channel_sub_type = 'APP_CAMPAIGN'
      AND campaign.name = '${campaignName}'
      AND ad_group_ad.status != 'REMOVED'
  `;
  
  const results = [];
  const rows = AdsApp.search(query);
  while (rows.hasNext()) {
    const row = rows.next();
    results.push({
      adId: row.adGroupAd.ad.id,
      adGroup: row.adGroupAd.adGroup,
      campaignName: row.campaign.name
    });
  }
  return results;
}
```

### Mutating Text Assets (Headlines & Descriptions)

```javascript
/**
 * Update headlines and/or descriptions for an App campaign ad
 * 
 * @param {string} adId - The ad ID (numeric string)
 * @param {string[]} headlines - Array of headline strings (max 5, each max 30 chars)
 * @param {string[]} descriptions - Array of description strings (max 5, each max 90 chars)
 * @returns {Object} Mutation result
 */
function updateAppAdTextAssets(adId, headlines, descriptions) {
  const customerId = getCustomerId();
  
  // Build the appAd object
  const appAd = {};
  const updatePaths = [];
  
  if (headlines && headlines.length > 0) {
    appAd.headlines = headlines.map(text => ({ text: text }));
    updatePaths.push('app_ad.headlines');
  }
  
  if (descriptions && descriptions.length > 0) {
    appAd.descriptions = descriptions.map(text => ({ text: text }));
    updatePaths.push('app_ad.descriptions');
  }
  
  if (updatePaths.length === 0) {
    throw new Error('Must provide at least headlines or descriptions');
  }
  
  const operation = {
    adOperation: {
      update: {
        resourceName: `customers/${customerId}/ads/${adId}`,
        appAd: appAd
      },
      updateMask: updatePaths.join(',')
    }
  };
  
  const result = AdsApp.mutate(operation);
  
  return {
    success: result.isSuccessful(),
    resourceName: result.isSuccessful() ? result.getResourceName() : null,
    error: result.isSuccessful() ? null : result.getErrorMessage()
  };
}

// Usage example
function exampleUpdateText() {
  const adId = '123456789012';
  
  const result = updateAppAdTextAssets(
    adId,
    [
      'Download Free Today',      // Headline 1
      'Best Puzzle Game 2024',    // Headline 2
      '10M+ Downloads',           // Headline 3
      'No Ads, No Waiting',       // Headline 4
      'Play Offline Anytime'      // Headline 5
    ],
    [
      'Challenge your mind with 500+ brain-teasing puzzles',
      'Sync progress across all your devices instantly',
      'New levels added every week - never run out of fun'
    ]
  );
  
  Logger.log('Update result: ' + JSON.stringify(result));
}
```

### Uploading Image Assets

Images require a two-step process:
1. Upload the image to create an Asset
2. Link the Asset to the App Ad

```javascript
/**
 * Upload an image from URL and create an Asset
 * 
 * @param {string} imageUrl - Public URL of the image
 * @param {string} assetName - Name for the asset (for identification)
 * @returns {string} Asset resource name (e.g., "customers/123/assets/456")
 */
function uploadImageAssetFromUrl(imageUrl, assetName) {
  const customerId = getCustomerId();
  
  // Fetch and encode image
  const response = UrlFetchApp.fetch(imageUrl);
  const blob = response.getBlob();
  const base64Data = Utilities.base64Encode(blob.getBytes());
  
  const operation = {
    assetOperation: {
      create: {
        resourceName: `customers/${customerId}/assets/-1`, // Temp ID
        name: assetName,
        type: 'IMAGE',
        imageAsset: {
          data: base64Data
        }
      }
    }
  };
  
  const result = AdsApp.mutate(operation);
  
  if (!result.isSuccessful()) {
    throw new Error('Failed to upload image: ' + result.getErrorMessage());
  }
  
  return result.getResourceName();
}

/**
 * Upload an image from Google Drive
 * 
 * @param {string} fileId - Google Drive file ID
 * @param {string} assetName - Name for the asset
 * @returns {string} Asset resource name
 */
function uploadImageAssetFromDrive(fileId, assetName) {
  const customerId = getCustomerId();
  
  const file = DriveApp.getFileById(fileId);
  const blob = file.getBlob();
  const base64Data = Utilities.base64Encode(blob.getBytes());
  
  const operation = {
    assetOperation: {
      create: {
        resourceName: `customers/${customerId}/assets/-1`,
        name: assetName,
        type: 'IMAGE',
        imageAsset: {
          data: base64Data
        }
      }
    }
  };
  
  const result = AdsApp.mutate(operation);
  
  if (!result.isSuccessful()) {
    throw new Error('Failed to upload image: ' + result.getErrorMessage());
  }
  
  return result.getResourceName();
}
```

### Linking Image Assets to App Ad

```javascript
/**
 * Update the images in an App campaign ad
 * 
 * IMPORTANT: This replaces ALL images. You must include existing images
 * you want to keep, plus any new ones.
 * 
 * @param {string} adId - The ad ID
 * @param {string[]} imageAssetResourceNames - Array of asset resource names
 * @returns {Object} Mutation result
 */
function updateAppAdImages(adId, imageAssetResourceNames) {
  const customerId = getCustomerId();
  
  // Build images array with asset references
  const images = imageAssetResourceNames.map(resourceName => ({
    asset: resourceName
  }));
  
  const operation = {
    adOperation: {
      update: {
        resourceName: `customers/${customerId}/ads/${adId}`,
        appAd: {
          images: images
        }
      },
      updateMask: 'app_ad.images'
    }
  };
  
  const result = AdsApp.mutate(operation);
  
  return {
    success: result.isSuccessful(),
    resourceName: result.isSuccessful() ? result.getResourceName() : null,
    error: result.isSuccessful() ? null : result.getErrorMessage()
  };
}

// Complete workflow example
function exampleAddNewImage() {
  const adId = '123456789012';
  
  // Step 1: Upload new image
  const newAssetResourceName = uploadImageAssetFromUrl(
    'https://example.com/new-creative-1200x628.png',
    'App_Creative_Holiday_2024_v1'
  );
  Logger.log('Created asset: ' + newAssetResourceName);
  
  // Step 2: Get existing image assets (to keep them)
  const existingImages = getCurrentImageAssets(adId);
  
  // Step 3: Combine existing + new
  const allImages = [...existingImages, newAssetResourceName];
  
  // Step 4: Update the ad
  const result = updateAppAdImages(adId, allImages);
  Logger.log('Update result: ' + JSON.stringify(result));
}

/**
 * Get current image asset resource names for an ad
 */
function getCurrentImageAssets(adId) {
  const customerId = getCustomerId();
  
  const query = `
    SELECT 
      ad_group_ad_asset_view.asset,
      ad_group_ad_asset_view.field_type
    FROM ad_group_ad_asset_view
    WHERE ad_group_ad.ad.id = ${adId}
      AND asset.type = 'IMAGE'
  `;
  
  const assets = [];
  const rows = AdsApp.search(query);
  while (rows.hasNext()) {
    const row = rows.next();
    assets.push(row.adGroupAdAssetView.asset);
  }
  return assets;
}
```

### Creating and Linking Video Assets

Videos MUST already exist on YouTube. You cannot upload video files directly.

```javascript
/**
 * Create a YouTube video asset from an existing YouTube video
 * 
 * @param {string} youtubeVideoId - The YouTube video ID (e.g., "dQw4w9WgXcQ")
 * @param {string} assetName - Name for the asset
 * @returns {string} Asset resource name
 */
function createYouTubeVideoAsset(youtubeVideoId, assetName) {
  const customerId = getCustomerId();
  
  const operation = {
    assetOperation: {
      create: {
        resourceName: `customers/${customerId}/assets/-1`,
        name: assetName,
        type: 'YOUTUBE_VIDEO',
        youtubeVideoAsset: {
          youtubeVideoId: youtubeVideoId
        }
      }
    }
  };
  
  const result = AdsApp.mutate(operation);
  
  if (!result.isSuccessful()) {
    throw new Error('Failed to create video asset: ' + result.getErrorMessage());
  }
  
  return result.getResourceName();
}

/**
 * Update the videos in an App campaign ad
 * 
 * IMPORTANT: This replaces ALL videos. Include existing ones you want to keep.
 * 
 * @param {string} adId - The ad ID
 * @param {string[]} videoAssetResourceNames - Array of asset resource names
 * @returns {Object} Mutation result
 */
function updateAppAdVideos(adId, videoAssetResourceNames) {
  const customerId = getCustomerId();
  
  const youtubeVideos = videoAssetResourceNames.map(resourceName => ({
    asset: resourceName
  }));
  
  const operation = {
    adOperation: {
      update: {
        resourceName: `customers/${customerId}/ads/${adId}`,
        appAd: {
          youtubeVideos: youtubeVideos
        }
      },
      updateMask: 'app_ad.youtube_videos'
    }
  };
  
  const result = AdsApp.mutate(operation);
  
  return {
    success: result.isSuccessful(),
    resourceName: result.isSuccessful() ? result.getResourceName() : null,
    error: result.isSuccessful() ? null : result.getErrorMessage()
  };
}

// Complete workflow example
function exampleAddNewVideo() {
  const adId = '123456789012';
  
  // Step 1: Create asset from YouTube video
  const newVideoAsset = createYouTubeVideoAsset(
    'abc123XYZ',  // YouTube video ID
    'App_Promo_Portrait_30s_v2'
  );
  Logger.log('Created video asset: ' + newVideoAsset);
  
  // Step 2: Get existing video assets
  const existingVideos = getCurrentVideoAssets(adId);
  
  // Step 3: Combine and update
  const allVideos = [...existingVideos, newVideoAsset];
  const result = updateAppAdVideos(adId, allVideos);
  
  Logger.log('Update result: ' + JSON.stringify(result));
}

/**
 * Get current video asset resource names for an ad
 */
function getCurrentVideoAssets(adId) {
  const query = `
    SELECT 
      ad_group_ad_asset_view.asset,
      ad_group_ad_asset_view.field_type
    FROM ad_group_ad_asset_view
    WHERE ad_group_ad.ad.id = ${adId}
      AND asset.type = 'YOUTUBE_VIDEO'
  `;
  
  const assets = [];
  const rows = AdsApp.search(query);
  while (rows.hasNext()) {
    const row = rows.next();
    assets.push(row.adGroupAdAssetView.asset);
  }
  return assets;
}
```

### Batch Operations: Update Multiple Asset Types

```javascript
/**
 * Update multiple asset types in a single operation
 * 
 * @param {string} adId - The ad ID
 * @param {Object} updates - Object containing arrays of assets to update
 * @param {string[]} [updates.headlines] - New headlines
 * @param {string[]} [updates.descriptions] - New descriptions  
 * @param {string[]} [updates.imageAssets] - Image asset resource names
 * @param {string[]} [updates.videoAssets] - Video asset resource names
 * @returns {Object} Mutation result
 */
function updateAppAdAssets(adId, updates) {
  const customerId = getCustomerId();
  
  const appAd = {};
  const updatePaths = [];
  
  if (updates.headlines) {
    appAd.headlines = updates.headlines.map(text => ({ text }));
    updatePaths.push('app_ad.headlines');
  }
  
  if (updates.descriptions) {
    appAd.descriptions = updates.descriptions.map(text => ({ text }));
    updatePaths.push('app_ad.descriptions');
  }
  
  if (updates.imageAssets) {
    appAd.images = updates.imageAssets.map(asset => ({ asset }));
    updatePaths.push('app_ad.images');
  }
  
  if (updates.videoAssets) {
    appAd.youtubeVideos = updates.videoAssets.map(asset => ({ asset }));
    updatePaths.push('app_ad.youtube_videos');
  }
  
  if (updatePaths.length === 0) {
    throw new Error('No updates specified');
  }
  
  const operation = {
    adOperation: {
      update: {
        resourceName: `customers/${customerId}/ads/${adId}`,
        appAd: appAd
      },
      updateMask: updatePaths.join(',')
    }
  };
  
  const result = AdsApp.mutate(operation);
  
  return {
    success: result.isSuccessful(),
    resourceName: result.isSuccessful() ? result.getResourceName() : null,
    error: result.isSuccessful() ? null : result.getErrorMessage()
  };
}
```

---

## Node.js Implementation (Google Ads API)

### Setup

```javascript
const { GoogleAdsApi, enums } = require('google-ads-api');

const client = new GoogleAdsApi({
  client_id: process.env.GOOGLE_CLIENT_ID,
  client_secret: process.env.GOOGLE_CLIENT_SECRET,
  developer_token: process.env.DEVELOPER_TOKEN,
});

function getCustomer(customerId) {
  return client.Customer({
    customer_id: customerId,
    refresh_token: process.env.REFRESH_TOKEN,
  });
}
```

### Update Text Assets

```javascript
/**
 * Update App Ad text assets via Google Ads API
 */
async function updateAppAdTextAssets(customerId, adId, headlines, descriptions) {
  const customer = getCustomer(customerId);
  
  const appAd = {};
  const updateMaskPaths = [];
  
  if (headlines?.length) {
    appAd.headlines = headlines.map(text => ({ text }));
    updateMaskPaths.push('app_ad.headlines');
  }
  
  if (descriptions?.length) {
    appAd.descriptions = descriptions.map(text => ({ text }));
    updateMaskPaths.push('app_ad.descriptions');
  }
  
  const operation = {
    update_operation: {
      update: {
        resource_name: `customers/${customerId}/ads/${adId}`,
        app_ad: appAd,
      },
      update_mask: {
        paths: updateMaskPaths,
      },
    },
  };
  
  try {
    const response = await customer.ads.update({
      operations: [operation],
    });
    return {
      success: true,
      resourceName: response.results[0].resource_name,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      details: error.errors,
    };
  }
}
```

### Upload Image Asset

```javascript
const fs = require('fs');
const path = require('path');

/**
 * Upload an image file and create an Asset
 */
async function uploadImageAsset(customerId, imagePath, assetName) {
  const customer = getCustomer(customerId);
  
  // Read and encode image
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Data = imageBuffer.toString('base64');
  
  const operation = {
    create: {
      name: assetName,
      type: enums.AssetType.IMAGE,
      image_asset: {
        data: Buffer.from(base64Data, 'base64'),
      },
    },
  };
  
  const response = await customer.assets.create({
    operations: [operation],
  });
  
  return response.results[0].resource_name;
}

/**
 * Upload image from URL
 */
async function uploadImageAssetFromUrl(customerId, imageUrl, assetName) {
  const customer = getCustomer(customerId);
  const axios = require('axios');
  
  // Fetch image
  const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
  const base64Data = Buffer.from(response.data).toString('base64');
  
  const operation = {
    create: {
      name: assetName,
      type: enums.AssetType.IMAGE,
      image_asset: {
        data: Buffer.from(base64Data, 'base64'),
      },
    },
  };
  
  const result = await customer.assets.create({
    operations: [operation],
  });
  
  return result.results[0].resource_name;
}
```

### Create YouTube Video Asset

```javascript
/**
 * Create a YouTube video asset
 */
async function createYouTubeVideoAsset(customerId, youtubeVideoId, assetName) {
  const customer = getCustomer(customerId);
  
  const operation = {
    create: {
      name: assetName,
      type: enums.AssetType.YOUTUBE_VIDEO,
      youtube_video_asset: {
        youtube_video_id: youtubeVideoId,
      },
    },
  };
  
  const response = await customer.assets.create({
    operations: [operation],
  });
  
  return response.results[0].resource_name;
}
```

### Update App Ad with New Assets

```javascript
/**
 * Update App Ad images and/or videos
 */
async function updateAppAdMediaAssets(customerId, adId, { imageAssets, videoAssets }) {
  const customer = getCustomer(customerId);
  
  const appAd = {};
  const updateMaskPaths = [];
  
  if (imageAssets?.length) {
    appAd.images = imageAssets.map(asset => ({ asset }));
    updateMaskPaths.push('app_ad.images');
  }
  
  if (videoAssets?.length) {
    appAd.youtube_videos = videoAssets.map(asset => ({ asset }));
    updateMaskPaths.push('app_ad.youtube_videos');
  }
  
  const operation = {
    update: {
      resource_name: `customers/${customerId}/ads/${adId}`,
      app_ad: appAd,
    },
    update_mask: {
      paths: updateMaskPaths,
    },
  };
  
  const response = await customer.ads.update({
    operations: [operation],
  });
  
  return response.results[0];
}
```

---

## Querying Asset Performance

### Get Asset Performance Labels

```javascript
// Google Ads Scripts
function getAssetPerformance(campaignId) {
  const query = `
    SELECT 
      asset.id,
      asset.name,
      asset.type,
      asset.text_asset.text,
      asset.image_asset.full_size.url,
      asset.youtube_video_asset.youtube_video_id,
      ad_group_ad_asset_view.performance_label,
      ad_group_ad_asset_view.field_type,
      ad_group.id,
      ad_group.name,
      campaign.id,
      campaign.name
    FROM ad_group_ad_asset_view
    WHERE campaign.id = ${campaignId}
      AND ad_group_ad_asset_view.enabled = TRUE
  `;
  
  const results = [];
  const rows = AdsApp.search(query);
  
  while (rows.hasNext()) {
    const row = rows.next();
    results.push({
      assetId: row.asset.id,
      assetName: row.asset.name,
      assetType: row.asset.type,
      text: row.asset.textAsset?.text || null,
      imageUrl: row.asset.imageAsset?.fullSize?.url || null,
      youtubeVideoId: row.asset.youtubeVideoAsset?.youtubeVideoId || null,
      performanceLabel: row.adGroupAdAssetView.performanceLabel,
      fieldType: row.adGroupAdAssetView.fieldType,
      adGroupId: row.adGroup.id,
      adGroupName: row.adGroup.name,
    });
  }
  
  return results;
}
```

### Performance Labels

| Label | Meaning |
|-------|---------|
| `PENDING` | Not enough data yet (< 5000 impressions typically) |
| `LOW` | Performing worse than other assets |
| `GOOD` | Performing about average |
| `BEST` | Performing better than other assets |
| `LEARNING` | Asset is in learning phase |

---

## Complete Asset Rotation Workflow

```javascript
/**
 * Complete workflow: Replace LOW performing assets with new ones
 */
function rotateUnderperformingAssets() {
  const CONFIG = {
    CAMPAIGN_ID: '123456789',
    MIN_IMPRESSIONS_FOR_JUDGMENT: 5000,
    YOUTUBE_PLAYLIST_ID: 'PLxxxxxxxxxxxxxxx',
    DRIVE_FOLDER_ID: 'xxxxxxxxxxxxxxx'
  };
  
  // 1. Get current asset performance
  const assetPerformance = getAssetPerformance(CONFIG.CAMPAIGN_ID);
  
  // 2. Identify LOW performers with enough data
  const lowPerformers = assetPerformance.filter(a => 
    a.performanceLabel === 'LOW'
  );
  
  if (lowPerformers.length === 0) {
    Logger.log('No low-performing assets found');
    return;
  }
  
  // 3. Get the ad ID (App campaigns have one ad per ad group)
  const adId = getAppAdId(CONFIG.CAMPAIGN_ID);
  
  // 4. Get current assets
  const currentAssets = {
    headlines: getCurrentTextAssets(adId, 'HEADLINE'),
    descriptions: getCurrentTextAssets(adId, 'DESCRIPTION'),
    images: getCurrentImageAssets(adId),
    videos: getCurrentVideoAssets(adId)
  };
  
  // 5. Get replacement assets from sources
  const newVideos = getNewVideosFromPlaylist(CONFIG.YOUTUBE_PLAYLIST_ID);
  const newImages = getNewImagesFromDrive(CONFIG.DRIVE_FOLDER_ID);
  
  // 6. Build updated asset lists
  const updates = {};
  
  // Replace LOW performing images
  const lowImages = lowPerformers.filter(a => a.assetType === 'IMAGE');
  if (lowImages.length > 0 && newImages.length > 0) {
    const lowImageIds = new Set(lowImages.map(a => a.assetId));
    const keptImages = currentAssets.images.filter(
      resourceName => !lowImageIds.has(extractAssetId(resourceName))
    );
    
    // Upload new images
    const newImageAssets = [];
    for (let i = 0; i < Math.min(lowImages.length, newImages.length); i++) {
      const assetName = uploadImageAssetFromDrive(
        newImages[i].id, 
        `Rotation_${Date.now()}_${i}`
      );
      newImageAssets.push(assetName);
    }
    
    updates.imageAssets = [...keptImages, ...newImageAssets];
  }
  
  // Replace LOW performing videos
  const lowVideos = lowPerformers.filter(a => a.assetType === 'YOUTUBE_VIDEO');
  if (lowVideos.length > 0 && newVideos.length > 0) {
    const lowVideoIds = new Set(lowVideos.map(a => a.assetId));
    const keptVideos = currentAssets.videos.filter(
      resourceName => !lowVideoIds.has(extractAssetId(resourceName))
    );
    
    // Create new video assets
    const newVideoAssets = [];
    for (let i = 0; i < Math.min(lowVideos.length, newVideos.length); i++) {
      const assetName = createYouTubeVideoAsset(
        newVideos[i].youtubeVideoId,
        `Rotation_Video_${Date.now()}_${i}`
      );
      newVideoAssets.push(assetName);
    }
    
    updates.videoAssets = [...keptVideos, ...newVideoAssets];
  }
  
  // 7. Apply updates
  if (Object.keys(updates).length > 0) {
    const result = updateAppAdAssets(adId, updates);
    Logger.log('Rotation result: ' + JSON.stringify(result));
    
    // 8. Log changes for audit trail
    logAssetRotation(lowPerformers, updates);
  }
}

function extractAssetId(resourceName) {
  // "customers/123/assets/456" -> "456"
  const match = resourceName.match(/assets\/(\d+)/);
  return match ? match[1] : null;
}

function getAppAdId(campaignId) {
  const query = `
    SELECT ad_group_ad.ad.id
    FROM ad_group_ad
    WHERE campaign.id = ${campaignId}
      AND ad_group_ad.status != 'REMOVED'
    LIMIT 1
  `;
  
  const rows = AdsApp.search(query);
  if (rows.hasNext()) {
    return rows.next().adGroupAd.ad.id;
  }
  throw new Error('No ad found for campaign ' + campaignId);
}
```

---

## Limitations and Caveats

### App Campaign Specific

| Limitation | Details |
|------------|---------|
| One ad per ad group | Cannot create multiple ads in an App campaign ad group |
| Array replacement | Updates replace ALL assets of that type, not append |
| Asset limits | Max 5 text, 20 images, 20 videos per ad |
| Performance label delay | Takes 24-48 hours after sufficient impressions |
| Video source | Must be on YouTube first; cannot upload video files |
| Image formats | JPEG/PNG only; specific dimension requirements per placement |

### Image Requirements

| Placement | Aspect Ratio | Min Dimensions |
|-----------|--------------|----------------|
| Landscape | 1.91:1 | 1200 x 628 |
| Square | 1:1 | 1200 x 1200 |
| Portrait | 4:5 | 480 x 600 |

### API Limitations

| Limitation | Details |
|------------|---------|
| GIF not supported | Returns `MEDIA_INCOMPATIBLE_FOR_UNIVERSAL_APP_CAMPAIGN` |
| HTML5 via API | Not fully supported; use UI |
| Asset deduplication | Same content = same asset ID (name may differ) |

---

## Error Handling

```javascript
function safeUpdateAppAdAssets(adId, updates) {
  try {
    const result = updateAppAdAssets(adId, updates);
    
    if (!result.success) {
      // Log error for investigation
      Logger.log('Update failed: ' + result.error);
      
      // Check for specific error types
      if (result.error.includes('IMMUTABLE_FIELD')) {
        Logger.log('Check: Using AdService? Correct updateMask format?');
      } else if (result.error.includes('MEDIA_INCOMPATIBLE')) {
        Logger.log('Check: Image format/dimensions? GIF not supported.');
      } else if (result.error.includes('RESOURCE_NOT_FOUND')) {
        Logger.log('Check: Asset resource names valid? Ad ID correct?');
      }
      
      return { success: false, error: result.error };
    }
    
    return result;
    
  } catch (e) {
    Logger.log('Exception during update: ' + e.message);
    return { success: false, error: e.message };
  }
}
```

---

## Testing Checklist

Before running in production:

1. **Verify ad ID format**: Numeric string, not resource name
2. **Test with text first**: Simplest mutation to validate setup
3. **Check asset resource names**: Must be full path `customers/X/assets/Y`
4. **Validate image dimensions**: Must meet placement requirements
5. **Confirm YouTube videos accessible**: Must be public or unlisted
6. **Test in preview mode**: Use `validateOnly: true` if available

```javascript
// Quick validation test
function testMutationSetup() {
  const customerId = getCustomerId();
  const testAdId = 'YOUR_TEST_AD_ID';
  
  // Simple text update to verify everything works
  const result = AdsApp.mutate({
    adOperation: {
      update: {
        resourceName: `customers/${customerId}/ads/${testAdId}`,
        appAd: {
          headlines: [{ text: 'Test ' + Date.now() }]
        }
      },
      updateMask: 'app_ad.headlines'
    }
  });
  
  Logger.log('Test result - Success: ' + result.isSuccessful());
  if (!result.isSuccessful()) {
    Logger.log('Error: ' + result.getErrorMessage());
  }
}
```

---

## Tested & Confirmed Working (December 2025)

### VIDEO: Add Existing Asset to Ad - WORKS

```javascript
// Tested: 2025-12-19
// Result: SUCCESS
// Resource: customers/1234567890/ads/123456789012

var payload = {
  adOperation: {
    update: {
      resourceName: 'customers/1234567890/ads/123456789012',
      appAd: {
        youtubeVideos: [
          { asset: 'customers/1234567890/assets/150592116554' },  // existing
          { asset: 'customers/1234567890/assets/11289238226' }    // added
        ]
      }
    },
    updateMask: 'app_ad.youtube_videos'
  }
};

var result = AdsApp.mutate(payload);
// result.isSuccessful() = true
```

### IMAGE: Remove from Ad - WORKS

```javascript
// Tested: 2025-12-19
// Result: SUCCESS
// Removed 1 image, kept 3

var payload = {
  adOperation: {
    update: {
      resourceName: 'customers/1234567890/ads/123456789012',
      appAd: {
        images: [
          { asset: 'customers/1234567890/assets/154197473570' },
          { asset: 'customers/1234567890/assets/154197475262' },
          { asset: 'customers/1234567890/assets/154210211026' }
        ]
      }
    },
    updateMask: 'app_ad.images'
  }
};

var result = AdsApp.mutate(payload);
// result.isSuccessful() = true
```

### IMAGE: Add Existing Asset to Ad - WORKS (with correct aspect ratio)

```javascript
// Tested: 2025-12-19
// Result: SUCCESS - Landscape (1.91:1) and Square (1:1) work

// WORKING: Add 1200x628 landscape image
var payload = {
  adOperation: {
    update: {
      resourceName: 'customers/1234567890/ads/123456789012',
      appAd: {
        images: [
          { asset: 'customers/1234567890/assets/154251627588' },
          { asset: 'customers/1234567890/assets/154197473570' },
          { asset: 'customers/1234567890/assets/154197475262' },
          { asset: 'customers/1234567890/assets/154210211026' },
          { asset: 'customers/1234567890/assets/11271644515' }  // 1200x628 - SUCCESS
        ]
      }
    },
    updateMask: 'app_ad.images'
  }
};

var result = AdsApp.mutate(payload);
// result.isSuccessful() = true
```

### IMAGE: Add with Wrong Aspect Ratio - FAILS

```javascript
// Tested: 2025-12-19
// Result: FAILED
// Error: ASPECT_RATIO_NOT_ALLOWED

// FAILING: Add 768x1024 (3:4 ratio) or 480x320 (1.5:1 ratio)
var payload = {
  adOperation: {
    update: {
      resourceName: 'customers/1234567890/ads/123456789012',
      appAd: {
        images: [
          // ... existing images ...
          { asset: 'customers/1234567890/assets/11283575898' }  // 768x1024 - FAILED
        ]
      }
    },
    updateMask: 'app_ad.images'
  }
};

// Error from result.sc.Ia.errors:
// {
//   "errorCode": {"mediaUploadError": "ASPECT_RATIO_NOT_ALLOWED"},
//   "message": "The aspect ratio of the image does not match the expected aspect ratios provided in the asset spec."
// }
```

### How to Extract Error Messages

```javascript
var result = AdsApp.mutate(payload);

if (!result.isSuccessful()) {
  // Error is in result.sc.Ia.errors array
  if (result.sc && result.sc.Ia && result.sc.Ia.errors) {
    var errors = result.sc.Ia.errors;
    for (var i = 0; i < errors.length; i++) {
      Logger.log('Error Code: ' + JSON.stringify(errors[i].errorCode));
      Logger.log('Message: ' + errors[i].message);
    }
  }
}
```

### Key Findings (Updated 2025-12-19)

| Operation | Asset Type | Result | Notes |
|-----------|------------|--------|-------|
| Add existing asset | VIDEO | ✅ SUCCESS | Works with real asset IDs |
| Remove asset | IMAGE | ✅ SUCCESS | Works |
| Add existing asset | IMAGE (1.91:1) | ✅ SUCCESS | Landscape 1200x628 works |
| Add existing asset | IMAGE (1:1) | ✅ SUCCESS | Square 720x720 works |
| Add existing asset | IMAGE (16:9) | ✅ SUCCESS | 1280x720 works |
| Add existing asset | IMAGE (4:5) | ✅ SUCCESS | 576x720 works (portrait) |
| Add existing asset | IMAGE (3:4) | ❌ FAILED | 768x1024 - ASPECT_RATIO_NOT_ALLOWED |
| Add existing asset | IMAGE (1.5:1) | ❌ FAILED | 480x320 - ASPECT_RATIO_NOT_ALLOWED |
| Add with direct text | HEADLINE | ✅ SUCCESS | `{ text: "..." }` works |
| Create new asset | TEXT/VIDEO/IMAGE | ✅ SUCCESS | Returns temporary IDs |
| Upload image from Drive | IMAGE | ✅ SUCCESS | See `uploadImageAssetFromDrive()` |
| Add newly created asset | ALL | ❌ FAILED | Temporary IDs don't work immediately |

### IMAGE: Upload from Google Drive - WORKS

```javascript
// Tested: 2025-12-19
// Result: SUCCESS
// Creates image asset from Google Drive file

/**
 * Upload image from Google Drive and create asset
 * @param {string} fileId - Google Drive file ID
 * @param {string} assetName - Name for the asset
 * @returns {Object} Result with success status and resource name or error
 */
function uploadImageAssetFromDrive(fileId, assetName) {
  var customerId = AdsApp.currentAccount().getCustomerId().replace(/-/g, '');

  try {
    var file = DriveApp.getFileById(fileId);
    var blob = file.getBlob();
    var base64Data = Utilities.base64Encode(blob.getBytes());

    var payload = {
      assetOperation: {
        create: {
          resourceName: 'customers/' + customerId + '/assets/-1',
          name: assetName,
          type: 'IMAGE',
          imageAsset: {
            data: base64Data
          }
        }
      }
    };

    var result = AdsApp.mutate(payload);

    if (result.isSuccessful()) {
      return {
        success: true,
        resourceName: result.getResourceName()
      };
    } else {
      // Extract error from sc.Ia.errors
      var errorInfo = { code: null, message: 'Unknown error' };
      if (result.sc && result.sc.Ia && result.sc.Ia.errors) {
        var err = result.sc.Ia.errors[0];
        errorInfo.code = err.errorCode;
        errorInfo.message = err.message;
      }
      return {
        success: false,
        errorCode: errorInfo.code,
        errorMessage: errorInfo.message
      };
    }
  } catch (e) {
    return {
      success: false,
      errorMessage: 'Exception: ' + e.message
    };
  }
}

// Usage:
// var result = uploadImageAssetFromDrive('1ABC123...', 'My_Creative_v1');
// if (result.success) {
//   Logger.log('Created: ' + result.resourceName);
// }
```

### App Campaign Image Aspect Ratio Requirements

**IMPORTANT:** Each App Campaign can have different allowed aspect ratios!

Common valid ratios for App Campaigns:
- **1.91:1** (Landscape) - e.g., 1200x628 ✅
- **1:1** (Square) - e.g., 1200x1200, 720x720 ✅
- **4:5** (Portrait) - e.g., 480x600 (campaign-dependent)

Invalid ratios that will fail:
- **3:4** (768x1024) ❌
- **1.5:1** (480x320) ❌
- **2:3** (320x480) ❌
- **9:16** (portrait video format) ❌

**Best Practice:** Query the current images in the ad to determine which aspect ratios are allowed, then only add images with matching ratios.

---

## References

- [Google Ads API - AppAdInfo](https://developers.google.com/google-ads/api/reference/rpc/latest/AppAdInfo)
- [Google Ads Scripts - Mutate](https://developers.google.com/google-ads/scripts/docs/features/mutate)
- [Google Ads Scripts - Assets](https://developers.google.com/google-ads/scripts/docs/campaigns/performance-max/assets)
- [Add App Campaign Sample](https://developers.google.com/google-ads/api/samples/add-app-campaign)
