/**
 * EXAMPLE SCRIPT: Sync Google Ads Assets to External Database
 *
 * Description:
 * Syncs Google Ads asset IDs and live status back to an external database.
 * Updates format-specific fields (16:9, 9:16, 4:5, 1:1) with asset IDs.
 *
 * Use Case:
 * Mapy.com tracks creative assets in a database with multiple aspect ratio fields.
 * After uploading to Google Ads, need to sync back the asset IDs and check
 * which assets are actively used in campaigns.
 *
 * Frequency: Weekly / On-demand
 * Platform: Google Ads Scripts
 *
 * Features:
 * - Bi-directional sync (Google Ads → Database)
 * - Format-specific field updates based on aspect ratio
 * - Live campaign status tracking
 * - Asset matching with multi-tier strategy (ID > Name > Fuzzy)
 * - DRY_RUN mode for safe preview
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

var CONFIG = {
  // External Database API settings
  DATABASE: {
    API_KEY: 'your_database_api_key',
    API_VERSION: '2022-06-28',
    BASE_URL: 'https://api.notion.com/v1',
    DATABASE_ID: 'your_database_id'
  },

  // Sync settings
  SYNC: {
    DRY_RUN: true,           // Set false to actually update database
    MAX_UPDATES: 500,        // Safety limit
    RATE_LIMIT_MS: 350       // Delay between updates (3 req/sec)
  },

  // Format-specific database field names
  FORMAT_FIELDS: {
    '16:9': 'G Ads Property ID 16x9',
    '9:16': 'G Ads Property ID 9x16',
    '4:5': 'G Ads Property ID 4x5',
    '1:1': 'G Ads Property ID 1x1'
  }
};

// ============================================================================
// EXTERNAL DATABASE API FUNCTIONS
// ============================================================================

/**
 * Make authenticated request to database API
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
    throw new Error('API error: ' + responseCode);
  }
}

/**
 * Query database with pagination
 */
function queryDatabase(filter) {
  var endpoint = '/databases/' + CONFIG.DATABASE.DATABASE_ID + '/query';
  var allResults = [];
  var hasMore = true;
  var startCursor = null;

  while (hasMore) {
    var payload = { page_size: 100 };
    if (filter) payload.filter = filter;
    if (startCursor) payload.start_cursor = startCursor;

    var response = databaseRequest(endpoint, 'POST', payload);

    if (response.results && response.results.length > 0) {
      allResults = allResults.concat(response.results);
    }

    hasMore = response.has_more || false;
    startCursor = response.next_cursor || null;

    if (allResults.length > 10000) break;
  }

  return allResults;
}

/**
 * Update database record
 */
function updateDatabaseRecord(recordId, properties) {
  var endpoint = '/pages/' + recordId;
  return databaseRequest(endpoint, 'PATCH', { properties: properties });
}

// ============================================================================
// GOOGLE ADS QUERY FUNCTIONS
// ============================================================================

/**
 * Get ALL video assets from Google Ads
 */
function getAllVideoAssets() {
  Logger.log('  Querying Google Ads video assets...');
  var assets = [];

  var query = "SELECT asset.id, asset.name, " +
    "asset.youtube_video_asset.youtube_video_id, " +
    "asset.youtube_video_asset.youtube_video_title " +
    "FROM asset WHERE asset.type = 'YOUTUBE_VIDEO'";

  var result = AdsApp.search(query);

  while (result.hasNext()) {
    var row = result.next();
    assets.push({
      assetId: row.asset.id,
      assetName: row.asset.name || '',
      assetType: 'VIDEO',
      videoId: row.asset.youtubeVideoAsset ? row.asset.youtubeVideoAsset.youtubeVideoId : null,
      videoTitle: row.asset.youtubeVideoAsset ? row.asset.youtubeVideoAsset.youtubeVideoTitle : ''
    });
  }

  Logger.log('  Found ' + assets.length + ' video assets');
  return assets;
}

/**
 * Get ALL image assets from Google Ads
 */
