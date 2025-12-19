# Successful Google Ads Scripts Calls

This document contains all tested and confirmed working Google Ads Scripts API calls for App Campaign asset mutations.

---

## Asset Creation

### IMAGE: Upload from Google Drive - SUCCESS

**Tested:** 2025-12-19
**Result:** Asset created successfully (returns temporary ID -1, need to query for actual ID)

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
  // result.getResourceName() = 'customers/3342315080/assets/-1' (temporary ID)
}
```

**Log Output:**
```
File: airalo-test-4-5.png
MIME type: image/png
Size: 6 KB
RESULT: SUCCESS
Asset Resource Name: customers/3342315080/assets/-1
```

**Note:** The returned resource name contains `-1` (temporary ID). To use the asset, you must query for the actual asset ID by name.

---

## Ad Mutations

### VIDEO: Add Existing Asset to Ad - SUCCESS

**Tested:** 2025-12-19
**Result:** Successfully added video asset to App Campaign ad

```javascript
var payload = {
  adOperation: {
    update: {
      resourceName: 'customers/3342315080/ads/707391445617',
      appAd: {
        youtubeVideos: [
          { asset: 'customers/3342315080/assets/150592116554' },  // existing
          { asset: 'customers/3342315080/assets/11289238226' }    // added
        ]
      }
    },
    updateMask: 'app_ad.youtube_videos'
  }
};

var result = AdsApp.mutate(payload);
// result.isSuccessful() = true
// result.getResourceName() = 'customers/3342315080/ads/707391445617'
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
      resourceName: 'customers/3342315080/ads/707391445617',
      appAd: {
        images: [
          { asset: 'customers/3342315080/assets/154197473570' },
          { asset: 'customers/3342315080/assets/154197475262' },
          { asset: 'customers/3342315080/assets/154210211026' }
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
      resourceName: 'customers/3342315080/ads/707391445617',
      appAd: {
        images: [
          { asset: 'customers/3342315080/assets/154251627588' },
          { asset: 'customers/3342315080/assets/154197473570' },
          { asset: 'customers/3342315080/assets/154197475262' },
          { asset: 'customers/3342315080/assets/154210211026' },
          { asset: 'customers/3342315080/assets/11271644515' }  // 1200x628 added
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
      resourceName: 'customers/3342315080/ads/707391445617',
      appAd: {
        images: [
          // ... existing images ...
          { asset: 'customers/3342315080/assets/SQUARE_IMAGE_ID' }  // 720x720 added
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
      resourceName: 'customers/3342315080/ads/707391445617',
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
| Temporary Asset IDs | Asset creation returns `-1` as resource name. Cannot use immediately in mutations. |
| Aspect Ratio | Images must match campaign's allowed ratios (1.91:1, 1:1, 4:5 for tested campaign) |
| 3:4 Ratio | 768x1024 images rejected with `ASPECT_RATIO_NOT_ALLOWED` |
| 1.5:1 Ratio | 480x320 images rejected with `ASPECT_RATIO_NOT_ALLOWED` |

---

## Working Aspect Ratios for Test Campaign

| Ratio | Dimensions | Status |
|-------|------------|--------|
| 1.91:1 | 1200x628 | SUCCESS |
| 16:9 | 1280x720 | SUCCESS |
| 1:1 | 720x720, 1200x1200 | SUCCESS |
| 4:5 | 576x720 | SUCCESS (upload) |
| 3:4 | 768x1024 | FAILED |
| 1.5:1 | 480x320 | FAILED |
