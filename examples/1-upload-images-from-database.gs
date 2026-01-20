/**
 * EXAMPLE SCRIPT: Upload Image Assets from External Database to Google Ads
 *
 * Description:
 * Uploads image creatives from an external database (e.g., Notion, Airtable)
 * to Google Ads as assets in the asset library.
 *
 * Use Case:
 * Mapy.com manages creative assets in a database and needs to sync approved
 * images to Google Ads for use in App campaigns.
 *
 * Frequency: Weekly / On-demand
 * Platform: Google Ads Scripts
 *
 * Features:
 * - Duplicate detection using unique ID pattern
 * - Multiple aspect ratios per creative
 * - Aspect ratio extraction from image dimensions
 * - Structured asset naming
 * - DRY_RUN mode for safe testing
 *
 * Asset Name Format:
 * explorelocalmaps_id-480_en_end-2026-01-15_16-9.jpg
 * └─ creative name_id-{id}_{lang}_end-{date}_{aspect}.ext
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

var CONFIG = {
  // External Database API settings (example: Notion)
  DATABASE: {
    API_KEY: 'your_database_api_key',
    API_VERSION: '2022-06-28',
    BASE_URL: 'https://api.notion.com/v1',
    DATABASE_ID: 'your_database_id'
  },

  // Query filters - what to fetch from database
  QUERY: {
    TYPE: 'Static',              // Creative type (images)
    DAYS_BACK: 7,                // Query creatives from last N days
    UPLOAD_STATUS_FIELD: 'Google Ads'  // Skip if already uploaded
  },

  // Script behavior
  DRY_RUN: false                 // Set true to preview without uploading
};

// ============================================================================
// EXTERNAL DATABASE API FUNCTIONS
// ============================================================================

/**
 * Make authenticated request to external database API
 */