function getAllImageAssets() {
  Logger.log('  Querying Google Ads image assets...');
  var assets = [];

  var query = "SELECT asset.id, asset.name, " +
    "asset.image_asset.full_size.width_pixels, " +
    "asset.image_asset.full_size.height_pixels " +
    "FROM asset WHERE asset.type = 'IMAGE'";

  var result = AdsApp.search(query);

  while (result.hasNext()) {
    var row = result.next();
    var width = row.asset.imageAsset && row.asset.imageAsset.fullSize ?
      row.asset.imageAsset.fullSize.widthPixels : null;
    var height = row.asset.imageAsset && row.asset.imageAsset.fullSize ?
      row.asset.imageAsset.fullSize.heightPixels : null;

    // Calculate aspect ratio
    var aspectRatio = null;
    if (width && height) {
      var gcd = function(a, b) { return b === 0 ? a : gcd(b, a % b); };
      var divisor = gcd(width, height);
      aspectRatio = (width / divisor) + ':' + (height / divisor);
    }

    assets.push({
      assetId: row.asset.id,
      assetName: row.asset.name || '',
      assetType: 'IMAGE',
      width: width,
      height: height,
      aspectRatio: aspectRatio
    });
  }

  Logger.log('  Found ' + assets.length + ' image assets');
  return assets;
}

/**
 * Check if asset is actively used in App campaigns
 */
function getAssetCampaignStatus() {
  Logger.log('  Querying campaign asset usage...');
  var activeAssetIds = {};

  // IMPORTANT: Must include campaign.advertising_channel_sub_type in SELECT
  // when using it in WHERE clause (GAQL requirement)
  var query = "SELECT asset.id, campaign.name, campaign.status, " +
    "campaign.advertising_channel_sub_type " +
    "FROM campaign_asset " +
    "WHERE campaign.advertising_channel_sub_type IN ('APP_CAMPAIGN', 'APP_CAMPAIGN_FOR_ENGAGEMENT') " +
    "AND campaign.status = 'ENABLED'";

  var result = AdsApp.search(query);

  while (result.hasNext()) {
    var row = result.next();
    activeAssetIds[row.asset.id] = true;
  }

  Logger.log('  Found ' + Object.keys(activeAssetIds).length + ' assets in active campaigns');
  return activeAssetIds;
}

// ============================================================================
// ASSET MATCHING FUNCTIONS
// ============================================================================

/**
 * Match Google Ads asset to database record using multi-tier strategy
 *
 * Priority:
 * 1. ID match (id-480 in asset name)
 * 2. Video ID match (YouTube videos only)
 * 3. Exact name match
 * 4. Fuzzy name match (normalized)
 *
 * @param {Object} asset - Google Ads asset
 * @param {Array} records - Database records
 * @returns {Object} Best match {record, confidence, method} or null
 */
function findBestMatch(asset, records) {
  // 1. Try ID extraction from asset name
  var idMatch = asset.assetName.match(/id-(\d+)/);
  if (idMatch) {
    for (var i = 0; i < records.length; i++) {
      if (records[i].uniqueId === parseInt(idMatch[1])) {
        return { record: records[i], confidence: 'high', method: 'id' };
      }
    }
  }

  // 2. Try video ID match (YouTube videos only)
  if (asset.videoId) {
    for (var i = 0; i < records.length; i++) {
      if (records[i].videoId === asset.videoId) {
        return { record: records[i], confidence: 'high', method: 'video_id' };
      }
    }
  }

  // 3. Try exact name match
  for (var i = 0; i < records.length; i++) {
    if (records[i].name === asset.assetName) {
      return { record: records[i], confidence: 'medium', method: 'exact_name' };
    }
  }

  // 4. Try fuzzy match (normalized: lowercase, alphanumeric only)
  var normalizedAssetName = asset.assetName.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (var i = 0; i < records.length; i++) {
    var normalizedRecordName = records[i].name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalizedRecordName === normalizedAssetName) {
      return { record: records[i], confidence: 'low', method: 'fuzzy' };
    }
  }

  return null;
}

// ============================================================================
// MAIN SYNC LOGIC
// ============================================================================

