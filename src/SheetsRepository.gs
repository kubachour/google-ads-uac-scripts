/**
 * SheetsRepository Module
 * All Google Sheets read/write operations
 *
 * PLATFORM: Google Ads Scripts
 * USED BY: ChangeRequestManager.gs, DecisionEngine.gs
 * DEPENDS ON: Config.gs
 */

var SheetsRepository = (function() {

  var _spreadsheet = null;

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Get the main spreadsheet (lazy loaded)
   * @returns {Spreadsheet} The automation spreadsheet
   */
  function getSpreadsheet() {
    if (_spreadsheet) {
      return _spreadsheet;
    }

    var spreadsheetId = CONFIG.SHEETS.SPREADSHEET_ID;

    if (!spreadsheetId) {
      // Fall back to OUTPUT_SPREADSHEET_URL if configured
      if (typeof OUTPUT_SPREADSHEET_URL !== 'undefined' && OUTPUT_SPREADSHEET_URL) {
        _spreadsheet = SpreadsheetApp.openByUrl(OUTPUT_SPREADSHEET_URL);
        return _spreadsheet;
      }
      throw new Error('No spreadsheet configured. Set CONFIG.SHEETS.SPREADSHEET_ID');
    }

    _spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    return _spreadsheet;
  }

  /**
   * Get or create a sheet by name
   * @param {string} sheetName - Name of the sheet
   * @returns {Sheet} The sheet object
   */
  function getSheet(sheetName) {
    var spreadsheet = getSpreadsheet();
    var sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
      Logger.log('Created new sheet: ' + sheetName);
    }

    return sheet;
  }

  // ============================================================================
  // GENERIC OPERATIONS
  // ============================================================================

  /**
   * Append a row to a sheet
   * @param {string} sheetName - Name of the sheet
   * @param {Object} data - Key-value pairs to append
   * @param {Array} headers - Expected headers (for consistency)
   * @returns {number} Row number of the appended row
   */
  function appendRow(sheetName, data, headers) {
    var sheet = getSheet(sheetName);
    var lastRow = sheet.getLastRow();

    // If sheet is empty, add headers first
    if (lastRow === 0 && headers) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      lastRow = 1;
    }

    // Get existing headers if not provided
    if (!headers && lastRow > 0) {
      headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    }

    // Build row array from data object
    var row = [];
    for (var i = 0; i < headers.length; i++) {
      var key = headers[i];
      row.push(data[key] !== undefined ? data[key] : '');
    }

    sheet.appendRow(row);
    return lastRow + 1;
  }

  /**
   * Update a specific cell
   * @param {string} sheetName - Name of the sheet
   * @param {number} row - Row number (1-based)
   * @param {string} columnName - Column header name
   * @param {*} value - New value
   */
  function updateCell(sheetName, row, columnName, value) {
    var sheet = getSheet(sheetName);
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var colIndex = headers.indexOf(columnName) + 1;

    if (colIndex === 0) {
      throw new Error('Column not found: ' + columnName);
    }

    sheet.getRange(row, colIndex).setValue(value);
  }

  /**
   * Get rows matching a filter
   * @param {string} sheetName - Name of the sheet
   * @param {string} columnName - Column to filter by
   * @param {*} value - Value to match
   * @returns {Array} Array of {row: number, data: Object}
   */
  function getRowsWhere(sheetName, columnName, value) {
    var sheet = getSheet(sheetName);
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();

    if (lastRow <= 1) {
      return [];  // Only headers or empty
    }

    var allData = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var headers = allData[0];
    var colIndex = headers.indexOf(columnName);

    if (colIndex === -1) {
      return [];
    }

    var results = [];
    for (var i = 1; i < allData.length; i++) {
      if (allData[i][colIndex] === value) {
        var rowData = {};
        for (var j = 0; j < headers.length; j++) {
          rowData[headers[j]] = allData[i][j];
        }
        results.push({
          row: i + 1,  // 1-based row number
          data: rowData
        });
      }
    }

    return results;
  }

  /**
   * Get all rows from a sheet
   * @param {string} sheetName - Name of the sheet
   * @returns {Array} Array of {row: number, data: Object}
   */
  function getAllRows(sheetName) {
    var sheet = getSheet(sheetName);
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();

    if (lastRow <= 1) {
      return [];
    }

    var allData = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var headers = allData[0];

    var results = [];
    for (var i = 1; i < allData.length; i++) {
      var rowData = {};
      for (var j = 0; j < headers.length; j++) {
        rowData[headers[j]] = allData[i][j];
      }
      results.push({
        row: i + 1,
        data: rowData
      });
    }

    return results;
  }

  /**
   * Get a single column as an array
   * @param {string} sheetName - Name of the sheet
   * @param {string} columnName - Column header name
   * @returns {Array} Array of values
   */
  function getColumn(sheetName, columnName) {
    var sheet = getSheet(sheetName);
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();

    if (lastRow <= 1) {
      return [];
    }

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var colIndex = headers.indexOf(columnName);

    if (colIndex === -1) {
      return [];
    }

    var data = sheet.getRange(2, colIndex + 1, lastRow - 1, 1).getValues();
    return data.map(function(row) { return row[0]; });
  }

  // ============================================================================
  // CHANGE REQUESTS
  // ============================================================================

  var CHANGE_REQUEST_HEADERS = [
    'request_id',
    'batch_id',
    'created_at',
    'campaign_id',
    'campaign_name',
    'ad_id',
    'asset_type',
    'current_asset_id',
    'current_asset_name',
    'current_performance',
    'days_active',
    'impressions',
    'clicks',
    'ctr',
    'conversions',
    'cost',
    'action',
    'new_asset_source_type',
    'new_asset_source_id',
    'new_asset_name',
    'replacement_best_perf',
    'replacement_source_campaign',
    'reason',
    'status',
    'executed_at',
    'execution_result',
    'current_assets_json'
  ];

  /**
   * Create a new change request
   * @param {Object} request - Change request data
   * @returns {string} Request ID
   */
  function createChangeRequest(request) {
    var requestId = 'REQ-' + Date.now();
    var batchId = request.batch_id || ('BATCH-' + new Date().toISOString().split('T')[0]);

    var data = {
      request_id: requestId,
      batch_id: batchId,
      created_at: new Date(),
      campaign_id: request.campaign_id || '',
      campaign_name: request.campaign_name || '',
      ad_id: request.ad_id || '',
      asset_type: request.asset_type || '',
      current_asset_id: request.current_asset_id || '',
      current_asset_name: request.current_asset_name || '',
      current_performance: request.current_performance || '',
      days_active: request.days_active || '',
      impressions: request.impressions || '',
      clicks: request.clicks || '',
      ctr: request.ctr || '',
      conversions: request.conversions || '',
      cost: request.cost || '',
      action: request.action || '',
      new_asset_source_type: request.new_asset_source_type || '',
      new_asset_source_id: request.new_asset_source_id || '',
      new_asset_name: request.new_asset_name || '',
      replacement_best_perf: request.replacement_best_perf || '',
      replacement_source_campaign: request.replacement_source_campaign || '',
      reason: request.reason || '',
      status: request.status || 'PENDING',
      executed_at: '',
      execution_result: '',
      current_assets_json: request.current_assets_json || ''
    };

    appendRow(CONFIG.SHEETS.CHANGE_REQUESTS, data, CHANGE_REQUEST_HEADERS);
    return requestId;
  }

  /**
   * Get approved change requests
   * @returns {Array} Array of approved requests with row numbers
   */
  function getApprovedChangeRequests() {
    return getRowsWhere(CONFIG.SHEETS.CHANGE_REQUESTS, 'status', 'APPROVED');
  }

  /**
   * Get pending change requests
   * @returns {Array} Array of pending requests
   */
  function getPendingChangeRequests() {
    return getRowsWhere(CONFIG.SHEETS.CHANGE_REQUESTS, 'status', 'PENDING');
  }

  /**
   * Mark a change request as executed
   * @param {number} row - Row number
   * @param {string} result - Execution result message
   */
  function markChangeRequestExecuted(row, result) {
    var sheet = getSheet(CONFIG.SHEETS.CHANGE_REQUESTS);
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    var statusCol = headers.indexOf('status') + 1;
    var executedAtCol = headers.indexOf('executed_at') + 1;
    var resultCol = headers.indexOf('execution_result') + 1;

    if (statusCol > 0) sheet.getRange(row, statusCol).setValue('EXECUTED');
    if (executedAtCol > 0) sheet.getRange(row, executedAtCol).setValue(new Date());
    if (resultCol > 0) sheet.getRange(row, resultCol).setValue(result);
  }

  /**
   * Mark a change request as failed
   * @param {number} row - Row number
   * @param {string} error - Error message
   */
  function markChangeRequestFailed(row, error) {
    var sheet = getSheet(CONFIG.SHEETS.CHANGE_REQUESTS);
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    var statusCol = headers.indexOf('status') + 1;
    var executedAtCol = headers.indexOf('executed_at') + 1;
    var resultCol = headers.indexOf('execution_result') + 1;

    if (statusCol > 0) sheet.getRange(row, statusCol).setValue('FAILED');
    if (executedAtCol > 0) sheet.getRange(row, executedAtCol).setValue(new Date());
    if (resultCol > 0) sheet.getRange(row, resultCol).setValue('ERROR: ' + error);
  }

  // ============================================================================
  // ASSET REGISTRY
  // ============================================================================

  var ASSET_REGISTRY_HEADERS = [
    'asset_id',
    'asset_name',
    'asset_type',
    'source_type',
    'source_id',
    'status',
    'best_performance',
    'last_performance',
    'first_seen',
    'last_updated',
    'times_activated',
    'total_impressions',
    'campaigns_used'
  ];

  /**
   * Get or create asset in registry
   * @param {string} assetId - Google Ads asset resource name
   * @param {Object} assetData - Asset data to upsert
   * @returns {Object} The asset record
   */
  function upsertAsset(assetId, assetData) {
    var existing = getRowsWhere(CONFIG.SHEETS.ASSET_REGISTRY, 'asset_id', assetId);

    if (existing.length > 0) {
      // Update existing
      var row = existing[0].row;
      var sheet = getSheet(CONFIG.SHEETS.ASSET_REGISTRY);

      // Update last_performance
      if (assetData.last_performance) {
        updateCell(CONFIG.SHEETS.ASSET_REGISTRY, row, 'last_performance', assetData.last_performance);
      }

      // Update best_performance only if better
      if (assetData.last_performance) {
        var currentBest = existing[0].data.best_performance;
        var newPerf = assetData.last_performance;
        if (shouldUpdateBestPerformance(currentBest, newPerf)) {
          updateCell(CONFIG.SHEETS.ASSET_REGISTRY, row, 'best_performance', newPerf);
        }
      }

      // Update status
      if (assetData.status) {
        updateCell(CONFIG.SHEETS.ASSET_REGISTRY, row, 'status', assetData.status);
      }

      // Update last_updated
      updateCell(CONFIG.SHEETS.ASSET_REGISTRY, row, 'last_updated', new Date());

      // Update impressions
      if (assetData.total_impressions) {
        updateCell(CONFIG.SHEETS.ASSET_REGISTRY, row, 'total_impressions', assetData.total_impressions);
      }

      return existing[0].data;
    }

    // Create new
    var data = {
      asset_id: assetId,
      asset_name: assetData.asset_name || '',
      asset_type: assetData.asset_type || '',
      source_type: assetData.source_type || '',
      source_id: assetData.source_id || '',
      status: assetData.status || 'ACTIVE',
      best_performance: assetData.last_performance || 'UNKNOWN',
      last_performance: assetData.last_performance || 'UNKNOWN',
      first_seen: new Date(),
      last_updated: new Date(),
      times_activated: 1,
      total_impressions: assetData.total_impressions || 0,
      campaigns_used: assetData.campaigns_used || ''
    };

    appendRow(CONFIG.SHEETS.ASSET_REGISTRY, data, ASSET_REGISTRY_HEADERS);
    return data;
  }

  /**
   * Check if new performance is better than current best
   * @param {string} currentBest - Current best performance
   * @param {string} newPerf - New performance
   * @returns {boolean} True if new is better
   */
  function shouldUpdateBestPerformance(currentBest, newPerf) {
    var rank = { 'UNKNOWN': 0, 'LOW': 1, 'GOOD': 2, 'BEST': 3 };
    return (rank[newPerf] || 0) > (rank[currentBest] || 0);
  }

  /**
   * Get paused assets with good historical performance
   * @param {string} assetType - Type to filter by (VIDEO, IMAGE, etc.)
   * @returns {Array} Array of reusable assets
   */
  function getReusableAssets(assetType) {
    var allAssets = getAllRows(CONFIG.SHEETS.ASSET_REGISTRY);

    return allAssets.filter(function(item) {
      var d = item.data;
      return d.status === 'PAUSED' &&
             (d.best_performance === 'GOOD' || d.best_performance === 'BEST') &&
             (!assetType || d.asset_type === assetType);
    }).sort(function(a, b) {
      // Sort by best_performance (BEST first), then by times_activated (less used first)
      var rankA = a.data.best_performance === 'BEST' ? 2 : 1;
      var rankB = b.data.best_performance === 'BEST' ? 2 : 1;
      if (rankB !== rankA) return rankB - rankA;
      return (a.data.times_activated || 0) - (b.data.times_activated || 0);
    });
  }

  /**
   * Mark an asset as paused
   * @param {string} assetId - Asset ID
   */
  function markAssetPaused(assetId) {
    var existing = getRowsWhere(CONFIG.SHEETS.ASSET_REGISTRY, 'asset_id', assetId);
    if (existing.length > 0) {
      updateCell(CONFIG.SHEETS.ASSET_REGISTRY, existing[0].row, 'status', 'PAUSED');
      updateCell(CONFIG.SHEETS.ASSET_REGISTRY, existing[0].row, 'last_updated', new Date());
    }
  }

  /**
   * Mark an asset as active and increment activation count
   * @param {string} assetId - Asset ID
   */
  function markAssetActive(assetId) {
    var existing = getRowsWhere(CONFIG.SHEETS.ASSET_REGISTRY, 'asset_id', assetId);
    if (existing.length > 0) {
      var row = existing[0].row;
      var currentCount = existing[0].data.times_activated || 0;
      updateCell(CONFIG.SHEETS.ASSET_REGISTRY, row, 'status', 'ACTIVE');
      updateCell(CONFIG.SHEETS.ASSET_REGISTRY, row, 'times_activated', currentCount + 1);
      updateCell(CONFIG.SHEETS.ASSET_REGISTRY, row, 'last_updated', new Date());
    }
  }

  // ============================================================================
  // PROCESSED FILES (for Drive deduplication)
  // ============================================================================

  var PROCESSED_FILES_HEADERS = [
    'file_id',
    'file_name',
    'campaign_id',
    'processed_at',
    'asset_id'
  ];

  /**
   * Check if a file has been processed
   * @param {string} fileId - Drive file ID
   * @returns {boolean} True if already processed
   */
  function isFileProcessed(fileId) {
    var existing = getRowsWhere(CONFIG.SHEETS.PROCESSED_FILES, 'file_id', fileId);
    return existing.length > 0;
  }

  /**
   * Mark a file as processed
   * @param {Object} fileData - File data
   */
  function markFileProcessed(fileData) {
    var data = {
      file_id: fileData.file_id,
      file_name: fileData.file_name || '',
      campaign_id: fileData.campaign_id || '',
      processed_at: new Date(),
      asset_id: fileData.asset_id || ''
    };

    appendRow(CONFIG.SHEETS.PROCESSED_FILES, data, PROCESSED_FILES_HEADERS);
  }

  /**
   * Get all processed file IDs
   * @returns {Object} Map of fileId -> true
   */
  function getProcessedFileIds() {
    var fileIds = getColumn(CONFIG.SHEETS.PROCESSED_FILES, 'file_id');
    var map = {};
    for (var i = 0; i < fileIds.length; i++) {
      if (fileIds[i]) {
        map[fileIds[i]] = true;
      }
    }
    return map;
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  return {
    // Generic
    getSheet: getSheet,
    appendRow: appendRow,
    updateCell: updateCell,
    getRowsWhere: getRowsWhere,
    getAllRows: getAllRows,
    getColumn: getColumn,

    // Change Requests
    createChangeRequest: createChangeRequest,
    getApprovedChangeRequests: getApprovedChangeRequests,
    getPendingChangeRequests: getPendingChangeRequests,
    markChangeRequestExecuted: markChangeRequestExecuted,
    markChangeRequestFailed: markChangeRequestFailed,
    CHANGE_REQUEST_HEADERS: CHANGE_REQUEST_HEADERS,

    // Asset Registry
    upsertAsset: upsertAsset,
    getReusableAssets: getReusableAssets,
    markAssetPaused: markAssetPaused,
    markAssetActive: markAssetActive,
    ASSET_REGISTRY_HEADERS: ASSET_REGISTRY_HEADERS,

    // Processed Files
    isFileProcessed: isFileProcessed,
    markFileProcessed: markFileProcessed,
    getProcessedFileIds: getProcessedFileIds
  };

})();