function databaseRequest(endpoint, method, payload) {
  method = method || 'GET';
  var url = CONFIG.DATABASE.BASE_URL + endpoint;

  var options = {
    method: method,
    headers: {
      'Authorization': 'Bearer ' + CONFIG.DATABASE.API_KEY,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };

  if (payload) {
    options.payload = JSON.stringify(payload);
  }

  var response = UrlFetchApp.fetch(url, options);
  var responseCode = response.getResponseCode();

  if (responseCode >= 200 && responseCode < 300) {
    return JSON.parse(response.getContentText());
  } else {
    throw new Error('API error: ' + responseCode + ' - ' + response.getContentText());
  }
}

/**
 * Query database with pagination support
 * IMPORTANT: Always implement pagination - most APIs limit to 100 records
 */
function queryDatabase(filter) {
  var endpoint = '/databases/' + CONFIG.DATABASE.DATABASE_ID + '/query';
  var allResults = [];
  var hasMore = true;
  var startCursor = null;

  // Handle pagination - keep fetching until no more results
  while (hasMore) {
    var payload = {
      filter: filter,
      page_size: 100
    };
    if (startCursor) payload.start_cursor = startCursor;

    var response = databaseRequest(endpoint, 'POST', payload);

    if (response.results && response.results.length > 0) {
      allResults = allResults.concat(response.results);
    }

    hasMore = response.has_more || false;
    startCursor = response.next_cursor || null;

    // Safety: prevent infinite loops
    if (allResults.length > 10000) {
      Logger.log('Warning: Query exceeded 10000 results, stopping');
      break;
    }
  }

  return allResults;
}

/**
 * Update database record (mark as uploaded)
 */
function updateDatabaseRecord(recordId, properties) {
  var endpoint = '/pages/' + recordId;
  return databaseRequest(endpoint, 'PATCH', { properties: properties });
}

// ============================================================================
// QUERY CREATIVES FROM DATABASE
// ============================================================================

/**
 * Get creatives ready to upload to Google Ads
 */
function getCreativesToUpload() {
  var daysAgo = new Date();
  daysAgo.setDate(daysAgo.getDate() - CONFIG.QUERY.DAYS_BACK);
  var dateFilter = daysAgo.toISOString().split('T')[0];

  var filter = {
    and: [
      { property: "Type", select: { equals: CONFIG.QUERY.TYPE } },
      { property: "Submission Date", date: { on_or_after: dateFilter } },
      { property: "Uploaded", multi_select: { does_not_contain: CONFIG.QUERY.UPLOAD_STATUS_FIELD } }
    ]
  };

  return queryDatabase(filter);
}

// ============================================================================
// GOOGLE ADS FUNCTIONS
// ============================================================================

/**
 * Check if asset already exists in Google Ads by unique ID
 *
 * IMPORTANT: Google Ads Asset API limitations:
 * - Cannot filter assets by date (asset.creation_time doesn't exist)
 * - Must query ALL assets and check programmatically
 * - Asset names are immutable after creation
 *
 * @param {String} uniqueId - Unique identifier (e.g., "480")
 * @returns {Boolean} True if duplicate found
 */
function isDuplicateAsset(uniqueId) {
  try {
    // Query all image assets (no date filter possible)
    var query = "SELECT asset.id, asset.name " +
      "FROM asset " +
      "WHERE asset.type = 'IMAGE'";

    var result = AdsApp.search(query);

    while (result.hasNext()) {
      var row = result.next();
      var assetName = row.asset.name;

      // Parse name for id-{unique_id} pattern
      var match = assetName.match(/id-(\d+)/);
      if (match && match[1] === uniqueId) {
        return true;
      }
    }
  } catch (e) {
    Logger.log('  Warning: Duplicate check failed - ' + e.message);
    // Safer to proceed with upload than skip on error
  }

  return false;
}

/**
 * Upload image to Google Ads as asset
 *
 * @param {Blob} imageBlob - Image blob from UrlFetchApp
 * @param {String} assetName - Asset name
 * @returns {Object} Upload result
 */
function uploadImageAsset(imageBlob, assetName) {
  if (CONFIG.DRY_RUN) {
    Logger.log('  [DRY RUN] Would upload: ' + assetName);
    return { dryRun: true };
  }

  // Base64 encode image
  var base64Data = Utilities.base64Encode(imageBlob.getBytes());

  // Create asset
  var assetOperation = {
    create: {
      name: assetName,
      type: 'IMAGE',
      imageAsset: {
        data: base64Data
      }
    }
  };

  // Upload via Google Ads API
  var result = AdsApp.mutate({
    assetOperation: assetOperation
  });

  return result;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Download image from URL
 * Note: Some systems (like Notion) have URLs that expire after 1 hour
 *
 * @param {String} fileUrl - File URL
 * @returns {Blob} Image blob
 */
function downloadImage(fileUrl) {
  var response = UrlFetchApp.fetch(fileUrl, {
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    throw new Error('Download failed: HTTP ' + response.getResponseCode());
  }

  return response.getBlob();
}

/**
 * Generate Google Ads asset name
 * Format: {name}_id-{id}_{language}[_end-{date}]_{aspect}.{ext}
 * Example: explorelocalmaps_id-480_en_end-2026-01-15_16-9.jpg
 *
 * IMPORTANT: Google Ads has 255 character limit for asset names
 *
 * @param {String} creativeName - Creative name
 * @param {Number} uniqueId - Unique identifier
 * @param {String} language - Language code (e.g., "en", "de")
 * @param {String} endDate - End date (YYYY-MM-DD) or null
 * @param {String} aspectRatio - Aspect ratio (e.g., "16-9", "1-1")
 * @param {String} extension - File extension
 * @returns {String} Asset name
 */
function generateAssetName(creativeName, uniqueId, language, endDate, aspectRatio, extension) {
  // Clean creative name: lowercase, alphanumeric only
  var cleanName = creativeName.toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .substring(0, 140);  // Leave room for metadata

  var idStr = uniqueId ? String(uniqueId) : 'unknown';
  var baseFilename = cleanName + '_id-' + idStr + '_' + language;

  if (endDate) {
    baseFilename += '_end-' + endDate;
  }

  baseFilename += '_' + aspectRatio;
  var assetName = baseFilename + '.' + extension;

  // Validate length
  if (assetName.length > 255) {
    throw new Error('Asset name too long (' + assetName.length + ' chars): ' + assetName);
  }

  return assetName;
}

/**
 * Get aspect ratio from image blob
 * Parses JPEG/PNG binary data to extract dimensions
 *
 * @param {Blob} imageBlob - Image blob
 * @returns {String} Aspect ratio (e.g., "16-9", "1-1") or null
 */
function getAspectRatio(imageBlob) {
  try {
    var bytes = imageBlob.getBytes();

    // JPEG: Find 0xFFC0 marker
    if (imageBlob.getContentType() === 'image/jpeg') {
      for (var i = 0; i < bytes.length - 8; i++) {
        if (bytes[i] === 0xFF && bytes[i + 1] === 0xC0) {
          var height = (bytes[i + 5] << 8) | bytes[i + 6];
          var width = (bytes[i + 7] << 8) | bytes[i + 8];
          return calculateAspectRatioString(width, height);
        }
      }
    }

    // PNG: Dimensions at bytes 16-23
    if (imageBlob.getContentType() === 'image/png') {
      if (bytes.length >= 24) {
        var width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
        var height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
        return calculateAspectRatioString(width, height);
      }
    }
  } catch (e) {
    Logger.log('  Warning: Could not extract dimensions - ' + e.message);
  }

  return null;
}

/**
 * Calculate aspect ratio string from dimensions
 */
function calculateAspectRatioString(width, height) {
  if (!width || !height) return null;

  // Find GCD to simplify ratio
  var gcd = function(a, b) {
    return b === 0 ? a : gcd(b, a % b);
  };

  var divisor = gcd(width, height);
  var ratioW = width / divisor;
  var ratioH = height / divisor;

  return ratioW + '-' + ratioH;
}

// ============================================================================
// MAIN LOGIC
// ============================================================================

function main() {
  Logger.log('=== Upload Images from Database to Google Ads ===');
  Logger.log('');

  if (CONFIG.DRY_RUN) {
    Logger.log('⚠ DRY RUN MODE - No uploads will happen');
    Logger.log('');
  }

  // Get creatives to upload
  Logger.log('Querying database for eligible creatives...');
  var creatives = getCreativesToUpload();
  Logger.log('Found ' + creatives.length + ' creatives');
  Logger.log('');

  if (creatives.length === 0) {
    Logger.log('No creatives to upload. Exiting.');
    return;
  }

  var uploaded = 0;
  var skipped = 0;

  // Process each creative
  for (var i = 0; i < creatives.length; i++) {
    var creative = creatives[i];

    try {
      // Extract metadata from database record
      var pageId = creative.id;
      var uniqueId = creative.properties.id.unique_id.number;
      var creativeName = creative.properties.Name.title[0].plain_text;
      var language = creative.properties.Language.select.name.toLowerCase().substring(0, 2);
      var endDate = creative.properties['End Date'] ? creative.properties['End Date'].date.start : null;
      var files = creative.properties.File.files;

      Logger.log('[' + (i+1) + '/' + creatives.length + '] ' + creativeName + ' (ID: ' + uniqueId + ')');

      // Validation
      if (!uniqueId) {
        Logger.log('  → Skipped: Missing unique ID');
        skipped++;
        continue;
      }

      if (!files || files.length === 0) {
        Logger.log('  → Skipped: No files attached');
        skipped++;
        continue;
      }

      // Check for duplicates
      if (isDuplicateAsset(String(uniqueId))) {
        Logger.log('  → Skipped: Duplicate exists in Google Ads');
        skipped++;
        continue;
      }

      // Process all files (multiple aspect ratios)
      Logger.log('  → Found ' + files.length + ' file(s)');
      var filesUploaded = 0;

      for (var fileIdx = 0; fileIdx < files.length; fileIdx++) {
        var fileObj = files[fileIdx];
        var fileUrl = fileObj.file.url;
        var fileName = fileObj.name;
        var extension = fileName.split('.').pop().toLowerCase();

        try {
          // Download image
          var imageBlob = downloadImage(fileUrl);

          // Extract aspect ratio
          var aspectRatio = getAspectRatio(imageBlob);
          if (!aspectRatio) {
            aspectRatio = String(fileIdx + 1);  // Fallback to sequential number
          }

          // Generate asset name
          var assetName = generateAssetName(creativeName, uniqueId, language, endDate, aspectRatio, extension);
          Logger.log('    [' + (fileIdx + 1) + '/' + files.length + '] ' + assetName);

          // Upload to Google Ads
          var result = uploadImageAsset(imageBlob, assetName);

          if (!CONFIG.DRY_RUN) {
            Logger.log('    [' + (fileIdx + 1) + '/' + files.length + '] Uploaded ✓');
          }

          filesUploaded++;

        } catch (fileError) {
          Logger.log('    [' + (fileIdx + 1) + '/' + files.length + '] Error: ' + fileError.message);
        }
      }

      // Update database (mark as uploaded)
      if (filesUploaded > 0 && !CONFIG.DRY_RUN) {
        try {
          var properties = {
            Uploaded: {
              multi_select: [{ name: CONFIG.QUERY.UPLOAD_STATUS_FIELD }]
            }
          };
          updateDatabaseRecord(pageId, properties);
          Logger.log('  → Database updated ✓');
        } catch (dbError) {
          Logger.log('  → Database update failed: ' + dbError.message);
        }
      }

      uploaded++;
      Logger.log('');

    } catch (e) {
      Logger.log('  → Error: ' + e.message);
      Logger.log('');
      skipped++;
    }
  }

  // Summary
  Logger.log('========================================');
  Logger.log('=== UPLOAD COMPLETE ===');
  Logger.log('========================================');
  Logger.log('Uploaded: ' + uploaded + ' creatives');
  Logger.log('Skipped: ' + skipped + ' creatives');
  Logger.log('');
}
