# Successful Google Ads Scripts Calls

This document contains all tested and confirmed working Google Ads Scripts API calls for App Campaign asset mutations.

> **Note:** All customer IDs, asset IDs, and resource names in this document are placeholder examples. Replace `1234567890` with your actual Google Ads Customer ID (without dashes) before use.

---

## Asset Creation

### IMAGE: Upload from Google Drive - SUCCESS

**Tested:** 2025-12-19
**Result:** Asset created successfully (returns ID -1 if only previewing)

```javascript
function uploadImageAssetFromDrive(fileId, assetName) {
  var customerId = AdsApp.currentAccount().getCustomerId().replace(/-/g, '');

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
  // result.isSuccessful() = true
  // result.getResourceName() = 'customers/1234567890/assets/-1' (temporary ID)
}
```

**Log Output:**
```
File: sample-image-4-5.png
MIME type: image/png
Size: 6 KB
RESULT: SUCCESS
Asset Resource Name: customers/1234567890/assets/-1
```
---

### IMAGE: Upload from Drive + Add to Ad - FULL SUCCESS

**Tested:** 2025-12-19
**Result:** Asset created with real ID and successfully added to App Campaign ad

```javascript
// Step 1: Upload image from Google Drive
function uploadImageAssetFromDrive(fileId, assetName) {
  var customerId = AdsApp.currentAccount().getCustomerId().replace(/-/g, '');

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
  return result.getResourceName();  // Returns real ID if unique content!
}

// Step 2: Add to App Campaign Ad
function addImageToAd(customerId, adId, currentImages, newAssetResourceName) {
  var newImages = currentImages.slice();  // Copy existing
  newImages.push({ asset: newAssetResourceName });

  var payload = {
    adOperation: {
      update: {
        resourceName: 'customers/' + customerId + '/ads/' + adId,
        appAd: {
          images: newImages
        }
      },
      updateMask: 'app_ad.images'
    }
  };

  return AdsApp.mutate(payload);
}
```

**Log Output (SUCCESS):**
```
File: sample-image-4-5-id-66554477.png
MIME type: image/png
Size: 14425 bytes (14 KB)
Asset name: TestUpload_id-901_fm-unknown.png_1766148002307
RESULT: SUCCESS
Asset Resource Name: customers/1234567890/assets/318024427603

--- Adding to Ad ---
SUCCESS
Resource: customers/1234567890/ads/123456789012
ADD TO AD: SUCCESS
```

---

### YOUTUBE VIDEO: Create Asset from Video ID - SUCCESS

**Tested:** 2025-12-19
**Result:** Asset created with real ID and successfully added to App Campaign ad

```javascript
// Step 1: Create YouTube Video Asset
var customerId = '1234567890';  // TODO: Replace with your Customer ID
var youtubeVideoId = 'xXxExAmPlExXx';
var assetName = 'TestVideo_' + youtubeVideoId + '_' + Date.now();

var assetPayload = {
  assetOperation: {
    create: {
      resourceName: 'customers/' + customerId + '/assets/-1',
      name: assetName,
      type: 'YOUTUBE_VIDEO',
      youtubeVideoAsset: {
        youtubeVideoId: youtubeVideoId
      }
    }
  }
};

var result = AdsApp.mutate(assetPayload);
// result.isSuccessful() = true
// result.getResourceName() = 'customers/1234567890/assets/317946076202'
```

**Log Output:**
```
Asset Name: TestVideo_xXxExAmPlExXx_1766152235270
RESULT: SUCCESS
Asset Resource Name: customers/1234567890/assets/317946076202
```

The video must be public or unlisted on YouTube.

---

### YOUTUBE VIDEO: Create Asset + Add to Ad - FULL SUCCESS

**Tested:** 2025-12-19
**Result:** Created new YouTube video asset and added to ad in sequence

```javascript
// Step 1: Create the asset (see above)
var assetResourceName = 'customers/1234567890/assets/317946076202';

// Step 2: Add to Ad (append to existing videos)
var adPayload = {
  adOperation: {
    update: {
      resourceName: 'customers/1234567890/ads/123456789012',
      appAd: {
        youtubeVideos: [
          { asset: 'customers/1234567890/assets/150592116554' },  // existing
          { asset: 'customers/1234567890/assets/11289238226' },   // existing
          { asset: 'customers/1234567890/assets/317946076202' }   // newly created
        ]
      }
    },
    updateMask: 'app_ad.youtube_videos'
  }
};

var result = AdsApp.mutate(adPayload);
// result.isSuccessful() = true
```

