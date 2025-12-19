/**
 * Main Entry Points
 * App Campaign Asset Automation
 *
 * PLATFORM: Google Ads Scripts
 * This file contains the main trigger functions and entry points
 */


// ============================================================================
// MAIN ENTRY POINTS
// ============================================================================

/**
 * Main function - required entry point for Google Ads Scripts
 */
function main() {
  // testImageUploadFromDrive();  // Commented - upload works but returns temp ID -1
  findUploadedImageAssets();
}


/**
 * Sync source assets from all YouTube playlists
 * Scheduled to run daily
 */
function syncSourceAssets() {
  Logger.log('=== Source Asset Sync ===');

  try {
    initConfig();

    // Get configured language playlists
    var languages = getConfiguredLanguages();
    if (languages.length === 0) {
      throw new Error('No playlists configured');
    }

    // Sync all language playlists
    var allResults = [];
    var successfulPlaylists = 0;
    var failedPlaylists = 0;

    for (var i = 0; i < languages.length; i++) {
      var result = syncPlaylistByLanguage(languages[i]);
      allResults.push(result);

      if (result.success) {
        successfulPlaylists++;
      } else {
        failedPlaylists++;
      }
    }

    // Aggregate results
    var summary = aggregateResults(allResults);

    // Get campaign stats
    var campaignStats = getCampaignStats();

    // Write to output spreadsheet
    writeVideosToSheet(allResults);

    // Google Ads logging only
    Logger.log('');
    Logger.log('--- Google Ads Campaigns ---');
    Logger.log('Total campaigns: ' + campaignStats.total);
    Logger.log('Active campaigns: ' + campaignStats.active);
    Logger.log('Videos in campaigns: ' + campaignStats.uniqueVideos);

    // Debug: Show where videos are actually linked
    logGoogleAdsDebug();

    Logger.log('');
    Logger.log('=== Sync Complete ===');

    return {
      success: true,
      summary: summary,
      results: allResults
    };

  } catch (error) {
    Logger.log('ERROR: ' + error.message);
    return {
      success: false,
      error: error.message
    };
  }
}


/**
 * Sync videos from a specific language playlist
 * @param {string} language - Language code (e.g., 'en', 'es')
 * @returns {Object} Sync results for this language
 */
function syncPlaylistByLanguage(language) {
  var playlistId = getPlaylistForLanguage(language);

  if (!playlistId) {
    return {
      language: language,
      success: false,
      error: 'No playlist configured'
    };
  }

  // Get playlist info
  var playlistInfo = YouTubeClient.getPlaylistInfo(playlistId);

  if (!playlistInfo) {
    return {
      language: language,
      success: false,
      error: 'Could not access playlist'
    };
  }

  // Get all videos with details
  var videos = YouTubeClient.getPlaylistVideosWithDetails(playlistId);

  // Process each video
  var results = {
    language: language,
    playlistId: playlistId,
    playlistTitle: playlistInfo.title,
    success: true,
    totalVideos: videos.length,
    newVideos: 0,
    existingVideos: 0,
    errors: 0,
    processed: []
  };

  for (var i = 0; i < videos.length; i++) {
    try {
      var processed = processVideo(videos[i], language);
      results.processed.push(processed);

      if (processed.isNew) {
        results.newVideos++;
      } else {
        results.existingVideos++;
      }

    } catch (error) {
      results.errors++;
    }
  }

  return results;
}


/**
 * Process a single video
 * @param {Object} video - Video object from YouTubeClient
 * @param {string} language - Language code
 * @returns {Object} Processing result
 */
function processVideo(video, language) {
  // Parse metadata from filename/title
  var parsed = parseVideoMetadata(video);

  return {
    videoId: video.videoId,
    title: video.title,
    language: language,
    publishedAt: video.publishedAt || '',
    durationFormatted: video.durationFormatted || '',
    definition: video.definition || '',
    isNew: true,
    parsed: parsed
  };
}


/**
 * Aggregate results from multiple playlist syncs
 * @param {Array} results - Array of sync results
 * @returns {Object} Aggregated summary
 */
function aggregateResults(results) {
  var summary = {
    totalPlaylists: results.length,
    successfulPlaylists: 0,
    totalVideos: 0,
    newVideos: 0,
    existingVideos: 0,
    errors: 0
  };

  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    if (r.success) {
      summary.successfulPlaylists++;
      summary.totalVideos += r.totalVideos || 0;
      summary.newVideos += r.newVideos || 0;
      summary.existingVideos += r.existingVideos || 0;
      summary.errors += r.errors || 0;
    }
  }

  return summary;
}


// ============================================================================
// METADATA PARSING
// ============================================================================

/**
 * Parse metadata from video title and description
 * @param {Object} video - Video object
 * @returns {Object} Parsed metadata
 */
function parseVideoMetadata(video) {
  var result = {
    fullName: null,
    format: null,
    creator: null,
    source: null,
    date: null,
    type: null,
    message: null,
    creativeSetId: null
  };

  // Try description first (might have "Full asset name:" line)
  var parsed = null;

  if (video.description) {
    var fullNameMatch = video.description.match(/Full asset name:\s*(.+)/i);
    if (fullNameMatch) {
      parsed = parseFilename(fullNameMatch[1].trim());
    } else {
      // Check if first line looks like a filename
      var firstLine = video.description.split('\n')[0].trim();
      if (looksLikeFilename(firstLine)) {
        parsed = parseFilename(firstLine);
      }
    }
  }

  // Fall back to title if description didn't yield results
  if (!parsed || !parsed.creator) {
    parsed = parseFilename(video.title);
  }

  if (parsed) {
    result.fullName = parsed.fullName;
    result.format = parsed.format;
    result.creator = parsed.creator;
    result.source = parsed.source;
    result.date = parsed.productionDate;
    result.type = parsed.assetType;
    result.message = parsed.messageTheme;
    result.creativeSetId = parsed.creativeSetId;
  }

  return result;
}


/**
 * Check if a string looks like a structured filename
 * @param {string} text - Text to check
 * @returns {boolean} True if it looks like a filename
 */
function looksLikeFilename(text) {
  return text && (
    text.indexOf('_c-') > -1 ||
    text.indexOf('_s-') > -1 ||
    text.indexOf('_d-') > -1 ||
    text.indexOf('_t-') > -1
  );
}


/**
 * Parse structured filename
 * Expected format: name_c-Creator_s-Source_d-MonYY_t-Type_m-Message_16x9.ext
 *
 * @param {string} filename - Filename to parse
 * @returns {Object|null} Parsed data or null
 */
function parseFilename(filename) {
  if (!filename) return null;

  // Remove extension
  var baseName = filename.replace(/\.[^.]+$/, '');

  // Extract format (aspect ratio)
  var format = extractFormat(baseName);
  var nameWithoutFormat = format
    ? baseName.replace(new RegExp('[_-]?' + format.pattern, 'i'), '')
    : baseName;

  // Extract parameters using consistent pattern
  var params = {
    creator: extractParam(nameWithoutFormat, '_c-'),
    source: extractParam(nameWithoutFormat, '_s-'),
    productionDate: extractParam(nameWithoutFormat, '_d-'),
    assetType: extractParam(nameWithoutFormat, '_t-'),
    messageTheme: extractParam(nameWithoutFormat, '_m-'),
    gender: extractParam(nameWithoutFormat, '_gen-'),
    age: extractParam(nameWithoutFormat, '_age-'),
    hook: extractParam(nameWithoutFormat, '_h-'),
    id: extractParam(nameWithoutFormat, '_id-')
  };

  // Generate creative set ID if not present
  var creativeSetId = params.id || generateCreativeSetId(params);

  return {
    originalFilename: filename,
    fullName: nameWithoutFormat.trim(),
    format: format ? format.normalized : null,
    creativeSetId: creativeSetId,
    creator: params.creator,
    source: params.source,
    productionDate: params.productionDate,
    assetType: params.assetType,
    messageTheme: params.messageTheme,
    targetGender: params.gender,
    targetAge: params.age,
    hookVariant: params.hook
  };
}


/**
 * Extract aspect ratio format from filename
 * @param {string} text - Text to search
 * @returns {Object|null} {pattern, normalized} or null
 */
function extractFormat(text) {
  var formats = [
    { pattern: '16[x:]9', normalized: '16x9' },
    { pattern: '9[x:]16', normalized: '9x16' },
    { pattern: '1[x:]1', normalized: '1x1' },
    { pattern: '4[x:]5', normalized: '4x5' },
    { pattern: '4[x:]3', normalized: '4x3' }
  ];

  for (var i = 0; i < formats.length; i++) {
    var regex = new RegExp('[_-]?(' + formats[i].pattern + ')', 'i');
    if (regex.test(text)) {
      return formats[i];
    }
  }

  return null;
}


/**
 * Extract parameter value from filename
 * @param {string} text - Text to search
 * @param {string} prefix - Parameter prefix (e.g., '_c-')
 * @returns {string|null} Parameter value or null
 */
function extractParam(text, prefix) {
  var escapedPrefix = prefix.replace(/[-]/g, '[-]');
  var regex = new RegExp(escapedPrefix + '([^_-]+)', 'i');
  var match = text.match(regex);
  return match ? match[1] : null;
}


/**
 * Generate a creative set ID from parameters
 * @param {Object} params - Parsed parameters
 * @returns {string} Generated ID
 */
function generateCreativeSetId(params) {
  var parts = ['CS'];

  // Add date component
  if (params.productionDate) {
    var monthMap = {
      'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
      'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
      'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
    };
    var match = params.productionDate.match(/([a-z]{3})(\d{2})/i);
    if (match) {
      parts.push('20' + match[2] + monthMap[match[1].toLowerCase()]);
    }
  }

  if (parts.length === 1) {
    var now = new Date();
    var year = now.getFullYear();
    var month = ('0' + (now.getMonth() + 1)).slice(-2);
    parts.push(year + month);
  }

  // Add creator initial + source initial + random
  var creatorInit = (params.creator || 'X')[0].toUpperCase();
  var sourceInit = (params.source || 'X')[0].toUpperCase();
  var random = Math.random().toString(36).substring(2, 6).toUpperCase();

  parts.push(creatorInit + sourceInit + random);

  return parts.join('-');
}


// ============================================================================
// SHEET OUTPUT
// ============================================================================

/**
 * Write video data to output spreadsheet
 * @param {Array} allResults - Results from all playlist syncs
 */
