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
  syncSourceAssets();
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

  // Build headlines array - keep all existing + we could add a new text headline
  // For app ads, headlines use asset references, not direct text
  // We'll just log what would be needed

  Logger.log('');
  Logger.log('NOTE: App Ad headlines use asset references (not direct text).');
  Logger.log('To add a new headline, you would need to:');
  Logger.log('  1. First create a TEXT asset with the headline text');
  Logger.log('  2. Then reference that asset in the app_ad.headlines array');
  Logger.log('');

  // Example mutation structure (logging only, not executing)
  Logger.log('Example mutation structure for headlines:');
  Logger.log(JSON.stringify({
    adOperation: {
      update: {
        resourceName: 'customers/' + customerId + '/ads/' + adInfo.adId,
        appAd: {
          headlines: adInfo.headlines.concat([{
            asset: 'customers/' + customerId + '/assets/NEW_ASSET_ID'
          }])
        }
      },
      updateMask: 'app_ad.headlines'
    }
  }, null, 2));
}


/**
 * Test image mutation - swap one image
 */
function testMutateImage(customerId, adInfo) {
  Logger.log('Current images (' + adInfo.images.length + '):');
  for (var i = 0; i < Math.min(5, adInfo.images.length); i++) {
    Logger.log('  ' + (i + 1) + '. ' + adInfo.images[i].asset);
  }
  if (adInfo.images.length > 5) {
    Logger.log('  ... and ' + (adInfo.images.length - 5) + ' more');
  }

  Logger.log('');
  Logger.log('To swap an image, keep all current images except one, and add a different one.');
  Logger.log('');

  // Build mutation - remove first image, keep the rest
  if (adInfo.images.length > 1) {
    var newImages = adInfo.images.slice(1); // Remove first image

    Logger.log('Example: Remove first image, keep ' + newImages.length + ' remaining');
    Logger.log('');

    // Try the actual mutation
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

