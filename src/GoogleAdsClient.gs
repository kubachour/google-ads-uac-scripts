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
    Logger.log('Fetching video assets from Google Ads...');

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

      Logger.log('Found ' + videoAssets.length + ' video assets');

    } catch (error) {
      Logger.log('Error fetching video assets: ' + error.message);
    }

    return videoAssets;
  }


  /**
   * Get video assets with campaign information
   * @returns {Array} Array of video assets with campaign details
   */
  function getVideoAssetsWithCampaigns() {
    Logger.log('Fetching video assets with campaign info...');

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

      Logger.log('Found ' + videoAssets.length + ' video asset-campaign links');

    } catch (error) {
      Logger.log('Error fetching video assets with campaigns: ' + error.message);
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

  // Public API
  return {
    getVideoAssets: getVideoAssets,
    getVideoAssetsWithCampaigns: getVideoAssetsWithCampaigns,
    getVideoIdMap: getVideoIdMap,
    checkVideosInAds: checkVideosInAds
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
 * Test: Compare YouTube videos with Google Ads
 */
function testCompareYouTubeWithAds() {
  initConfig();

  // Get YouTube videos
  var languages = getConfiguredLanguages();
  var youtubeVideoIds = [];

  for (var i = 0; i < languages.length; i++) {
    var playlistId = getPlaylistForLanguage(languages[i]);
    var videos = YouTubeClient.getPlaylistVideosWithDetails(playlistId);

    for (var j = 0; j < videos.length; j++) {
      youtubeVideoIds.push(videos[j].videoId);
    }
  }

  Logger.log('YouTube videos found: ' + youtubeVideoIds.length);

  // Check against Google Ads
  var comparison = GoogleAdsClient.checkVideosInAds(youtubeVideoIds);

  Logger.log('');
  Logger.log('=== Comparison Results ===');
  Logger.log('Already in Google Ads: ' + comparison.inAds.length);
  Logger.log('Not in Google Ads: ' + comparison.notInAds.length);
  Logger.log('');

  if (comparison.notInAds.length > 0) {
    Logger.log('Videos NOT in Google Ads:');
    for (var k = 0; k < comparison.notInAds.length; k++) {
      Logger.log('  - ' + comparison.notInAds[k]);
    }
  }
}