**Log Output:**
```
Asset Creation: SUCCESS
Asset Resource: customers/1234567890/assets/317946076202
Add to Ad: SUCCESS
```

---

## Ad Mutations

### VIDEO: Add Existing Asset to Ad - SUCCESS

**Tested:** 2025-12-19
**Result:** Successfully added video asset to App Campaign ad

```javascript
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
// result.getResourceName() = 'customers/1234567890/ads/123456789012'
```

---

### IMAGE: Remove from Ad - SUCCESS

**Tested:** 2025-12-19
**Result:** Successfully removed image from App Campaign ad

```javascript
// Remove 1 image by providing only the images to KEEP
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

---

### IMAGE: Add Existing Asset (1.91:1 Landscape) - SUCCESS

**Tested:** 2025-12-19
**Result:** Successfully added 1200x628 landscape image

```javascript
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
          { asset: 'customers/1234567890/assets/11271644515' }  // 1200x628 added
        ]
      }
    },
    updateMask: 'app_ad.images'
  }
};

var result = AdsApp.mutate(payload);
// result.isSuccessful() = true
```

---

### IMAGE: Add Existing Asset (1:1 Square) - SUCCESS

**Tested:** 2025-12-19
**Result:** Successfully added 720x720 square image

```javascript
var payload = {
  adOperation: {
    update: {
      resourceName: 'customers/1234567890/ads/123456789012',
      appAd: {
        images: [
          // ... existing images ...
          { asset: 'customers/1234567890/assets/SQUARE_IMAGE_ID' }  // 720x720 added
        ]
      }
    },
    updateMask: 'app_ad.images'
  }
};

var result = AdsApp.mutate(payload);
// result.isSuccessful() = true
```

---

### HEADLINE: Update with Direct Text - SUCCESS

**Tested:** 2025-12-19
**Result:** Successfully updated headlines using direct text format

```javascript
var payload = {
  adOperation: {
    update: {
      resourceName: 'customers/1234567890/ads/123456789012',
      appAd: {
        headlines: [
          { text: 'Headline One' },
          { text: 'Headline Two' },
          { text: 'Headline Three' }
        ]
      }
    },
    updateMask: 'app_ad.headlines'
  }
};

var result = AdsApp.mutate(payload);
// result.isSuccessful() = true
```

---

## Error Extraction

### How to Extract Error Details from Failed Mutations

```javascript
var result = AdsApp.mutate(payload);

if (!result.isSuccessful()) {
  // Errors are in result.sc.Ia.errors array
  if (result.sc && result.sc.Ia && result.sc.Ia.errors) {
    var errors = result.sc.Ia.errors;
    for (var i = 0; i < errors.length; i++) {
      var err = errors[i];
      Logger.log('Error Code: ' + JSON.stringify(err.errorCode));
      Logger.log('Error Message: ' + err.message);
      if (err.trigger) {
        Logger.log('Trigger: ' + JSON.stringify(err.trigger));
      }
      if (err.location) {
        Logger.log('Location: ' + JSON.stringify(err.location));
      }
    }
  }
}
```

**Example Error Output:**
```
Error Code: {"mediaUploadError":"ASPECT_RATIO_NOT_ALLOWED"}
Error Message: The aspect ratio of the image does not match the expected aspect ratios provided in the asset spec.
```

---

## Known Limitations

| Issue | Details |
|-------|---------|
| Aspect Ratio | Images must match campaign's allowed ratios (1.91:1, 1:1, 4:5 for tested campaign) |
| 3:4 Ratio | 768x1024 images rejected with `ASPECT_RATIO_NOT_ALLOWED` |
| 1.5:1 Ratio | 480x320 images rejected with `ASPECT_RATIO_NOT_ALLOWED` |

---

## YouTube Advanced API Calls

**Prerequisites:**
1. Enable YouTube Advanced API in Google Ads Scripts editor
2. Click "Advanced APIs" button → Check "YouTube"
3. Enable in linked Google Cloud Console

### Get Playlist Info - SUCCESS

```javascript
// Get playlist metadata (title, video count, etc.)
var response = YouTube.Playlists.list('snippet,contentDetails', {
  id: 'PLxxxxxxxxxxxxxxx'  // YouTube playlist ID
});

