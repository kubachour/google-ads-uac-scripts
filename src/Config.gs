/**
 * Configuration Constants
 * App Campaign Asset Automation for Abrello
 *
 * PLATFORM: Google Ads Scripts
 * Config is loaded from a Google Sheet (no PropertiesService available)
 */

// ============================================================================
// CONFIGURATION SHEET SETUP
// ============================================================================
// Create a Google Sheet with two sheets:
//   1. "Config" - Key-value pairs (Column A: Key, Column B: Value)
//   2. "Playlists" - Language playlists (Column A: Language, Column B: Playlist ID)
//
// Config sheet should have rows like:
//   NOTION_API_KEY | secret_...
//   SLACK_WEBHOOK_URL | https://hooks.slack.com/...
//   CLAUDE_API_KEY | sk-ant-...
//   etc.
//
// NOTE: YouTube API key is NOT needed - uses Advanced API with automatic auth
// ============================================================================

/**
 * URL of the configuration spreadsheet
 * Set to null to use hardcoded config (for testing)
 */
var CONFIG_SPREADSHEET_URL = null; // Using hardcoded playlists

/**
 * OUTPUT SPREADSHEET - where video data will be written
 * Can be same as CONFIG_SPREADSHEET_URL or a different sheet
 */
// TODO: Replace with your actual spreadsheet URL
var OUTPUT_SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/YOUR_SPREADSHEET_ID_HERE/edit';

/**
 * HARDCODED PLAYLISTS FOR TESTING
 * TODO: Replace these placeholder IDs with your actual YouTube playlist IDs
 * Format: 'language_code': 'PLxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
 */
var HARDCODED_PLAYLISTS = {
  'en': 'PLxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',  // TODO: Replace with your English playlist ID
  'de': 'PLyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy',  // TODO: Replace with your German playlist ID
};

/**
 * Runtime configuration object - populated by initConfig()
 */
var CONFIG = {
  // Will be populated from sheet OR hardcoded values
  secrets: {},
  playlists: {},

  // ============================================================================
  // GOOGLE ADS SETTINGS
  // ============================================================================
  // TODO: Replace all IDs below with your actual Google Ads account values
  GOOGLE_ADS: {
    CUSTOMER_ID: '1234567890',  // TODO: Replace with your Google Ads Customer ID (no dashes)
    CAMPAIGNS: [
      {
        id: '12345678901',           // TODO: Replace with your Campaign ID
        adGroupId: '123456789012',   // TODO: Replace with your Ad Group ID
        name: 'Test Campaign',
        geo: 'US',
        language: 'EN'
      }
      // Add more campaigns as needed
    ]
  },

  // ============================================================================
  // SHEETS REPOSITORY
  // ============================================================================
  SHEETS: {
    // Main spreadsheet for all automation data
    SPREADSHEET_ID: null,  // Set this to your spreadsheet ID

    // Sheet names
    CHANGE_REQUESTS: 'ChangeRequests',
    ASSET_REGISTRY: 'AssetRegistry',
    PERFORMANCE_SNAPSHOTS: 'PerformanceSnapshots',
    TEXT_EXAMPLES: 'TextExamples',
    CAMPAIGN_CONFIG: 'CampaignConfig',
    PROCESSED_FILES: 'ProcessedFiles'
  },

  // ============================================================================
  // DRIVE SOURCE (Image Discovery)
  // ============================================================================
  DRIVE: {
    // Parent folder containing campaign subfolders
    PARENT_FOLDER_ID: null,  // Set this to your Drive folder ID

    // How to match folder names to campaigns
    // Options: 'FOLDER_NAME' (folder name = campaign name) or 'SHEET_LOOKUP'
    FOLDER_MATCHING: 'FOLDER_NAME'
  },

  // ============================================================================
  // DECISION ENGINE RULES
  // ============================================================================
  DECISION: {
    // Auto-remove LOW performers after these thresholds
    AUTO_REMOVE_MIN_DAYS: 7,
    AUTO_REMOVE_MIN_IMPRESSIONS: 1000,

    // Auto-add replacement when removing LOW
    AUTO_ADD_REPLACEMENT: true,

    // Performance labels to skip (don't touch these)
    SKIP_LABELS: ['PENDING', 'LEARNING', 'BEST'],

    // Labels that trigger auto-removal
    AUTO_REMOVE_LABELS: ['LOW'],

    // Labels that require manual approval for replacement
    MANUAL_APPROVAL_LABELS: ['GOOD']
  },

  // ============================================================================
  // SLACK NOTIFICATIONS
  // ============================================================================
  SLACK: {
    WEBHOOK_URL: null,  // Set this to your Slack webhook URL
    ENABLED: false
  },

  // ============================================================================
  // STATIC CONFIGURATION (Google Ads constraints)
  // ============================================================================
  LIMITS: {
    MAX_HEADLINES: 5,
    MIN_HEADLINES: 2,
    MAX_DESCRIPTIONS: 5,
    MIN_DESCRIPTIONS: 1,
    MAX_IMAGES: 20,
    MIN_IMAGES: 1,
    MAX_VIDEOS: 20,
    MIN_VIDEOS: 0,
    HEADLINE_MAX_CHARS: 30,
    DESCRIPTION_MAX_CHARS: 90
  },

  // Analysis Settings
  ANALYSIS: {
    PERFORMANCE_WINDOW_DAYS: 7,
    MIN_IMPRESSIONS_FOR_DECISION: 1000,
    SNAPSHOT_RETENTION_DAYS: 90
  },

  // Text Generation
  TEXT_GEN: {
    GOOD_EXAMPLES_COUNT: 5,
    BAD_EXAMPLES_COUNT: 3,
    VARIATIONS_TO_GENERATE: 5
  }
};


