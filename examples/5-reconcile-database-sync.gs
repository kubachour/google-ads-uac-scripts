/**
 * EXAMPLE SCRIPT: Reconcile Database with Google Ads Assets
 *
 * Description:
 * Reconciles an external database with Google Ads assets to fix sync discrepancies.
 * Finds assets that exist in Google Ads but aren't marked as uploaded in the database.
 *
 * Use Case:
 * Mapy.com uploads assets to Google Ads from a database. Sometimes the database
 * update fails after successful upload, causing sync issues. This script finds
 * and fixes those discrepancies.
 *
 * Frequency: Weekly / On-demand (maintenance)
 * Platform: Google Ads Scripts
 *
 * Features:
 * - Read-only for Google Ads (no mutations)
 * - Idempotent (safe to run multiple times)
 * - DRY_RUN mode for preview
 * - MAX_UPDATES safety limit
 * - Detailed reconciliation report
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

  // Reconciliation settings
  RECONCILE: {
    DRY_RUN: true,       // Set false to actually update database
    MAX_UPDATES: 100,    // Safety limit on updates
    UPLOAD_STATUS_FIELD: 'Google Ads'  // Value to add to "Uploaded" field
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
 * IMPORTANT: Always implement pagination - databases limit to 100 records
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
// GOOGLE ADS QUERY FUNCTIONS
// ============================================================================

/**
 * Get ALL image assets from Google Ads with unique IDs
 * Parses asset names to extract unique ID (e.g., id-480)
 *
 * IMPORTANT:
 * - Cannot filter assets by date (asset.creation_time doesn't exist)
 * - Must query ALL assets and filter programmatically
 *
 * @returns {Array} Array of { assetId, assetName, uniqueId }
 */
function getAllGoogleAdsAssets() {
  Logger.log('  Querying Google Ads assets...');
  var assets = [];

  // Query all image assets (no date filter possible)
  var query = "SELECT asset.id, asset.name " +
    "FROM asset " +
    "WHERE asset.type = 'IMAGE'";

  var result = AdsApp.search(query);

  while (result.hasNext()) {
    var row = result.next();
    var assetName = row.asset.name;

    if (!assetName) continue;

    // Extract unique ID from name (pattern: id-480)
    var match = assetName.match(/id-(\d+)/);
    if (match) {
      assets.push({
        assetId: row.asset.id,
        assetName: assetName,
        uniqueId: parseInt(match[1])
      });
    }
  }

  Logger.log('  Found ' + assets.length + ' assets with unique IDs');
  return assets;
}

// ============================================================================
// RECONCILIATION LOGIC
// ============================================================================

/**
 * Get all database records (no filters)
 * Returns simplified structure for matching
 *
 * @returns {Array} Array of { recordId, name, uniqueId, hasGoogleAds, uploadedValues }
 */
function getAllDatabaseRecords() {
  Logger.log('  Querying database records...');

  // Query ALL records (no filters)
  var filter = {
    property: "Type",
    select: { equals: "Static" }
  };

  var records = queryDatabase(filter);
  Logger.log('  Retrieved ' + records.length + ' records');

  // Map to simpler structure
  var mapped = records.map(function(record) {
    var uniqueId = null;
    if (record.properties.id &&
        record.properties.id.unique_id &&
        record.properties.id.unique_id.number) {
      uniqueId = record.properties.id.unique_id.number;
    }

    var uploaded = [];
    var hasGoogleAds = false;
    if (record.properties.Uploaded &&
        record.properties.Uploaded.multi_select) {
      uploaded = record.properties.Uploaded.multi_select.map(function(opt) {
        return opt.name;
      });
      hasGoogleAds = uploaded.indexOf(CONFIG.RECONCILE.UPLOAD_STATUS_FIELD) !== -1;
    }

    var name = 'Untitled';
    if (record.properties.Name &&
        record.properties.Name.title &&
        record.properties.Name.title[0]) {
      name = record.properties.Name.title[0].plain_text;
    }

    return {
      recordId: record.id,
      name: name,
      uniqueId: uniqueId,
      hasGoogleAds: hasGoogleAds,
      uploadedValues: uploaded
    };
  }).filter(function(r) { return r.uniqueId !== null; });

  Logger.log('  Found ' + mapped.length + ' records with unique ID');
  return mapped;
}

/**
 * Mark database record as uploaded to Google Ads
 */
function markAsUploadedToGoogleAds(recordId, existingUploaded) {
  var uploadedValues = existingUploaded || [];

  // Add "Google Ads" if not already present
  if (uploadedValues.indexOf(CONFIG.RECONCILE.UPLOAD_STATUS_FIELD) === -1) {
    uploadedValues.push(CONFIG.RECONCILE.UPLOAD_STATUS_FIELD);
  }

  var properties = {
    Uploaded: {
      multi_select: uploadedValues.map(function(val) {
        return { name: val };
      })
    }
  };

  updateDatabaseRecord(recordId, properties);
}

// ============================================================================
// MAIN RECONCILIATION LOGIC
// ============================================================================