function writeVideosToSheet(allResults) {
  var spreadsheet = getOutputSpreadsheet();

  if (!spreadsheet) {
    Logger.log('No output spreadsheet configured - skipping sheet write');
    return;
  }

  Logger.log('Writing videos to spreadsheet...');

  // Get campaign info for each video from Google Ads
  var campaignsByVideoId = getVideoCampaignMap();

  // Get or create "YouTube Videos" sheet
  var sheet = spreadsheet.getSheetByName('YouTube Videos');
  if (!sheet) {
    sheet = spreadsheet.insertSheet('YouTube Videos');
  }

  // Clear existing data
  sheet.clear();

  // Write header row
  var headers = [
    'Video ID',
    'Title',
    'Playlist Country',
    'Upload Date',
    'Duration',
    'Quality',
    'Format',
    'Creator',
    'Source',
    'Date',
    'Type',
    'Message',
    'Creative Set ID',
    'Asset ID',
    'Campaigns',
    'In Google Ads',
    'YouTube URL',
    'Synced At'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

  // Collect all video rows
  var rows = [];
  var syncedAt = new Date().toISOString();

  for (var i = 0; i < allResults.length; i++) {
    var result = allResults[i];
    if (!result.success || !result.processed) continue;

    for (var j = 0; j < result.processed.length; j++) {
      var video = result.processed[j];
      var parsed = video.parsed || {};

      // Get campaigns and asset ID for this video
      var videoInfo = campaignsByVideoId[video.videoId] || { campaigns: [], assetId: '' };
      var campaignNames = videoInfo.campaigns.join(', ');
      var assetId = videoInfo.assetId || '';
      var inGoogleAds = videoInfo.campaigns.length > 0 ? 'Yes' : 'No';

      // Get country from language code (uppercase for display)
      var playlistCountry = (video.language || result.language || '').toUpperCase();

      // Format upload date (from ISO to readable)
      var uploadDate = video.publishedAt ? formatDate(video.publishedAt) : '';

      rows.push([
        video.videoId,
        video.title,
        playlistCountry,
        uploadDate,
        video.durationFormatted || '',
        video.definition || '',
        parsed.format || '',
        parsed.creator || '',
        parsed.source || '',
        parsed.date || '',
        parsed.type || '',
        parsed.message || '',
        parsed.creativeSetId || '',
        assetId,
        campaignNames,
        inGoogleAds,
        'https://www.youtube.com/watch?v=' + video.videoId,
        syncedAt
      ]);
    }
  }

  // Write data rows
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  Logger.log('Wrote ' + rows.length + ' videos to sheet');

  // Auto-resize columns
  for (var c = 1; c <= headers.length; c++) {
    sheet.autoResizeColumn(c);
  }
}


/**
 * Format ISO date string to readable format (YYYY-MM-DD)
 * @param {string} isoDate - ISO date string
 * @returns {string} Formatted date
 */
function formatDate(isoDate) {
  if (!isoDate) return '';
  try {
    var date = new Date(isoDate);
    var year = date.getFullYear();
    var month = ('0' + (date.getMonth() + 1)).slice(-2);
    var day = ('0' + date.getDate()).slice(-2);
    return year + '-' + month + '-' + day;
  } catch (e) {
    return isoDate;
  }
}


/**
 * Get campaign statistics from Google Ads
 * @returns {Object} Campaign stats
 */
function getCampaignStats() {
  var stats = {
    total: 0,
    active: 0,
    uniqueVideos: 0
  };

  try {
    var assets = GoogleAdsClient.getVideoAssetsWithCampaigns();

    var campaigns = {};
    var videos = {};

    for (var i = 0; i < assets.length; i++) {
      var asset = assets[i];

      // Track unique campaigns
      if (!campaigns[asset.campaignId]) {
        campaigns[asset.campaignId] = {
          name: asset.campaignName,
          status: asset.campaignStatus
        };
      }

      // Track unique videos
      videos[asset.videoId] = true;
    }

    stats.total = Object.keys(campaigns).length;
    stats.uniqueVideos = Object.keys(videos).length;

    // Count active campaigns
    for (var campaignId in campaigns) {
      if (campaigns[campaignId].status === 'ENABLED') {
        stats.active++;
      }
    }

  } catch (error) {
    // Silently handle - stats will be 0
  }

  return stats;
}


/**
 * Get map of video ID to campaign names
 * @returns {Object} Map of videoId to array of campaign names
 */
function getVideoCampaignMap() {
  var videoMap = {};

  try {
    var assets = GoogleAdsClient.getVideoAssetsWithCampaigns();

    for (var i = 0; i < assets.length; i++) {
      var asset = assets[i];
      var videoId = asset.videoId;

      if (!videoMap[videoId]) {
        videoMap[videoId] = {
          campaigns: [],
          assetId: asset.assetId || ''
        };
      }

      // Only add campaign name if not already in list
      if (asset.campaignName && videoMap[videoId].campaigns.indexOf(asset.campaignName) === -1) {
        videoMap[videoId].campaigns.push(asset.campaignName);
      }
    }

  } catch (error) {
    // Silently handle
  }

  return videoMap;
}


// ============================================================================
// TEST FUNCTIONS
// ============================================================================

/**
 * Test: Run full sync and write to sheet
 */
function testSyncSourceAssets() {
  var result = syncSourceAssets();
  Logger.log('');
  Logger.log('Final result: ' + JSON.stringify(result, null, 2));
}


/**
 * Test: Sync specific language only
 */
function testSyncSingleLanguage() {
  initConfig();

  var languages = getConfiguredLanguages();
  if (languages.length === 0) {
    Logger.log('No languages configured');
    return;
  }

  // Test first language
  var result = syncPlaylistByLanguage(languages[0]);
  Logger.log('');
  Logger.log('Result: ' + JSON.stringify(result, null, 2));
}


/**
 * Test: Filename parsing
 */
function testParseFilename() {
  var testCases = [
    'Sprint32-SocialSavannah-Diego-video1_c-Diego_s-Fiverr_d-Sep25_t-Video_m-WhatIsAneSim_9x16.mp4',
    'Diego-WhatIsAneSim-Sep25-16x9',
    'creative_c-Casey_s-Internal_d-Oct24_t-Static_1x1.png',
    'Simple Video Title'
  ];

  Logger.log('Testing filename parser:');
  Logger.log('');

  for (var i = 0; i < testCases.length; i++) {
    var filename = testCases[i];
    var parsed = parseFilename(filename);

    Logger.log('Input: ' + filename);
    Logger.log('  Format: ' + (parsed.format || 'N/A'));
    Logger.log('  Creator: ' + (parsed.creator || 'N/A'));
    Logger.log('  Source: ' + (parsed.source || 'N/A'));
    Logger.log('  Date: ' + (parsed.productionDate || 'N/A'));
    Logger.log('  Type: ' + (parsed.assetType || 'N/A'));
    Logger.log('  Message: ' + (parsed.messageTheme || 'N/A'));
    Logger.log('  CS ID: ' + (parsed.creativeSetId || 'N/A'));
    Logger.log('');
  }
}


// ============================================================================
// DEBUG FUNCTIONS
// ============================================================================

/**
 * Log assets for a specific campaign using multiple methods
 * Target: PERFORMANCE|EU|FR|FRENCH|GOOGLE-APP-INSTALL|SIGN-UP|IOS|ALWAYS-ON
 */
function logGoogleAdsDebug() {
  var targetCampaign = 'PERFORMANCE|EU|FR|FRENCH|GOOGLE-APP-INSTALL|SIGN-UP|IOS|ALWAYS-ON';

  Logger.log('');
  Logger.log('################################################################################');
  Logger.log('# CAMPAIGN ASSET ANALYSIS');
  Logger.log('# Target: ' + targetCampaign);
  Logger.log('################################################################################');

  // Method 1: Get all assets from App Ad (ad_group_ad.app_ad)
  logMethod1_AppAdAssets(targetCampaign);

  // Method 2: Get video assets with details
  logMethod2_VideoAssetDetails(targetCampaign);

  // Method 3: Get image assets with details
  logMethod3_ImageAssetDetails(targetCampaign);

  // Method 4: Get text assets (headlines/descriptions)
  logMethod4_TextAssetDetails(targetCampaign);

  // Method 5: Asset performance metrics
  logMethod5_AssetPerformance(targetCampaign);

  // Method 6: Campaign-level asset query
  logMethod6_CampaignAssets(targetCampaign);

  // Method 7: Ad group-level asset query
  logMethod7_AdGroupAssets(targetCampaign);

  Logger.log('');
  Logger.log('################################################################################');
  Logger.log('# ANALYSIS COMPLETE');
  Logger.log('################################################################################');
}


/**
 * Method 1: Get all assets from App Ad structure
 */
function logMethod1_AppAdAssets(campaignName) {
  Logger.log('');
  Logger.log('================================================================================');
  Logger.log('METHOD 1: App Ad Assets (ad_group_ad.app_ad)');
  Logger.log('QUERY: ad_group_ad table - extracts all asset references from app_ad');
  Logger.log('================================================================================');

  try {
    var query =
      "SELECT " +
      "campaign.name, " +
      "ad_group.id, " +
      "ad_group.name, " +
      "ad_group_ad.ad.id, " +
      "ad_group_ad.ad.app_ad.headlines, " +
      "ad_group_ad.ad.app_ad.descriptions, " +
      "ad_group_ad.ad.app_ad.images, " +
      "ad_group_ad.ad.app_ad.youtube_videos, " +
      "ad_group_ad.ad.app_ad.html5_media_bundles " +
      "FROM ad_group_ad " +
      "WHERE campaign.name = '" + campaignName.replace(/'/g, "\\'") + "'";

    var result = AdsApp.search(query);
    var totalHeadlines = 0;
    var totalDescriptions = 0;
    var totalImages = 0;
    var totalVideos = 0;
    var totalHtml5 = 0;
    var adCount = 0;

    var allVideoAssets = [];
    var allImageAssets = [];
    var allHeadlineAssets = [];
    var allDescriptionAssets = [];

    while (result.hasNext()) {
      var row = result.next();
      var appAd = row.adGroupAd.ad.appAd || {};
      adCount++;

      var headlines = appAd.headlines || [];
      var descriptions = appAd.descriptions || [];
      var images = appAd.images || [];
      var videos = appAd.youtubeVideos || [];
      var html5 = appAd.html5MediaBundles || [];

      totalHeadlines += headlines.length;
      totalDescriptions += descriptions.length;
      totalImages += images.length;
      totalVideos += videos.length;
      totalHtml5 += html5.length;

      // Collect unique assets
      for (var i = 0; i < videos.length; i++) {
        if (allVideoAssets.indexOf(videos[i].asset) === -1) {
          allVideoAssets.push(videos[i].asset);
        }
      }
      for (var j = 0; j < images.length; j++) {
        if (allImageAssets.indexOf(images[j].asset) === -1) {
          allImageAssets.push(images[j].asset);
        }
      }
      for (var k = 0; k < headlines.length; k++) {
        if (allHeadlineAssets.indexOf(headlines[k].asset) === -1) {
          allHeadlineAssets.push(headlines[k].asset);
        }
      }
      for (var l = 0; l < descriptions.length; l++) {
        if (allDescriptionAssets.indexOf(descriptions[l].asset) === -1) {
          allDescriptionAssets.push(descriptions[l].asset);
        }
      }
    }

    Logger.log('');
    Logger.log('RESULT: SUCCESS');
    Logger.log('');
    Logger.log('Ads found: ' + adCount);
    Logger.log('');
    Logger.log('ASSET COUNTS (total across all ads):');
    Logger.log('  Headlines: ' + totalHeadlines);
    Logger.log('  Descriptions: ' + totalDescriptions);
    Logger.log('  Images: ' + totalImages);
    Logger.log('  Videos: ' + totalVideos);
    Logger.log('  HTML5 Bundles: ' + totalHtml5);
    Logger.log('');
    Logger.log('UNIQUE ASSETS:');
    Logger.log('  Unique Videos: ' + allVideoAssets.length);
    Logger.log('  Unique Images: ' + allImageAssets.length);
    Logger.log('  Unique Headlines: ' + allHeadlineAssets.length);
    Logger.log('  Unique Descriptions: ' + allDescriptionAssets.length);
    Logger.log('');
    Logger.log('VIDEO ASSET RESOURCE NAMES:');
    for (var v = 0; v < allVideoAssets.length; v++) {
      Logger.log('  ' + (v + 1) + '. ' + allVideoAssets[v]);
    }
    Logger.log('');
    Logger.log('IMAGE ASSET RESOURCE NAMES:');
    for (var m = 0; m < allImageAssets.length; m++) {
      Logger.log('  ' + (m + 1) + '. ' + allImageAssets[m]);
    }

  } catch (error) {
    Logger.log('RESULT: ERROR');
    Logger.log('Error: ' + error.message);
  }
}


/**
 * Method 2: Get video asset details with performance metrics
 */
function logMethod2_VideoAssetDetails(campaignName) {
  Logger.log('');
  Logger.log('================================================================================');
  Logger.log('METHOD 2: Video Asset Details + Performance');
  Logger.log('QUERY: ad_group_ad_asset_view for videos with metrics');
  Logger.log('================================================================================');

  try {
    // Query video assets with performance from ad_group_ad_asset_view
    // Note: video_views metric not supported for this view
    var query =
      "SELECT " +
      "campaign.name, " +
      "asset.id, " +
      "asset.name, " +
      "asset.youtube_video_asset.youtube_video_id, " +
      "asset.youtube_video_asset.youtube_video_title, " +
      "ad_group_ad_asset_view.performance_label, " +
      "metrics.impressions, " +
      "metrics.clicks, " +
      "metrics.conversions, " +
      "metrics.all_conversions, " +
      "metrics.cost_micros " +
      "FROM ad_group_ad_asset_view " +
      "WHERE campaign.name = '" + campaignName.replace(/'/g, "\\'") + "' " +
      "AND asset.type = 'YOUTUBE_VIDEO'";

    var result = AdsApp.search(query);

    // Aggregate by asset ID (same asset may appear multiple times)
    var videoMap = {};

    while (result.hasNext()) {
      var row = result.next();
      var assetId = row.asset.id;

      if (!videoMap[assetId]) {
        videoMap[assetId] = {
          id: assetId,
          name: row.asset.name || '',
          videoId: row.asset.youtubeVideoAsset.youtubeVideoId,
          videoTitle: row.asset.youtubeVideoAsset.youtubeVideoTitle || '',
          performanceLabel: row.adGroupAdAssetView.performanceLabel,
          impressions: 0,
          clicks: 0,
          conversions: 0,
          allConversions: 0,
          cost: 0
        };
      }

      // Aggregate metrics
      videoMap[assetId].impressions += row.metrics.impressions || 0;
      videoMap[assetId].clicks += row.metrics.clicks || 0;
      videoMap[assetId].conversions += row.metrics.conversions || 0;
      videoMap[assetId].allConversions += row.metrics.allConversions || 0;
      videoMap[assetId].cost += row.metrics.costMicros || 0;
    }

    var videos = Object.keys(videoMap).map(function(k) { return videoMap[k]; });

    Logger.log('');
    Logger.log('Found ' + videos.length + ' unique video assets');
    Logger.log('');
    Logger.log('VIDEO ASSETS WITH PERFORMANCE:');
    Logger.log('');

    for (var i = 0; i < videos.length; i++) {
      var v = videos[i];
      var costFormatted = (v.cost / 1000000).toFixed(2);
      var ctr = v.impressions > 0 ? ((v.clicks / v.impressions) * 100).toFixed(2) : '0.00';

      Logger.log((i + 1) + '. [' + v.id + '] ' + (v.videoTitle || v.videoId));
      Logger.log('   YouTube ID: ' + v.videoId);
      Logger.log('   URL: https://youtube.com/watch?v=' + v.videoId);
      Logger.log('   Performance Label: ' + (v.performanceLabel || 'N/A'));
      Logger.log('   Impressions: ' + v.impressions.toLocaleString());
      Logger.log('   Clicks: ' + v.clicks.toLocaleString() + ' (CTR: ' + ctr + '%)');
      Logger.log('   Conversions: ' + v.conversions.toFixed(2) + ' | All Conv: ' + v.allConversions.toFixed(2));
      Logger.log('   Cost: $' + costFormatted);
      Logger.log('');
    }

  } catch (error) {
    Logger.log('RESULT: ERROR');
    Logger.log('Error: ' + error.message);
  }
}


/**
 * Method 3: Get image asset details with performance metrics
 */
function logMethod3_ImageAssetDetails(campaignName) {
  Logger.log('');
  Logger.log('================================================================================');
  Logger.log('METHOD 3: Image Asset Details + Performance');
  Logger.log('QUERY: ad_group_ad_asset_view for images with metrics');
  Logger.log('================================================================================');

  try {
    // Query image assets with performance
    var query =
      "SELECT " +
      "campaign.name, " +
      "asset.id, " +
      "asset.name, " +
      "asset.image_asset.full_size.width_pixels, " +
      "asset.image_asset.full_size.height_pixels, " +
      "asset.image_asset.file_size, " +
      "ad_group_ad_asset_view.performance_label, " +
      "metrics.impressions, " +
      "metrics.clicks, " +
      "metrics.conversions, " +
      "metrics.all_conversions, " +
      "metrics.cost_micros " +
      "FROM ad_group_ad_asset_view " +
      "WHERE campaign.name = '" + campaignName.replace(/'/g, "\\'") + "' " +
      "AND asset.type = 'IMAGE'";

    var result = AdsApp.search(query);

    // Aggregate by asset ID
    var imageMap = {};

    while (result.hasNext()) {
      var row = result.next();
      var assetId = row.asset.id;
      var img = row.asset.imageAsset || {};
      var fullSize = img.fullSize || {};

      if (!imageMap[assetId]) {
        imageMap[assetId] = {
          id: assetId,
          name: row.asset.name || '',
          width: fullSize.widthPixels || 0,
          height: fullSize.heightPixels || 0,
          fileSize: img.fileSize || 0,
          performanceLabel: row.adGroupAdAssetView.performanceLabel,
          impressions: 0,
          clicks: 0,
          conversions: 0,
          allConversions: 0,
          cost: 0
        };
      }

      imageMap[assetId].impressions += row.metrics.impressions || 0;
      imageMap[assetId].clicks += row.metrics.clicks || 0;
      imageMap[assetId].conversions += row.metrics.conversions || 0;
      imageMap[assetId].allConversions += row.metrics.allConversions || 0;
      imageMap[assetId].cost += row.metrics.costMicros || 0;
    }

    var images = Object.keys(imageMap).map(function(k) { return imageMap[k]; });

    Logger.log('');
    Logger.log('Found ' + images.length + ' unique image assets');
    Logger.log('');
    Logger.log('IMAGE ASSETS WITH PERFORMANCE:');
    Logger.log('');

    for (var i = 0; i < images.length; i++) {
      var img = images[i];
      var costFormatted = (img.cost / 1000000).toFixed(2);
      var ctr = img.impressions > 0 ? ((img.clicks / img.impressions) * 100).toFixed(2) : '0.00';
      var dimensions = img.width + 'x' + img.height;

      Logger.log((i + 1) + '. [' + img.id + '] ' + (img.name || 'unnamed'));
      Logger.log('   Dimensions: ' + dimensions + ' | Size: ' + (img.fileSize ? Math.round(img.fileSize/1024) + 'KB' : 'N/A'));
      Logger.log('   Performance Label: ' + (img.performanceLabel || 'N/A'));
      Logger.log('   Impressions: ' + img.impressions.toLocaleString());
      Logger.log('   Clicks: ' + img.clicks.toLocaleString() + ' (CTR: ' + ctr + '%)');
      Logger.log('   Conversions: ' + img.conversions.toFixed(2) + ' | All Conv: ' + img.allConversions.toFixed(2));
      Logger.log('   Cost: $' + costFormatted);
      Logger.log('');
    }

  } catch (error) {
    Logger.log('RESULT: ERROR');
    Logger.log('Error: ' + error.message);
  }
}


/**
 * Method 4: Get text asset details with performance metrics
 */
function logMethod4_TextAssetDetails(campaignName) {
  Logger.log('');
  Logger.log('================================================================================');
  Logger.log('METHOD 4: Text Asset Details + Performance (Headlines & Descriptions)');
  Logger.log('QUERY: ad_group_ad_asset_view for text assets with metrics');
  Logger.log('================================================================================');

  try {
    // Query text assets with performance
    var query =
      "SELECT " +
      "campaign.name, " +
      "asset.id, " +
      "asset.text_asset.text, " +
      "ad_group_ad_asset_view.field_type, " +
      "ad_group_ad_asset_view.performance_label, " +
      "metrics.impressions, " +
      "metrics.clicks, " +
      "metrics.conversions, " +
      "metrics.all_conversions, " +
      "metrics.cost_micros " +
      "FROM ad_group_ad_asset_view " +
      "WHERE campaign.name = '" + campaignName.replace(/'/g, "\\'") + "' " +
      "AND asset.type = 'TEXT'";

    var result = AdsApp.search(query);

    // Separate headlines and descriptions, aggregate by asset ID
    var headlineMap = {};
    var descriptionMap = {};

    while (result.hasNext()) {
      var row = result.next();
      var assetId = row.asset.id;
      var fieldType = row.adGroupAdAssetView.fieldType;
      var text = row.asset.textAsset ? row.asset.textAsset.text : '';

      var targetMap = (fieldType === 'HEADLINE') ? headlineMap : descriptionMap;

      if (!targetMap[assetId]) {
        targetMap[assetId] = {
          id: assetId,
          text: text,
          fieldType: fieldType,
          performanceLabel: row.adGroupAdAssetView.performanceLabel,
          impressions: 0,
          clicks: 0,
          conversions: 0,
          allConversions: 0,
          cost: 0
        };
      }

      targetMap[assetId].impressions += row.metrics.impressions || 0;
      targetMap[assetId].clicks += row.metrics.clicks || 0;
      targetMap[assetId].conversions += row.metrics.conversions || 0;
      targetMap[assetId].allConversions += row.metrics.allConversions || 0;
      targetMap[assetId].cost += row.metrics.costMicros || 0;
    }

    var headlines = Object.keys(headlineMap).map(function(k) { return headlineMap[k]; });
    var descriptions = Object.keys(descriptionMap).map(function(k) { return descriptionMap[k]; });

    Logger.log('');
    Logger.log('Found ' + headlines.length + ' unique headline assets');
    Logger.log('Found ' + descriptions.length + ' unique description assets');
    Logger.log('');

    // Log headlines with performance
    if (headlines.length > 0) {
      Logger.log('HEADLINES WITH PERFORMANCE:');
      Logger.log('');
      for (var i = 0; i < headlines.length; i++) {
        var h = headlines[i];
        var costFormatted = (h.cost / 1000000).toFixed(2);
        var ctr = h.impressions > 0 ? ((h.clicks / h.impressions) * 100).toFixed(2) : '0.00';

        Logger.log((i + 1) + '. [' + h.id + '] "' + h.text + '"');
        Logger.log('   Performance: ' + (h.performanceLabel || 'N/A'));
        Logger.log('   Impressions: ' + h.impressions.toLocaleString() + ' | Clicks: ' + h.clicks.toLocaleString() + ' (CTR: ' + ctr + '%)');
        Logger.log('   Conversions: ' + h.conversions.toFixed(2) + ' | All Conv: ' + h.allConversions.toFixed(2) + ' | Cost: $' + costFormatted);
        Logger.log('');
      }
    }

    // Log descriptions with performance
    if (descriptions.length > 0) {
      Logger.log('DESCRIPTIONS WITH PERFORMANCE:');
      Logger.log('');
      for (var j = 0; j < descriptions.length; j++) {
        var d = descriptions[j];
        var costFormatted2 = (d.cost / 1000000).toFixed(2);
        var ctr2 = d.impressions > 0 ? ((d.clicks / d.impressions) * 100).toFixed(2) : '0.00';

        Logger.log((j + 1) + '. [' + d.id + '] "' + d.text + '"');
        Logger.log('   Performance: ' + (d.performanceLabel || 'N/A'));
        Logger.log('   Impressions: ' + d.impressions.toLocaleString() + ' | Clicks: ' + d.clicks.toLocaleString() + ' (CTR: ' + ctr2 + '%)');
        Logger.log('   Conversions: ' + d.conversions.toFixed(2) + ' | All Conv: ' + d.allConversions.toFixed(2) + ' | Cost: $' + costFormatted2);
        Logger.log('');
      }
    }

  } catch (error) {
    Logger.log('RESULT: ERROR');
    Logger.log('Error: ' + error.message);
  }
}


/**
 * Method 5: Performance Summary by Asset Type
 */
function logMethod5_AssetPerformance(campaignName) {
  Logger.log('');
  Logger.log('================================================================================');
  Logger.log('METHOD 5: Performance Summary by Asset Type');
  Logger.log('QUERY: ad_group_ad_asset_view aggregated totals');
  Logger.log('================================================================================');

  try {
    var query =
      "SELECT " +
      "campaign.name, " +
      "asset.id, " +
      "asset.type, " +
      "ad_group_ad_asset_view.performance_label, " +
      "metrics.impressions, " +
      "metrics.clicks, " +
      "metrics.conversions, " +
      "metrics.all_conversions, " +
      "metrics.cost_micros " +
      "FROM ad_group_ad_asset_view " +
      "WHERE campaign.name = '" + campaignName.replace(/'/g, "\\'") + "'";

    var result = AdsApp.search(query);

    // Aggregate by asset type
    var summaryByType = {};
    var performanceLabelCounts = {};
    var uniqueAssets = {};

    while (result.hasNext()) {
      var row = result.next();
      var assetType = row.asset.type;
      var assetId = row.asset.id;
      var perfLabel = row.adGroupAdAssetView.performanceLabel || 'UNKNOWN';

      // Track unique assets
      if (!uniqueAssets[assetType]) {
        uniqueAssets[assetType] = {};
      }
      uniqueAssets[assetType][assetId] = true;

      // Aggregate metrics by type
      if (!summaryByType[assetType]) {
        summaryByType[assetType] = {
          impressions: 0,
          clicks: 0,
          conversions: 0,
          allConversions: 0,
          cost: 0
        };
      }
      summaryByType[assetType].impressions += row.metrics.impressions || 0;
      summaryByType[assetType].clicks += row.metrics.clicks || 0;
      summaryByType[assetType].conversions += row.metrics.conversions || 0;
      summaryByType[assetType].allConversions += row.metrics.allConversions || 0;
      summaryByType[assetType].cost += row.metrics.costMicros || 0;

      // Count performance labels
      var key = assetType + '_' + perfLabel;
      performanceLabelCounts[key] = (performanceLabelCounts[key] || 0) + 1;
    }

    Logger.log('');
    Logger.log('PERFORMANCE SUMMARY BY ASSET TYPE:');
    Logger.log('');

    var grandTotal = { impressions: 0, clicks: 0, conversions: 0, allConversions: 0, cost: 0 };

    for (var type in summaryByType) {
      var s = summaryByType[type];
      var uniqueCount = Object.keys(uniqueAssets[type]).length;
      var costFormatted = (s.cost / 1000000).toFixed(2);
      var ctr = s.impressions > 0 ? ((s.clicks / s.impressions) * 100).toFixed(2) : '0.00';
      var cpa = s.conversions > 0 ? (s.cost / 1000000 / s.conversions).toFixed(2) : 'N/A';

      Logger.log('--- ' + type + ' (' + uniqueCount + ' unique assets) ---');
      Logger.log('   Impressions: ' + s.impressions.toLocaleString());
      Logger.log('   Clicks: ' + s.clicks.toLocaleString() + ' (CTR: ' + ctr + '%)');
      Logger.log('   Conversions: ' + s.conversions.toFixed(2) + ' | All Conv: ' + s.allConversions.toFixed(2));
      Logger.log('   Cost: $' + costFormatted + ' | CPA: $' + cpa);

      // Show performance label distribution
      var labels = ['BEST', 'GOOD', 'LOW', 'LEARNING', 'UNKNOWN'];
      var labelStr = [];
      for (var l = 0; l < labels.length; l++) {
        var lKey = type + '_' + labels[l];
        if (performanceLabelCounts[lKey]) {
          labelStr.push(labels[l] + ':' + performanceLabelCounts[lKey]);
        }
      }
      if (labelStr.length > 0) {
        Logger.log('   Performance Labels: ' + labelStr.join(' | '));
      }
      Logger.log('');

      // Add to grand total
      grandTotal.impressions += s.impressions;
      grandTotal.clicks += s.clicks;
      grandTotal.conversions += s.conversions;
      grandTotal.allConversions += s.allConversions;
      grandTotal.cost += s.cost;
    }

    // Log grand total
    Logger.log('=== GRAND TOTAL ===');
    var gtCost = (grandTotal.cost / 1000000).toFixed(2);
    var gtCtr = grandTotal.impressions > 0 ? ((grandTotal.clicks / grandTotal.impressions) * 100).toFixed(2) : '0.00';
    var gtCpa = grandTotal.conversions > 0 ? (grandTotal.cost / 1000000 / grandTotal.conversions).toFixed(2) : 'N/A';
    Logger.log('   Impressions: ' + grandTotal.impressions.toLocaleString());
    Logger.log('   Clicks: ' + grandTotal.clicks.toLocaleString() + ' (CTR: ' + gtCtr + '%)');
    Logger.log('   Conversions: ' + grandTotal.conversions.toFixed(2) + ' | All Conv: ' + grandTotal.allConversions.toFixed(2));
    Logger.log('   Cost: $' + gtCost + ' | CPA: $' + gtCpa);

  } catch (error) {
    Logger.log('RESULT: ERROR');
    Logger.log('Error: ' + error.message);
  }
}


/**
 * Method 6: Campaign-level assets (campaign_asset table)
 */
function logMethod6_CampaignAssets(campaignName) {
  Logger.log('');
  Logger.log('================================================================================');
  Logger.log('METHOD 6: Campaign-Level Assets (campaign_asset)');
  Logger.log('QUERY: campaign_asset table - may be empty for app campaigns');
  Logger.log('================================================================================');

  try {
    var query =
      "SELECT " +
      "campaign.name, " +
      "asset.id, " +
      "asset.type, " +
      "asset.name, " +
      "campaign_asset.field_type, " +
      "campaign_asset.status " +
      "FROM campaign_asset " +
      "WHERE campaign.name = '" + campaignName.replace(/'/g, "\\'") + "'";

    var result = AdsApp.search(query);
    var count = 0;
    var byType = {};

    while (result.hasNext()) {
      var row = result.next();
      count++;
      var type = row.asset.type;
      byType[type] = (byType[type] || 0) + 1;
      Logger.log('  [' + row.asset.id + '] Type: ' + type + ' | Field: ' + row.campaignAsset.fieldType);
    }

    Logger.log('');
    if (count === 0) {
      Logger.log('RESULT: No campaign-level assets found (typical for App campaigns)');
    } else {
      Logger.log('RESULT: Found ' + count + ' campaign-level assets');
      for (var t in byType) {
        Logger.log('  ' + t + ': ' + byType[t]);
      }
    }

  } catch (error) {
    Logger.log('RESULT: ERROR');
    Logger.log('Error: ' + error.message);
  }
}


/**
 * Method 7: Ad group-level assets (ad_group_asset table)
 */
function logMethod7_AdGroupAssets(campaignName) {
  Logger.log('');
  Logger.log('================================================================================');
  Logger.log('METHOD 7: Ad Group-Level Assets (ad_group_asset)');
  Logger.log('QUERY: ad_group_asset table - may be empty for app campaigns');
  Logger.log('================================================================================');

  try {
    var query =
      "SELECT " +
      "campaign.name, " +
      "ad_group.name, " +
      "asset.id, " +
      "asset.type, " +
      "asset.name, " +
      "ad_group_asset.field_type, " +
      "ad_group_asset.status " +
      "FROM ad_group_asset " +
      "WHERE campaign.name = '" + campaignName.replace(/'/g, "\\'") + "'";

    var result = AdsApp.search(query);
    var count = 0;
    var byType = {};

    while (result.hasNext()) {
      var row = result.next();
      count++;
      var type = row.asset.type;
      byType[type] = (byType[type] || 0) + 1;
      Logger.log('  [' + row.asset.id + '] Type: ' + type + ' | AdGroup: ' + row.adGroup.name);
    }

    Logger.log('');
    if (count === 0) {
      Logger.log('RESULT: No ad group-level assets found (typical for App campaigns)');
    } else {
      Logger.log('RESULT: Found ' + count + ' ad group-level assets');
      for (var t in byType) {
        Logger.log('  ' + t + ': ' + byType[t]);
      }
    }

  } catch (error) {
    Logger.log('RESULT: ERROR');
    Logger.log('Error: ' + error.message);
  }
}


// ============================================================================
// MUTATION TEST FUNCTIONS
// ============================================================================

/**
 * Test mutation of campaign assets
 * Campaign: 21509897472
 * Ad Group: 162629008222
 */
function testMutateAppAd() {
  var customerId = '3342315080';
  var campaignId = '21509897472';
  var adGroupId = '162629008222';

  Logger.log('');
  Logger.log('################################################################################');
  Logger.log('# APP AD MUTATION TEST');
  Logger.log('# Customer: ' + customerId);
  Logger.log('# Campaign: ' + campaignId);
  Logger.log('# Ad Group: ' + adGroupId);
  Logger.log('################################################################################');
  Logger.log('');

  // Step 1: Get the ad ID and current assets
  Logger.log('=== STEP 1: Get Current Ad and Assets ===');
  var adInfo = getCurrentAdAssets(customerId, campaignId, adGroupId);

  if (!adInfo) {
    Logger.log('ERROR: Could not find ad for this campaign/ad group');
    return;
  }

  Logger.log('Found Ad ID: ' + adInfo.adId);
  Logger.log('Current Headlines: ' + adInfo.headlines.length);
  Logger.log('Current Descriptions: ' + adInfo.descriptions.length);
  Logger.log('Current Images: ' + adInfo.images.length);
  Logger.log('Current Videos: ' + adInfo.videos.length);
  Logger.log('');

  // Step 2: Test headline mutation
  Logger.log('=== STEP 2: Test Headline Mutation ===');
  testMutateHeadline(customerId, adInfo);

  // Step 3: Test image mutation (swap one image)
  Logger.log('');
  Logger.log('=== STEP 3: Test Image Mutation ===');
  testMutateImage(customerId, adInfo);

  // Step 4: Test video mutation (swap one video)
  Logger.log('');
  Logger.log('=== STEP 4: Test Video Mutation ===');
  testMutateVideo(customerId, adInfo);

  Logger.log('');
  Logger.log('################################################################################');
  Logger.log('# MUTATION TEST COMPLETE');
  Logger.log('################################################################################');
}


/**
 * Get current ad and all its assets
 */
function getCurrentAdAssets(customerId, campaignId, adGroupId) {
  try {
    var query =
      "SELECT " +
      "ad_group_ad.ad.id, " +
      "ad_group_ad.ad.resource_name, " +
      "ad_group_ad.ad.app_ad.headlines, " +
      "ad_group_ad.ad.app_ad.descriptions, " +
      "ad_group_ad.ad.app_ad.images, " +
      "ad_group_ad.ad.app_ad.youtube_videos, " +
      "ad_group_ad.status " +
      "FROM ad_group_ad " +
      "WHERE campaign.id = " + campaignId + " " +
      "AND ad_group.id = " + adGroupId + " " +
      "AND ad_group_ad.status != 'REMOVED' " +
      "LIMIT 1";

    var result = AdsApp.search(query);

    if (!result.hasNext()) {
      return null;
    }

    var row = result.next();
    var ad = row.adGroupAd.ad;
    var appAd = ad.appAd || {};

    return {
      adId: ad.id,
      resourceName: ad.resourceName,
      status: row.adGroupAd.status,
      headlines: appAd.headlines || [],
      descriptions: appAd.descriptions || [],
      images: appAd.images || [],
      videos: appAd.youtubeVideos || []
    };

  } catch (error) {
    Logger.log('Error getting ad assets: ' + error.message);
    return null;
  }
}


/**
 * Test headline mutation - add a new headline while keeping existing ones
 */
function testMutateHeadline(customerId, adInfo) {
  Logger.log('Current headlines:');
  for (var i = 0; i < adInfo.headlines.length; i++) {
    Logger.log('  ' + (i + 1) + '. ' + adInfo.headlines[i].asset);
  }

  Logger.log('');
  Logger.log('NOTE: App Ad headlines use asset references (not direct text).');
  Logger.log('To add a new headline, use testCreateAndAddHeadline() function.');
}


/**
 * Get existing TEXT assets in the account
 */
function getExistingTextAssets() {
  Logger.log('=== Existing TEXT Assets ===');
  Logger.log('');

  try {
    var query =
      "SELECT " +
      "asset.id, " +
      "asset.name, " +
      "asset.text_asset.text, " +
      "asset.resource_name " +
      "FROM asset " +
      "WHERE asset.type = 'TEXT' " +
      "LIMIT 20";

    var result = AdsApp.search(query);
    var count = 0;

    while (result.hasNext()) {
      var row = result.next();
      count++;
      Logger.log(count + '. [' + row.asset.id + '] "' + row.asset.textAsset.text + '"');
      Logger.log('   Resource: ' + row.asset.resourceName);
    }

    Logger.log('');
    Logger.log('Total TEXT assets found: ' + count);

  } catch (error) {
    Logger.log('Error: ' + error.message);
  }
}


/**
 * Create a new TEXT asset and return its resource name
 */
function createTextAsset(customerId, text) {
  Logger.log('Creating TEXT asset: "' + text + '"');

  try {
    var result = AdsApp.mutate({
      assetOperation: {
        create: {
          textAsset: {
            text: text
          }
        }
      }
    });

    if (result.isSuccessful()) {
      var resourceName = result.getResourceName();
      Logger.log('SUCCESS: Created asset ' + resourceName);
      return resourceName;
    } else {
      Logger.log('ERROR: ' + result.getErrorMessage());
      return null;
    }

  } catch (error) {
    Logger.log('ERROR: ' + error.message);
    return null;
  }
}


/**
 * Create a new headline and add it to the ad
 * This demonstrates the full flow: create asset -> add to ad
 */
function testCreateAndAddHeadline() {
  var customerId = '3342315080';
  var campaignId = '21509897472';
  var adGroupId = '162629008222';
  var newHeadlineText = 'Test Headline ' + Date.now();

  Logger.log('');
  Logger.log('################################################################################');
  Logger.log('# CREATE AND ADD HEADLINE TEST');
  Logger.log('################################################################################');
  Logger.log('');

  // Step 1: Get current ad info
  Logger.log('=== Step 1: Get Current Ad ===');
  var adInfo = getCurrentAdAssets(customerId, campaignId, adGroupId);

  if (!adInfo) {
    Logger.log('ERROR: Could not find ad');
    return;
  }

  Logger.log('Ad ID: ' + adInfo.adId);
  Logger.log('Current headlines: ' + adInfo.headlines.length);
  Logger.log('');

  // Step 2: Create new TEXT asset
  Logger.log('=== Step 2: Create TEXT Asset ===');
  var newAssetResourceName = createTextAsset(customerId, newHeadlineText);

  if (!newAssetResourceName) {
    Logger.log('Failed to create asset');
    return;
  }

  Logger.log('');

  // Step 3: Add new headline to ad (keeping all existing)
  Logger.log('=== Step 3: Add Headline to Ad ===');

  var newHeadlines = adInfo.headlines.concat([{
    asset: newAssetResourceName
  }]);

  Logger.log('New headlines array will have ' + newHeadlines.length + ' items');
  Logger.log('');

  try {
    var mutationResult = AdsApp.mutate({
      adOperation: {
        update: {
          resourceName: 'customers/' + customerId + '/ads/' + adInfo.adId,
          appAd: {
            headlines: newHeadlines
          }
        },
        updateMask: 'app_ad.headlines'
      }
    });

    Logger.log('Mutation Success: ' + mutationResult.isSuccessful());
    if (mutationResult.isSuccessful()) {
      Logger.log('Resource: ' + mutationResult.getResourceName());
      Logger.log('');
      Logger.log('SUCCESS: Added headline "' + newHeadlineText + '" to ad!');
    } else {
      Logger.log('Error: ' + mutationResult.getErrorMessage());
    }

  } catch (error) {
    Logger.log('Error: ' + error.message);
  }
}


/**
 * Test image mutation - swap one image
 */
function testMutateImage(customerId, adInfo) {
  Logger.log('Current images: ' + adInfo.images.length);
  Logger.log('');

  // Build mutation - remove first image, keep the rest
  if (adInfo.images.length > 1) {
    var newImages = adInfo.images.slice(1); // Remove first image

    Logger.log('Removing 1 image, keeping ' + newImages.length);
    Logger.log('Attempting mutation...');
    try {
      var mutationResult = AdsApp.mutate({
        adOperation: {
          update: {
            resourceName: 'customers/' + customerId + '/ads/' + adInfo.adId,
            appAd: {
              images: newImages
            }
          },
          updateMask: 'app_ad.images'
        }
      });

      Logger.log('Mutation Success: ' + mutationResult.isSuccessful());
      if (mutationResult.isSuccessful()) {
        Logger.log('Resource: ' + mutationResult.getResourceName());
      } else {
        Logger.log('Error: ' + mutationResult.getErrorMessage());
      }
    } catch (error) {
      Logger.log('Mutation Error: ' + error.message);
    }
  } else {
    Logger.log('Not enough images to test removal');
  }
}


/**
 * Test video mutation - swap one video
 */
function testMutateVideo(customerId, adInfo) {
  Logger.log('Current videos (' + adInfo.videos.length + '):');
  for (var i = 0; i < Math.min(5, adInfo.videos.length); i++) {
    Logger.log('  ' + (i + 1) + '. ' + adInfo.videos[i].asset);
  }
  if (adInfo.videos.length > 5) {
    Logger.log('  ... and ' + (adInfo.videos.length - 5) + ' more');
  }

  Logger.log('');
  Logger.log('To swap a video, keep all current videos except one, and add a different one.');
  Logger.log('');

  // Build mutation - remove first video, keep the rest
  if (adInfo.videos.length > 1) {
    var newVideos = adInfo.videos.slice(1); // Remove first video

    Logger.log('Example: Remove first video, keep ' + newVideos.length + ' remaining');
    Logger.log('');

    // Try the actual mutation
    Logger.log('Attempting mutation...');
    try {
      var mutationResult = AdsApp.mutate({
        adOperation: {
          update: {
            resourceName: 'customers/' + customerId + '/ads/' + adInfo.adId,
            appAd: {
              youtubeVideos: newVideos
            }
          },
          updateMask: 'app_ad.youtube_videos'
        }
      });

      Logger.log('Mutation Success: ' + mutationResult.isSuccessful());
      if (mutationResult.isSuccessful()) {
        Logger.log('Resource: ' + mutationResult.getResourceName());
      } else {
        Logger.log('Error: ' + mutationResult.getErrorMessage());
      }
    } catch (error) {
      Logger.log('Mutation Error: ' + error.message);
    }
  } else {
    Logger.log('Not enough videos to test removal');
  }
}


/**
 * Full mutation test - update all asset types at once
 * This keeps all existing assets and just logs what the mutation would look like
 */
function testFullMutation() {
  var customerId = '3342315080';
  var campaignId = '21509897472';
  var adGroupId = '162629008222';

  Logger.log('=== FULL MUTATION TEST ===');
  Logger.log('');

  var adInfo = getCurrentAdAssets(customerId, campaignId, adGroupId);

  if (!adInfo) {
    Logger.log('ERROR: Could not find ad');
    return;
  }

  Logger.log('Ad ID: ' + adInfo.adId);
  Logger.log('Resource Name: ' + adInfo.resourceName);
  Logger.log('');

  // Full mutation keeping all assets
  var fullMutation = {
    adOperation: {
      update: {
        resourceName: adInfo.resourceName,
        appAd: {
          headlines: adInfo.headlines,
          descriptions: adInfo.descriptions,
          images: adInfo.images,
          youtubeVideos: adInfo.videos
        }
      },
      updateMask: 'app_ad.headlines,app_ad.descriptions,app_ad.images,app_ad.youtube_videos'
    }
  };

  Logger.log('Full mutation structure (no changes, just re-setting same assets):');
  Logger.log(JSON.stringify(fullMutation, null, 2));

  Logger.log('');
  Logger.log('Attempting full mutation...');

  try {
    var result = AdsApp.mutate(fullMutation);
    Logger.log('Success: ' + result.isSuccessful());
    if (result.isSuccessful()) {
      Logger.log('Resource: ' + result.getResourceName());
    } else {
      Logger.log('Error: ' + result.getErrorMessage());
    }
  } catch (error) {
    Logger.log('Error: ' + error.message);
  }
}


// ============================================================================
// COMPREHENSIVE ASSET MUTATION TEST - ALL THREE TYPES
// ============================================================================

/**
 * Test mutations for all three asset types: Headlines, Images, Videos
 * This is the main entry point for testing campaign asset mutations
 */
function testAllAssetMutations() {
  var customerId = '3342315080';
  var campaignId = '21509897472';
  var adGroupId = '162629008222';

  Logger.log('');
  Logger.log('################################################################################');
  Logger.log('# COMPREHENSIVE ASSET MUTATION TEST');
  Logger.log('# Testing: Headlines (TEXT), Images, Videos');
  Logger.log('# Customer: ' + customerId);
  Logger.log('# Campaign: ' + campaignId);
  Logger.log('# Ad Group: ' + adGroupId);
  Logger.log('################################################################################');
  Logger.log('');

  // Get current ad info
  Logger.log('=== Loading Current Ad Assets ===');
  var adInfo = getCurrentAdAssets(customerId, campaignId, adGroupId);

  if (!adInfo) {
    Logger.log('ERROR: Could not find ad for this campaign/ad group');
    return;
  }

  Logger.log('Ad ID: ' + adInfo.adId);
  Logger.log('Headlines: ' + adInfo.headlines.length);
  Logger.log('Descriptions: ' + adInfo.descriptions.length);
  Logger.log('Images: ' + adInfo.images.length);
  Logger.log('Videos: ' + adInfo.videos.length);
  Logger.log('');

  // Store results for summary
  var results = {
    headline: { success: false, message: '' },
    image: { success: false, message: '' },
    video: { success: false, message: '' }
  };

  // TEST 1: HEADLINE MUTATION (Add new headline)
  Logger.log('================================================================================');
  Logger.log('TEST 1: HEADLINE MUTATION (Add new TEXT asset as headline)');
  Logger.log('================================================================================');
  results.headline = testHeadlineMutation(customerId, adInfo);

  // Refresh ad info after headline mutation
  adInfo = getCurrentAdAssets(customerId, campaignId, adGroupId);
  Logger.log('');

  // TEST 2: IMAGE MUTATION (Remove and re-add an image)
  Logger.log('================================================================================');
  Logger.log('TEST 2: IMAGE MUTATION (Remove first image, keep rest)');
  Logger.log('================================================================================');
  results.image = testImageMutation(customerId, adInfo);

  // Refresh ad info after image mutation
  adInfo = getCurrentAdAssets(customerId, campaignId, adGroupId);
  Logger.log('');

  // TEST 3: VIDEO MUTATION (Remove and re-add a video)
  Logger.log('================================================================================');
  Logger.log('TEST 3: VIDEO MUTATION (Remove first video, keep rest)');
  Logger.log('================================================================================');
  results.video = testVideoMutation(customerId, adInfo);
  Logger.log('');

  // Print summary
  Logger.log('################################################################################');
  Logger.log('# MUTATION TEST SUMMARY');
  Logger.log('################################################################################');
  Logger.log('');
  Logger.log('HEADLINE MUTATION: ' + (results.headline.success ? 'SUCCESS' : 'FAILED'));
  Logger.log('  ' + results.headline.message);
  Logger.log('');
  Logger.log('IMAGE MUTATION: ' + (results.image.success ? 'SUCCESS' : 'FAILED'));
  Logger.log('  ' + results.image.message);
  Logger.log('');
  Logger.log('VIDEO MUTATION: ' + (results.video.success ? 'SUCCESS' : 'FAILED'));
  Logger.log('  ' + results.video.message);
  Logger.log('');
  Logger.log('################################################################################');
}


/**
 * Test headline mutation - creates new TEXT asset and adds it to ad
 * @returns {Object} {success: boolean, message: string}
 */
function testHeadlineMutation(customerId, adInfo) {
  var newHeadlineText = 'Test Headline ' + new Date().toISOString().slice(0, 16).replace('T', ' ');

  Logger.log('');
  Logger.log('Current headlines (' + adInfo.headlines.length + '):');
  for (var i = 0; i < adInfo.headlines.length; i++) {
    Logger.log('  ' + (i + 1) + '. ' + adInfo.headlines[i].asset);
  }
  Logger.log('');

  // Step 1: Create new TEXT asset
  Logger.log('Step 1: Creating TEXT asset with text: "' + newHeadlineText + '"');

  try {
    var assetResult = AdsApp.mutate({
      assetOperation: {
        create: {
          textAsset: {
            text: newHeadlineText
          }
        }
      }
    });

    if (!assetResult.isSuccessful()) {
      var errorMsg = 'Failed to create TEXT asset: ' + assetResult.getErrorMessage();
      Logger.log('ERROR: ' + errorMsg);
      return { success: false, message: errorMsg };
    }

    var newAssetResourceName = assetResult.getResourceName();
    Logger.log('Created TEXT asset: ' + newAssetResourceName);
    Logger.log('');

    // Step 2: Add new headline to ad
    Logger.log('Step 2: Adding headline to ad...');

    var newHeadlines = adInfo.headlines.concat([{
      asset: newAssetResourceName
    }]);

    Logger.log('New headline count will be: ' + newHeadlines.length);

    var adResult = AdsApp.mutate({
      adOperation: {
        update: {
          resourceName: 'customers/' + customerId + '/ads/' + adInfo.adId,
          appAd: {
            headlines: newHeadlines
          }
        },
        updateMask: 'app_ad.headlines'
      }
    });

    if (adResult.isSuccessful()) {
      var successMsg = 'Added headline "' + newHeadlineText + '" to ad';
      Logger.log('SUCCESS: ' + successMsg);
      return { success: true, message: successMsg };
    } else {
      var errorMsg2 = 'Failed to add headline to ad: ' + adResult.getErrorMessage();
      Logger.log('ERROR: ' + errorMsg2);
      return { success: false, message: errorMsg2 };
    }

  } catch (error) {
    var errorMsg3 = 'Exception: ' + error.message;
    Logger.log('ERROR: ' + errorMsg3);
    return { success: false, message: errorMsg3 };
  }
}


/**
 * Test image mutation - removes first image and keeps the rest
 * @returns {Object} {success: boolean, message: string}
 */
function testImageMutation(customerId, adInfo) {
  Logger.log('');
  Logger.log('Current images: ' + adInfo.images.length);
  Logger.log('');

  if (adInfo.images.length < 2) {
    var msg = 'Not enough images to test removal (need at least 2)';
    Logger.log(msg);
    return { success: false, message: msg };
  }

  // Remove first image, keep the rest
  var newImages = adInfo.images.slice(1);

  Logger.log('Removing 1 image, keeping ' + newImages.length);
  Logger.log('');

  try {
    var result = AdsApp.mutate({
      adOperation: {
        update: {
          resourceName: 'customers/' + customerId + '/ads/' + adInfo.adId,
          appAd: {
            images: newImages
          }
        },
        updateMask: 'app_ad.images'
      }
    });

    if (result.isSuccessful()) {
      var successMsg = 'Removed 1 image, ' + newImages.length + ' remaining';
      Logger.log('SUCCESS: ' + successMsg);
      return { success: true, message: successMsg };
    } else {
      var errorMsg = 'Failed to update images: ' + result.getErrorMessage();
      Logger.log('ERROR: ' + errorMsg);
      return { success: false, message: errorMsg };
    }

  } catch (error) {
    var errorMsg2 = 'Exception: ' + error.message;
    Logger.log('ERROR: ' + errorMsg2);
    return { success: false, message: errorMsg2 };
  }
}


/**
 * Test video mutation - removes first video and keeps the rest
 * @returns {Object} {success: boolean, message: string}
 */
function testVideoMutation(customerId, adInfo) {
  Logger.log('');
  Logger.log('Current videos (' + adInfo.videos.length + '):');
  for (var i = 0; i < Math.min(5, adInfo.videos.length); i++) {
    Logger.log('  ' + (i + 1) + '. ' + adInfo.videos[i].asset);
  }
  if (adInfo.videos.length > 5) {
    Logger.log('  ... and ' + (adInfo.videos.length - 5) + ' more');
  }
  Logger.log('');

  if (adInfo.videos.length < 2) {
    var msg = 'Not enough videos to test removal (need at least 2)';
    Logger.log(msg);
    return { success: false, message: msg };
  }

  // Remove first video, keep the rest
  var removedVideo = adInfo.videos[0].asset;
  var newVideos = adInfo.videos.slice(1);

  Logger.log('Removing video: ' + removedVideo);
  Logger.log('Keeping ' + newVideos.length + ' videos');
  Logger.log('');

  try {
    var result = AdsApp.mutate({
      adOperation: {
        update: {
          resourceName: 'customers/' + customerId + '/ads/' + adInfo.adId,
          appAd: {
            youtubeVideos: newVideos
          }
        },
        updateMask: 'app_ad.youtube_videos'
      }
    });

    if (result.isSuccessful()) {
      var successMsg = 'Removed 1 video, ' + newVideos.length + ' remaining';
      Logger.log('SUCCESS: ' + successMsg);
      return { success: true, message: successMsg };
    } else {
      var errorMsg = 'Failed to update videos: ' + result.getErrorMessage();
      Logger.log('ERROR: ' + errorMsg);
      return { success: false, message: errorMsg };
    }

  } catch (error) {
    var errorMsg2 = 'Exception: ' + error.message;
    Logger.log('ERROR: ' + errorMsg2);
    return { success: false, message: errorMsg2 };
  }
}


/**
 * Get existing IMAGE assets in the account (for adding images)
 */
function getExistingImageAssets() {
  Logger.log('=== Existing IMAGE Assets ===');
  Logger.log('');

  try {
    var query =
      "SELECT " +
      "asset.id, " +
      "asset.name, " +
      "asset.resource_name, " +
      "asset.image_asset.full_size.width_pixels, " +
      "asset.image_asset.full_size.height_pixels " +
      "FROM asset " +
      "WHERE asset.type = 'IMAGE' " +
      "LIMIT 20";

    var result = AdsApp.search(query);
    var count = 0;
    var assets = [];

    while (result.hasNext()) {
      var row = result.next();
      count++;
      var img = row.asset.imageAsset || {};
      var size = img.fullSize || {};
      var dims = (size.widthPixels || '?') + 'x' + (size.heightPixels || '?');

      Logger.log(count + '. [' + row.asset.id + '] ' + (row.asset.name || 'unnamed') + ' (' + dims + ')');
      Logger.log('   Resource: ' + row.asset.resourceName);

      assets.push({
        id: row.asset.id,
        name: row.asset.name,
        resourceName: row.asset.resourceName,
        width: size.widthPixels,
        height: size.heightPixels
      });
    }

    Logger.log('');
    Logger.log('Total IMAGE assets found: ' + count);

    return assets;

  } catch (error) {
    Logger.log('Error: ' + error.message);
    return [];
  }
}


// ============================================================================
// HEADLINE MUTATION TEST - Direct Text vs Asset Reference
// ============================================================================

/**
 * Test headline mutation with proper error extraction
 */
function testHeadlineMutation() {
  var customerId = '3342315080';
  var campaignId = '21509897472';
  var adGroupId = '162629008222';

  Logger.log('');
  Logger.log('################################################################################');
  Logger.log('# HEADLINE MUTATION TEST');
  Logger.log('################################################################################');
  Logger.log('');

  // Get current ad info
  var adInfo = getCurrentAdAssets(customerId, campaignId, adGroupId);

  if (!adInfo) {
    Logger.log('ERROR: Could not find ad');
    return;
  }

  Logger.log('Ad ID: ' + adInfo.adId);
  Logger.log('Current Headlines: ' + adInfo.headlines.length);
  Logger.log('');

  // Log current headlines
  Logger.log('--- Current Headlines ---');
  for (var i = 0; i < adInfo.headlines.length; i++) {
    var h = adInfo.headlines[i];
    if (h.text) {
      Logger.log((i + 1) + '. [TEXT] "' + h.text + '"');
    } else if (h.asset) {
      Logger.log((i + 1) + '. [ASSET] ' + h.asset);
    } else {
      Logger.log((i + 1) + '. ' + JSON.stringify(h));
    }
  }
  Logger.log('');

  // =========================================================================
  // TEST 1: Add headline with DIRECT TEXT
  // =========================================================================
  Logger.log('================================================================================');
  Logger.log('TEST 1: ADD HEADLINE WITH DIRECT TEXT');
  Logger.log('================================================================================');
  Logger.log('');

  var directText = 'Test ' + Date.now();
  Logger.log('New headline text: "' + directText + '"');
  Logger.log('');

  // Build headlines array - keep existing + add new with direct text
  var headlinesDirectText = [];
  for (var j = 0; j < adInfo.headlines.length; j++) {
    headlinesDirectText.push(adInfo.headlines[j]);
  }
  headlinesDirectText.push({ text: directText });

  var payload1 = {
    adOperation: {
      update: {
        resourceName: 'customers/' + customerId + '/ads/' + adInfo.adId,
        appAd: {
          headlines: headlinesDirectText
        }
      },
      updateMask: 'app_ad.headlines'
    }
  };

  Logger.log('Payload:');
  Logger.log(JSON.stringify(payload1, null, 2));
  Logger.log('');

  var result1 = executeMutationWithErrorExtraction(payload1);
  Logger.log('');

  // =========================================================================
  // TEST 2: Add headline with ASSET REFERENCE (create asset first)
  // =========================================================================
  Logger.log('================================================================================');
  Logger.log('TEST 2: ADD HEADLINE WITH ASSET REFERENCE');
  Logger.log('================================================================================');
  Logger.log('');

  // Refresh ad info
  adInfo = getCurrentAdAssets(customerId, campaignId, adGroupId);

  var assetText = 'Asset ' + Date.now();
  Logger.log('Step 1: Creating TEXT asset with text: "' + assetText + '"');
  Logger.log('');

  var assetPayload = {
    assetOperation: {
      create: {
        textAsset: {
          text: assetText
        }
      }
    }
  };

  Logger.log('Asset creation payload:');
  Logger.log(JSON.stringify(assetPayload, null, 2));
  Logger.log('');

  var assetResult = executeMutationWithErrorExtraction(assetPayload);

  if (!assetResult.success) {
    Logger.log('Failed to create asset, skipping ad update');
  } else {
    Logger.log('');
    Logger.log('Step 2: Adding asset to ad headlines');
    Logger.log('Asset resource name: ' + assetResult.resourceName);
    Logger.log('');

    // Build headlines array - keep existing + add new with asset reference
    var headlinesAssetRef = [];
    for (var k = 0; k < adInfo.headlines.length; k++) {
      headlinesAssetRef.push(adInfo.headlines[k]);
    }
    headlinesAssetRef.push({ asset: assetResult.resourceName });

    var payload2 = {
      adOperation: {
        update: {
          resourceName: 'customers/' + customerId + '/ads/' + adInfo.adId,
          appAd: {
            headlines: headlinesAssetRef
          }
        },
        updateMask: 'app_ad.headlines'
      }
    };

    Logger.log('Ad update payload:');
    Logger.log(JSON.stringify(payload2, null, 2));
    Logger.log('');

    var result2 = executeMutationWithErrorExtraction(payload2);
  }

  Logger.log('');

  // =========================================================================
  // TEST 3: Replace ALL headlines with direct text only
  // =========================================================================
  Logger.log('================================================================================');
  Logger.log('TEST 3: REPLACE ALL HEADLINES WITH DIRECT TEXT');
  Logger.log('================================================================================');
  Logger.log('');

  // Refresh ad info
  adInfo = getCurrentAdAssets(customerId, campaignId, adGroupId);

  Logger.log('Current headlines count: ' + adInfo.headlines.length);
  Logger.log('');

  // Create all new headlines with direct text
  var allDirectTextHeadlines = [
    { text: 'Headline One' },
    { text: 'Headline Two' },
    { text: 'Headline Three' }
  ];

  var payload3 = {
    adOperation: {
      update: {
        resourceName: 'customers/' + customerId + '/ads/' + adInfo.adId,
        appAd: {
          headlines: allDirectTextHeadlines
        }
      },
      updateMask: 'app_ad.headlines'
    }
  };

  Logger.log('Payload (replace all with direct text):');
  Logger.log(JSON.stringify(payload3, null, 2));
  Logger.log('');

  var result3 = executeMutationWithErrorExtraction(payload3);

  Logger.log('');
  Logger.log('################################################################################');
  Logger.log('# TEST COMPLETE');
  Logger.log('################################################################################');
}


/**
 * Execute mutation and extract error details properly
 */
function executeMutationWithErrorExtraction(payload) {
  var result = {
    success: false,
    resourceName: null,
    errorCode: null,
    errorMessage: null
  };

  try {
    var mutationResult = AdsApp.mutate(payload);
    result.success = mutationResult.isSuccessful();

    if (result.success) {
      result.resourceName = mutationResult.getResourceName();
      Logger.log('SUCCESS');
      Logger.log('Resource: ' + result.resourceName);
    } else {
      Logger.log('FAILED');

      // Extract error from sc.Ia.errors
      if (mutationResult.sc && mutationResult.sc.Ia && mutationResult.sc.Ia.errors) {
        var errors = mutationResult.sc.Ia.errors;
        for (var i = 0; i < errors.length; i++) {
          var err = errors[i];
          result.errorCode = err.errorCode;
          result.errorMessage = err.message;

          Logger.log('Error Code: ' + JSON.stringify(err.errorCode));
          Logger.log('Error Message: ' + err.message);

          if (err.trigger) {
            Logger.log('Trigger: ' + JSON.stringify(err.trigger));
          }
          if (err.location) {
            Logger.log('Location: ' + JSON.stringify(err.location));
          }
        }
      } else {
        Logger.log('No error details found in result.sc.Ia.errors');
        Logger.log('Full result: ' + JSON.stringify(mutationResult));
      }
    }

  } catch (e) {
    result.success = false;
    result.errorMessage = 'Exception: ' + e.message;
    Logger.log('EXCEPTION: ' + e.message);
    if (e.stack) Logger.log('Stack: ' + e.stack);
  }

  return result;
}


// ============================================================================
// IMAGE MUTATION VARIANTS - Testing different approaches
// ============================================================================

/**
 * Test different approaches to image mutation
 * Hypothesis: The 320x480 image failed because it's not a valid App Campaign dimension
 */
function testImageMutationVariants() {
  var customerId = '3342315080';
  var campaignId = '21509897472';
  var adGroupId = '162629008222';

  Logger.log('');
  Logger.log('################################################################################');
  Logger.log('# IMAGE MUTATION VARIANTS TEST');
  Logger.log('################################################################################');
  Logger.log('');

  // Get current ad info
  var adInfo = getCurrentAdAssets(customerId, campaignId, adGroupId);

  if (!adInfo) {
    Logger.log('ERROR: Could not find ad');
    return;
  }

  Logger.log('Ad ID: ' + adInfo.adId);
  Logger.log('Current Images: ' + adInfo.images.length);
  Logger.log('');

  // Log current images with their dimensions
  Logger.log('--- Current Images in Ad ---');
  logImageDetails(adInfo.images);
  Logger.log('');

  // Get all image assets with dimensions
  Logger.log('--- All Available Image Assets ---');
  var allImages = getAllImageAssetsWithDimensions();
  Logger.log('Total image assets in account: ' + allImages.length);
  Logger.log('');

  // Categorize images by aspect ratio
  var imagesByRatio = categorizeImagesByRatio(allImages);

  Logger.log('Images by aspect ratio:');
  for (var ratio in imagesByRatio) {
    Logger.log('  ' + ratio + ': ' + imagesByRatio[ratio].length + ' images');
  }
  Logger.log('');

  // Get IDs of images currently in ad
  var currentImageIds = {};
  for (var i = 0; i < adInfo.images.length; i++) {
    var match = adInfo.images[i].asset.match(/assets\/(\d+)/);
    if (match) currentImageIds[match[1]] = true;
  }

  // =========================================================================
  // TEST 1: Try adding a LANDSCAPE image (1.91:1 ratio - 1200x628 or similar)
  // =========================================================================
  Logger.log('================================================================================');
  Logger.log('TEST 1: ADD LANDSCAPE IMAGE (1.91:1 ratio)');
  Logger.log('================================================================================');

  var landscapeImage = findUnusedImageByRatio(allImages, currentImageIds, '1.91:1');
  if (!landscapeImage) {
    landscapeImage = findUnusedImageByRatio(allImages, currentImageIds, '16:9');
  }

  if (landscapeImage) {
    testAddImage(customerId, adInfo, landscapeImage, 'Landscape');
    // Refresh for next test
    adInfo = getCurrentAdAssets(customerId, campaignId, adGroupId);
    updateCurrentImageIds(adInfo, currentImageIds);
  } else {
    Logger.log('No unused landscape image found');
  }

  Logger.log('');

  // =========================================================================
  // TEST 2: Try adding a SQUARE image (1:1 ratio - 1200x1200 or similar)
  // =========================================================================
  Logger.log('================================================================================');
  Logger.log('TEST 2: ADD SQUARE IMAGE (1:1 ratio)');
  Logger.log('================================================================================');

  var squareImage = findUnusedImageByRatio(allImages, currentImageIds, '1:1');

  if (squareImage) {
    testAddImage(customerId, adInfo, squareImage, 'Square');
    adInfo = getCurrentAdAssets(customerId, campaignId, adGroupId);
    updateCurrentImageIds(adInfo, currentImageIds);
  } else {
    Logger.log('No unused square image found');
  }

  Logger.log('');

  // =========================================================================
  // TEST 3: Try adding a PORTRAIT image (4:5 ratio)
  // =========================================================================
  Logger.log('================================================================================');
  Logger.log('TEST 3: ADD PORTRAIT IMAGE (4:5 ratio)');
  Logger.log('================================================================================');

  var portraitImage = findUnusedImageByRatio(allImages, currentImageIds, '4:5');

  if (portraitImage) {
    testAddImage(customerId, adInfo, portraitImage, 'Portrait 4:5');
    adInfo = getCurrentAdAssets(customerId, campaignId, adGroupId);
    updateCurrentImageIds(adInfo, currentImageIds);
  } else {
    Logger.log('No unused 4:5 portrait image found');
  }

  Logger.log('');

  // =========================================================================
  // TEST 4: Try re-adding an image that WAS in the ad before (known working)
  // =========================================================================
  Logger.log('================================================================================');
  Logger.log('TEST 4: RE-ADD PREVIOUSLY REMOVED IMAGE');
  Logger.log('================================================================================');

  // Find an image that exists in account but not in ad, with same dimensions as current ad images
  var currentDimensions = getCurrentImageDimensions(adInfo.images, allImages);
  Logger.log('Current ad image dimensions: ' + JSON.stringify(currentDimensions));

  var compatibleImage = findUnusedImageWithMatchingDimensions(allImages, currentImageIds, currentDimensions);

  if (compatibleImage) {
    testAddImage(customerId, adInfo, compatibleImage, 'Matching Dimensions');
    adInfo = getCurrentAdAssets(customerId, campaignId, adGroupId);
  } else {
    Logger.log('No unused image with matching dimensions found');
  }

  Logger.log('');

  // =========================================================================
  // TEST 5: Try adding ANY image from same campaign type
  // =========================================================================
  Logger.log('================================================================================');
  Logger.log('TEST 5: ADD IMAGE USED IN OTHER APP CAMPAIGNS');
  Logger.log('================================================================================');

  var appCampaignImage = findImageUsedInOtherAppCampaigns(customerId, campaignId, currentImageIds);

  if (appCampaignImage) {
    testAddImage(customerId, adInfo, appCampaignImage, 'From Other App Campaign');
  } else {
    Logger.log('No suitable image from other App campaigns found');
  }

  Logger.log('');
  Logger.log('################################################################################');
  Logger.log('# TEST COMPLETE');
  Logger.log('################################################################################');
}


/**
 * Log details of images including dimensions
 */
function logImageDetails(images) {
  for (var i = 0; i < images.length; i++) {
    var assetId = images[i].asset.match(/assets\/(\d+)/);
    Logger.log((i + 1) + '. ' + images[i].asset);
  }
}


/**
 * Get all image assets with their dimensions
 */
function getAllImageAssetsWithDimensions() {
  var images = [];

  try {
    var query =
      "SELECT asset.id, asset.resource_name, asset.name, " +
      "asset.image_asset.full_size.width_pixels, " +
      "asset.image_asset.full_size.height_pixels " +
      "FROM asset WHERE asset.type = 'IMAGE' LIMIT 200";

    var rows = AdsApp.search(query);
    while (rows.hasNext()) {
      var row = rows.next();
      var img = row.asset.imageAsset || {};
      var size = img.fullSize || {};

      images.push({
        id: row.asset.id,
        resourceName: row.asset.resourceName,
        name: row.asset.name || 'unnamed',
        width: size.widthPixels || 0,
        height: size.heightPixels || 0
      });
    }
  } catch (e) {
    Logger.log('Error getting images: ' + e.message);
  }

  return images;
}


/**
 * Categorize images by aspect ratio
 */
function categorizeImagesByRatio(images) {
  var byRatio = {};

  for (var i = 0; i < images.length; i++) {
    var img = images[i];
    if (img.width && img.height) {
      var ratio = getAspectRatio(img.width, img.height);
      if (!byRatio[ratio]) byRatio[ratio] = [];
      byRatio[ratio].push(img);
    }
  }

  return byRatio;
}


/**
 * Get aspect ratio string
 */
function getAspectRatio(width, height) {
  var ratio = width / height;

  // Common App Campaign ratios
  if (Math.abs(ratio - 1.91) < 0.1) return '1.91:1';
  if (Math.abs(ratio - 1.78) < 0.1) return '16:9';
  if (Math.abs(ratio - 1.0) < 0.1) return '1:1';
  if (Math.abs(ratio - 0.8) < 0.1) return '4:5';
  if (Math.abs(ratio - 0.75) < 0.1) return '3:4';
  if (Math.abs(ratio - 0.5625) < 0.1) return '9:16';
  if (Math.abs(ratio - 0.667) < 0.1) return '2:3';

  return ratio.toFixed(2) + ':1';
}


/**
 * Find unused image by aspect ratio
 */
function findUnusedImageByRatio(allImages, currentIds, targetRatio) {
  for (var i = 0; i < allImages.length; i++) {
    var img = allImages[i];
    if (currentIds[img.id]) continue;

    var ratio = getAspectRatio(img.width, img.height);
    if (ratio === targetRatio) {
      Logger.log('Found: [' + img.id + '] ' + img.name + ' (' + img.width + 'x' + img.height + ')');
      return img;
    }
  }
  return null;
}


/**
 * Get dimensions of current images
 */
function getCurrentImageDimensions(currentImages, allImages) {
  var dims = [];
  var imageMap = {};

  for (var i = 0; i < allImages.length; i++) {
    imageMap[allImages[i].id] = allImages[i];
  }

  for (var j = 0; j < currentImages.length; j++) {
    var match = currentImages[j].asset.match(/assets\/(\d+)/);
    if (match && imageMap[match[1]]) {
      var img = imageMap[match[1]];
      dims.push(img.width + 'x' + img.height);
    }
  }

  return dims;
}


/**
 * Find unused image with matching dimensions
 */
function findUnusedImageWithMatchingDimensions(allImages, currentIds, targetDimensions) {
  for (var i = 0; i < allImages.length; i++) {
    var img = allImages[i];
    if (currentIds[img.id]) continue;

    var dims = img.width + 'x' + img.height;
    if (targetDimensions.indexOf(dims) !== -1) {
      Logger.log('Found matching: [' + img.id + '] ' + img.name + ' (' + dims + ')');
      return img;
    }
  }
  return null;
}


/**
 * Find image used in other App campaigns
 */
function findImageUsedInOtherAppCampaigns(customerId, excludeCampaignId, currentIds) {
  try {
    var query =
      "SELECT asset.id, asset.resource_name, asset.name, " +
      "asset.image_asset.full_size.width_pixels, " +
      "asset.image_asset.full_size.height_pixels, " +
      "campaign.id, campaign.name " +
      "FROM ad_group_ad_asset_view " +
      "WHERE campaign.advertising_channel_type = 'MULTI_CHANNEL' " +
      "AND asset.type = 'IMAGE' " +
      "AND campaign.id != " + excludeCampaignId + " " +
      "LIMIT 50";

    var rows = AdsApp.search(query);
    while (rows.hasNext()) {
      var row = rows.next();
      if (currentIds[row.asset.id]) continue;

      var img = row.asset.imageAsset || {};
      var size = img.fullSize || {};

      Logger.log('Found from campaign "' + row.campaign.name + '": [' + row.asset.id + '] ' +
                 (size.widthPixels || '?') + 'x' + (size.heightPixels || '?'));

      return {
        id: row.asset.id,
        resourceName: row.asset.resourceName,
        name: row.asset.name || 'unnamed',
        width: size.widthPixels || 0,
        height: size.heightPixels || 0,
        fromCampaign: row.campaign.name
      };
    }
  } catch (e) {
    Logger.log('Error querying App campaign images: ' + e.message);
  }

  return null;
}


/**
 * Update current image IDs after mutation
 */
function updateCurrentImageIds(adInfo, currentIds) {
  for (var i = 0; i < adInfo.images.length; i++) {
    var match = adInfo.images[i].asset.match(/assets\/(\d+)/);
    if (match) currentIds[match[1]] = true;
  }
}


/**
 * Test adding a single image to ad
 */
function testAddImage(customerId, adInfo, image, testName) {
  Logger.log('');
  Logger.log('Testing: ' + testName);
  Logger.log('Image: [' + image.id + '] ' + image.name);
  Logger.log('Dimensions: ' + image.width + 'x' + image.height);
  Logger.log('Resource: ' + image.resourceName);
  Logger.log('');

  // Build new images array
  var newImages = [];
  for (var i = 0; i < adInfo.images.length; i++) {
    newImages.push(adInfo.images[i]);
  }
  newImages.push({ asset: image.resourceName });

  var payload = {
    adOperation: {
      update: {
        resourceName: 'customers/' + customerId + '/ads/' + adInfo.adId,
        appAd: {
          images: newImages
        }
      },
      updateMask: 'app_ad.images'
    }
  };

  Logger.log('Payload: ' + JSON.stringify(payload, null, 2));
  Logger.log('');

  try {
    var result = AdsApp.mutate(payload);
    var success = result.isSuccessful();

    Logger.log('Result: ' + (success ? 'SUCCESS' : 'FAILED'));

    if (success) {
      Logger.log('Resource: ' + result.getResourceName());
    } else {
      // Try to extract error
      try {
        var resultStr = JSON.stringify(result);
        Logger.log('Result object: ' + resultStr);
      } catch (e) {}

      // Check the 'sc' property mentioned earlier
      if (result.sc) {
        Logger.log('sc property: ' + JSON.stringify(result.sc));
      }
    }

    return success;

  } catch (e) {
    Logger.log('Exception: ' + e.message);
    return false;
  }
}


// ============================================================================
// SIMPLE TEST: MUTATE AD USING EXISTING ASSETS ONLY
// ============================================================================

/**
 * Simple test: Add/remove existing assets to/from ad
 * No asset creation - only uses assets already in the account
 */
function testExistingAssetMutation() {
  var customerId = '3342315080';
  var campaignId = '21509897472';
  var adGroupId = '162629008222';

  Logger.log('');
  Logger.log('################################################################################');
  Logger.log('# TEST: MUTATE AD USING EXISTING ASSETS');
  Logger.log('################################################################################');
  Logger.log('');

  // Get current ad info
  var adInfo = getCurrentAdAssets(customerId, campaignId, adGroupId);

  if (!adInfo) {
    Logger.log('ERROR: Could not find ad');
    return;
  }

  Logger.log('Ad ID: ' + adInfo.adId);
  Logger.log('Current Images: ' + adInfo.images.length);
  Logger.log('Current Videos: ' + adInfo.videos.length);
  Logger.log('');

  // =========================================================================
  // TEST 1: Find existing IMAGE asset not in ad and add it
  // =========================================================================
  Logger.log('================================================================================');
  Logger.log('TEST 1: ADD EXISTING IMAGE TO AD');
  Logger.log('================================================================================');
  Logger.log('');

  // Get IDs of images currently in ad
  var currentImageIds = {};
  for (var i = 0; i < adInfo.images.length; i++) {
    var match = adInfo.images[i].asset.match(/assets\/(\d+)/);
    if (match) {
      currentImageIds[match[1]] = true;
      Logger.log('Current image in ad: ' + adInfo.images[i].asset);
    }
  }
  Logger.log('');

  // Find an image asset NOT in the ad
  var unusedImage = null;
  try {
    var imageQuery =
      "SELECT asset.id, asset.resource_name, asset.name, " +
      "asset.image_asset.full_size.width_pixels, asset.image_asset.full_size.height_pixels " +
      "FROM asset WHERE asset.type = 'IMAGE' LIMIT 50";

    var rows = AdsApp.search(imageQuery);
    while (rows.hasNext()) {
      var row = rows.next();
      if (!currentImageIds[row.asset.id]) {
        var dims = row.asset.imageAsset && row.asset.imageAsset.fullSize
          ? row.asset.imageAsset.fullSize.widthPixels + 'x' + row.asset.imageAsset.fullSize.heightPixels
          : 'unknown';
        unusedImage = {
          id: row.asset.id,
          resourceName: row.asset.resourceName,
          name: row.asset.name || 'unnamed',
          dimensions: dims
        };
        Logger.log('Found unused image: [' + unusedImage.id + '] ' + unusedImage.name + ' (' + dims + ')');
        Logger.log('Resource name: ' + unusedImage.resourceName);
        break;
      }
    }
  } catch (e) {
    Logger.log('Error querying images: ' + e.message);
  }

  if (unusedImage) {
    Logger.log('');
    Logger.log('Adding image to ad...');

    // Build new images array: existing + new
    var newImages = [];
    for (var j = 0; j < adInfo.images.length; j++) {
      newImages.push(adInfo.images[j]);
    }
    newImages.push({ asset: unusedImage.resourceName });

    Logger.log('New images count will be: ' + newImages.length);
    Logger.log('');

    var payload = {
      adOperation: {
        update: {
          resourceName: 'customers/' + customerId + '/ads/' + adInfo.adId,
          appAd: {
            images: newImages
          }
        },
        updateMask: 'app_ad.images'
      }
    };

    Logger.log('Payload:');
    Logger.log(JSON.stringify(payload, null, 2));
    Logger.log('');

    try {
      var result = AdsApp.mutate(payload);
      Logger.log('isSuccessful(): ' + result.isSuccessful());

      if (result.isSuccessful()) {
        Logger.log('SUCCESS! Resource: ' + result.getResourceName());
      } else {
        // Try to get error info
        Logger.log('FAILED');
        try { Logger.log('getErrorMessage: ' + result.getErrorMessage()); } catch(e) {}
        try { Logger.log('getError: ' + result.getError()); } catch(e) {}
        try { Logger.log('errors: ' + JSON.stringify(result.errors)); } catch(e) {}
        try { Logger.log('Result as string: ' + result.toString()); } catch(e) {}

        // List all methods/properties
        Logger.log('Available methods on result:');
        for (var prop in result) {
          Logger.log('  ' + prop + ': ' + typeof result[prop]);
        }
      }
    } catch (e) {
      Logger.log('Exception: ' + e.message);
      if (e.stack) Logger.log('Stack: ' + e.stack);
    }
  } else {
    Logger.log('No unused image found to test with');
  }

  Logger.log('');

  // =========================================================================
  // TEST 2: Find existing VIDEO asset not in ad and add it
  // =========================================================================
  Logger.log('================================================================================');
  Logger.log('TEST 2: ADD EXISTING VIDEO TO AD');
  Logger.log('================================================================================');
  Logger.log('');

  // Refresh ad info
  adInfo = getCurrentAdAssets(customerId, campaignId, adGroupId);

  // Get IDs of videos currently in ad
  var currentVideoIds = {};
  for (var v = 0; v < adInfo.videos.length; v++) {
    var vmatch = adInfo.videos[v].asset.match(/assets\/(\d+)/);
    if (vmatch) {
      currentVideoIds[vmatch[1]] = true;
      Logger.log('Current video in ad: ' + adInfo.videos[v].asset);
    }
  }
  Logger.log('');

  // Find a video asset NOT in the ad
  var unusedVideo = null;
  try {
    var videoQuery =
      "SELECT asset.id, asset.resource_name, asset.name, " +
      "asset.youtube_video_asset.youtube_video_id, asset.youtube_video_asset.youtube_video_title " +
      "FROM asset WHERE asset.type = 'YOUTUBE_VIDEO' LIMIT 50";

    var vrows = AdsApp.search(videoQuery);
    while (vrows.hasNext()) {
      var vrow = vrows.next();
      if (!currentVideoIds[vrow.asset.id]) {
        var ytInfo = vrow.asset.youtubeVideoAsset || {};
        unusedVideo = {
          id: vrow.asset.id,
          resourceName: vrow.asset.resourceName,
          name: vrow.asset.name || 'unnamed',
          youtubeId: ytInfo.youtubeVideoId,
          youtubeTitle: ytInfo.youtubeVideoTitle || ''
        };
        Logger.log('Found unused video: [' + unusedVideo.id + '] ' + unusedVideo.youtubeTitle);
        Logger.log('YouTube ID: ' + unusedVideo.youtubeId);
        Logger.log('Resource name: ' + unusedVideo.resourceName);
        break;
      }
    }
  } catch (e) {
    Logger.log('Error querying videos: ' + e.message);
  }

  if (unusedVideo) {
    Logger.log('');
    Logger.log('Adding video to ad...');

    // Build new videos array: existing + new
    var newVideos = [];
    for (var k = 0; k < adInfo.videos.length; k++) {
      newVideos.push(adInfo.videos[k]);
    }
    newVideos.push({ asset: unusedVideo.resourceName });

    Logger.log('New videos count will be: ' + newVideos.length);
    Logger.log('');

    var videoPayload = {
      adOperation: {
        update: {
          resourceName: 'customers/' + customerId + '/ads/' + adInfo.adId,
          appAd: {
            youtubeVideos: newVideos
          }
        },
        updateMask: 'app_ad.youtube_videos'
      }
    };

    Logger.log('Payload:');
    Logger.log(JSON.stringify(videoPayload, null, 2));
    Logger.log('');

    try {
      var vresult = AdsApp.mutate(videoPayload);
      Logger.log('isSuccessful(): ' + vresult.isSuccessful());

      if (vresult.isSuccessful()) {
        Logger.log('SUCCESS! Resource: ' + vresult.getResourceName());
      } else {
        Logger.log('FAILED');
        try { Logger.log('getErrorMessage: ' + vresult.getErrorMessage()); } catch(e) {}
        try { Logger.log('getError: ' + vresult.getError()); } catch(e) {}

        Logger.log('Available methods on result:');
        for (var vprop in vresult) {
          Logger.log('  ' + vprop + ': ' + typeof vresult[vprop]);
        }
      }
    } catch (e) {
      Logger.log('Exception: ' + e.message);
      if (e.stack) Logger.log('Stack: ' + e.stack);
    }
  } else {
    Logger.log('No unused video found to test with');
  }

  Logger.log('');
  Logger.log('################################################################################');
  Logger.log('# TEST COMPLETE');
  Logger.log('################################################################################');
}


// ============================================================================
// MUTATION TEST V2 - COMPREHENSIVE TESTING WITH DETAILED RESULTS
// ============================================================================

/**
 * Test mutations for all asset types with detailed success/failure reporting
 */
function testMutationV2() {
  var customerId = '3342315080';
  var campaignId = '21509897472';
  var adGroupId = '162629008222';

  var results = [];
  var startTime = new Date();

  Logger.log('');
  Logger.log('################################################################################');
  Logger.log('# MUTATION TEST V2 - COMPREHENSIVE ASSET MUTATION TESTING');
  Logger.log('################################################################################');
  Logger.log('');
  Logger.log('Started: ' + startTime.toISOString());
  Logger.log('Customer ID: ' + customerId);
  Logger.log('Campaign ID: ' + campaignId);
  Logger.log('Ad Group ID: ' + adGroupId);
  Logger.log('');

  // Get current ad info
  Logger.log('--- Loading Ad Info ---');
  var adInfo = getCurrentAdAssets(customerId, campaignId, adGroupId);

  if (!adInfo) {
    Logger.log('FATAL ERROR: Could not find ad for campaign/ad group');
    Logger.log('Query used campaign.id = ' + campaignId + ' AND ad_group.id = ' + adGroupId);
    return;
  }

  Logger.log('Ad ID: ' + adInfo.adId);
  Logger.log('Resource Name: ' + adInfo.resourceName);
  Logger.log('Status: ' + adInfo.status);
  Logger.log('Headlines: ' + adInfo.headlines.length);
  Logger.log('Descriptions: ' + adInfo.descriptions.length);
  Logger.log('Images: ' + adInfo.images.length);
  Logger.log('Videos: ' + adInfo.videos.length);
  Logger.log('');

  // =========================================================================
  // TEST 1A: HEADLINE - Direct Text Approach
  // =========================================================================
  results.push(runTest('1A', 'Headline - Direct Text', function() {
    var testText = 'Direct ' + Date.now();
    var info = getCurrentAdAssets(customerId, campaignId, adGroupId);

    var headlines = [];
    for (var i = 0; i < info.headlines.length; i++) {
      headlines.push(info.headlines[i]);
    }
    headlines.push({ text: testText });

    var payload = {
      adOperation: {
        update: {
          resourceName: 'customers/' + customerId + '/ads/' + info.adId,
          appAd: { headlines: headlines }
        },
        updateMask: 'app_ad.headlines'
      }
    };

    return executeMutation(payload, {
      testText: testText,
      existingCount: info.headlines.length,
      newCount: headlines.length,
      approach: 'direct text { text: "..." }'
    });
  }));

  // =========================================================================
  // TEST 1B: HEADLINE - Asset Reference Approach
  // =========================================================================
  results.push(runTest('1B', 'Headline - Asset Reference', function() {
    var testText = 'AssetRef ' + Date.now();

    // Step 1: Create TEXT asset
    var assetPayload = {
      assetOperation: {
        create: {
          textAsset: { text: testText }
        }
      }
    };

    var assetResult = executeMutation(assetPayload, { step: 'Create TEXT asset' });

    if (!assetResult.success) {
      return {
        success: false,
        error: 'Failed to create TEXT asset: ' + assetResult.error,
        step: 'Asset Creation'
      };
    }

    // Step 2: Add to ad
    var info = getCurrentAdAssets(customerId, campaignId, adGroupId);
    var headlines = info.headlines.concat([{ asset: assetResult.resourceName }]);

    var adPayload = {
      adOperation: {
        update: {
          resourceName: 'customers/' + customerId + '/ads/' + info.adId,
          appAd: { headlines: headlines }
        },
        updateMask: 'app_ad.headlines'
      }
    };

    var adResult = executeMutation(adPayload, { step: 'Add to ad' });
    adResult.assetCreated = assetResult.resourceName;
    adResult.testText = testText;
    adResult.approach = 'asset reference { asset: "customers/.../assets/..." }';

    return adResult;
  }));

  // =========================================================================
  // TEST 2: VIDEO - Remove
  // =========================================================================
  results.push(runTest('2', 'Video - Remove First', function() {
    var info = getCurrentAdAssets(customerId, campaignId, adGroupId);

    if (info.videos.length < 2) {
      return {
        success: false,
        skipped: true,
        error: 'Need at least 2 videos to test removal (have ' + info.videos.length + ')'
      };
    }

    var removedVideo = info.videos[0].asset;
    var newVideos = info.videos.slice(1);

    var payload = {
      adOperation: {
        update: {
          resourceName: 'customers/' + customerId + '/ads/' + info.adId,
          appAd: { youtubeVideos: newVideos }
        },
        updateMask: 'app_ad.youtube_videos'
      }
    };

    var result = executeMutation(payload, {
      removedAsset: removedVideo,
      beforeCount: info.videos.length,
      afterCount: newVideos.length
    });

    return result;
  }));

  // =========================================================================
  // TEST 3: VIDEO - Create Asset and Add
  // =========================================================================
  results.push(runTest('3', 'Video - Create Asset & Add', function() {
    // Find a YouTube video ID to use
    var videoId = null;
    try {
      var query = "SELECT asset.youtube_video_asset.youtube_video_id FROM asset WHERE asset.type = 'YOUTUBE_VIDEO' LIMIT 1";
      var rows = AdsApp.search(query);
      if (rows.hasNext()) {
        videoId = rows.next().asset.youtubeVideoAsset.youtubeVideoId;
      }
    } catch (e) {
      return { success: false, error: 'Failed to query existing videos: ' + e.message };
    }

    if (!videoId) {
      return { success: false, skipped: true, error: 'No YouTube video assets found in account' };
    }

    // Step 1: Create video asset
    var assetPayload = {
      assetOperation: {
        create: {
          name: 'TestVideo_' + Date.now(),
          youtubeVideoAsset: { youtubeVideoId: videoId }
        }
      }
    };

    var assetResult = executeMutation(assetPayload, { youtubeVideoId: videoId });

    if (!assetResult.success) {
      return {
        success: false,
        error: 'Failed to create video asset: ' + assetResult.error,
        youtubeVideoId: videoId
      };
    }

    // Step 2: Add to ad
    var info = getCurrentAdAssets(customerId, campaignId, adGroupId);
    var videos = info.videos.concat([{ asset: assetResult.resourceName }]);

    var adPayload = {
      adOperation: {
        update: {
          resourceName: 'customers/' + customerId + '/ads/' + info.adId,
          appAd: { youtubeVideos: videos }
        },
        updateMask: 'app_ad.youtube_videos'
      }
    };

    var adResult = executeMutation(adPayload, {});
    adResult.assetCreated = assetResult.resourceName;
    adResult.youtubeVideoId = videoId;
    adResult.beforeCount = info.videos.length;
    adResult.afterCount = videos.length;

    return adResult;
  }));

  // =========================================================================
  // TEST 4: IMAGE - Remove
  // =========================================================================
  results.push(runTest('4', 'Image - Remove First', function() {
    var info = getCurrentAdAssets(customerId, campaignId, adGroupId);

    if (info.images.length < 2) {
      return {
        success: false,
        skipped: true,
        error: 'Need at least 2 images to test removal (have ' + info.images.length + ')'
      };
    }

    var removedImage = info.images[0].asset;
    var newImages = info.images.slice(1);

    var payload = {
      adOperation: {
        update: {
          resourceName: 'customers/' + customerId + '/ads/' + info.adId,
          appAd: { images: newImages }
        },
        updateMask: 'app_ad.images'
      }
    };

    var result = executeMutation(payload, {
      removedAsset: removedImage,
      beforeCount: info.images.length,
      afterCount: newImages.length
    });

    return result;
  }));

  // =========================================================================
  // TEST 5: IMAGE - Add Existing Asset
  // =========================================================================
  results.push(runTest('5', 'Image - Add Existing Asset', function() {
    var info = getCurrentAdAssets(customerId, campaignId, adGroupId);

    // Get current image IDs
    var currentIds = {};
    for (var i = 0; i < info.images.length; i++) {
      var m = info.images[i].asset.match(/assets\/(\d+)/);
      if (m) currentIds[m[1]] = true;
    }

    // Find unused image
    var unusedImage = null;
    try {
      var query = "SELECT asset.id, asset.resource_name, asset.name FROM asset WHERE asset.type = 'IMAGE' LIMIT 100";
      var rows = AdsApp.search(query);
      while (rows.hasNext()) {
        var row = rows.next();
        if (!currentIds[row.asset.id]) {
          unusedImage = { id: row.asset.id, resourceName: row.asset.resourceName, name: row.asset.name };
          break;
        }
      }
    } catch (e) {
      return { success: false, error: 'Failed to query images: ' + e.message };
    }

    if (!unusedImage) {
      return { success: false, skipped: true, error: 'No unused image assets found' };
    }

    var images = info.images.concat([{ asset: unusedImage.resourceName }]);

    var payload = {
      adOperation: {
        update: {
          resourceName: 'customers/' + customerId + '/ads/' + info.adId,
          appAd: { images: images }
        },
        updateMask: 'app_ad.images'
      }
    };

    var result = executeMutation(payload, {
      addedAsset: unusedImage.resourceName,
      addedAssetId: unusedImage.id,
      addedAssetName: unusedImage.name,
      beforeCount: info.images.length,
      afterCount: images.length
    });

    return result;
  }));

  // =========================================================================
  // TEST 6: IMAGE - Upload from URL
  // =========================================================================
  results.push(runTest('6', 'Image - Upload from URL', function() {
    var imageUrl = 'https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png';

    // Fetch image
    var fetchInfo = {};
    try {
      var response = UrlFetchApp.fetch(imageUrl);
      var blob = response.getBlob();
      var base64Data = Utilities.base64Encode(blob.getBytes());
      fetchInfo.sizeBytes = blob.getBytes().length;
      fetchInfo.contentType = blob.getContentType();
    } catch (e) {
      return { success: false, error: 'Failed to fetch image: ' + e.message, url: imageUrl };
    }

    // Create asset
    var assetPayload = {
      assetOperation: {
        create: {
          name: 'UrlUpload_' + Date.now(),
          imageAsset: { data: base64Data }
        }
      }
    };

    var assetResult = executeMutation(assetPayload, { url: imageUrl, fetchInfo: fetchInfo });

    if (!assetResult.success) {
      return {
        success: false,
        error: 'Failed to create image asset: ' + assetResult.error,
        url: imageUrl,
        fetchInfo: fetchInfo
      };
    }

    // Add to ad
    var info = getCurrentAdAssets(customerId, campaignId, adGroupId);
    var images = info.images.concat([{ asset: assetResult.resourceName }]);

    var adPayload = {
      adOperation: {
        update: {
          resourceName: 'customers/' + customerId + '/ads/' + info.adId,
          appAd: { images: images }
        },
        updateMask: 'app_ad.images'
      }
    };

    var adResult = executeMutation(adPayload, {});
    adResult.assetCreated = assetResult.resourceName;
    adResult.url = imageUrl;
    adResult.fetchInfo = fetchInfo;
    adResult.beforeCount = info.images.length;
    adResult.afterCount = images.length;

    return adResult;
  }));

  // =========================================================================
  // SUMMARY
  // =========================================================================
  var endTime = new Date();
  var duration = (endTime - startTime) / 1000;

  Logger.log('');
  Logger.log('################################################################################');
  Logger.log('# TEST RESULTS SUMMARY');
  Logger.log('################################################################################');
  Logger.log('');
  Logger.log('Duration: ' + duration.toFixed(2) + ' seconds');
  Logger.log('');

  var successCount = 0;
  var failCount = 0;
  var skipCount = 0;

  for (var t = 0; t < results.length; t++) {
    var r = results[t];
    var status = r.skipped ? 'SKIPPED' : (r.success ? 'SUCCESS' : 'FAILED');
    var icon = r.skipped ? '[-]' : (r.success ? '[+]' : '[X]');

    if (r.skipped) skipCount++;
    else if (r.success) successCount++;
    else failCount++;

    Logger.log(icon + ' TEST ' + r.testId + ': ' + r.testName + ' - ' + status);

    if (r.error) {
      Logger.log('    Error: ' + r.error);
    }
    if (r.resourceName) {
      Logger.log('    Resource: ' + r.resourceName);
    }
    if (r.details) {
      var detailKeys = Object.keys(r.details);
      for (var d = 0; d < detailKeys.length; d++) {
        var key = detailKeys[d];
        var val = r.details[key];
        if (typeof val === 'object') val = JSON.stringify(val);
        Logger.log('    ' + key + ': ' + val);
      }
    }
    Logger.log('');
  }

  Logger.log('--------------------------------------------------------------------------------');
  Logger.log('TOTAL: ' + successCount + ' passed, ' + failCount + ' failed, ' + skipCount + ' skipped');
  Logger.log('--------------------------------------------------------------------------------');
  Logger.log('');

  // Return results for programmatic access
  return {
    customerId: customerId,
    campaignId: campaignId,
    adGroupId: adGroupId,
    adId: adInfo.adId,
    duration: duration,
    results: results,
    summary: {
      total: results.length,
      success: successCount,
      failed: failCount,
      skipped: skipCount
    }
  };
}


/**
 * Run a single test with error handling
 */
function runTest(testId, testName, testFn) {
  Logger.log('================================================================================');
  Logger.log('TEST ' + testId + ': ' + testName);
  Logger.log('================================================================================');
  Logger.log('');

  var result = {
    testId: testId,
    testName: testName,
    success: false,
    skipped: false,
    error: null,
    resourceName: null,
    details: {}
  };

  try {
    var testResult = testFn();

    result.success = testResult.success || false;
    result.skipped = testResult.skipped || false;
    result.error = testResult.error || null;
    result.resourceName = testResult.resourceName || null;

    // Copy all other properties to details
    var keys = Object.keys(testResult);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (['success', 'skipped', 'error', 'resourceName'].indexOf(key) === -1) {
        result.details[key] = testResult[key];
      }
    }

  } catch (e) {
    result.success = false;
    result.error = 'Exception: ' + e.message;
    Logger.log('EXCEPTION: ' + e.message);
    if (e.stack) Logger.log('Stack: ' + e.stack);
  }

  // Log result
  var status = result.skipped ? 'SKIPPED' : (result.success ? 'SUCCESS' : 'FAILED');
  Logger.log('Result: ' + status);
  if (result.error) Logger.log('Error: ' + result.error);
  if (result.resourceName) Logger.log('Resource: ' + result.resourceName);
  Logger.log('');

  return result;
}


/**
 * Execute a mutation and return detailed result
 */
function executeMutation(payload, extraInfo) {
  var result = {
    success: false,
    error: null,
    resourceName: null,
    payload: payload
  };

  // Copy extra info
  if (extraInfo) {
    var keys = Object.keys(extraInfo);
    for (var i = 0; i < keys.length; i++) {
      result[keys[i]] = extraInfo[keys[i]];
    }
  }

  try {
    Logger.log('Executing mutation...');
    Logger.log('Payload: ' + JSON.stringify(payload, null, 2));

    var mutationResult = AdsApp.mutate(payload);

    // Check if mutation was successful
    if (typeof mutationResult.isSuccessful === 'function') {
      result.success = mutationResult.isSuccessful();
    } else {
      // If isSuccessful doesn't exist, check for resource name
      result.success = !!mutationResult.getResourceName;
    }

    if (result.success) {
      if (typeof mutationResult.getResourceName === 'function') {
        result.resourceName = mutationResult.getResourceName();
      }
      Logger.log('SUCCESS - Resource: ' + result.resourceName);
    } else {
      // Try multiple ways to get error message
      if (typeof mutationResult.getErrorMessage === 'function') {
        result.error = mutationResult.getErrorMessage();
      } else if (typeof mutationResult.getError === 'function') {
        result.error = mutationResult.getError();
      } else if (mutationResult.error) {
        result.error = mutationResult.error;
      } else if (mutationResult.errors) {
        result.error = JSON.stringify(mutationResult.errors);
      } else {
        // Log all properties of the result to understand its structure
        result.error = 'Unknown error. Result object: ' + JSON.stringify(mutationResult);
        Logger.log('Mutation result properties:');
        for (var prop in mutationResult) {
          Logger.log('  ' + prop + ': ' + typeof mutationResult[prop]);
        }
      }
      Logger.log('FAILED - Error: ' + result.error);
    }

  } catch (e) {
    result.error = 'Exception: ' + e.message;
    Logger.log('EXCEPTION: ' + e.message);
    if (e.stack) {
      Logger.log('Stack: ' + e.stack);
    }
  }

  return result;
}


/**
 * Get existing YOUTUBE_VIDEO assets in the account (for adding videos)
 */
function getExistingVideoAssets() {
  Logger.log('=== Existing YOUTUBE_VIDEO Assets ===');
  Logger.log('');

  try {
    var query =
      "SELECT " +
      "asset.id, " +
      "asset.name, " +
      "asset.resource_name, " +
      "asset.youtube_video_asset.youtube_video_id, " +
      "asset.youtube_video_asset.youtube_video_title " +
      "FROM asset " +
      "WHERE asset.type = 'YOUTUBE_VIDEO' " +
      "LIMIT 20";

    var result = AdsApp.search(query);
    var count = 0;
    var assets = [];

    while (result.hasNext()) {
      var row = result.next();
      count++;
      var video = row.asset.youtubeVideoAsset || {};

      Logger.log(count + '. [' + row.asset.id + '] ' + (video.youtubeVideoTitle || video.youtubeVideoId));
      Logger.log('   YouTube ID: ' + video.youtubeVideoId);
      Logger.log('   Resource: ' + row.asset.resourceName);

      assets.push({
        id: row.asset.id,
        name: row.asset.name,
        resourceName: row.asset.resourceName,
        youtubeVideoId: video.youtubeVideoId,
        youtubeVideoTitle: video.youtubeVideoTitle
      });
    }

    Logger.log('');
    Logger.log('Total YOUTUBE_VIDEO assets found: ' + count);

    return assets;

  } catch (error) {
    Logger.log('Error: ' + error.message);
    return [];
  }
}


// ============================================================================
// IMAGE UPLOAD FROM GOOGLE DRIVE - Test Functions
// ============================================================================

/**
 * Upload image from Google Drive and create asset
 * @param {string} fileId - Google Drive file ID
 * @param {string} assetName - Name for the asset
 * @returns {Object} Result with success status and resource name or error
 */
function uploadImageAssetFromDrive(fileId, assetName) {
  var customerId = AdsApp.currentAccount().getCustomerId().replace(/-/g, '');

  try {
    var file = DriveApp.getFileById(fileId);
    var blob = file.getBlob();
    var base64Data = Utilities.base64Encode(blob.getBytes());

    Logger.log('File: ' + file.getName());
    Logger.log('MIME type: ' + blob.getContentType());
    Logger.log('Size: ' + Math.round(blob.getBytes().length / 1024) + ' KB');

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

    if (result.isSuccessful()) {
      return {
        success: true,
        resourceName: result.getResourceName()
      };
    } else {
      // Extract error from sc.Ia.errors
      var errorInfo = { code: null, message: 'Unknown error' };
      if (result.sc && result.sc.Ia && result.sc.Ia.errors) {
        var err = result.sc.Ia.errors[0];
        errorInfo.code = err.errorCode;
        errorInfo.message = err.message;
      }
      return {
        success: false,
        errorCode: errorInfo.code,
        errorMessage: errorInfo.message
      };
    }
  } catch (e) {
    return {
      success: false,
      errorMessage: 'Exception: ' + e.message
    };
  }
}


/**
 * Test image upload from Google Drive
 * Tests multiple approaches:
 * 1. Upload single image and create asset
 * 2. Upload and add to ad
 *
 * SETUP: Upload your test images to Google Drive and get their file IDs
 * To get file ID: Open file in Drive > Share > Copy link > extract ID from URL
 * URL format: https://drive.google.com/file/d/FILE_ID/view
 */
function testImageUploadFromDrive() {
  Logger.log('');
  Logger.log('################################################################################');
  Logger.log('# TEST: IMAGE UPLOAD FROM GOOGLE DRIVE');
  Logger.log('################################################################################');
  Logger.log('');

  // =========================================================================
  // CONFIGURATION - Replace with your Google Drive file IDs
  // =========================================================================
  var TEST_IMAGES = [
    {
      fileId: '15ppZjozotpZJ_Kl47vdassYY6-FLLgNy',  // Replace with actual Drive file ID
      name: 'Test_4x5_Portrait',
      expectedRatio: '4:5',
      expectedDimensions: '576x720'
    }, 
    {
      fileId: '157jhayR9h4bD3sOMXEdYIdAFRPv7pIxd',  // Replace with actual Drive file ID
      name: 'Test_16x9_Horizontal',
      expectedRatio: '16:9',
      expectedDimensions: '1280x720'
    }
  ];

  var customerId = '3342315080';
  var campaignId = '21509897472';
  var adGroupId = '162629008222';

  // Check if file IDs are configured
  if (TEST_IMAGES[0].fileId === 'YOUR_DRIVE_FILE_ID_1') {
    Logger.log('ERROR: Please configure Google Drive file IDs in TEST_IMAGES');
    Logger.log('');
    Logger.log('To get file ID from Google Drive:');
    Logger.log('1. Upload your images to Google Drive');
    Logger.log('2. Right-click > Get link');
    Logger.log('3. Extract ID from URL: https://drive.google.com/file/d/FILE_ID/view');
    Logger.log('');
    Logger.log('Expected test images:');
    Logger.log('- airalo-test-4-5.png (576x720, 4:5 ratio)');
    Logger.log('- airalo-test-horizontal.png (1280x720, 16:9 ratio)');
    return;
  }

  // Get current ad info for reference
  var adInfo = getCurrentAdAssets(customerId, campaignId, adGroupId);

  if (!adInfo) {
    Logger.log('ERROR: Could not find ad');
    return;
  }

  Logger.log('Ad ID: ' + adInfo.adId);
  Logger.log('Current Images: ' + adInfo.images.length);
  Logger.log('');

  // =========================================================================
  // TEST 1: Simple Upload - Create Asset Only
  // =========================================================================
  Logger.log('================================================================================');
  Logger.log('TEST 1: UPLOAD IMAGE - CREATE ASSET ONLY');
  Logger.log('================================================================================');
  Logger.log('');

  for (var i = 0; i < TEST_IMAGES.length; i++) {
    var testImage = TEST_IMAGES[i];
    Logger.log('--- Image ' + (i + 1) + ': ' + testImage.name + ' (' + testImage.expectedRatio + ') ---');
    Logger.log('File ID: ' + testImage.fileId);
    Logger.log('Expected: ' + testImage.expectedDimensions);
    Logger.log('');

    var uploadResult = uploadImageAssetFromDrive(testImage.fileId, testImage.name + '_' + Date.now());

    if (uploadResult.success) {
      Logger.log('RESULT: SUCCESS');
      Logger.log('Asset Resource Name: ' + uploadResult.resourceName);
      testImage.resourceName = uploadResult.resourceName;
    } else {
      Logger.log('RESULT: FAILED');
      if (uploadResult.errorCode) {
        Logger.log('Error Code: ' + JSON.stringify(uploadResult.errorCode));
      }
      Logger.log('Error Message: ' + uploadResult.errorMessage);
    }
    Logger.log('');
  }

  // =========================================================================
  // TEST 2: Add Uploaded Images to Ad
  // =========================================================================
  Logger.log('================================================================================');
  Logger.log('TEST 2: ADD UPLOADED IMAGES TO AD');
  Logger.log('================================================================================');
  Logger.log('');

  // Filter to only successfully uploaded images
  var successfulUploads = TEST_IMAGES.filter(function(img) {
    return img.resourceName;
  });

  if (successfulUploads.length === 0) {
    Logger.log('No images were successfully uploaded. Skipping add-to-ad test.');
    return;
  }

  // Get fresh ad info
  adInfo = getCurrentAdAssets(customerId, campaignId, adGroupId);

  for (var j = 0; j < successfulUploads.length; j++) {
    var img = successfulUploads[j];
    Logger.log('--- Adding: ' + img.name + ' (' + img.expectedRatio + ') ---');
    Logger.log('Resource Name: ' + img.resourceName);
    Logger.log('');

    // Build images array: current + new
    var newImages = [];
    for (var k = 0; k < adInfo.images.length; k++) {
      newImages.push(adInfo.images[k]);
    }
    newImages.push({ asset: img.resourceName });

    var payload = {
      adOperation: {
        update: {
          resourceName: 'customers/' + customerId + '/ads/' + adInfo.adId,
          appAd: {
            images: newImages
          }
        },
        updateMask: 'app_ad.images'
      }
    };

    var addResult = executeMutationWithErrorExtraction(payload);

    if (addResult.success) {
      Logger.log('ADD TO AD: SUCCESS');
      img.addedToAd = true;
      // Refresh ad info for next iteration
      adInfo = getCurrentAdAssets(customerId, campaignId, adGroupId);
    } else {
      Logger.log('ADD TO AD: FAILED');
      img.addedToAd = false;
    }
    Logger.log('');
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  Logger.log('================================================================================');
  Logger.log('TEST SUMMARY');
  Logger.log('================================================================================');
  Logger.log('');

  for (var m = 0; m < TEST_IMAGES.length; m++) {
    var ti = TEST_IMAGES[m];
    var uploadStatus = ti.resourceName ? 'SUCCESS' : 'FAILED';
    var addStatus = ti.addedToAd ? 'SUCCESS' : (ti.resourceName ? 'FAILED' : 'SKIPPED');

    Logger.log((m + 1) + '. ' + ti.name + ' (' + ti.expectedRatio + ' / ' + ti.expectedDimensions + ')');
    Logger.log('   Upload: ' + uploadStatus);
    Logger.log('   Add to Ad: ' + addStatus);
    if (ti.resourceName) {
      Logger.log('   Resource: ' + ti.resourceName);
    }
    Logger.log('');
  }

  Logger.log('################################################################################');
  Logger.log('# TEST COMPLETE');
  Logger.log('################################################################################');
}


/**
 * Test uploading a single image from Drive by file ID
 * Use this for quick testing with a specific file
 *
 * @param {string} fileId - Google Drive file ID
 * @param {string} name - Optional asset name
 */
function testSingleImageUpload(fileId, name) {
  if (!fileId) {
    Logger.log('ERROR: Please provide a Google Drive file ID');
    Logger.log('Usage: testSingleImageUpload("1ABC123...", "MyImage")');
    return;
  }

  var assetName = name || 'Test_Upload_' + Date.now();

  Logger.log('');
  Logger.log('=== Single Image Upload Test ===');
  Logger.log('File ID: ' + fileId);
  Logger.log('Asset Name: ' + assetName);
  Logger.log('');

  var result = uploadImageAssetFromDrive(fileId, assetName);

  if (result.success) {
    Logger.log('SUCCESS');
    Logger.log('Resource Name: ' + result.resourceName);

    // Extract asset ID from resource name
    var match = result.resourceName.match(/assets\/(\d+)/);
    if (match) {
      Logger.log('Asset ID: ' + match[1]);
    }
  } else {
    Logger.log('FAILED');
    if (result.errorCode) {
      Logger.log('Error Code: ' + JSON.stringify(result.errorCode));
    }
    Logger.log('Error Message: ' + result.errorMessage);
  }

  return result;
}


/**
 * List files in a Google Drive folder
 * Useful for finding file IDs to use in tests
 *
 * @param {string} folderId - Google Drive folder ID
 */
function listDriveFolderFiles(folderId) {
  if (!folderId) {
    Logger.log('ERROR: Please provide a Google Drive folder ID');
    Logger.log('');
    Logger.log('To get folder ID:');
    Logger.log('1. Open folder in Google Drive');
    Logger.log('2. Look at URL: https://drive.google.com/drive/folders/FOLDER_ID');
    return;
  }

  try {
    var folder = DriveApp.getFolderById(folderId);
    Logger.log('');
    Logger.log('=== Files in folder: ' + folder.getName() + ' ===');
    Logger.log('');

    var files = folder.getFiles();
    var count = 0;

    while (files.hasNext()) {
      var file = files.next();
      count++;
      Logger.log(count + '. ' + file.getName());
      Logger.log('   ID: ' + file.getId());
      Logger.log('   Type: ' + file.getMimeType());
      Logger.log('   Size: ' + Math.round(file.getSize() / 1024) + ' KB');
      Logger.log('');
    }

    Logger.log('Total files: ' + count);

  } catch (e) {
    Logger.log('ERROR: ' + e.message);
  }
}


// ============================================================================
// FIND UPLOADED IMAGE ASSETS
// ============================================================================

/**
 * Find recently uploaded image assets by searching for name patterns
 * Use this to find the actual asset IDs after upload (since upload returns -1)
 */
function findUploadedImageAssets() {
  Logger.log('');
  Logger.log('################################################################################');
  Logger.log('# FIND UPLOADED IMAGE ASSETS');
  Logger.log('################################################################################');
  Logger.log('');

  // Search patterns for our test uploads
  var searchPatterns = [
    'Test_4x5',
    'Test_16x9',
    'airalo'
  ];

  Logger.log('Searching for image assets matching patterns:');
  for (var i = 0; i < searchPatterns.length; i++) {
    Logger.log('  - ' + searchPatterns[i]);
  }
  Logger.log('');

  try {
    // Query all IMAGE assets
    var query =
      "SELECT " +
      "asset.id, " +
      "asset.name, " +
      "asset.resource_name, " +
      "asset.type, " +
      "asset.image_asset.full_size.width_pixels, " +
      "asset.image_asset.full_size.height_pixels, " +
      "asset.image_asset.file_size " +
      "FROM asset " +
      "WHERE asset.type = 'IMAGE' " +
      "ORDER BY asset.id DESC " +
      "LIMIT 100";

    var result = AdsApp.search(query);
    var found = [];
    var allAssets = [];

    while (result.hasNext()) {
      var row = result.next();
      var assetName = row.asset.name || '';
      var imgAsset = row.asset.imageAsset || {};
      var fullSize = imgAsset.fullSize || {};

      var asset = {
        id: row.asset.id,
        name: assetName,
        resourceName: row.asset.resourceName,
        width: fullSize.widthPixels || 0,
        height: fullSize.heightPixels || 0,
        fileSize: imgAsset.fileSize || 0
      };

      allAssets.push(asset);

      // Check if name matches any pattern
      for (var j = 0; j < searchPatterns.length; j++) {
        if (assetName.toLowerCase().indexOf(searchPatterns[j].toLowerCase()) !== -1) {
          found.push(asset);
          break;
        }
      }
    }

    Logger.log('Total IMAGE assets in account: ' + allAssets.length);
    Logger.log('');

    // Log matching assets
    if (found.length > 0) {
      Logger.log('================================================================================');
      Logger.log('MATCHING ASSETS FOUND: ' + found.length);
      Logger.log('================================================================================');
      Logger.log('');

      for (var k = 0; k < found.length; k++) {
        var a = found[k];
        var dims = a.width + 'x' + a.height;
        var ratio = getAspectRatio(a.width, a.height);
        var sizeKB = a.fileSize ? Math.round(a.fileSize / 1024) + ' KB' : 'unknown';

        Logger.log((k + 1) + '. ASSET ID: ' + a.id);
        Logger.log('   Name: ' + a.name);
        Logger.log('   Resource Name: ' + a.resourceName);
        Logger.log('   Dimensions: ' + dims + ' (' + ratio + ')');
        Logger.log('   File Size: ' + sizeKB);
        Logger.log('');
      }
    } else {
      Logger.log('No matching assets found.');
      Logger.log('');
    }

    // Also show most recent 10 IMAGE assets for reference
    Logger.log('================================================================================');
    Logger.log('MOST RECENT 10 IMAGE ASSETS (for reference):');
    Logger.log('================================================================================');
    Logger.log('');

    var recentCount = Math.min(10, allAssets.length);
    for (var m = 0; m < recentCount; m++) {
      var ra = allAssets[m];
      var raDims = ra.width + 'x' + ra.height;
      var raRatio = getAspectRatio(ra.width, ra.height);

      Logger.log((m + 1) + '. [' + ra.id + '] ' + (ra.name || 'unnamed'));
      Logger.log('   Resource: ' + ra.resourceName);
      Logger.log('   Dimensions: ' + raDims + ' (' + raRatio + ')');
      Logger.log('');
    }

    Logger.log('################################################################################');
    Logger.log('# SEARCH COMPLETE');
    Logger.log('################################################################################');

    return found;

  } catch (e) {
    Logger.log('ERROR: ' + e.message);
    return [];
  }
}


/**
 * Find a specific image asset by name
 * @param {string} namePattern - Pattern to search for in asset name
 */
function findImageAssetByName(namePattern) {
  Logger.log('');
  Logger.log('=== Searching for image asset: ' + namePattern + ' ===');
  Logger.log('');

  try {
    var query =
      "SELECT " +
      "asset.id, " +
      "asset.name, " +
      "asset.resource_name, " +
      "asset.image_asset.full_size.width_pixels, " +
      "asset.image_asset.full_size.height_pixels " +
      "FROM asset " +
      "WHERE asset.type = 'IMAGE' " +
      "AND asset.name LIKE '%" + namePattern + "%' " +
      "LIMIT 20";

    var result = AdsApp.search(query);
    var count = 0;

    while (result.hasNext()) {
      var row = result.next();
      count++;
      var imgAsset = row.asset.imageAsset || {};
      var fullSize = imgAsset.fullSize || {};

      Logger.log(count + '. [' + row.asset.id + '] ' + row.asset.name);
      Logger.log('   Resource: ' + row.asset.resourceName);
      Logger.log('   Dimensions: ' + (fullSize.widthPixels || '?') + 'x' + (fullSize.heightPixels || '?'));
      Logger.log('');
    }

    if (count === 0) {
      Logger.log('No assets found matching: ' + namePattern);
    }

    Logger.log('Total found: ' + count);

  } catch (e) {
    Logger.log('ERROR: ' + e.message);
  }
}

