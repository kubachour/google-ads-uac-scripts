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

    // Summary logging
    Logger.log('');
    Logger.log('--- YouTube Playlists ---');
    Logger.log('Playlists synced: ' + successfulPlaylists + ' success, ' + failedPlaylists + ' failed');
    for (var j = 0; j < allResults.length; j++) {
      var r = allResults[j];
      if (r.success) {
        Logger.log('  ' + r.language.toUpperCase() + ': ' + r.totalVideos + ' videos');
      } else {
        Logger.log('  ' + r.language.toUpperCase() + ': FAILED - ' + r.error);
      }
    }

    Logger.log('');
    Logger.log('--- Google Ads Campaigns ---');
    Logger.log('Total campaigns: ' + campaignStats.total);
    Logger.log('Active campaigns: ' + campaignStats.active);
    Logger.log('Videos in campaigns: ' + campaignStats.uniqueVideos);

    // Debug: Show where videos are actually linked
    logGoogleAdsDebug();

    Logger.log('');
    Logger.log('--- Summary ---');
    Logger.log('Total videos from YouTube: ' + summary.totalVideos);
    Logger.log('Processing errors: ' + summary.errors);
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
 * Log Google Ads debug info during main sync
 * Shows counts from different asset tables to identify where videos live
 */
function logGoogleAdsDebug() {
  Logger.log('');
  Logger.log('--- Google Ads Debug ---');

  // Test 1: Basic video assets
  try {
    var q1 = "SELECT asset.id FROM asset WHERE asset.type = 'YOUTUBE_VIDEO'";
    var r1 = AdsApp.search(q1);
    var c1 = 0;
    while (r1.hasNext()) { r1.next(); c1++; }
    Logger.log('Video assets in account: ' + c1);
  } catch (e) {
    Logger.log('Video assets query error: ' + e.message);
  }

  // Test 2: Campaign-level assets
  try {
    var q2 = "SELECT asset.id FROM campaign_asset WHERE asset.type = 'YOUTUBE_VIDEO'";
    var r2 = AdsApp.search(q2);
    var c2 = 0;
    while (r2.hasNext()) { r2.next(); c2++; }
    Logger.log('Videos at campaign level: ' + c2);
  } catch (e) {
    Logger.log('Campaign assets query error: ' + e.message);
  }

  // Test 3: Ad group-level assets
  try {
    var q3 = "SELECT asset.id FROM ad_group_asset WHERE asset.type = 'YOUTUBE_VIDEO'";
    var r3 = AdsApp.search(q3);
    var c3 = 0;
    while (r3.hasNext()) { r3.next(); c3++; }
    Logger.log('Videos at ad group level: ' + c3);
  } catch (e) {
    Logger.log('Ad group assets query error: ' + e.message);
  }

  // Test 4: Asset group assets (Performance Max)
  try {
    var q4 = "SELECT asset.id FROM asset_group_asset WHERE asset.type = 'YOUTUBE_VIDEO'";
    var r4 = AdsApp.search(q4);
    var c4 = 0;
    while (r4.hasNext()) { r4.next(); c4++; }
    Logger.log('Videos in asset groups (PMax): ' + c4);
  } catch (e) {
    Logger.log('Asset group query error: ' + e.message);
  }

  // Test 5: All campaigns
  try {
    var q5 = "SELECT campaign.id FROM campaign";
    var r5 = AdsApp.search(q5);
    var c5 = 0;
    while (r5.hasNext()) { r5.next(); c5++; }
    Logger.log('Total campaigns in account: ' + c5);
  } catch (e) {
    Logger.log('Campaigns query error: ' + e.message);
  }

  // Test 6: App campaigns with "performance" in name
  try {
    var q6 = "SELECT campaign.id, campaign.name, campaign.advertising_channel_type " +
             "FROM campaign " +
             "WHERE campaign.advertising_channel_type IN ('MULTI_CHANNEL', 'DISPLAY') " +
             "AND campaign.name LIKE '%performance%'";
    var r6 = AdsApp.search(q6);
    var c6 = 0;
    var appCampaignNames = [];
    while (r6.hasNext()) {
      var row = r6.next();
      c6++;
      if (c6 <= 3) appCampaignNames.push(row.campaign.name + ' (' + row.campaign.advertisingChannelType + ')');
    }
    Logger.log('App campaigns with "performance": ' + c6);
    if (appCampaignNames.length > 0) {
      Logger.log('  Sample: ' + appCampaignNames.join(', '));
    }
  } catch (e) {
    Logger.log('App campaigns query error: ' + e.message);
  }

  // Test 7: Customer-level assets (account-wide)
  try {
    var q7 = "SELECT asset.id FROM customer_asset WHERE asset.type = 'YOUTUBE_VIDEO'";
    var r7 = AdsApp.search(q7);
    var c7 = 0;
    while (r7.hasNext()) { r7.next(); c7++; }
    Logger.log('Videos at customer (account) level: ' + c7);
  } catch (e) {
    Logger.log('Customer assets query error: ' + e.message);
  }

  // Test 8: Show sample video assets with their resource names
  try {
    var q8 = "SELECT asset.id, asset.name, asset.youtube_video_asset.youtube_video_id " +
             "FROM asset WHERE asset.type = 'YOUTUBE_VIDEO' LIMIT 3";
    var r8 = AdsApp.search(q8);
    Logger.log('Sample video assets:');
    while (r8.hasNext()) {
      var row = r8.next();
      Logger.log('  ID: ' + row.asset.id + ', VideoID: ' + row.asset.youtubeVideoAsset.youtubeVideoId);
    }
  } catch (e) {
    Logger.log('Sample assets query error: ' + e.message);
  }

  // Test 9: App campaign ads with video assets
  try {
    var q9 = "SELECT " +
             "campaign.id, campaign.name, " +
             "ad_group.id, " +
             "ad_group_ad.ad.id, " +
             "ad_group_ad.ad.type, " +
             "ad_group_ad.ad.app_ad.youtube_videos " +
             "FROM ad_group_ad " +
             "WHERE campaign.advertising_channel_type = 'MULTI_CHANNEL' " +
             "AND campaign.name LIKE '%performance%' " +
             "LIMIT 5";
    var r9 = AdsApp.search(q9);
    var c9 = 0;
    Logger.log('App campaign ads with videos:');
    while (r9.hasNext()) {
      var row = r9.next();
      c9++;
      var videos = row.adGroupAd.ad.appAd.youtubeVideos || [];
      Logger.log('  Campaign: ' + row.campaign.name);
      Logger.log('  Ad type: ' + row.adGroupAd.ad.type);
      Logger.log('  Videos in ad: ' + videos.length);
      if (videos.length > 0) {
        for (var v = 0; v < Math.min(videos.length, 2); v++) {
          Logger.log('    - Asset: ' + videos[v].asset);
        }
      }
    }
    Logger.log('Total app ads checked: ' + c9);
  } catch (e) {
    Logger.log('App ads query error: ' + e.message);
  }
}


