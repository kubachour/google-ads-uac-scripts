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
  Logger.log('=== Starting Source Asset Sync ===');
  Logger.log('Time: ' + new Date().toISOString());

  try {
    initConfig();

    // Get configured language playlists
    var languages = getConfiguredLanguages();
    if (languages.length === 0) {
      throw new Error('No playlists configured in Playlists sheet');
    }

    Logger.log('Found ' + languages.length + ' language playlist(s): ' + languages.join(', '));

    // Sync all language playlists
    var allResults = [];
    for (var i = 0; i < languages.length; i++) {
      var result = syncPlaylistByLanguage(languages[i]);
      allResults.push(result);
    }

    // Aggregate results
    var summary = aggregateResults(allResults);

    // Write to output spreadsheet
    writeVideosToSheet(allResults);

    Logger.log('');
    Logger.log('=== Sync Complete ===');
    Logger.log('Total videos: ' + summary.totalVideos);
    Logger.log('New videos: ' + summary.newVideos);
    Logger.log('Errors: ' + summary.errors);

    return {
      success: true,
      summary: summary,
      results: allResults
    };

  } catch (error) {
    Logger.log('ERROR in syncSourceAssets: ' + error.message);
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
  Logger.log('');
  Logger.log('--- Syncing playlist: ' + language.toUpperCase() + ' ---');

  var playlistId = getPlaylistForLanguage(language);

  if (!playlistId) {
    Logger.log('No playlist configured for language: ' + language);
    return {
      language: language,
      success: false,
      error: 'No playlist configured'
    };
  }

  // Get playlist info
  var playlistInfo = YouTubeClient.getPlaylistInfo(playlistId);

  if (!playlistInfo) {
    Logger.log('Could not access playlist: ' + playlistId);
    return {
      language: language,
      success: false,
      error: 'Could not access playlist'
    };
  }

  Logger.log('Playlist: ' + playlistInfo.title);
  Logger.log('Expected videos: ' + playlistInfo.videoCount);

  // Get all videos with details
  var videos = YouTubeClient.getPlaylistVideosWithDetails(playlistId);

  Logger.log('Retrieved ' + videos.length + ' videos');

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
      Logger.log('Error processing video ' + videos[i].videoId + ': ' + error.message);
      results.errors++;
    }
  }

  Logger.log('');
  Logger.log(language.toUpperCase() + ' sync results:');
  Logger.log('  Total: ' + results.totalVideos);
  Logger.log('  New: ' + results.newVideos);
  Logger.log('  Existing: ' + results.existingVideos);
  Logger.log('  Errors: ' + results.errors);

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

  // Log what we found
  Logger.log('');
  Logger.log('Video: ' + video.title);
  Logger.log('  ID: ' + video.videoId);
  Logger.log('  Duration: ' + (video.durationFormatted || 'N/A'));
  Logger.log('  Language: ' + language);

  if (parsed.format) Logger.log('  Format: ' + parsed.format);
  if (parsed.creator) Logger.log('  Creator: ' + parsed.creator);
  if (parsed.source) Logger.log('  Source: ' + parsed.source);
  if (parsed.date) Logger.log('  Date: ' + parsed.date);
  if (parsed.message) Logger.log('  Message: ' + parsed.message);

  // TODO: Check if video already exists in Notion Source Queue
  // TODO: Create Source Queue entry if new

  return {
    videoId: video.videoId,
    title: video.title,
    language: language,
    durationFormatted: video.durationFormatted || '',
    definition: video.definition || '',
    isNew: true, // TODO: Check against existing records
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
    'Language',
    'Duration',
    'Quality',
    'Format',
    'Creator',
    'Source',
    'Date',
    'Type',
    'Message',
    'Creative Set ID',
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

      // Get campaigns for this video
      var campaigns = campaignsByVideoId[video.videoId] || [];
      var campaignNames = campaigns.join(', ');
      var inGoogleAds = campaigns.length > 0 ? 'Yes' : 'No';

      rows.push([
        video.videoId,
        video.title,
        video.language || result.language,
        video.durationFormatted || '',
        video.definition || '',
        parsed.format || '',
        parsed.creator || '',
        parsed.source || '',
        parsed.date || '',
        parsed.type || '',
        parsed.message || '',
        parsed.creativeSetId || '',
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
 * Get map of video ID to campaign names
 * @returns {Object} Map of videoId to array of campaign names
 */
function getVideoCampaignMap() {
  var campaignMap = {};

  try {
    var assets = GoogleAdsClient.getVideoAssetsWithCampaigns();

    for (var i = 0; i < assets.length; i++) {
      var asset = assets[i];
      var videoId = asset.videoId;
      var campaignName = asset.campaignName;

      if (!campaignMap[videoId]) {
        campaignMap[videoId] = [];
      }

      // Only add campaign name if not already in list
      if (campaignMap[videoId].indexOf(campaignName) === -1) {
        campaignMap[videoId].push(campaignName);
      }
    }

    Logger.log('Built campaign map for ' + Object.keys(campaignMap).length + ' videos');

  } catch (error) {
    Logger.log('Warning: Could not fetch Google Ads campaigns: ' + error.message);
  }

  return campaignMap;
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
