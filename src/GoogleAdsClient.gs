/**
 * GoogleAdsClient Module
 * Retrieves assets from Google Ads campaigns
 *
 * PLATFORM: Google Ads Scripts
 */

var GoogleAdsClient = (function() {

  /**
   * Get all video assets used in campaigns
   * @returns {Array} Array of video asset objects
   */
  function getVideoAssets() {
    var videoAssets = [];

    // Query video assets using GAQL
    var query =
      "SELECT " +
        "asset.id, " +
        "asset.name, " +
        "asset.type, " +
        "asset.youtube_video_asset.youtube_video_id, " +
        "asset.youtube_video_asset.youtube_video_title " +
      "FROM asset " +
      "WHERE asset.type = 'YOUTUBE_VIDEO'";

    try {
      var result = AdsApp.search(query);

      while (result.hasNext()) {
        var row = result.next();
        var asset = row.asset;

        videoAssets.push({
          assetId: asset.id,
          assetName: asset.name || '',
          assetType: asset.type,
          videoId: asset.youtubeVideoAsset.youtubeVideoId,
          videoTitle: asset.youtubeVideoAsset.youtubeVideoTitle || '',
          youtubeUrl: 'https://www.youtube.com/watch?v=' + asset.youtubeVideoAsset.youtubeVideoId
        });
      }

    } catch (error) {
      // Silently handle
    }

    return videoAssets;
  }


  /**
   * Get video assets with campaign information
   * @returns {Array} Array of video assets with campaign details
   */
  function getVideoAssetsWithCampaigns() {
    var videoAssets = [];

    var query =
      "SELECT " +
        "asset.id, " +
        "asset.name, " +
        "asset.youtube_video_asset.youtube_video_id, " +
        "asset.youtube_video_asset.youtube_video_title, " +
        "campaign.id, " +
        "campaign.name, " +
        "campaign.status, " +
        "campaign.advertising_channel_type " +
      "FROM campaign_asset " +
      "WHERE asset.type = 'YOUTUBE_VIDEO'";

    try {
      var result = AdsApp.search(query);

      while (result.hasNext()) {
        var row = result.next();

        videoAssets.push({
          assetId: row.asset.id,
          assetName: row.asset.name || '',
          videoId: row.asset.youtubeVideoAsset.youtubeVideoId,
          videoTitle: row.asset.youtubeVideoAsset.youtubeVideoTitle || '',
          campaignId: row.campaign.id,
          campaignName: row.campaign.name,
          campaignStatus: row.campaign.status,
          campaignType: row.campaign.advertisingChannelType,
          youtubeUrl: 'https://www.youtube.com/watch?v=' + row.asset.youtubeVideoAsset.youtubeVideoId
        });
      }

    } catch (error) {
      // Silently handle
    }

    return videoAssets;
  }


  /**
   * Get unique video IDs currently in use
   * @returns {Object} Map of videoId to asset info
   */
  function getVideoIdMap() {
    var assets = getVideoAssets();
    var videoIdMap = {};

    for (var i = 0; i < assets.length; i++) {
      var asset = assets[i];
      videoIdMap[asset.videoId] = asset;
    }

    return videoIdMap;
  }


  /**
   * Check which YouTube videos are already in Google Ads
   * @param {Array} youtubeVideoIds - Array of YouTube video IDs to check
   * @returns {Object} {inAds: [], notInAds: []}
   */
  function checkVideosInAds(youtubeVideoIds) {
    var videoIdMap = getVideoIdMap();

    var inAds = [];
    var notInAds = [];

    for (var i = 0; i < youtubeVideoIds.length; i++) {
      var videoId = youtubeVideoIds[i];
      if (videoIdMap[videoId]) {
        inAds.push({
          videoId: videoId,
          asset: videoIdMap[videoId]
        });
      } else {
        notInAds.push(videoId);
      }
    }

    return {
      inAds: inAds,
      notInAds: notInAds
    };
  }

  /**
   * Get video assets for a specific campaign
   * @param {string} campaignName - Campaign name to filter by
   * @returns {Array} Array of video assets for this campaign
   */
  function getVideoAssetsForCampaign(campaignName) {
    var videoAssets = [];

    // Query campaign_asset for specific campaign
    var query =
      "SELECT " +
        "asset.id, " +
        "asset.name, " +
        "asset.youtube_video_asset.youtube_video_id, " +
        "asset.youtube_video_asset.youtube_video_title, " +
        "campaign.id, " +
        "campaign.name, " +
        "campaign.status " +
      "FROM campaign_asset " +
      "WHERE asset.type = 'YOUTUBE_VIDEO' " +
      "AND campaign.name = '" + campaignName.replace(/'/g, "\\'") + "'";

    try {
      var result = AdsApp.search(query);

      while (result.hasNext()) {
        var row = result.next();

        videoAssets.push({
          assetId: row.asset.id,
          assetName: row.asset.name || '',
          videoId: row.asset.youtubeVideoAsset.youtubeVideoId,
          videoTitle: row.asset.youtubeVideoAsset.youtubeVideoTitle || '',
          campaignId: row.campaign.id,
          campaignName: row.campaign.name,
          campaignStatus: row.campaign.status
        });
      }

    } catch (error) {
      Logger.log('Error querying campaign assets: ' + error.message);
    }

    return videoAssets;
  }

  // Public API
  return {
    getVideoAssets: getVideoAssets,
    getVideoAssetsWithCampaigns: getVideoAssetsWithCampaigns,
    getVideoIdMap: getVideoIdMap,
    checkVideosInAds: checkVideosInAds,
    getVideoAssetsForCampaign: getVideoAssetsForCampaign
  };

})();


// ============================================================================
// SHEET OUTPUT FOR ADS ASSETS
// ============================================================================

/**
 * Write Google Ads video assets to spreadsheet
 * @param {Array} assets - Video assets array
 */
function writeAdsAssetsToSheet(assets) {
  var spreadsheet = getOutputSpreadsheet();

  if (!spreadsheet) {
    Logger.log('No output spreadsheet configured');
    return;
  }

  // Get or create sheet
  var sheet = spreadsheet.getSheetByName('Google Ads Assets');
  if (!sheet) {
    sheet = spreadsheet.insertSheet('Google Ads Assets');
  }

  sheet.clear();

  // Headers
  var headers = [
    'Asset ID',
    'Asset Name',
    'Video ID',
    'Video Title',
    'Campaign ID',
    'Campaign Name',
    'Campaign Status',
    'Campaign Type',
    'YouTube URL',
    'Synced At'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

  // Data rows
  var rows = [];
  var syncedAt = new Date().toISOString();

  for (var i = 0; i < assets.length; i++) {
    var a = assets[i];
    rows.push([
      a.assetId || '',
      a.assetName || '',
      a.videoId || '',
      a.videoTitle || '',
      a.campaignId || '',
      a.campaignName || '',
      a.campaignStatus || '',
      a.campaignType || '',
      a.youtubeUrl || '',
      syncedAt
    ]);
  }

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  Logger.log('Wrote ' + rows.length + ' assets to sheet');

  for (var c = 1; c <= headers.length; c++) {
    sheet.autoResizeColumn(c);
  }
}


// ============================================================================
// TEST FUNCTIONS
// ============================================================================

/**
 * Test: List all video assets in Google Ads
 */
function testGetVideoAssets() {
  var assets = GoogleAdsClient.getVideoAssets();

  Logger.log('');
  Logger.log('=== Video Assets in Google Ads ===');
  Logger.log('Total: ' + assets.length);
  Logger.log('');

  var showCount = Math.min(assets.length, 10);
  for (var i = 0; i < showCount; i++) {
    var a = assets[i];
    Logger.log((i + 1) + '. ' + (a.videoTitle || a.videoId));
    Logger.log('   Video ID: ' + a.videoId);
    Logger.log('   Asset ID: ' + a.assetId);
    Logger.log('');
  }

  if (assets.length > 10) {
    Logger.log('... and ' + (assets.length - 10) + ' more');
  }
}


/**
 * Test: List video assets with campaign info
 */
function testGetVideoAssetsWithCampaigns() {
  var assets = GoogleAdsClient.getVideoAssetsWithCampaigns();

  Logger.log('');
  Logger.log('=== Video Assets by Campaign ===');
  Logger.log('Total links: ' + assets.length);
  Logger.log('');

  var showCount = Math.min(assets.length, 10);
  for (var i = 0; i < showCount; i++) {
    var a = assets[i];
    Logger.log((i + 1) + '. ' + (a.videoTitle || a.videoId));
    Logger.log('   Campaign: ' + a.campaignName + ' (' + a.campaignStatus + ')');
    Logger.log('   Type: ' + a.campaignType);
    Logger.log('');
  }
}


/**
 * Test: Sync video assets to spreadsheet
 */
function testSyncAdsAssetsToSheet() {
  var assets = GoogleAdsClient.getVideoAssetsWithCampaigns();
  writeAdsAssetsToSheet(assets);
  Logger.log('Done! Check "Google Ads Assets" sheet.');
}


/**
 * Test: Log video assets for a specific campaign
 * Logs Asset ID, YouTube ID, and Asset Name
 */
function testLogCampaignVideos() {
  var campaignName = 'PERFORMANCE|EU|DE|GERMAN|GOOGLE-APP-INSTALL|INSTALLS|IOS|ALWAYS-ON';

  Logger.log('');
  Logger.log('=== Video Assets for Campaign ===');
  Logger.log('Campaign: ' + campaignName);
  Logger.log('');

  var assets = GoogleAdsClient.getVideoAssetsForCampaign(campaignName);

  if (assets.length === 0) {
    Logger.log('No video assets found for this campaign.');
    Logger.log('');
    Logger.log('Possible reasons:');
    Logger.log('  - Campaign name might be slightly different');
    Logger.log('  - Videos might be at ad group level instead of campaign level');
    Logger.log('');
    Logger.log('Trying to find similar campaigns...');

    // Search for campaigns with similar name
    try {
      var query = "SELECT campaign.name FROM campaign WHERE campaign.name LIKE '%PERFORMANCE%' AND campaign.name LIKE '%DE%'";
      var result = AdsApp.search(query);
      var similar = [];
      while (result.hasNext()) {
        similar.push(result.next().campaign.name);
      }
      if (similar.length > 0) {
        Logger.log('Found ' + similar.length + ' similar campaigns:');
        for (var i = 0; i < Math.min(similar.length, 5); i++) {
          Logger.log('  - ' + similar[i]);
        }
      }
    } catch (e) {
      Logger.log('Error searching campaigns: ' + e.message);
    }

    return;
  }

  Logger.log('Found ' + assets.length + ' video assets:');
  Logger.log('');
  Logger.log('Asset ID | YouTube ID | Asset Name');
  Logger.log('---------|------------|------------');

  for (var i = 0; i < assets.length; i++) {
    var a = assets[i];
    Logger.log(a.assetId + ' | ' + a.videoId + ' | ' + (a.assetName || a.videoTitle || '(no name)'));
  }

  Logger.log('');
  Logger.log('Total: ' + assets.length + ' videos');
}


// ============================================================================
// APP CAMPAIGN LOGGING - Multiple Methods
// ============================================================================

/**
 * Main entry point: Log all active app campaigns and detailed info for target campaign
 * Run this function to get full campaign analysis
 */
function testLogAppCampaigns() {
  var targetCampaign = 'PERFORMANCE|EU|DE|GERMAN|GOOGLE-APP-INSTALL|INSTALLS|IOS|ALWAYS-ON';

  Logger.log('');
  Logger.log('################################################################################');
  Logger.log('# APP CAMPAIGN ANALYSIS');
  Logger.log('# Target: ' + targetCampaign);
  Logger.log('################################################################################');
  Logger.log('');

  // 1. Log all active app campaigns count
  logActiveAppCampaignsCount();

  // 2. Log target campaign details using multiple methods
  logCampaignDetails_Method1_BasicInfo(targetCampaign);
  logCampaignDetails_Method2_Budget(targetCampaign);
  logCampaignDetails_Method3_AdGroups(targetCampaign);
  logCampaignDetails_Method4_CampaignAssets(targetCampaign);
  logCampaignDetails_Method5_AdGroupAssets(targetCampaign);
  logCampaignDetails_Method6_AppAds(targetCampaign);
  logCampaignDetails_Method7_AssetCounts(targetCampaign);
  logCampaignDetails_Method8_Targeting(targetCampaign);
  logCampaignDetails_Method9_CampaignCriteria(targetCampaign);

  Logger.log('');
  Logger.log('################################################################################');
  Logger.log('# ANALYSIS COMPLETE');
  Logger.log('################################################################################');
}


/**
 * Log count of all active mobile app campaigns
 */
function logActiveAppCampaignsCount() {
  Logger.log('');
  Logger.log('================================================================================');
  Logger.log('METHOD: Active App Campaigns Count');
  Logger.log('QUERY: campaign table with MULTI_CHANNEL + APP_CAMPAIGN filter');
  Logger.log('================================================================================');

  try {
    var query =
      "SELECT campaign.name, campaign.status, campaign.id, " +
      "metrics.clicks, metrics.impressions, metrics.cost_micros " +
      "FROM campaign " +
      "WHERE campaign.advertising_channel_type = 'MULTI_CHANNEL' " +
      "AND campaign.advertising_channel_sub_type = 'APP_CAMPAIGN'";

    var result = AdsApp.search(query);
    var total = 0;
    var enabled = 0;
    var paused = 0;
    var removed = 0;
    var campaigns = [];

    while (result.hasNext()) {
      var row = result.next();
      total++;

      var status = row.campaign.status;
      if (status === 'ENABLED') enabled++;
      else if (status === 'PAUSED') paused++;
      else if (status === 'REMOVED') removed++;

      campaigns.push({
        name: row.campaign.name,
        id: row.campaign.id,
        status: status,
        clicks: row.metrics.clicks || 0,
        impressions: row.metrics.impressions || 0,
        costMicros: row.metrics.costMicros || 0
      });
    }

    Logger.log('');
    Logger.log('RESULT: SUCCESS');
    Logger.log('');
    Logger.log('Total App Campaigns: ' + total);
    Logger.log('  - ENABLED (active): ' + enabled);
    Logger.log('  - PAUSED: ' + paused);
    Logger.log('  - REMOVED: ' + removed);
    Logger.log('');

    // List all enabled campaigns
    if (enabled > 0) {
      Logger.log('Active Campaign Names:');
      for (var i = 0; i < campaigns.length; i++) {
        if (campaigns[i].status === 'ENABLED') {
          var c = campaigns[i];
          var costFormatted = (c.costMicros / 1000000).toFixed(2);
          Logger.log('  [' + c.id + '] ' + c.name);
          Logger.log('      Impressions: ' + c.impressions + ' | Clicks: ' + c.clicks + ' | Cost: $' + costFormatted);
        }
      }
    }

  } catch (error) {
    Logger.log('RESULT: ERROR');
    Logger.log('Error: ' + error.message);
  }
}


/**
 * Method 1: Basic campaign info from campaign table
 */
function logCampaignDetails_Method1_BasicInfo(campaignName) {
  Logger.log('');
  Logger.log('================================================================================');
  Logger.log('METHOD 1: Basic Campaign Info');
  Logger.log('QUERY: campaign table - core fields');
  Logger.log('================================================================================');

  try {
    var query =
      "SELECT " +
      "campaign.id, " +
      "campaign.name, " +
      "campaign.status, " +
      "campaign.advertising_channel_type, " +
      "campaign.advertising_channel_sub_type, " +
      "campaign.start_date, " +
      "campaign.end_date, " +
      "campaign.serving_status, " +
      "campaign.bidding_strategy_type, " +
      "campaign.optimization_score, " +
      "campaign.app_campaign_setting.app_id, " +
      "campaign.app_campaign_setting.app_store, " +
      "campaign.app_campaign_setting.bidding_strategy_goal_type, " +
      "metrics.clicks, " +
      "metrics.impressions, " +
      "metrics.conversions, " +
      "metrics.cost_micros " +
      "FROM campaign " +
      "WHERE campaign.name = '" + campaignName.replace(/'/g, "\\'") + "'";

    var result = AdsApp.search(query);

    if (!result.hasNext()) {
      Logger.log('RESULT: Campaign not found');
      return;
    }

    var row = result.next();
    var c = row.campaign;
    var m = row.metrics;

    Logger.log('');
    Logger.log('RESULT: SUCCESS');
    Logger.log('');
    Logger.log('Campaign ID: ' + c.id);
    Logger.log('Campaign Name: ' + c.name);
    Logger.log('Status: ' + c.status);
    Logger.log('Serving Status: ' + c.servingStatus);
    Logger.log('Channel Type: ' + c.advertisingChannelType);
    Logger.log('Channel Sub-Type: ' + c.advertisingChannelSubType);
    Logger.log('Start Date: ' + c.startDate);
    Logger.log('End Date: ' + (c.endDate || 'None'));
    Logger.log('Bidding Strategy: ' + c.biddingStrategyType);
    Logger.log('Optimization Score: ' + (c.optimizationScore || 'N/A'));
    Logger.log('');
    Logger.log('App Settings:');
    Logger.log('  App ID: ' + (c.appCampaignSetting.appId || 'N/A'));
    Logger.log('  App Store: ' + (c.appCampaignSetting.appStore || 'N/A'));
    Logger.log('  Bidding Goal: ' + (c.appCampaignSetting.biddingStrategyGoalType || 'N/A'));
    Logger.log('');
    Logger.log('Metrics (last 30 days):');
    Logger.log('  Impressions: ' + (m.impressions || 0));
    Logger.log('  Clicks: ' + (m.clicks || 0));
    Logger.log('  Conversions: ' + (m.conversions || 0));
    Logger.log('  Cost: $' + ((m.costMicros || 0) / 1000000).toFixed(2));

  } catch (error) {
    Logger.log('RESULT: ERROR');
    Logger.log('Error: ' + error.message);
  }
}


/**
 * Method 2: Campaign budget info
 */
function logCampaignDetails_Method2_Budget(campaignName) {
  Logger.log('');
  Logger.log('================================================================================');
  Logger.log('METHOD 2: Campaign Budget');
  Logger.log('QUERY: campaign_budget table');
  Logger.log('================================================================================');

  try {
    var query =
      "SELECT " +
      "campaign.id, " +
      "campaign.name, " +
      "campaign_budget.id, " +
      "campaign_budget.name, " +
      "campaign_budget.amount_micros, " +
      "campaign_budget.total_amount_micros, " +
      "campaign_budget.status, " +
      "campaign_budget.delivery_method, " +
      "campaign_budget.period, " +
      "campaign_budget.type, " +
      "campaign_budget.explicitly_shared " +
      "FROM campaign " +
      "WHERE campaign.name = '" + campaignName.replace(/'/g, "\\'") + "'";

    var result = AdsApp.search(query);

    if (!result.hasNext()) {
      Logger.log('RESULT: Campaign not found');
      return;
    }

    var row = result.next();
    var b = row.campaignBudget;

    Logger.log('');
    Logger.log('RESULT: SUCCESS');
    Logger.log('');
    Logger.log('Budget ID: ' + b.id);
    Logger.log('Budget Name: ' + (b.name || 'N/A'));
    Logger.log('Daily Amount: $' + ((b.amountMicros || 0) / 1000000).toFixed(2));
    Logger.log('Total Amount: $' + ((b.totalAmountMicros || 0) / 1000000).toFixed(2));
    Logger.log('Status: ' + b.status);
    Logger.log('Delivery Method: ' + b.deliveryMethod);
    Logger.log('Period: ' + b.period);
    Logger.log('Type: ' + b.type);
    Logger.log('Explicitly Shared: ' + b.explicitlyShared);

  } catch (error) {
    Logger.log('RESULT: ERROR');
    Logger.log('Error: ' + error.message);
  }
}


/**
 * Method 3: Ad Groups in the campaign
 */
function logCampaignDetails_Method3_AdGroups(campaignName) {
  Logger.log('');
  Logger.log('================================================================================');
  Logger.log('METHOD 3: Ad Groups');
  Logger.log('QUERY: ad_group table');
  Logger.log('================================================================================');

  try {
    var query =
      "SELECT " +
      "ad_group.id, " +
      "ad_group.name, " +
      "ad_group.status, " +
      "ad_group.type, " +
      "ad_group.cpc_bid_micros, " +
      "ad_group.cpm_bid_micros, " +
      "ad_group.target_cpa_micros, " +
      "metrics.impressions, " +
      "metrics.clicks " +
      "FROM ad_group " +
      "WHERE campaign.name = '" + campaignName.replace(/'/g, "\\'") + "'";

    var result = AdsApp.search(query);
    var adGroups = [];

    while (result.hasNext()) {
      var row = result.next();
      adGroups.push({
        id: row.adGroup.id,
        name: row.adGroup.name,
        status: row.adGroup.status,
        type: row.adGroup.type,
        cpcBid: row.adGroup.cpcBidMicros,
        cpmBid: row.adGroup.cpmBidMicros,
        targetCpa: row.adGroup.targetCpaMicros,
        impressions: row.metrics.impressions || 0,
        clicks: row.metrics.clicks || 0
      });
    }

    Logger.log('');
    Logger.log('RESULT: SUCCESS');
    Logger.log('');
    Logger.log('Total Ad Groups: ' + adGroups.length);
    Logger.log('');

    for (var i = 0; i < adGroups.length; i++) {
      var ag = adGroups[i];
      Logger.log('Ad Group ' + (i + 1) + ':');
      Logger.log('  ID: ' + ag.id);
      Logger.log('  Name: ' + ag.name);
      Logger.log('  Status: ' + ag.status);
      Logger.log('  Type: ' + ag.type);
      if (ag.cpcBid) Logger.log('  CPC Bid: $' + (ag.cpcBid / 1000000).toFixed(2));
      if (ag.targetCpa) Logger.log('  Target CPA: $' + (ag.targetCpa / 1000000).toFixed(2));
      Logger.log('  Impressions: ' + ag.impressions + ' | Clicks: ' + ag.clicks);
      Logger.log('');
    }

  } catch (error) {
    Logger.log('RESULT: ERROR');
    Logger.log('Error: ' + error.message);
  }
}


/**
 * Method 4: Campaign-level assets
 */
function logCampaignDetails_Method4_CampaignAssets(campaignName) {
  Logger.log('');
  Logger.log('================================================================================');
  Logger.log('METHOD 4: Campaign-Level Assets');
  Logger.log('QUERY: campaign_asset table');
  Logger.log('================================================================================');

  try {
    var query =
      "SELECT " +
      "asset.id, " +
      "asset.name, " +
      "asset.type, " +
      "asset.youtube_video_asset.youtube_video_id, " +
      "asset.youtube_video_asset.youtube_video_title, " +
      "asset.image_asset.file_size, " +
      "asset.image_asset.full_size.width_pixels, " +
      "asset.image_asset.full_size.height_pixels, " +
      "asset.text_asset.text, " +
      "campaign_asset.field_type, " +
      "campaign_asset.status " +
      "FROM campaign_asset " +
      "WHERE campaign.name = '" + campaignName.replace(/'/g, "\\'") + "'";

    var result = AdsApp.search(query);
    var assets = [];
    var assetsByType = {};

    while (result.hasNext()) {
      var row = result.next();
      var asset = {
        id: row.asset.id,
        name: row.asset.name || '',
        type: row.asset.type,
        fieldType: row.campaignAsset.fieldType,
        status: row.campaignAsset.status
      };

      // Add type-specific info
      if (row.asset.type === 'YOUTUBE_VIDEO') {
        asset.videoId = row.asset.youtubeVideoAsset.youtubeVideoId;
        asset.videoTitle = row.asset.youtubeVideoAsset.youtubeVideoTitle;
      } else if (row.asset.type === 'IMAGE') {
        asset.width = row.asset.imageAsset.fullSize ? row.asset.imageAsset.fullSize.widthPixels : null;
        asset.height = row.asset.imageAsset.fullSize ? row.asset.imageAsset.fullSize.heightPixels : null;
      } else if (row.asset.type === 'TEXT') {
        asset.text = row.asset.textAsset ? row.asset.textAsset.text : null;
      }

      assets.push(asset);

      // Count by type
      if (!assetsByType[row.asset.type]) {
        assetsByType[row.asset.type] = [];
      }
      assetsByType[row.asset.type].push(asset);
    }

    Logger.log('');
    Logger.log('RESULT: SUCCESS');
    Logger.log('');
    Logger.log('Total Campaign Assets: ' + assets.length);
    Logger.log('');
    Logger.log('Assets by Type:');
    for (var type in assetsByType) {
      Logger.log('  ' + type + ': ' + assetsByType[type].length);
    }
    Logger.log('');

    // Log details for each type
    for (var assetType in assetsByType) {
      Logger.log('--- ' + assetType + ' Assets ---');
      var typeAssets = assetsByType[assetType];
      for (var i = 0; i < typeAssets.length; i++) {
        var a = typeAssets[i];
        Logger.log('  [' + a.id + '] ' + (a.name || a.videoTitle || a.text || 'unnamed'));
        if (a.videoId) Logger.log('    YouTube: ' + a.videoId);
        if (a.width && a.height) Logger.log('    Size: ' + a.width + 'x' + a.height);
        if (a.text) Logger.log('    Text: ' + a.text.substring(0, 50) + (a.text.length > 50 ? '...' : ''));
        Logger.log('    Field: ' + a.fieldType + ' | Status: ' + a.status);
      }
      Logger.log('');
    }

  } catch (error) {
    Logger.log('RESULT: ERROR');
    Logger.log('Error: ' + error.message);
  }
}


/**
 * Method 5: Ad Group-level assets
 */
function logCampaignDetails_Method5_AdGroupAssets(campaignName) {
  Logger.log('');
  Logger.log('================================================================================');
  Logger.log('METHOD 5: Ad Group-Level Assets');
  Logger.log('QUERY: ad_group_asset table');
  Logger.log('================================================================================');

  try {
    var query =
      "SELECT " +
      "ad_group.id, " +
      "ad_group.name, " +
      "asset.id, " +
      "asset.name, " +
      "asset.type, " +
      "asset.youtube_video_asset.youtube_video_id, " +
      "asset.youtube_video_asset.youtube_video_title, " +
      "ad_group_asset.field_type, " +
      "ad_group_asset.status " +
      "FROM ad_group_asset " +
      "WHERE campaign.name = '" + campaignName.replace(/'/g, "\\'") + "'";

    var result = AdsApp.search(query);
    var assets = [];
    var assetsByAdGroup = {};

    while (result.hasNext()) {
      var row = result.next();
      var asset = {
        adGroupId: row.adGroup.id,
        adGroupName: row.adGroup.name,
        assetId: row.asset.id,
        assetName: row.asset.name || '',
        assetType: row.asset.type,
        fieldType: row.adGroupAsset.fieldType,
        status: row.adGroupAsset.status
      };

      if (row.asset.type === 'YOUTUBE_VIDEO') {
        asset.videoId = row.asset.youtubeVideoAsset.youtubeVideoId;
        asset.videoTitle = row.asset.youtubeVideoAsset.youtubeVideoTitle;
      }

      assets.push(asset);

      // Group by ad group
      if (!assetsByAdGroup[row.adGroup.name]) {
        assetsByAdGroup[row.adGroup.name] = [];
      }
      assetsByAdGroup[row.adGroup.name].push(asset);
    }

    Logger.log('');
    Logger.log('RESULT: SUCCESS');
    Logger.log('');
    Logger.log('Total Ad Group Assets: ' + assets.length);
    Logger.log('');

    for (var adGroupName in assetsByAdGroup) {
      var adGroupAssets = assetsByAdGroup[adGroupName];
      Logger.log('Ad Group: ' + adGroupName);
      Logger.log('  Asset Count: ' + adGroupAssets.length);

      // Count by type
      var typeCount = {};
      for (var i = 0; i < adGroupAssets.length; i++) {
        var type = adGroupAssets[i].assetType;
        typeCount[type] = (typeCount[type] || 0) + 1;
      }
      for (var t in typeCount) {
        Logger.log('    ' + t + ': ' + typeCount[t]);
      }
      Logger.log('');
    }

  } catch (error) {
    Logger.log('RESULT: ERROR');
    Logger.log('Error: ' + error.message);
  }
}


/**
 * Method 6: App Ads with video assets embedded
 */
function logCampaignDetails_Method6_AppAds(campaignName) {
  Logger.log('');
  Logger.log('================================================================================');
  Logger.log('METHOD 6: App Ads (ad_group_ad with app_ad)');
  Logger.log('QUERY: ad_group_ad table - app_ad fields');
  Logger.log('================================================================================');

  try {
    var query =
      "SELECT " +
      "ad_group.id, " +
      "ad_group.name, " +
      "ad_group_ad.ad.id, " +
      "ad_group_ad.ad.type, " +
      "ad_group_ad.ad.name, " +
      "ad_group_ad.ad.app_ad.headlines, " +
      "ad_group_ad.ad.app_ad.descriptions, " +
      "ad_group_ad.ad.app_ad.images, " +
      "ad_group_ad.ad.app_ad.youtube_videos, " +
      "ad_group_ad.ad.app_ad.html5_media_bundles, " +
      "ad_group_ad.status " +
      "FROM ad_group_ad " +
      "WHERE campaign.name = '" + campaignName.replace(/'/g, "\\'") + "'";

    var result = AdsApp.search(query);
    var ads = [];

    while (result.hasNext()) {
      var row = result.next();
      var appAd = row.adGroupAd.ad.appAd || {};

      ads.push({
        adGroupName: row.adGroup.name,
        adId: row.adGroupAd.ad.id,
        adType: row.adGroupAd.ad.type,
        adName: row.adGroupAd.ad.name,
        status: row.adGroupAd.status,
        headlines: appAd.headlines || [],
        descriptions: appAd.descriptions || [],
        images: appAd.images || [],
        videos: appAd.youtubeVideos || [],
        html5: appAd.html5MediaBundles || []
      });
    }

    Logger.log('');
    Logger.log('RESULT: SUCCESS');
    Logger.log('');
    Logger.log('Total Ads Found: ' + ads.length);
    Logger.log('');

    for (var i = 0; i < ads.length; i++) {
      var ad = ads[i];
      Logger.log('Ad ' + (i + 1) + ':');
      Logger.log('  Ad Group: ' + ad.adGroupName);
      Logger.log('  Ad ID: ' + ad.adId);
      Logger.log('  Type: ' + ad.adType);
      Logger.log('  Status: ' + ad.status);
      Logger.log('  Headlines: ' + ad.headlines.length);
      Logger.log('  Descriptions: ' + ad.descriptions.length);
      Logger.log('  Images: ' + ad.images.length);
      Logger.log('  Videos: ' + ad.videos.length);
      Logger.log('  HTML5 Bundles: ' + ad.html5.length);

      // Show video asset references
      if (ad.videos.length > 0) {
        Logger.log('  Video Asset References:');
        for (var v = 0; v < ad.videos.length; v++) {
          Logger.log('    - ' + ad.videos[v].asset);
        }
      }
      Logger.log('');
    }

  } catch (error) {
    Logger.log('RESULT: ERROR');
    Logger.log('Error: ' + error.message);
  }
}


/**
 * Method 7: Asset counts using separate queries per asset type
 */
function logCampaignDetails_Method7_AssetCounts(campaignName) {
  Logger.log('');
  Logger.log('================================================================================');
  Logger.log('METHOD 7: Asset Counts by Type (Multiple Queries)');
  Logger.log('QUERY: campaign_asset filtered by asset.type');
  Logger.log('================================================================================');

  var assetTypes = [
    'YOUTUBE_VIDEO',
    'IMAGE',
    'TEXT',
    'MEDIA_BUNDLE',
    'LEAD_FORM',
    'CALL',
    'CALLOUT',
    'SITELINK',
    'STRUCTURED_SNIPPET'
  ];

  Logger.log('');
  Logger.log('RESULT: Checking each asset type...');
  Logger.log('');

  var totalAssets = 0;

  for (var i = 0; i < assetTypes.length; i++) {
    var assetType = assetTypes[i];
    try {
      var query =
        "SELECT asset.id " +
        "FROM campaign_asset " +
        "WHERE campaign.name = '" + campaignName.replace(/'/g, "\\'") + "' " +
        "AND asset.type = '" + assetType + "'";

      var result = AdsApp.search(query);
      var count = 0;
      while (result.hasNext()) {
        result.next();
        count++;
      }

      if (count > 0) {
        Logger.log('  ' + assetType + ': ' + count);
        totalAssets += count;
      }

    } catch (error) {
      Logger.log('  ' + assetType + ': ERROR - ' + error.message);
    }
  }

  Logger.log('');
  Logger.log('Total assets found: ' + totalAssets);
}


/**
 * Method 8: Targeting settings (geo, language, device)
 */
function logCampaignDetails_Method8_Targeting(campaignName) {
  Logger.log('');
  Logger.log('================================================================================');
  Logger.log('METHOD 8: Targeting Settings');
  Logger.log('QUERY: Multiple targeting tables');
  Logger.log('================================================================================');

  Logger.log('');

  // 8a: Geographic targeting
  Logger.log('--- Geographic Targeting ---');
  try {
    var geoQuery =
      "SELECT " +
      "campaign_criterion.location.geo_target_constant, " +
      "campaign_criterion.negative " +
      "FROM campaign_criterion " +
      "WHERE campaign.name = '" + campaignName.replace(/'/g, "\\'") + "' " +
      "AND campaign_criterion.type = 'LOCATION'";

    var geoResult = AdsApp.search(geoQuery);
    var locations = [];
    while (geoResult.hasNext()) {
      var row = geoResult.next();
      locations.push({
        location: row.campaignCriterion.location.geoTargetConstant,
        negative: row.campaignCriterion.negative
      });
    }

    Logger.log('Location targets: ' + locations.length);
    for (var i = 0; i < locations.length; i++) {
      var prefix = locations[i].negative ? '  EXCLUDE: ' : '  INCLUDE: ';
      Logger.log(prefix + locations[i].location);
    }
  } catch (error) {
    Logger.log('ERROR: ' + error.message);
  }

  Logger.log('');

  // 8b: Language targeting
  Logger.log('--- Language Targeting ---');
  try {
    var langQuery =
      "SELECT " +
      "campaign_criterion.language.language_constant " +
      "FROM campaign_criterion " +
      "WHERE campaign.name = '" + campaignName.replace(/'/g, "\\'") + "' " +
      "AND campaign_criterion.type = 'LANGUAGE'";

    var langResult = AdsApp.search(langQuery);
    var languages = [];
    while (langResult.hasNext()) {
      var row = langResult.next();
      languages.push(row.campaignCriterion.language.languageConstant);
    }

    Logger.log('Language targets: ' + languages.length);
    for (var j = 0; j < languages.length; j++) {
      Logger.log('  ' + languages[j]);
    }
  } catch (error) {
    Logger.log('ERROR: ' + error.message);
  }

  Logger.log('');

  // 8c: Device targeting
  Logger.log('--- Device Targeting ---');
  try {
    var deviceQuery =
      "SELECT " +
      "campaign_criterion.device.type " +
      "FROM campaign_criterion " +
      "WHERE campaign.name = '" + campaignName.replace(/'/g, "\\'") + "' " +
      "AND campaign_criterion.type = 'DEVICE'";

    var deviceResult = AdsApp.search(deviceQuery);
    var devices = [];
    while (deviceResult.hasNext()) {
      var row = deviceResult.next();
      devices.push(row.campaignCriterion.device.type);
    }

    Logger.log('Device targets: ' + devices.length);
    for (var k = 0; k < devices.length; k++) {
      Logger.log('  ' + devices[k]);
    }
  } catch (error) {
    Logger.log('ERROR: ' + error.message);
  }
}


/**
 * Method 9: All campaign criteria (comprehensive)
 */
function logCampaignDetails_Method9_CampaignCriteria(campaignName) {
  Logger.log('');
  Logger.log('================================================================================');
  Logger.log('METHOD 9: All Campaign Criteria');
  Logger.log('QUERY: campaign_criterion table - all types');
  Logger.log('================================================================================');

  try {
    var query =
      "SELECT " +
      "campaign_criterion.criterion_id, " +
      "campaign_criterion.type, " +
      "campaign_criterion.status, " +
      "campaign_criterion.negative, " +
      "campaign_criterion.bid_modifier " +
      "FROM campaign_criterion " +
      "WHERE campaign.name = '" + campaignName.replace(/'/g, "\\'") + "'";

    var result = AdsApp.search(query);
    var criteria = [];
    var criteriaByType = {};

    while (result.hasNext()) {
      var row = result.next();
      var criterion = {
        id: row.campaignCriterion.criterionId,
        type: row.campaignCriterion.type,
        status: row.campaignCriterion.status,
        negative: row.campaignCriterion.negative,
        bidModifier: row.campaignCriterion.bidModifier
      };

      criteria.push(criterion);

      if (!criteriaByType[criterion.type]) {
        criteriaByType[criterion.type] = [];
      }
      criteriaByType[criterion.type].push(criterion);
    }

    Logger.log('');
    Logger.log('RESULT: SUCCESS');
    Logger.log('');
    Logger.log('Total Criteria: ' + criteria.length);
    Logger.log('');
    Logger.log('Criteria by Type:');
    for (var type in criteriaByType) {
      Logger.log('  ' + type + ': ' + criteriaByType[type].length);
    }

  } catch (error) {
    Logger.log('RESULT: ERROR');
    Logger.log('Error: ' + error.message);
  }
}