function main() {
  Logger.log('========================================');
  Logger.log('=== Reconcile Database with Google Ads ===');
  Logger.log('========================================');
  Logger.log('');

  if (CONFIG.RECONCILE.DRY_RUN) {
    Logger.log('⚠ DRY RUN MODE - No database updates');
    Logger.log('');
  }

  // Step 1: Get all assets from Google Ads
  Logger.log('[Step 1/5] Fetching assets from Google Ads...');
  var googleAdsAssets = getAllGoogleAdsAssets();
  Logger.log('Found ' + googleAdsAssets.length + ' assets');
  Logger.log('');

  // Create lookup by unique ID
  var googleAdsLookup = {};
  for (var i = 0; i < googleAdsAssets.length; i++) {
    var asset = googleAdsAssets[i];
    googleAdsLookup[asset.uniqueId] = asset;
  }

  // Step 2: Get all database records
  Logger.log('[Step 2/5] Fetching records from database...');
  var databaseRecords = getAllDatabaseRecords();
  Logger.log('Found ' + databaseRecords.length + ' records');
  Logger.log('');

  // Step 3: Find mismatches
  Logger.log('[Step 3/5] Analyzing mismatches...');
  var toUpdate = [];
  var alreadySynced = 0;
  var notInGoogleAds = 0;

  for (var i = 0; i < databaseRecords.length; i++) {
    var record = databaseRecords[i];
    var existsInGoogleAds = googleAdsLookup[record.uniqueId];

    if (existsInGoogleAds && !record.hasGoogleAds) {
      // Asset exists in Google Ads but database not marked
      toUpdate.push({
        record: record,
        asset: existsInGoogleAds
      });
    } else if (existsInGoogleAds && record.hasGoogleAds) {
      alreadySynced++;
    } else if (!existsInGoogleAds) {
      notInGoogleAds++;
    }
  }

  Logger.log('');
  Logger.log('========================================');
  Logger.log('=== Analysis Complete ===');
  Logger.log('========================================');
  Logger.log('');
  Logger.log('✓ Already synced: ' + alreadySynced + ' records');
  Logger.log('⊘ Not in Google Ads: ' + notInGoogleAds + ' records (may be pending upload)');
  Logger.log('⚠ Need updating: ' + toUpdate.length + ' records');
  Logger.log('');

  if (toUpdate.length === 0) {
    Logger.log('========================================');
    Logger.log('✓ No updates needed - all in sync!');
    Logger.log('========================================');
    return;
  }

  // Step 4: Preview or update
  Logger.log('[Step 4/5] Processing mismatches...');
  Logger.log('');

  if (CONFIG.RECONCILE.DRY_RUN) {
    // Preview mode
    Logger.log('DRY RUN MODE - Would update the following:');
    Logger.log('');
    for (var i = 0; i < Math.min(10, toUpdate.length); i++) {
      var item = toUpdate[i];
      Logger.log('[' + (i+1) + '] "' + item.record.name + '" [ID: ' + item.record.uniqueId + ']');
      Logger.log('    Asset: ' + item.asset.assetName);
    }
    if (toUpdate.length > 10) {
      Logger.log('... and ' + (toUpdate.length - 10) + ' more');
    }
    Logger.log('');
    Logger.log('========================================');
    Logger.log('Set CONFIG.RECONCILE.DRY_RUN = false to update');
    Logger.log('========================================');

  } else {
    // Update mode
    Logger.log('Updating database (max ' + CONFIG.RECONCILE.MAX_UPDATES + ' updates)...');
    Logger.log('');

    var updated = 0;
    var failed = 0;

    for (var i = 0; i < Math.min(toUpdate.length, CONFIG.RECONCILE.MAX_UPDATES); i++) {
      var item = toUpdate[i];

      try {
        Logger.log('[' + (i+1) + '/' + toUpdate.length + '] Updating: ' + item.record.name);
        markAsUploadedToGoogleAds(item.record.recordId, item.record.uploadedValues);
        Logger.log('  ✓ Updated successfully');
        updated++;
      } catch (e) {
        Logger.log('  ✗ Failed: ' + e.message);
        failed++;
      }
    }

    Logger.log('');
    Logger.log('========================================');
    Logger.log('=== Reconciliation Complete ===');
    Logger.log('========================================');
    Logger.log('');
    Logger.log('✓ Updated: ' + updated + ' records');
    if (failed > 0) {
      Logger.log('✗ Failed: ' + failed + ' records');
    }
    if (toUpdate.length > CONFIG.RECONCILE.MAX_UPDATES) {
      Logger.log('⚠ Remaining: ' + (toUpdate.length - CONFIG.RECONCILE.MAX_UPDATES) + ' records');
      Logger.log('   Increase MAX_UPDATES to process more');
    }
    Logger.log('');
  }
}

// ============================================================================
// TEST FUNCTIONS
// ============================================================================

/**
 * Test Google Ads query
 * Rename to main() to test
 */
function testGoogleAdsQuery() {
  Logger.log('=== Testing Google Ads Query ===');
  Logger.log('');

  var assets = getAllGoogleAdsAssets();

  Logger.log('Sample assets (first 5):');
  for (var i = 0; i < Math.min(5, assets.length); i++) {
    Logger.log((i+1) + '. ' + assets[i].assetName);
    Logger.log('   Asset ID: ' + assets[i].assetId);
    Logger.log('   Unique ID: ' + assets[i].uniqueId);
  }
}

/**
 * Test database query
 * Rename to main() to test
 */
function testDatabaseQuery() {
  Logger.log('=== Testing Database Query ===');
  Logger.log('');

  var records = getAllDatabaseRecords();

  Logger.log('Sample records (first 5):');
  for (var i = 0; i < Math.min(5, records.length); i++) {
    Logger.log((i+1) + '. ' + records[i].name);
    Logger.log('   Record ID: ' + records[i].recordId);
    Logger.log('   Unique ID: ' + records[i].uniqueId);
    Logger.log('   Has Google Ads: ' + records[i].hasGoogleAds);
  }
}