/**
 * Debug: Test Google Ads campaign query directly
 * Use this to troubleshoot why campaigns might not be showing
 */
function debugGoogleAdsQuery() {
  Logger.log('=== Google Ads Debug ===');
  Logger.log('');

  // Test 1: Basic video assets query
  Logger.log('--- Test 1: Basic Video Assets ---');
  try {
    var query1 =
      "SELECT " +
        "asset.id, " +
        "asset.name, " +
        "asset.type, " +
        "asset.youtube_video_asset.youtube_video_id, " +
        "asset.youtube_video_asset.youtube_video_title " +
      "FROM asset " +
      "WHERE asset.type = 'YOUTUBE_VIDEO' " +
      "LIMIT 10";

    var result1 = AdsApp.search(query1);
    var count1 = 0;

    while (result1.hasNext()) {
      var row = result1.next();
      count1++;
      Logger.log(count1 + '. Asset ID: ' + row.asset.id);
      Logger.log('   Video ID: ' + row.asset.youtubeVideoAsset.youtubeVideoId);
      Logger.log('   Title: ' + (row.asset.youtubeVideoAsset.youtubeVideoTitle || 'N/A'));
      Logger.log('');
    }

    Logger.log('Total video assets found: ' + count1);
  } catch (error) {
    Logger.log('ERROR in Test 1: ' + error.message);
  }

  Logger.log('');
  Logger.log('--- Test 2: Campaign Assets ---');
  try {
    var query2 =
      "SELECT " +
        "asset.id, " +
        "asset.youtube_video_asset.youtube_video_id, " +
        "campaign.id, " +
        "campaign.name, " +
        "campaign.status " +
      "FROM campaign_asset " +
      "WHERE asset.type = 'YOUTUBE_VIDEO' " +
      "LIMIT 10";

    var result2 = AdsApp.search(query2);
    var count2 = 0;

    while (result2.hasNext()) {
      var row = result2.next();
      count2++;
      Logger.log(count2 + '. Video ID: ' + row.asset.youtubeVideoAsset.youtubeVideoId);
      Logger.log('   Campaign: ' + row.campaign.name + ' (' + row.campaign.status + ')');
      Logger.log('');
    }

    Logger.log('Total campaign-asset links found: ' + count2);
  } catch (error) {
    Logger.log('ERROR in Test 2: ' + error.message);
  }

  Logger.log('');
  Logger.log('--- Test 3: Ad Group Assets ---');
  try {
    var query3 =
      "SELECT " +
        "asset.id, " +
        "asset.youtube_video_asset.youtube_video_id, " +
        "ad_group.id, " +
        "ad_group.name, " +
        "campaign.id, " +
        "campaign.name " +
      "FROM ad_group_asset " +
      "WHERE asset.type = 'YOUTUBE_VIDEO' " +
      "LIMIT 10";

    var result3 = AdsApp.search(query3);
    var count3 = 0;

    while (result3.hasNext()) {
      var row = result3.next();
      count3++;
      Logger.log(count3 + '. Video ID: ' + row.asset.youtubeVideoAsset.youtubeVideoId);
      Logger.log('   Ad Group: ' + row.adGroup.name);
      Logger.log('   Campaign: ' + row.campaign.name);
      Logger.log('');
    }

    Logger.log('Total ad_group-asset links found: ' + count3);
  } catch (error) {
    Logger.log('ERROR in Test 3: ' + error.message);
  }

  Logger.log('');
  Logger.log('--- Test 4: All Campaigns ---');
  try {
    var query4 =
      "SELECT " +
        "campaign.id, " +
        "campaign.name, " +
        "campaign.status, " +
        "campaign.advertising_channel_type " +
      "FROM campaign " +
      "LIMIT 20";

    var result4 = AdsApp.search(query4);
    var count4 = 0;

    while (result4.hasNext()) {
      var row = result4.next();
      count4++;
      Logger.log(count4 + '. ' + row.campaign.name);
      Logger.log('   Status: ' + row.campaign.status);
      Logger.log('   Type: ' + row.campaign.advertisingChannelType);
      Logger.log('');
    }

    Logger.log('Total campaigns found: ' + count4);
  } catch (error) {
    Logger.log('ERROR in Test 4: ' + error.message);
  }

  Logger.log('');
  Logger.log('=== Debug Complete ===');
}
