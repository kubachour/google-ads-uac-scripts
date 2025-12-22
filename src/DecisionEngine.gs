/**
 * DecisionEngine Module
 * Analyzes asset performance and determines what changes to make
 *
 * PLATFORM: Google Ads Scripts
 * USED BY: ChangeRequestManager.gs, Main.gs
 * DEPENDS ON: Config.gs, SheetsRepository.gs
 */

var DecisionEngine = (function() {

  // ============================================================================
  // PERFORMANCE ANALYSIS
  // ============================================================================

  /**
   * Analyze all campaigns and generate change recommendations
   * @returns {Array} Array of change objects with approval type
   */
  function analyzeAllCampaigns() {
    var allChanges = [];
    var campaigns = CONFIG.GOOGLE_ADS.CAMPAIGNS;

    for (var i = 0; i < campaigns.length; i++) {
      var campaign = campaigns[i];
      Logger.log('Analyzing campaign: ' + campaign.name + ' (' + campaign.id + ')');

      try {
        var changes = analyzeCampaign(campaign);
        allChanges = allChanges.concat(changes);
        Logger.log('  Found ' + changes.length + ' changes');
      } catch (e) {
        Logger.log('  ERROR: ' + e.message);
      }
    }

    return allChanges;
  }

  /**
   * Analyze a single campaign and generate change recommendations
   * @param {Object} campaign - Campaign config object
   * @returns {Array} Array of change objects
   */
  function analyzeCampaign(campaign) {
    var changes = [];

    // Get current asset performance from Google Ads
    var assetPerformance = queryAssetPerformance(campaign);

    // Get current ad assets for the campaign
    var adInfo = getCurrentAdInfo(campaign);

    if (!adInfo) {
      Logger.log('  Could not get ad info for campaign');
      return [];
    }

    // Analyze each asset
    for (var i = 0; i < assetPerformance.length; i++) {
      var asset = assetPerformance[i];

      // Update asset registry with current performance
      SheetsRepository.upsertAsset(asset.resourceName, {
        asset_name: asset.name,
        asset_type: asset.type,
        status: 'ACTIVE',
        last_performance: asset.performanceLabel,
        total_impressions: asset.impressions
      });

      // Determine if action needed
      var decision = shouldTakeAction(asset);

      if (decision.action !== 'SKIP') {
        var change = buildChangeObject(asset, decision, campaign, adInfo);
        if (change) {
          changes.push(change);
        }
      }
    }

    return changes;
  }

  /**
   * Query asset performance from Google Ads
   * @param {Object} campaign - Campaign config
   * @returns {Array} Array of asset performance objects
   */
  function queryAssetPerformance(campaign) {
    var assets = [];

    try {
      var query =
        "SELECT " +
        "asset.id, " +
        "asset.name, " +
        "asset.type, " +
        "asset.resource_name, " +
        "asset.youtube_video_asset.youtube_video_id, " +
        "ad_group_ad_asset_view.performance_label, " +
        "ad_group_ad_asset_view.enabled, " +
        "metrics.impressions, " +
        "metrics.clicks, " +
        "metrics.conversions, " +
        "metrics.cost_micros " +
        "FROM ad_group_ad_asset_view " +
        "WHERE campaign.id = " + campaign.id + " " +
        "AND segments.date DURING LAST_" + CONFIG.ANALYSIS.PERFORMANCE_WINDOW_DAYS + "_DAYS";

      var result = AdsApp.search(query);

      while (result.hasNext()) {
        var row = result.next();
        var assetView = row.adGroupAdAssetView || {};

        assets.push({
          id: row.asset.id,
          name: row.asset.name || '',
          type: row.asset.type,
          resourceName: row.asset.resourceName,
          youtubeVideoId: row.asset.youtubeVideoAsset ? row.asset.youtubeVideoAsset.youtubeVideoId : null,
          performanceLabel: assetView.performanceLabel || 'UNKNOWN',
          enabled: assetView.enabled,
          impressions: row.metrics.impressions || 0,
          clicks: row.metrics.clicks || 0,
          conversions: row.metrics.conversions || 0,
          costMicros: row.metrics.costMicros || 0
        });
      }

    } catch (e) {
      Logger.log('Error querying asset performance: ' + e.message);
    }

    return assets;
  }

  /**
   * Get current ad info including all assets
   * @param {Object} campaign - Campaign config
   * @returns {Object} Ad info with current assets
   */
  function getCurrentAdInfo(campaign) {
    try {
      var query =
        "SELECT " +
        "ad_group_ad.ad.id, " +
        "ad_group_ad.ad.app_ad.headlines, " +
        "ad_group_ad.ad.app_ad.descriptions, " +
        "ad_group_ad.ad.app_ad.images, " +
        "ad_group_ad.ad.app_ad.youtube_videos " +
        "FROM ad_group_ad " +
        "WHERE campaign.id = " + campaign.id + " " +
        "AND ad_group.id = " + campaign.adGroupId;

      var result = AdsApp.search(query);

      if (result.hasNext()) {
        var row = result.next();
        var appAd = row.adGroupAd.ad.appAd || {};

        return {
          adId: row.adGroupAd.ad.id,
          headlines: appAd.headlines || [],
          descriptions: appAd.descriptions || [],
          images: appAd.images || [],
          videos: appAd.youtubeVideos || []
        };
      }

    } catch (e) {
      Logger.log('Error getting ad info: ' + e.message);
    }

    return null;
  }

  // ============================================================================
  // DECISION LOGIC
  // ============================================================================

  /**
   * Determine if action should be taken on an asset
   * @param {Object} asset - Asset with performance data
   * @returns {Object} {action: string, approval: string, reason: string}
   */
  function shouldTakeAction(asset) {
    var perf = asset.performanceLabel;
    var impressions = asset.impressions || 0;

    // Check if this is a protected label (never touch)
    if (CONFIG.DECISION.SKIP_LABELS.indexOf(perf) !== -1) {
      return {
        action: 'SKIP',
        approval: null,
        reason: perf + ' - skipping'
      };
    }

    // Check for LOW performers
    if (CONFIG.DECISION.AUTO_REMOVE_LABELS.indexOf(perf) !== -1) {
      // Check if meets minimum thresholds
      if (impressions >= CONFIG.DECISION.AUTO_REMOVE_MIN_IMPRESSIONS) {
        return {
          action: 'REMOVE',
          approval: 'AUTO',
          reason: 'LOW with ' + formatNumber(impressions) + ' impressions'
        };
      } else {
        return {
          action: 'SKIP',
          approval: null,
          reason: 'LOW but insufficient data (' + impressions + ' impr)'
        };
      }
    }

    // Check for GOOD performers - only if better replacement exists
    if (CONFIG.DECISION.MANUAL_APPROVAL_LABELS.indexOf(perf) !== -1) {
      var replacement = findBetterReplacement(asset);
      if (replacement) {
        return {
          action: 'REPLACE',
          approval: 'PENDING',
          reason: 'GOOD performer, but BEST replacement available',
          replacement: replacement
        };
      }
      return {
        action: 'SKIP',
        approval: null,
        reason: 'GOOD, no better replacement'
      };
    }

    // Default: skip unknown labels
    return {
      action: 'SKIP',
      approval: null,
      reason: 'Unknown label: ' + perf
    };
  }

  /**
   * Find a better replacement for an asset
   * Priority: 1. New from source, 2. PAUSED with BEST, 3. PAUSED with GOOD
   * @param {Object} asset - Asset to replace
   * @returns {Object|null} Replacement asset or null
   */
  function findBetterReplacement(asset) {
    // First, check for reusable assets in registry
    var reusable = SheetsRepository.getReusableAssets(asset.type);

    // Filter for BEST performers first
    var bestPerformers = reusable.filter(function(r) {
      return r.data.best_performance === 'BEST';
    });

    if (bestPerformers.length > 0) {
      return {
        type: 'REGISTRY',
        assetId: bestPerformers[0].data.asset_id,
        name: bestPerformers[0].data.asset_name,
        sourceType: bestPerformers[0].data.source_type,
        sourceId: bestPerformers[0].data.source_id,
        bestPerformance: 'BEST',
        sourceCampaign: bestPerformers[0].data.campaigns_used
      };
    }

    // If no BEST, return null (we only replace GOOD with BEST)
    return null;
  }

  /**
   * Find any available replacement (for LOW performers)
   * @param {Object} asset - Asset to replace
   * @returns {Object|null} Replacement asset or null
   */
  function findAnyReplacement(asset) {
    // Check for reusable assets (GOOD or BEST)
    var reusable = SheetsRepository.getReusableAssets(asset.type);

    if (reusable.length > 0) {
      var best = reusable[0];  // Already sorted by performance
      return {
        type: 'REGISTRY',
        assetId: best.data.asset_id,
        name: best.data.asset_name,
        sourceType: best.data.source_type,
        sourceId: best.data.source_id,
        bestPerformance: best.data.best_performance,
        sourceCampaign: best.data.campaigns_used
      };
    }

    // TODO: Check for new assets from YouTube/Drive sources
    // This will be implemented when we add source discovery

    return null;
  }

  // ============================================================================
  // CHANGE OBJECT BUILDING
  // ============================================================================

  /**
   * Build a change object for the change request
   * @param {Object} asset - Asset being changed
   * @param {Object} decision - Decision from shouldTakeAction
   * @param {Object} campaign - Campaign config
   * @param {Object} adInfo - Current ad info
   * @returns {Object} Change object for ChangeRequestManager
   */
  function buildChangeObject(asset, decision, campaign, adInfo) {
    var change = {
      campaign_id: campaign.id,
      campaign_name: campaign.name,
      ad_id: adInfo.adId,
      asset_type: asset.type,
      current_asset_id: asset.resourceName,
      current_asset_name: asset.name,
      current_performance: asset.performanceLabel,
      impressions: asset.impressions,
      clicks: asset.clicks,
      ctr: asset.impressions > 0 ? ((asset.clicks / asset.impressions) * 100).toFixed(2) + '%' : '0%',
      conversions: asset.conversions,
      cost: (asset.costMicros / 1000000).toFixed(2),
      action: decision.action,
      approval: decision.approval,
      reason: buildReason(asset, decision),
      current_assets_json: JSON.stringify(getCurrentAssetsByType(asset.type, adInfo))
    };

    // If REMOVE with auto-replacement enabled, find replacement
    if (decision.action === 'REMOVE' && CONFIG.DECISION.AUTO_ADD_REPLACEMENT) {
      var replacement = findAnyReplacement(asset);
      if (replacement) {
        change.action = 'REPLACE';
        change.new_asset_source_type = replacement.sourceType;
        change.new_asset_source_id = replacement.sourceId;
        change.new_asset_name = replacement.name;
        change.replacement_best_perf = replacement.bestPerformance;
        change.replacement_source_campaign = replacement.sourceCampaign;
      }
    }

    // If REPLACE decision already has replacement
    if (decision.action === 'REPLACE' && decision.replacement) {
      change.new_asset_source_type = decision.replacement.sourceType;
      change.new_asset_source_id = decision.replacement.sourceId;
      change.new_asset_name = decision.replacement.name;
      change.replacement_best_perf = decision.replacement.bestPerformance;
      change.replacement_source_campaign = decision.replacement.sourceCampaign;
    }

    return change;
  }

  /**
   * Get current assets of a specific type from ad info
   * @param {string} assetType - Asset type
   * @param {Object} adInfo - Ad info object
   * @returns {Array} Array of current assets
   */
  function getCurrentAssetsByType(assetType, adInfo) {
    switch (assetType) {
      case 'YOUTUBE_VIDEO':
        return adInfo.videos || [];
      case 'IMAGE':
        return adInfo.images || [];
      case 'TEXT':
        return adInfo.headlines.concat(adInfo.descriptions) || [];
      default:
        return [];
    }
  }

  /**
   * Build human-readable reason for the change
   * @param {Object} asset - Asset data
   * @param {Object} decision - Decision object
   * @returns {string} Reason text
   */
  function buildReason(asset, decision) {
    var r = '';

    // Current asset status
    r += asset.performanceLabel + ' ';
    r += '(' + formatNumber(asset.impressions) + ' impr';
    if (asset.clicks > 0) {
      var ctr = ((asset.clicks / asset.impressions) * 100).toFixed(2);
      r += ', CTR ' + ctr + '%';
    }
    r += '). ';

    // Action explanation
    if (decision.approval === 'AUTO') {
      r += 'Auto-' + decision.action.toLowerCase() + 'ing. ';
    } else if (decision.approval === 'PENDING') {
      r += 'Needs approval. ';
    }

    // Replacement info
    if (decision.replacement) {
      r += 'Replacement: "' + decision.replacement.name + '" ';
      r += '(achieved ' + decision.replacement.bestPerformance + ' in ' + decision.replacement.sourceCampaign + ').';
    }

    return r;
  }

  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================

  /**
   * Format number with commas
   * @param {number} num - Number to format
   * @returns {string} Formatted number
   */
  function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  return {
    analyzeAllCampaigns: analyzeAllCampaigns,
    analyzeCampaign: analyzeCampaign,
    shouldTakeAction: shouldTakeAction,
    findBetterReplacement: findBetterReplacement,
    findAnyReplacement: findAnyReplacement,
    queryAssetPerformance: queryAssetPerformance,
    getCurrentAdInfo: getCurrentAdInfo
  };

})();