// ============================================================================
// TEST FUNCTIONS
// ============================================================================

/**
 * Test: Create a sample change request
 */
function testCreateChangeRequest() {
  initConfig();

  var requestId = SheetsRepository.createChangeRequest({
    campaign_id: CONFIG.GOOGLE_ADS.CAMPAIGNS[0].id,
    campaign_name: CONFIG.GOOGLE_ADS.CAMPAIGNS[0].name,
    ad_id: CONFIG.GOOGLE_ADS.CAMPAIGNS[0].adGroupId,
    asset_type: 'VIDEO',
    current_asset_name: 'Test-Video-9x16',
    current_performance: 'LOW',
    days_active: 14,
    impressions: 12450,
    action: 'REMOVE',
    reason: 'LOW for 14d with 12K impressions. Auto-removing.',
    status: 'PENDING'
  });

  Logger.log('Created change request: ' + requestId);
}

/**
 * Test: Upsert an asset to registry
 */
function testUpsertAsset() {
  initConfig();

  var asset = SheetsRepository.upsertAsset('customers/123/assets/456', {
    asset_name: 'Test-Video-9x16',
    asset_type: 'VIDEO',
    source_type: 'YOUTUBE',
    source_id: 'dQw4w9WgXcQ',
    status: 'ACTIVE',
    last_performance: 'GOOD',
    total_impressions: 50000
  });

  Logger.log('Upserted asset:');
  Logger.log(JSON.stringify(asset, null, 2));
}

/**
 * Test: Get reusable assets
 */
function testGetReusableAssets() {
  initConfig();

  var reusable = SheetsRepository.getReusableAssets('VIDEO');

  Logger.log('Reusable VIDEO assets: ' + reusable.length);
  for (var i = 0; i < reusable.length; i++) {
    var a = reusable[i].data;
    Logger.log('  ' + a.asset_name + ' (best: ' + a.best_performance + ', used ' + a.times_activated + 'x)');
  }
}

/**
 * Test: Get approved change requests
 */
function testGetApprovedRequests() {
  initConfig();

  var approved = SheetsRepository.getApprovedChangeRequests();

  Logger.log('Approved requests: ' + approved.length);
  for (var i = 0; i < approved.length; i++) {
    var r = approved[i].data;
    Logger.log('  Row ' + approved[i].row + ': ' + r.request_id + ' - ' + r.action + ' ' + r.asset_type);
  }
}