function main() {
  Logger.log('========================================');
  Logger.log('=== Sync Google Ads Assets to Database ===');
  Logger.log('========================================');
  Logger.log('');

  if (CONFIG.SYNC.DRY_RUN) {
    Logger.log('⚠ DRY RUN MODE - No database updates');
    Logger.log('');
  }

  // Step 1: Get all assets from Google Ads
  Logger.log('[Step 1/5] Fetching assets from Google Ads...');
  var videoAssets = getAllVideoAssets();
  var imageAssets = getAllImageAssets();
  var allAssets = videoAssets.concat(imageAssets);
  Logger.log('Total assets: ' + allAssets.length);
  Logger.log('');

  // Step 2: Get campaign status
  Logger.log('[Step 2/5] Checking campaign usage...');
  var activeAssetIds = getAssetCampaignStatus();
  Logger.log('');

  // Step 3: Get all records from database
  Logger.log('[Step 3/5] Fetching records from database...');
  var records = queryDatabase(null);  // No filter - get ALL records
  Logger.log('Total records: ' + records.length);
  Logger.log('');

  // Parse database records
  var parsedRecords = records.map(function(record) {
    return {
      id: record.id,
      uniqueId: record.properties.id ? record.properties.id.unique_id.number : null,
      name: record.properties.Name ? record.properties.Name.title[0].plain_text : '',
      videoId: record.properties['YouTube ID'] ? record.properties['YouTube ID'].rich_text[0].plain_text : null
    };
  }).filter(function(r) { return r.uniqueId !== null; });

  Logger.log('Records with unique ID: ' + parsedRecords.length);
  Logger.log('');

  // Step 4: Match assets to records
  Logger.log('[Step 4/5] Matching assets to records...');
  var toUpdate = [];
  var matched = 0;
  var unmatched = 0;

  for (var i = 0; i < allAssets.length; i++) {
    var asset = allAssets[i];
    var match = findBestMatch(asset, parsedRecords);

    if (match) {
      matched++;

      // Determine which field to update based on aspect ratio
      var fieldName = null;
      if (asset.aspectRatio) {
        fieldName = CONFIG.FORMAT_FIELDS[asset.aspectRatio];
      }

      // Check if asset is live in campaigns
      var isLive = activeAssetIds[asset.assetId] === true;

      toUpdate.push({
        recordId: match.record.id,
        recordName: match.record.name,
        assetId: asset.assetId,
        assetName: asset.assetName,
        fieldName: fieldName,
        isLive: isLive,
        confidence: match.confidence,
        method: match.method
      });
    } else {
      unmatched++;
    }
  }

  Logger.log('Matched: ' + matched + ' assets');
  Logger.log('Unmatched: ' + unmatched + ' assets');
  Logger.log('');

  // Step 5: Update database
  Logger.log('[Step 5/5] Updating database...');
  Logger.log('');

  if (CONFIG.SYNC.DRY_RUN) {
    Logger.log('DRY RUN MODE - Would update ' + toUpdate.length + ' records:');
    Logger.log('');
    for (var i = 0; i < Math.min(5, toUpdate.length); i++) {
      var item = toUpdate[i];
      Logger.log('[' + (i+1) + '] ' + item.recordName);
      Logger.log('    Asset ID: ' + item.assetId);
      Logger.log('    Field: ' + (item.fieldName || 'N/A'));
      Logger.log('    Live: ' + item.isLive);
      Logger.log('    Confidence: ' + item.confidence + ' (' + item.method + ')');
    }
    Logger.log('');
    Logger.log('Set CONFIG.SYNC.DRY_RUN = false to actually update');
  } else {
    var updated = 0;
    var failed = 0;

    for (var i = 0; i < Math.min(toUpdate.length, CONFIG.SYNC.MAX_UPDATES); i++) {
      var item = toUpdate[i];

      try {
        var properties = {};

        // Update format-specific field if applicable
        if (item.fieldName) {
          properties[item.fieldName] = {
            rich_text: [{ text: { content: item.assetId } }]
          };
        }

        // Update live status
        properties['Live-in-channels'] = {
          multi_select: item.isLive ? [{ name: 'Google Ads' }] : []
        };

        updateDatabaseRecord(item.recordId, properties);
        Logger.log('[' + (i+1) + '/' + toUpdate.length + '] Updated: ' + item.recordName);

        updated++;

        // Rate limiting
        if (i < toUpdate.length - 1) {
          Utilities.sleep(CONFIG.SYNC.RATE_LIMIT_MS);
        }

      } catch (e) {
        Logger.log('[' + (i+1) + '/' + toUpdate.length + '] Failed: ' + item.recordName + ' - ' + e.message);
        failed++;
      }
    }

    Logger.log('');
    Logger.log('========================================');
    Logger.log('=== SYNC COMPLETE ===');
    Logger.log('========================================');
    Logger.log('Updated: ' + updated + ' records');
    if (failed > 0) {
      Logger.log('Failed: ' + failed + ' records');
    }
  }

  Logger.log('');
}
