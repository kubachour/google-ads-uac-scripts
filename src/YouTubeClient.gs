/**
 * YouTubeClient Module
 * Retrieves videos from YouTube playlists using Advanced API
 *
 * PLATFORM: Google Ads Scripts
 * Uses YouTube Advanced API (automatic authorization, no API key needed)
 *
 * Prerequisites:
 * 1. Enable YouTube Advanced API in Google Ads Scripts editor:
 *    - Click "Advanced APIs" button
 *    - Check "YouTube"
 *    - Enable in linked Google Cloud Console
 */

var YouTubeClient = (function() {

  /**
   * Get playlist metadata
   * @param {string} playlistId - YouTube playlist ID
   * @returns {Object|null} Playlist info or null
   */
  function getPlaylistInfo(playlistId) {
    try {
      var response = YouTube.Playlists.list('snippet,contentDetails', {
        id: playlistId
      });

      if (!response.items || response.items.length === 0) {
        return null;
      }

      var playlist = response.items[0];

      return {
        playlistId: playlistId,
        title: playlist.snippet.title,
        description: playlist.snippet.description || '',
        channelTitle: playlist.snippet.channelTitle,
        videoCount: playlist.contentDetails.itemCount,
        thumbnailUrl: getBestThumbnail(playlist.snippet.thumbnails)
      };

    } catch (error) {
      return null;
    }
  }

  /**
   * Get all videos from a playlist with full details
   * @param {string} playlistId - YouTube playlist ID
   * @returns {Array} Array of video objects with full details
   */
  function getPlaylistVideosWithDetails(playlistId) {
    // Step 1: Get all playlist items (paginated)
    var playlistItems = [];
    var pageToken = null;

    do {
      var params = {
        playlistId: playlistId,
        maxResults: 50
      };

      if (pageToken) {
        params.pageToken = pageToken;
      }

      var response = YouTube.PlaylistItems.list('snippet,contentDetails', params);

      if (!response.items || response.items.length === 0) {
        break;
      }

      for (var i = 0; i < response.items.length; i++) {
        playlistItems.push(response.items[i]);
      }

      pageToken = response.nextPageToken;

    } while (pageToken);

    if (playlistItems.length === 0) {
      return [];
    }

    // Step 2: Get video details in batches (for duration, etc.)
    var videoIds = playlistItems.map(function(item) {
      return item.contentDetails.videoId;
    });

    var detailsMap = fetchVideoDetails(videoIds);

    // Step 3: Build final video objects
    var videos = playlistItems.map(function(item) {
      var videoId = item.contentDetails.videoId;
      return buildVideoObject(item, detailsMap[videoId]);
    });

    return videos;
  }

  /**
   * Fetch video details in batches
   * @param {Array} videoIds - Array of video IDs
   * @returns {Object} Map of videoId to details
   */
  function fetchVideoDetails(videoIds) {
    var detailsMap = {};
    var batchSize = 50; // YouTube API limit

    for (var i = 0; i < videoIds.length; i += batchSize) {
      var batch = videoIds.slice(i, i + batchSize);

      try {
        var response = YouTube.Videos.list('contentDetails,status', {
          id: batch.join(',')
        });

        if (response.items) {
          for (var j = 0; j < response.items.length; j++) {
            var video = response.items[j];
            var durationSeconds = parseDuration(video.contentDetails.duration);

            detailsMap[video.id] = {
              durationSeconds: durationSeconds,
              durationFormatted: formatDuration(durationSeconds),
              privacyStatus: video.status.privacyStatus,
              definition: video.contentDetails.definition
            };
          }
        }

      } catch (error) {
        // Silently continue with next batch
      }
    }

    return detailsMap;
  }

  /**
   * Build a standardized video object
   * @param {Object} item - Playlist item from API
   * @param {Object} details - Video details (duration, etc.)
   * @returns {Object} Standardized video object
   */
  function buildVideoObject(item, details) {
    var snippet = item.snippet;
    var videoId = item.contentDetails.videoId;

    var video = {
      videoId: videoId,
      title: snippet.title,
      description: snippet.description || '',
      publishedAt: snippet.publishedAt,
      channelTitle: snippet.channelTitle,
      thumbnailUrl: getBestThumbnail(snippet.thumbnails),
      position: snippet.position
    };

    if (details) {
      video.durationSeconds = details.durationSeconds;
      video.durationFormatted = details.durationFormatted;
      video.privacyStatus = details.privacyStatus;
      video.definition = details.definition;
    }

    return video;
  }

  /**
   * Get best available thumbnail URL
   * @param {Object} thumbnails - Thumbnails object from API
   * @returns {string} Best thumbnail URL
   */
  function getBestThumbnail(thumbnails) {
    if (!thumbnails) return '';
    return (thumbnails.maxres && thumbnails.maxres.url) ||
           (thumbnails.high && thumbnails.high.url) ||
           (thumbnails.medium && thumbnails.medium.url) ||
           (thumbnails.standard && thumbnails.standard.url) ||
           (thumbnails['default'] && thumbnails['default'].url) ||
           '';
  }

  /**
   * Parse ISO 8601 duration to seconds
   * @param {string} isoDuration - Duration like "PT1H30M45S"
   * @returns {number} Duration in seconds
   */
  function parseDuration(isoDuration) {
    if (!isoDuration) return 0;

    var match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;

    var hours = parseInt(match[1] || 0, 10);
    var minutes = parseInt(match[2] || 0, 10);
    var seconds = parseInt(match[3] || 0, 10);

    return hours * 3600 + minutes * 60 + seconds;
  }

  /**
   * Format seconds to human-readable duration
   * @param {number} totalSeconds - Duration in seconds
   * @returns {string} Formatted duration (e.g., "1:30:45")
   */
  function formatDuration(totalSeconds) {
    var hours = Math.floor(totalSeconds / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;

    var pad = function(n) { return n < 10 ? '0' + n : String(n); };

    if (hours > 0) {
      return hours + ':' + pad(minutes) + ':' + pad(seconds);
    }
    return minutes + ':' + pad(seconds);
  }

  // Public API
  return {
    getPlaylistInfo: getPlaylistInfo,
    getPlaylistVideosWithDetails: getPlaylistVideosWithDetails,
    parseDuration: parseDuration,
    formatDuration: formatDuration
  };

})();


// ============================================================================
// TEST FUNCTIONS
// ============================================================================

/**
 * Test: Verify YouTube API connection
 */
function testYouTubeConnection() {
  initConfig();

  var languages = getConfiguredLanguages();

  if (languages.length === 0) {
    Logger.log('No playlists configured. Add entries to Playlists sheet.');
    return;
  }

  Logger.log('Testing YouTube Advanced API connection...');
  Logger.log('');

  for (var i = 0; i < languages.length; i++) {
    var lang = languages[i];
    var playlistId = getPlaylistForLanguage(lang);

    Logger.log('Language: ' + lang);
    Logger.log('Playlist ID: ' + playlistId);

    var info = YouTubeClient.getPlaylistInfo(playlistId);

    if (info) {
      Logger.log('  Title: ' + info.title);
      Logger.log('  Videos: ' + info.videoCount);
      Logger.log('  Status: OK');
    } else {
      Logger.log('  Status: FAILED - Could not access playlist');
    }
    Logger.log('');
  }
}

/**
 * Test: Fetch videos from first configured playlist
 */
function testFetchPlaylistVideos() {
  initConfig();

  var languages = getConfiguredLanguages();

  if (languages.length === 0) {
    Logger.log('No playlists configured');
    return;
  }

  var lang = languages[0];
  var playlistId = getPlaylistForLanguage(lang);

  Logger.log('Testing video fetch for: ' + lang + ' (' + playlistId + ')');
  Logger.log('');

  var videos = YouTubeClient.getPlaylistVideosWithDetails(playlistId);

  Logger.log('');
  Logger.log('Found ' + videos.length + ' videos:');
  Logger.log('');

  var showCount = Math.min(videos.length, 5);
  for (var i = 0; i < showCount; i++) {
    var video = videos[i];
    Logger.log((i + 1) + '. ' + video.title);
    Logger.log('   ID: ' + video.videoId);
    Logger.log('   Duration: ' + (video.durationFormatted || 'N/A'));
    Logger.log('   Quality: ' + (video.definition || 'N/A'));
    Logger.log('');
  }

  if (videos.length > 5) {
    Logger.log('... and ' + (videos.length - 5) + ' more videos');
  }
}

/**
 * Test: Duration parsing
 */
function testDurationParsing() {
  var testCases = ['PT30S', 'PT5M', 'PT5M30S', 'PT1H', 'PT1H30M', 'PT1H30M45S'];

  Logger.log('Duration parsing test:');

  for (var i = 0; i < testCases.length; i++) {
    var iso = testCases[i];
    var seconds = YouTubeClient.parseDuration(iso);
    var formatted = YouTubeClient.formatDuration(seconds);
    Logger.log('  ' + iso + ' -> ' + seconds + 's -> ' + formatted);
  }
}