/**
 * Initialize configuration
 * Uses hardcoded values if CONFIG_SPREADSHEET_URL is null, otherwise loads from Sheet
 */
function initConfig() {
  // Use hardcoded config for testing
  if (!CONFIG_SPREADSHEET_URL) {
    Logger.log('Using hardcoded configuration (testing mode)');
    CONFIG.playlists = HARDCODED_PLAYLISTS;
    CONFIG.secrets = {}; // No secrets needed for YouTube (uses Advanced API)
    Logger.log('  Playlists loaded: ' + Object.keys(CONFIG.playlists).length);
    return;
  }

  // Load from spreadsheet
  Logger.log('Loading configuration from spreadsheet...');

  try {
    var spreadsheet = SpreadsheetApp.openByUrl(CONFIG_SPREADSHEET_URL);

    // Load key-value config
    CONFIG.secrets = loadConfigSheet(spreadsheet);

    // Load language-based playlists
    CONFIG.playlists = loadPlaylistsSheet(spreadsheet);

    Logger.log('Configuration loaded successfully');
    Logger.log('  Secrets loaded: ' + Object.keys(CONFIG.secrets).length);
    Logger.log('  Playlists loaded: ' + Object.keys(CONFIG.playlists).length);

  } catch (error) {
    throw new Error('Failed to load configuration: ' + error.message);
  }
}


/**
 * Load key-value pairs from Config sheet
 * @param {Spreadsheet} spreadsheet - The config spreadsheet
 * @returns {Object} Key-value config object
 */
function loadConfigSheet(spreadsheet) {
  var sheet = spreadsheet.getSheetByName('Config');

  if (!sheet) {
    throw new Error('Config sheet not found in spreadsheet');
  }

  var data = sheet.getDataRange().getValues();
  var config = {};

  // Skip header row if present
  var startRow = (data[0][0] === 'Key' || data[0][0] === 'key') ? 1 : 0;

  for (var i = startRow; i < data.length; i++) {
    var key = String(data[i][0]).trim();
    var value = String(data[i][1]).trim();

    if (key && value) {
      config[key] = value;
    }
  }

  return config;
}


/**
 * Load language-to-playlist mapping from Playlists sheet
 * @param {Spreadsheet} spreadsheet - The config spreadsheet
 * @returns {Object} Language code to playlist ID mapping
 */
function loadPlaylistsSheet(spreadsheet) {
  var sheet = spreadsheet.getSheetByName('Playlists');

  if (!sheet) {
    Logger.log('Warning: Playlists sheet not found, using empty playlist config');
    return {};
  }

  var data = sheet.getDataRange().getValues();
  var playlists = {};

  // Skip header row if present
  var startRow = (data[0][0] === 'Language' || data[0][0] === 'language') ? 1 : 0;

  for (var i = startRow; i < data.length; i++) {
    var language = String(data[i][0]).trim().toLowerCase();
    var playlistId = String(data[i][1]).trim();

    if (language && playlistId) {
      playlists[language] = playlistId;
    }
  }

  return playlists;
}