// ============================================================================
// TEST FUNCTIONS
// ============================================================================

/**
 * Test: Analyze first campaign
 */
function testAnalyzeCampaign() {
  initConfig();

  if (CONFIG.GOOGLE_ADS.CAMPAIGNS.length === 0) {
    Logger.log('No campaigns configured');
    return;
  }

  var campaign = CONFIG.GOOGLE_ADS.CAMPAIGNS[0];
  Logger.log('Analyzing campaign: ' + campaign.name);
  Logger.log('');

  var changes = DecisionEngine.analyzeCampaign(campaign);

  Logger.log('Changes found: ' + changes.length);
  Logger.log('');

  for (var i = 0; i < changes.length; i++) {
    var c = changes[i];
    Logger.log((i + 1) + '. ' + c.action + ' ' + c.asset_type);
    Logger.log('   Asset: ' + c.current_asset_name);
    Logger.log('   Performance: ' + c.current_performance);
    Logger.log('   Approval: ' + c.approval);
    Logger.log('   Reason: ' + c.reason);
    Logger.log('');
  }
}

/**
 * Test: Query asset performance
 */
function testQueryAssetPerformance() {
  initConfig();

  if (CONFIG.GOOGLE_ADS.CAMPAIGNS.length === 0) {
    Logger.log('No campaigns configured');
    return;
  }

  var campaign = CONFIG.GOOGLE_ADS.CAMPAIGNS[0];
  Logger.log('Querying performance for: ' + campaign.name);
  Logger.log('');

  var assets = DecisionEngine.queryAssetPerformance(campaign);

  Logger.log('Assets found: ' + assets.length);
  Logger.log('');

  for (var i = 0; i < Math.min(assets.length, 10); i++) {
    var a = assets[i];
    Logger.log((i + 1) + '. ' + a.type + ': ' + (a.name || a.youtubeVideoId || 'unnamed'));
    Logger.log('   Performance: ' + a.performanceLabel);
    Logger.log('   Impressions: ' + a.impressions);
    Logger.log('');
  }
}

/**
 * Test: Decision logic on sample assets
 */
function testDecisionLogic() {
  initConfig();

  var testAssets = [
    { performanceLabel: 'BEST', impressions: 50000, name: 'Best Performer' },
    { performanceLabel: 'GOOD', impressions: 30000, name: 'Good Performer' },
    { performanceLabel: 'LOW', impressions: 15000, name: 'Low Performer - Enough Data' },
    { performanceLabel: 'LOW', impressions: 500, name: 'Low Performer - Not Enough Data' },
    { performanceLabel: 'LEARNING', impressions: 1000, name: 'Still Learning' },
    { performanceLabel: 'PENDING', impressions: 100, name: 'Just Added' }
  ];

  Logger.log('Testing decision logic:');
  Logger.log('');

  for (var i = 0; i < testAssets.length; i++) {
    var asset = testAssets[i];
    var decision = DecisionEngine.shouldTakeAction(asset);

    Logger.log(asset.name + ' (' + asset.performanceLabel + ', ' + asset.impressions + ' impr):');
    Logger.log('  Action: ' + decision.action);
    Logger.log('  Approval: ' + (decision.approval || 'N/A'));
    Logger.log('  Reason: ' + decision.reason);
    Logger.log('');
  }
}
