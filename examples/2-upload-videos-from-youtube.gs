/**
 * EXAMPLE SCRIPT: Upload Video Assets from YouTube Playlists to Google Ads
 *
 * Description:
 * Syncs videos from YouTube playlists to Google Ads as video assets.
 * Supports multiple language playlists and duplicate detection.
 *
 * Use Case:
 * Mapy.com has separate YouTube playlists for each language (English, German, Spanish, etc.)
 * and needs to automatically add new videos to Google Ads campaigns.
 *
 * Frequency: Weekly / On-demand
 * Platform: Google Ads Scripts
 *
 * Prerequisites:
 * - Enable YouTube Data API in Google Cloud Console
 * - In Google Ads Scripts editor: Resources → Advanced Google Services → Enable YouTube API
 *
 * Features:
 * - Multi-language playlist support
 * - Duplicate detection using YouTube video ID
 * - Automatic pagination for large playlists
 * - DRY_RUN mode for testing
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

var CONFIG = {
  // YouTube playlists by language code
  PLAYLISTS: {
    'en': 'PLxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',  // English playlist
    'de': 'PLyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy',  // German playlist
    'es': 'PLzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',  // Spanish playlist
    'fr': 'PLaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'   // French playlist
  },

  // Script behavior
  DRY_RUN: false,  // Set true to preview without uploading
  MAX_VIDEOS_PER_PLAYLIST: 50  // Limit videos per playlist (safety)
};

// ============================================================================
// YOUTUBE API FUNCTIONS
// ============================================================================

/**
 * Get all videos from a YouTube playlist
 * Uses YouTube Data API v3 (Advanced Services)
 *
 * IMPORTANT:
 * - YouTube API has quota limits (10,000 units/day default)
 * - Each playlist query costs ~3 units
 * - Monitor quota in Google Cloud Console
 *
 * @param {String} playlistId - YouTube playlist ID
 * @returns {Array} Array of video objects
 */
function getPlaylistVideos(playlistId) {
  var videos = [];
  var pageToken = null;

  try {
    do {
      var params = {
        playlistId: playlistId,
        maxResults: 50,  // Max allowed per request
        pageToken: pageToken || ''
      };

      var response = YouTube.PlaylistItems.list('snippet,contentDetails', params);

      // Check for empty response
      if (!response || !response.items || response.items.length === 0) {
        break;
      }

      // Extract video data
      for (var i = 0; i < response.items.length; i++) {
        var item = response.items[i];
        videos.push({
          videoId: item.contentDetails.videoId,
          title: item.snippet.title,
          description: item.snippet.description || '',
          publishedAt: item.snippet.publishedAt
        });
      }

      pageToken = response.nextPageToken;

      // Safety limit
      if (videos.length >= CONFIG.MAX_VIDEOS_PER_PLAYLIST) {
        Logger.log('  Reached max videos limit (' + CONFIG.MAX_VIDEOS_PER_PLAYLIST + ')');
        break;
      }

    } while (pageToken);

  } catch (e) {
    Logger.log('  Error fetching playlist: ' + e.message);
    Logger.log('  Possible causes:');
    Logger.log('    - YouTube API quota exceeded');
    Logger.log('    - Invalid or private playlist');
    Logger.log('    - YouTube API not enabled in Advanced Services');
    return [];
  }

  return videos;
}

// ============================================================================
// GOOGLE ADS FUNCTIONS
// ============================================================================

/**
 * Check if video asset already exists in Google Ads
 *
 * IMPORTANT: Use YouTube video ID for duplicate detection, NOT assigned IDs
 * - Different aspect ratios of same video = different YouTube IDs
 * - Each unique YouTube video ID should only exist once
 *
 * @param {String} youtubeVideoId - YouTube video ID
 * @returns {Boolean} True if duplicate found
 */
function isDuplicateVideoAsset(youtubeVideoId) {
  try {
    // Query all video assets
    var query = "SELECT asset.id, asset.name, " +
      "asset.youtube_video_asset.youtube_video_id " +
      "FROM asset " +
      "WHERE asset.type = 'YOUTUBE_VIDEO'";

    var result = AdsApp.search(query);

    while (result.hasNext()) {
      var row = result.next();
      var existingVideoId = row.asset.youtubeVideoAsset.youtubeVideoId;

      if (existingVideoId === youtubeVideoId) {
        return true;
      }
    }
  } catch (e) {
    Logger.log('  Warning: Duplicate check failed - ' + e.message);
    // Safer to proceed than skip on error
  }

  return false;
}

/**
 * Upload YouTube video to Google Ads as asset
 *
 * NOTE: Video must be public or unlisted (not private)
 *
 * @param {String} youtubeVideoId - YouTube video ID (11 characters)
 * @param {String} assetName - Asset name
 * @returns {Object} Upload result
 */