/**
 * Get a secret/config value
 * @param {string} key - The config key
 * @returns {string|null} The value or null if not found
 */
function getSecret(key) {
  return CONFIG.secrets[key] || null;
}


/**
 * Get playlist ID for a specific language
 * @param {string} language - Language code (e.g., 'en', 'es', 'de')
 * @returns {string|null} Playlist ID or null if not found
 */
function getPlaylistForLanguage(language) {
  return CONFIG.playlists[language.toLowerCase()] || null;
}


/**
 * Get all configured languages
 * @returns {Array} Array of language codes
 */
function getConfiguredLanguages() {
  return Object.keys(CONFIG.playlists);
}


/**
 * Get output spreadsheet for writing data
 * @returns {Spreadsheet|null} Spreadsheet object or null
 */
function getOutputSpreadsheet() {
  if (!OUTPUT_SPREADSHEET_URL) {
    return null;
  }
  return SpreadsheetApp.openByUrl(OUTPUT_SPREADSHEET_URL);
}


/**
 * Validate that required config keys are present
 * @param {Array} requiredKeys - Array of required key names
 * @returns {Object} {isValid: boolean, missing: Array}
 */
function validateConfig(requiredKeys) {
  var missing = [];

  for (var i = 0; i < requiredKeys.length; i++) {
    var key = requiredKeys[i];
    if (!CONFIG.secrets[key]) {
      missing.push(key);
    }
  }

  return {
    isValid: missing.length === 0,
    missing: missing
  };
}


// ============================================================================
// SETUP & DEBUG FUNCTIONS
// ============================================================================

/**
 * Print setup instructions
 */
function showSetupInstructions() {
  Logger.log('=== Configuration Setup Instructions ===');
  Logger.log('');
  Logger.log('1. Create a Google Sheet with two sheets:');
  Logger.log('');
  Logger.log('   Sheet 1: "Config" (key-value pairs)');
  Logger.log('   +-----------------------+---------------------------+');
  Logger.log('   | Key                   | Value                     |');
  Logger.log('   +-----------------------+---------------------------+');
  Logger.log('   | NOTION_API_KEY        | secret_...                |');
  Logger.log('   | SLACK_WEBHOOK_URL     | https://hooks.slack...    |');
  Logger.log('   | CLAUDE_API_KEY        | sk-ant-...                |');
  Logger.log('   +-----------------------+---------------------------+');
  Logger.log('');
  Logger.log('   Sheet 2: "Playlists" (language to playlist mapping)');
  Logger.log('   +-----------+---------------------------+');
  Logger.log('   | Language  | Playlist ID               |');
  Logger.log('   +-----------+---------------------------+');
  Logger.log('   | en        | PLxxxxxxxxxxxxxxxx        |');
  Logger.log('   | es        | PLyyyyyyyyyyyyyyyy        |');
  Logger.log('   | de        | PLzzzzzzzzzzzzzzzz        |');
  Logger.log('   +-----------+---------------------------+');
  Logger.log('');
  Logger.log('2. Update CONFIG_SPREADSHEET_URL in this script');
  Logger.log('');
  Logger.log('3. Share the spreadsheet with the Google Ads account');
  Logger.log('');
  Logger.log('4. Enable YouTube Advanced API:');
  Logger.log('   - In script editor, click "Advanced APIs"');
  Logger.log('   - Check "YouTube"');
  Logger.log('   - Enable in linked Google Cloud Console');
  Logger.log('');
}


/**
 * Test configuration loading
 */
function testConfigLoading() {
  initConfig();

  Logger.log('');
  Logger.log('=== Configuration Test Results ===');
  Logger.log('');

  // Show secrets (masked)
  Logger.log('Secrets:');
  for (var key in CONFIG.secrets) {
    var value = CONFIG.secrets[key];
    var masked = value.length > 8
      ? value.substring(0, 4) + '...' + value.substring(value.length - 4)
      : '****';
    Logger.log('  ' + key + ': ' + masked);
  }

  Logger.log('');
  Logger.log('Playlists:');
  for (var lang in CONFIG.playlists) {
    Logger.log('  ' + lang + ': ' + CONFIG.playlists[lang]);
  }

  // Check playlists (YouTube API key not needed - uses Advanced API)
  Logger.log('');

  var languages = getConfiguredLanguages();
  if (languages.length > 0) {
    Logger.log('Configured languages: ' + languages.join(', '));
  } else {
    Logger.log('Warning: No playlists configured');
  }
}
