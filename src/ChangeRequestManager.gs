/**
 * ChangeRequestManager Module
 * Orchestrates the full lifecycle of change requests
 *
 * PLATFORM: Google Ads Scripts
 * USED BY: Main.gs
 * DEPENDS ON: Config.gs, SheetsRepository.gs, DecisionEngine.gs, SlackClient.gs
 */

var ChangeRequestManager = (function() {

  // ============================================================================
  // MAIN ORCHESTRATION
  // ============================================================================

  /**
   * Process changes from analysis - execute AUTO, queue PENDING
   * @param {Array} changes - Array of change objects from DecisionEngine
   * @returns {Object} Results summary
   */
  function processChanges(changes) {
    var autoChanges = [];
    var pendingChanges = [];

    // Separate by approval type
    for (var i = 0; i < changes.length; i++) {
      if (changes[i].approval === 'AUTO') {
        autoChanges.push(changes[i]);
      } else if (changes[i].approval === 'PENDING') {
        pendingChanges.push(changes[i]);
      }
    }

    Logger.log('Processing ' + changes.length + ' changes:');
    Logger.log('  AUTO: ' + autoChanges.length);
    Logger.log('  PENDING: ' + pendingChanges.length);

    // Execute AUTO changes immediately
    var autoResults = { success: 0, failed: 0, details: [] };
    if (autoChanges.length > 0) {
      autoResults = executeChanges(autoChanges);
      Logger.log('Auto-executed: ' + autoResults.success + ' success, ' + autoResults.failed + ' failed');
    }

    // Write PENDING to sheet for approval
    var batchId = 'BATCH-' + new Date().toISOString().split('T')[0] + '-' + Date.now();
    for (var j = 0; j < pendingChanges.length; j++) {
      pendingChanges[j].batch_id = batchId;
      SheetsRepository.createChangeRequest(pendingChanges[j]);
    }

    if (pendingChanges.length > 0) {
      Logger.log('Wrote ' + pendingChanges.length + ' pending requests to sheet');
    }

    // Send notification
    if (typeof SlackClient !== 'undefined' && CONFIG.SLACK.ENABLED) {
      SlackClient.notifyAnalysisComplete(autoResults, pendingChanges.length);
    }

    return {
      auto: autoResults,
      pending: pendingChanges.length,
      total: changes.length
    };
  }

  /**
   * Get approved requests from sheet
   * @returns {Array} Array of approved request objects with row numbers
   */
  function getApprovedFromSheet() {
    return SheetsRepository.getApprovedChangeRequests();
  }

  /**
   * Execute approved changes from sheet
   * @returns {Object} Execution results
   */
  function executeApprovedFromSheet() {
    var approved = getApprovedFromSheet();

    if (approved.length === 0) {
      Logger.log('No approved changes to execute');
      return { success: 0, failed: 0, details: [] };
    }

    Logger.log('Found ' + approved.length + ' approved changes');

    // Convert to change objects
    var changes = approved.map(function(item) {
      return {
        row: item.row,
        data: item.data
      };
    });

    var results = executeChangesFromSheet(changes);

    // Send notification
    if (typeof SlackClient !== 'undefined' && CONFIG.SLACK.ENABLED) {
      SlackClient.notifyExecutionComplete(results);
    }

    return results;
  }

  // ============================================================================
  // EXECUTION
  // ============================================================================

  /**
   * Execute a list of changes (for AUTO changes)
   * @param {Array} changes - Array of change objects
   * @returns {Object} Results summary
   */
  function executeChanges(changes) {
    var results = { success: 0, failed: 0, details: [] };

    for (var i = 0; i < changes.length; i++) {
      var change = changes[i];
      var result = executeSingleChange(change);

      if (result.success) {
        results.success++;
      } else {
        results.failed++;
      }

      results.details.push({
        asset: change.current_asset_name,
        action: change.action,
        success: result.success,
        message: result.message
      });
    }

    return results;
  }

  /**
   * Execute changes from sheet (for APPROVED changes)
   * Updates sheet status after execution
   * @param {Array} changes - Array of {row, data} objects
   * @returns {Object} Results summary
   */
  function executeChangesFromSheet(changes) {
    var results = { success: 0, failed: 0, details: [] };

    for (var i = 0; i < changes.length; i++) {
      var change = changes[i];
      var result = executeSingleChange(change.data);

      if (result.success) {
        results.success++;
        SheetsRepository.markChangeRequestExecuted(change.row, result.message);
      } else {
        results.failed++;
        SheetsRepository.markChangeRequestFailed(change.row, result.message);
      }

      results.details.push({
        requestId: change.data.request_id,
        asset: change.data.current_asset_name,
        action: change.data.action,
        success: result.success,
        message: result.message
      });
    }

    return results;
  }

  /**
   * Execute a single change
   * @param {Object} change - Change object
   * @returns {Object} {success: boolean, message: string}
   */
  function executeSingleChange(change) {
    try {
      Logger.log('Executing: ' + change.action + ' ' + change.asset_type + ' - ' + change.current_asset_name);

      var currentAssets = [];
      if (change.current_assets_json) {
        try {
          currentAssets = JSON.parse(change.current_assets_json);
        } catch (e) {
          // Ignore parse errors
        }
      }

      switch (change.action) {
        case 'REMOVE':
          return executeRemove(change, currentAssets);

        case 'ADD':
          return executeAdd(change, currentAssets);

        case 'REPLACE':
          // Replace = Remove old + Add new
          var removeResult = executeRemove(change, currentAssets);
          if (!removeResult.success) {
            return removeResult;
          }

          // Get updated assets after removal
          var adInfo = DecisionEngine.getCurrentAdInfo({
            id: change.campaign_id,
            adGroupId: change.ad_id
          });

          if (adInfo) {
            currentAssets = getAssetsByType(change.asset_type, adInfo);
          }

          var addResult = executeAdd(change, currentAssets);
          if (addResult.success) {
            return { success: true, message: 'Replaced: ' + removeResult.message + ' -> ' + addResult.message };
          }
          return addResult;

        default:
          return { success: false, message: 'Unknown action: ' + change.action };
      }

    } catch (e) {
      Logger.log('ERROR: ' + e.message);
      return { success: false, message: e.message };
    }
  }

  /**
   * Execute a REMOVE action
   * @param {Object} change - Change object
   * @param {Array} currentAssets - Current assets of this type
   * @returns {Object} Result
   */
  function executeRemove(change, currentAssets) {
    var customerId = CONFIG.GOOGLE_ADS.CUSTOMER_ID;

    // Filter out the asset to remove
    var newAssets = currentAssets.filter(function(a) {
      var assetRef = a.asset || a;
      return assetRef !== change.current_asset_id &&
             assetRef.indexOf(change.current_asset_id) === -1;
    });

    if (newAssets.length === currentAssets.length) {
      // Asset not found in current list - might already be removed
      Logger.log('  Asset not found in current list, may already be removed');
    }

    // Check minimum limits
    var minLimit = getMinLimitForType(change.asset_type);
    if (newAssets.length < minLimit) {
      return {
        success: false,
        message: 'Cannot remove - would go below minimum (' + minLimit + ')'
      };
    }

    // Build and execute mutation
    var payload = buildUpdatePayload(change, newAssets);
    var result = AdsApp.mutate(payload);

    if (result.isSuccessful()) {
      // Update asset registry
      SheetsRepository.markAssetPaused(change.current_asset_id);

      return { success: true, message: 'Removed ' + change.current_asset_name };
    } else {
      return { success: false, message: extractErrorMessage(result) };
    }
  }

  /**
   * Execute an ADD action
   * @param {Object} change - Change object
   * @param {Array} currentAssets - Current assets of this type
   * @returns {Object} Result
   */
  function executeAdd(change, currentAssets) {
    var customerId = CONFIG.GOOGLE_ADS.CUSTOMER_ID;
    var assetResourceName = null;

    // Check maximum limits
    var maxLimit = getMaxLimitForType(change.asset_type);
    if (currentAssets.length >= maxLimit) {
      return {
        success: false,
        message: 'Cannot add - already at maximum (' + maxLimit + ')'
      };
    }

    // Create or get asset based on source type
    if (change.new_asset_source_type === 'YOUTUBE') {
      // Create YouTube video asset
      var assetResult = createYouTubeAsset(change.new_asset_source_id, change.new_asset_name);
      if (!assetResult.success) {
        return assetResult;
      }
      assetResourceName = assetResult.resourceName;

    } else if (change.new_asset_source_type === 'REGISTRY') {
      // Reuse existing asset from registry
      assetResourceName = change.new_asset_source_id;

    } else if (change.new_asset_source_type === 'DRIVE') {
      // Upload image from Drive
      var imageResult = createImageAssetFromDrive(change.new_asset_source_id, change.new_asset_name);
      if (!imageResult.success) {
        return imageResult;
      }
      assetResourceName = imageResult.resourceName;

    } else {
      return { success: false, message: 'Unknown source type: ' + change.new_asset_source_type };
    }

    // Add to current assets
    var newAssets = currentAssets.slice();
    newAssets.push({ asset: assetResourceName });

    // Build and execute mutation
    var payload = buildUpdatePayload(change, newAssets);
    var result = AdsApp.mutate(payload);

    if (result.isSuccessful()) {
      // Update asset registry
      SheetsRepository.markAssetActive(assetResourceName);

      return { success: true, message: 'Added ' + change.new_asset_name };
    } else {
      return { success: false, message: extractErrorMessage(result) };
    }
  }

  // ============================================================================
  // ASSET CREATION
  // ============================================================================

  /**
   * Create a YouTube video asset
   * @param {string} youtubeVideoId - YouTube video ID
   * @param {string} assetName - Name for the asset
   * @returns {Object} {success, resourceName, message}
   */
  function createYouTubeAsset(youtubeVideoId, assetName) {
    var customerId = CONFIG.GOOGLE_ADS.CUSTOMER_ID;

    var payload = {
      assetOperation: {
        create: {
          resourceName: 'customers/' + customerId + '/assets/-1',
          name: assetName || ('Video_' + youtubeVideoId),
          type: 'YOUTUBE_VIDEO',
          youtubeVideoAsset: {
            youtubeVideoId: youtubeVideoId
          }
        }
      }
    };

    var result = AdsApp.mutate(payload);

    if (result.isSuccessful()) {
      return {
        success: true,
        resourceName: result.getResourceName(),
        message: 'Created YouTube asset'
      };
    } else {
      return {
        success: false,
        resourceName: null,
        message: extractErrorMessage(result)
      };
    }
  }

  /**
   * Create an image asset from Google Drive
   * @param {string} fileId - Drive file ID
   * @param {string} assetName - Name for the asset
   * @returns {Object} {success, resourceName, message}
   */
  function createImageAssetFromDrive(fileId, assetName) {
    var customerId = CONFIG.GOOGLE_ADS.CUSTOMER_ID;

    try {
      var file = DriveApp.getFileById(fileId);
      var blob = file.getBlob();
      var base64Data = Utilities.base64Encode(blob.getBytes());

      var payload = {
        assetOperation: {
          create: {
            resourceName: 'customers/' + customerId + '/assets/-1',
            name: assetName || file.getName(),
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
          resourceName: result.getResourceName(),
          message: 'Created image asset'
        };
      } else {
        return {
          success: false,
          resourceName: null,
          message: extractErrorMessage(result)
        };
      }

    } catch (e) {
      return {
        success: false,
        resourceName: null,
        message: 'Drive error: ' + e.message
      };
    }
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  /**
   * Build update payload for ad mutation
   * @param {Object} change - Change object
   * @param {Array} assets - New assets array
   * @returns {Object} Mutation payload
   */
  function buildUpdatePayload(change, assets) {
    var customerId = CONFIG.GOOGLE_ADS.CUSTOMER_ID;
    var adResourceName = 'customers/' + customerId + '/ads/' + change.ad_id;

    var appAd = {};
    var updateMask = '';

    switch (change.asset_type) {
      case 'YOUTUBE_VIDEO':
        appAd.youtubeVideos = assets;
        updateMask = 'app_ad.youtube_videos';
        break;
      case 'IMAGE':
        appAd.images = assets;
        updateMask = 'app_ad.images';
        break;
      case 'TEXT':
        // Determine if headline or description based on content
        // For now, default to headlines
        appAd.headlines = assets;
        updateMask = 'app_ad.headlines';
        break;
      default:
        throw new Error('Unsupported asset type: ' + change.asset_type);
    }

    return {
      adOperation: {
        update: {
          resourceName: adResourceName,
          appAd: appAd
        },
        updateMask: updateMask
      }
    };
  }

  /**
   * Get assets by type from ad info
   * @param {string} assetType - Asset type
   * @param {Object} adInfo - Ad info object
   * @returns {Array} Assets array
   */
  function getAssetsByType(assetType, adInfo) {
    switch (assetType) {
      case 'YOUTUBE_VIDEO':
        return adInfo.videos || [];
      case 'IMAGE':
        return adInfo.images || [];
      default:
        return [];
    }
  }

  /**
   * Get minimum limit for asset type
   * @param {string} assetType - Asset type
   * @returns {number} Minimum count
   */
  function getMinLimitForType(assetType) {
    switch (assetType) {
      case 'YOUTUBE_VIDEO':
        return CONFIG.LIMITS.MIN_VIDEOS;
      case 'IMAGE':
        return CONFIG.LIMITS.MIN_IMAGES;
      case 'TEXT':
        return CONFIG.LIMITS.MIN_HEADLINES;
      default:
        return 0;
    }
  }

  /**
   * Get maximum limit for asset type
   * @param {string} assetType - Asset type
   * @returns {number} Maximum count
   */
  function getMaxLimitForType(assetType) {
    switch (assetType) {
      case 'YOUTUBE_VIDEO':
        return CONFIG.LIMITS.MAX_VIDEOS;
      case 'IMAGE':
        return CONFIG.LIMITS.MAX_IMAGES;
      case 'TEXT':
        return CONFIG.LIMITS.MAX_HEADLINES;
      default:
        return 20;
    }
  }

  /**
   * Extract error message from mutation result
   * @param {Object} result - Mutation result
   * @returns {string} Error message
   */
  function extractErrorMessage(result) {
    try {
      var errors = result.getErrors();
      if (errors && errors.length > 0) {
        return errors.map(function(e) { return e.message || e; }).join('; ');
      }
      return 'Unknown error';
    } catch (e) {
      return 'Could not extract error: ' + e.message;
    }
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  return {
    processChanges: processChanges,
    getApprovedFromSheet: getApprovedFromSheet,
    executeApprovedFromSheet: executeApprovedFromSheet,
    executeChanges: executeChanges,
    executeSingleChange: executeSingleChange,
    createYouTubeAsset: createYouTubeAsset,
    createImageAssetFromDrive: createImageAssetFromDrive
  };

})();


// ============================================================================
// TEST FUNCTIONS
// ============================================================================

/**
 * Test: Execute approved changes from sheet
 */
function testExecuteApproved() {
  initConfig();

  Logger.log('Checking for approved changes...');
  Logger.log('');

  var results = ChangeRequestManager.executeApprovedFromSheet();

  Logger.log('');
  Logger.log('Results:');
  Logger.log('  Success: ' + results.success);
  Logger.log('  Failed: ' + results.failed);

  if (results.details.length > 0) {
    Logger.log('');
    Logger.log('Details:');
    for (var i = 0; i < results.details.length; i++) {
      var d = results.details[i];
      Logger.log('  ' + (d.success ? 'OK' : 'FAIL') + ': ' + d.action + ' ' + d.asset);
      if (d.message) {
        Logger.log('    ' + d.message);
      }
    }
  }
}

/**
 * Test: Full analysis and processing cycle
 */
function testFullAnalysisCycle() {
  initConfig();

  Logger.log('=== FULL ANALYSIS CYCLE ===');
  Logger.log('');

  // 1. Analyze all campaigns
  var changes = DecisionEngine.analyzeAllCampaigns();
  Logger.log('Analysis found ' + changes.length + ' changes');
  Logger.log('');

  // 2. Process changes (execute AUTO, queue PENDING)
  var results = ChangeRequestManager.processChanges(changes);

  Logger.log('');
  Logger.log('=== RESULTS ===');
  Logger.log('Auto-executed: ' + results.auto.success + ' success, ' + results.auto.failed + ' failed');
  Logger.log('Pending approval: ' + results.pending);
  Logger.log('');
  Logger.log('Check the ChangeRequests sheet for pending items.');
}