function uploadVideoAsset(youtubeVideoId, assetName) {
  if (CONFIG.DRY_RUN) {
    Logger.log('  [DRY RUN] Would upload: ' + assetName);
    return { dryRun: true };
  }

  // Create YouTube video asset
  var assetOperation = {
    create: {
      name: assetName,
      type: 'YOUTUBE_VIDEO',
      youtubeVideoAsset: {
        youtubeVideoId: youtubeVideoId  // Just the ID, not full URL
      }
    }
  };

  // Upload via Google Ads API
  var result = AdsApp.mutate({
    assetOperation: assetOperation
  });

  return result;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate asset name from video metadata
 * Format: {title}_{language}_{videoId}
 * Example: explorelocalstreets_en_dQw4w9WgXcQ
 *
 * @param {String} videoTitle - YouTube video title
 * @param {String} language - Language code
 * @param {String} videoId - YouTube video ID
 * @returns {String} Asset name
 */
function generateAssetName(videoTitle, language, videoId) {
  // Clean title: lowercase, alphanumeric only
  var cleanTitle = videoTitle.toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .substring(0, 200);  // Leave room for language and ID

  var assetName = cleanTitle + '_' + language + '_' + videoId;

  // Validate length (255 char limit)
  if (assetName.length > 255) {
    // Truncate title if needed
    var maxTitleLength = 255 - language.length - videoId.length - 2;  // 2 underscores
    cleanTitle = cleanTitle.substring(0, maxTitleLength);
    assetName = cleanTitle + '_' + language + '_' + videoId;
  }

  return assetName;
}

// ============================================================================
// MAIN LOGIC
// ============================================================================

function main() {
  Logger.log('=== Upload Videos from YouTube Playlists to Google Ads ===');
  Logger.log('');

  if (CONFIG.DRY_RUN) {
    Logger.log('⚠ DRY RUN MODE - No uploads will happen');
    Logger.log('');
  }

  var languages = Object.keys(CONFIG.PLAYLISTS);
  Logger.log('Processing ' + languages.length + ' language playlists...');
  Logger.log('');

  var totalUploaded = 0;
  var totalSkipped = 0;

  // Process each language playlist
  for (var i = 0; i < languages.length; i++) {
    var language = languages[i];
    var playlistId = CONFIG.PLAYLISTS[language];

    Logger.log('[' + (i+1) + '/' + languages.length + '] ' + language.toUpperCase() + ' playlist');
    Logger.log('  Playlist ID: ' + playlistId);

    // Get videos from playlist
    var videos = getPlaylistVideos(playlistId);
    Logger.log('  Found ' + videos.length + ' videos');

    if (videos.length === 0) {
      Logger.log('  → Skipping (no videos or API error)');
      Logger.log('');
      continue;
    }

    var uploaded = 0;
    var skipped = 0;

    // Process each video
    for (var j = 0; j < videos.length; j++) {
      var video = videos[j];

      try {
        // Check for duplicates
        if (isDuplicateVideoAsset(video.videoId)) {
          skipped++;
          continue;
        }

        // Generate asset name
        var assetName = generateAssetName(video.title, language, video.videoId);

        // Upload to Google Ads
        var result = uploadVideoAsset(video.videoId, assetName);

        if (!CONFIG.DRY_RUN) {
          Logger.log('    ✓ Uploaded: ' + video.title.substring(0, 50));
        } else {
          Logger.log('    [DRY RUN] ' + assetName);
        }

        uploaded++;

      } catch (e) {
        Logger.log('    ✗ Error: ' + video.title.substring(0, 50) + ' - ' + e.message);
        skipped++;
      }
    }

    Logger.log('  → Uploaded: ' + uploaded + ' | Skipped: ' + skipped + ' (duplicates)');
    Logger.log('');

    totalUploaded += uploaded;
    totalSkipped += skipped;
  }

  // Summary
  Logger.log('========================================');
  Logger.log('=== UPLOAD COMPLETE ===');
  Logger.log('========================================');
  Logger.log('Total uploaded: ' + totalUploaded + ' videos');
  Logger.log('Total skipped: ' + totalSkipped + ' videos');
  Logger.log('');
}

// ============================================================================
// TEST FUNCTION - Test Single Playlist
// ============================================================================

/**
 * Test function to check YouTube API connectivity
 * Rename to main() to test, or call from main()
 */
function testYouTubeAPI() {
  Logger.log('=== Testing YouTube API ===');
  Logger.log('');

  var testPlaylistId = CONFIG.PLAYLISTS['en'];  // Test English playlist

  Logger.log('Testing playlist: ' + testPlaylistId);
  var videos = getPlaylistVideos(testPlaylistId);

  Logger.log('Found ' + videos.length + ' videos');
  Logger.log('');

  // Show first 3 videos
  for (var i = 0; i < Math.min(3, videos.length); i++) {
    Logger.log('[' + (i+1) + '] ' + videos[i].title);
    Logger.log('    Video ID: ' + videos[i].videoId);
    Logger.log('    Published: ' + videos[i].publishedAt);
  }
}