if (response.items && response.items.length > 0) {
  var playlist = response.items[0];

  Logger.log('Title: ' + playlist.snippet.title);
  Logger.log('Description: ' + playlist.snippet.description);
  Logger.log('Channel: ' + playlist.snippet.channelTitle);
  Logger.log('Video Count: ' + playlist.contentDetails.itemCount);
  Logger.log('Thumbnail: ' + playlist.snippet.thumbnails.high.url);
}
```

---

### Get Playlist Videos (Paginated) - SUCCESS

```javascript
// Get all videos from a playlist with pagination
var playlistItems = [];
var pageToken = null;

do {
  var params = {
    playlistId: 'PLxxxxxxxxxxxxxxx',
    maxResults: 50  // Max allowed per request
  };

  if (pageToken) {
    params.pageToken = pageToken;
  }

  var response = YouTube.PlaylistItems.list('snippet,contentDetails', params);

  if (response.items && response.items.length > 0) {
    for (var i = 0; i < response.items.length; i++) {
      var item = response.items[i];
      playlistItems.push({
        videoId: item.contentDetails.videoId,
        title: item.snippet.title,
        description: item.snippet.description,
        publishedAt: item.snippet.publishedAt,
        position: item.snippet.position,
        thumbnailUrl: item.snippet.thumbnails.high.url
      });
    }
  }

  pageToken = response.nextPageToken;

} while (pageToken);

Logger.log('Total videos: ' + playlistItems.length);
```

---

### Get Video Details (Duration, Quality) - SUCCESS

```javascript
// Get video details in batches (max 50 IDs per request)
var videoIds = ['videoId1', 'videoId2', 'videoId3'];

var response = YouTube.Videos.list('contentDetails,status', {
  id: videoIds.join(',')
});

if (response.items) {
  for (var i = 0; i < response.items.length; i++) {
    var video = response.items[i];

    Logger.log('Video ID: ' + video.id);
    Logger.log('Duration: ' + video.contentDetails.duration);  // ISO 8601 format: PT1H30M45S
    Logger.log('Definition: ' + video.contentDetails.definition);  // 'hd' or 'sd'
    Logger.log('Privacy: ' + video.status.privacyStatus);  // 'public', 'unlisted', 'private'
  }
}
```

---

### Parse ISO 8601 Duration - UTILITY

```javascript
// Convert YouTube duration format to seconds
function parseDuration(isoDuration) {
  if (!isoDuration) return 0;

  var match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;

  var hours = parseInt(match[1] || 0, 10);
  var minutes = parseInt(match[2] || 0, 10);
  var seconds = parseInt(match[3] || 0, 10);

  return hours * 3600 + minutes * 60 + seconds;
}

// Examples:
// 'PT30S'      -> 30
// 'PT5M30S'    -> 330
// 'PT1H30M45S' -> 5445
```

---

### Format Duration for Display - UTILITY

```javascript
function formatDuration(totalSeconds) {
  var hours = Math.floor(totalSeconds / 3600);
  var minutes = Math.floor((totalSeconds % 3600) / 60);
  var seconds = totalSeconds % 60;

  var pad = function(n) { return n < 10 ? '0' + n : String(n); };

  if (hours > 0) {
    return hours + ':' + pad(minutes) + ':' + pad(seconds);
  }
  return minutes + ':' + pad(seconds);
}

// Examples:
// 30    -> '0:30'
// 330   -> '5:30'
// 5445  -> '1:30:45'
```

---

### Complete YouTube Client Example

```javascript
var YouTubeClient = {

  getPlaylistInfo: function(playlistId) {
    var response = YouTube.Playlists.list('snippet,contentDetails', {
      id: playlistId
    });

    if (!response.items || response.items.length === 0) {
      return null;
    }

    var playlist = response.items[0];
    return {
      playlistId: playlistId,
      title: playlist.snippet.title,
      description: playlist.snippet.description || '',
      channelTitle: playlist.snippet.channelTitle,
      videoCount: playlist.contentDetails.itemCount
    };
  },

  getPlaylistVideos: function(playlistId) {
    var videos = [];
    var pageToken = null;

    do {
      var params = { playlistId: playlistId, maxResults: 50 };
      if (pageToken) params.pageToken = pageToken;

      var response = YouTube.PlaylistItems.list('snippet,contentDetails', params);

      if (response.items) {
        for (var i = 0; i < response.items.length; i++) {
          videos.push({
            videoId: response.items[i].contentDetails.videoId,
            title: response.items[i].snippet.title
          });
        }
      }

      pageToken = response.nextPageToken;
    } while (pageToken);

    return videos;
  }
};

// Usage:
var info = YouTubeClient.getPlaylistInfo('PLxxxxxxx');
var videos = YouTubeClient.getPlaylistVideos('PLxxxxxxx');
```
