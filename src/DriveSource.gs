/**
 * DriveSource Module
 * Fetch images from Google Drive folders for asset discovery
 *
 * PLATFORM: Google Ads Scripts
 * USED BY: Main.gs, ChangeRequestManager.gs
 * DEPENDS ON: Config.gs, SheetsRepository.gs
 */

var DriveSource = (function() {

  // ============================================================================
  // FOLDER DISCOVERY
  // ============================================================================

  /**
   * Discover all campaign folders and their images
   * @returns {Array} Array of {folderId, folderName, campaignId, files}
   */
  function discoverAllFolders() {
    var parentFolderId = CONFIG.DRIVE.PARENT_FOLDER_ID;

    if (!parentFolderId) {
      Logger.log('No parent folder configured. Set CONFIG.DRIVE.PARENT_FOLDER_ID');
      return [];
    }

    var discovered = [];

    try {
      var parentFolder = DriveApp.getFolderById(parentFolderId);
      var subfolders = parentFolder.getFolders();

      Logger.log('Scanning parent folder: ' + parentFolder.getName());

      while (subfolders.hasNext()) {
        var folder = subfolders.next();
        var folderName = folder.getName();

        // Match folder to campaign
        var campaignId = matchFolderToCampaign(folderName);

        if (campaignId) {
          var files = getImagesFromFolder(folder);
          discovered.push({
            folderId: folder.getId(),
            folderName: folderName,
            campaignId: campaignId,
            files: files
          });
          Logger.log('  Found: ' + folderName + ' -> Campaign ' + campaignId + ' (' + files.length + ' images)');
        } else {
          Logger.log('  Skipping: ' + folderName + ' (no matching campaign)');
        }
      }

    } catch (e) {
      Logger.log('Error discovering folders: ' + e.message);
    }

    return discovered;
  }

  /**
   * Match folder name to campaign ID
   * @param {string} folderName - Name of the folder
   * @returns {string|null} Campaign ID or null
   */
  function matchFolderToCampaign(folderName) {
    var campaigns = CONFIG.GOOGLE_ADS.CAMPAIGNS;

    // Strategy 1: Folder name exactly matches campaign name
    for (var i = 0; i < campaigns.length; i++) {
      if (folderName === campaigns[i].name) {
        return campaigns[i].id;
      }
    }

    // Strategy 2: Folder name contains campaign ID
    for (var j = 0; j < campaigns.length; j++) {
      if (folderName.indexOf(campaigns[j].id) !== -1) {
        return campaigns[j].id;
      }
    }

    // Strategy 3: Folder name matches geo-language pattern
    for (var k = 0; k < campaigns.length; k++) {
      var pattern = campaigns[k].geo + '-' + campaigns[k].language;
      if (folderName.toUpperCase().indexOf(pattern.toUpperCase()) !== -1) {
        return campaigns[k].id;
      }
    }

    // Strategy 4: Sheet lookup (if configured)
    if (CONFIG.DRIVE.FOLDER_MATCHING === 'SHEET_LOOKUP') {
      return matchFolderFromSheet(folderName);
    }

    return null;
  }

  /**
   * Match folder from CampaignConfig sheet
   * @param {string} folderName - Name of the folder
   * @returns {string|null} Campaign ID or null
   */
  function matchFolderFromSheet(folderName) {
    try {
      var rows = SheetsRepository.getRowsWhere(CONFIG.SHEETS.CAMPAIGN_CONFIG, 'folder_name', folderName);
      if (rows.length > 0) {
        return rows[0].data.campaign_id;
      }
    } catch (e) {
      // Sheet might not exist yet
    }
    return null;
  }

  // ============================================================================
  // FILE RETRIEVAL
  // ============================================================================

  /**
   * Get all image files from a folder
   * @param {Folder} folder - Drive folder object
   * @returns {Array} Array of file info objects
   */
  function getImagesFromFolder(folder) {
    var files = folder.getFiles();
    var images = [];

    while (files.hasNext()) {
      var file = files.next();
      var mimeType = file.getMimeType();

      // Only include image files
      if (mimeType.indexOf('image/') === 0) {
        images.push({
          fileId: file.getId(),
          fileName: file.getName(),
          mimeType: mimeType,
          size: file.getSize(),
          created: file.getDateCreated(),
          folderId: folder.getId(),
          folderName: folder.getName()
        });
      }
    }

    return images;
  }

  /**
   * Get images from a specific folder by ID
   * @param {string} folderId - Drive folder ID
   * @returns {Array} Array of file info objects
   */
  function getFolderImages(folderId) {
    try {
      var folder = DriveApp.getFolderById(folderId);
      return getImagesFromFolder(folder);
    } catch (e) {
      Logger.log('Error getting folder: ' + e.message);
      return [];
    }
  }

  /**
   * Get image as base64 encoded data
   * @param {string} fileId - Drive file ID
   * @returns {Object} {success, data, mimeType, error}
   */
  function getImageAsBase64(fileId) {
    try {
      var file = DriveApp.getFileById(fileId);
      var blob = file.getBlob();
      var bytes = blob.getBytes();
      var base64Data = Utilities.base64Encode(bytes);

      return {
        success: true,
        data: base64Data,
        mimeType: blob.getContentType(),
        fileName: file.getName(),
        size: bytes.length
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: e.message
      };
    }
  }

  // ============================================================================
  // NEW FILES DISCOVERY (Deduplication)
  // ============================================================================

  /**
   * Get only new (unprocessed) files from all folders
   * @returns {Array} Array of new file info objects
   */
  function getNewFiles() {
    var allFolders = discoverAllFolders();
    var processedIds = SheetsRepository.getProcessedFileIds();
    var newFiles = [];

    for (var i = 0; i < allFolders.length; i++) {
      var folder = allFolders[i];

      for (var j = 0; j < folder.files.length; j++) {
        var file = folder.files[j];

        if (!processedIds[file.fileId]) {
          file.campaignId = folder.campaignId;
          newFiles.push(file);
        }
      }
    }

    Logger.log('Found ' + newFiles.length + ' new (unprocessed) files');
    return newFiles;
  }

  /**
   * Get new files for a specific campaign
   * @param {string} campaignId - Campaign ID
   * @returns {Array} Array of new file info objects
   */
  function getNewFilesForCampaign(campaignId) {
    var allNew = getNewFiles();
    return allNew.filter(function(f) {
      return f.campaignId === campaignId;
    });
  }

  // ============================================================================
  // ASPECT RATIO FILTERING
  // ============================================================================

  /**
   * Get image dimensions
   * @param {string} fileId - Drive file ID
   * @returns {Object} {width, height, aspectRatio}
   */
  function getImageDimensions(fileId) {
    try {
      var file = DriveApp.getFileById(fileId);
      var blob = file.getBlob();

      // For PNG files, we can read dimensions from header
      var bytes = blob.getBytes();

      if (blob.getContentType() === 'image/png' && bytes.length > 24) {
        // PNG dimensions are at bytes 16-23
        var width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
        var height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];

        return {
          width: width,
          height: height,
          aspectRatio: width / height
        };
      }

      // For other formats, we'd need to use a different approach
      // For now, return null to indicate we couldn't determine
      return null;

    } catch (e) {
      return null;
    }
  }

  /**
   * Filter files by aspect ratio
   * @param {Array} files - Array of file objects
   * @param {string} ratio - Target ratio ('16:9', '9:16', '1:1', etc.)
   * @returns {Array} Filtered files
   */
  function filterByAspectRatio(files, ratio) {
    var targetRatio = parseAspectRatio(ratio);
    if (!targetRatio) return files;

    var tolerance = 0.05;  // 5% tolerance

    return files.filter(function(file) {
      var dims = getImageDimensions(file.fileId);
      if (!dims) return true;  // Include if we can't determine

      var diff = Math.abs(dims.aspectRatio - targetRatio);
      return diff <= (targetRatio * tolerance);
    });
  }

  /**
   * Parse aspect ratio string to decimal
   * @param {string} ratio - Ratio string ('16:9', '1.91:1', etc.)
   * @returns {number} Decimal ratio
   */
  function parseAspectRatio(ratio) {
    var parts = ratio.split(/[:/x]/);
    if (parts.length !== 2) return null;

    var w = parseFloat(parts[0]);
    var h = parseFloat(parts[1]);

    if (isNaN(w) || isNaN(h) || h === 0) return null;
    return w / h;
  }

  // ============================================================================
  // FOLDER LISTING (Debug/Utility)
  // ============================================================================

  /**
   * List files in a folder (for debugging)
   * @param {string} folderId - Drive folder ID
   */
  function listFolderFiles(folderId) {
    if (!folderId) {
      Logger.log('ERROR: Please provide a Google Drive folder ID');
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
  // PUBLIC API
  // ============================================================================

  return {
    discoverAllFolders: discoverAllFolders,
    getFolderImages: getFolderImages,
    getImageAsBase64: getImageAsBase64,
    getNewFiles: getNewFiles,
    getNewFilesForCampaign: getNewFilesForCampaign,
    filterByAspectRatio: filterByAspectRatio,
    getImageDimensions: getImageDimensions,
    listFolderFiles: listFolderFiles,
    matchFolderToCampaign: matchFolderToCampaign
  };

})();


// ============================================================================
// TEST FUNCTIONS
// ============================================================================

/**
 * Test: Discover all folders
 */
function testDiscoverFolders() {
  initConfig();

  Logger.log('=== Discovering Drive Folders ===');
  Logger.log('');

  var folders = DriveSource.discoverAllFolders();

  Logger.log('');
  Logger.log('Summary:');
  Logger.log('Total folders found: ' + folders.length);

  for (var i = 0; i < folders.length; i++) {
    var f = folders[i];
    Logger.log('  ' + f.folderName + ': ' + f.files.length + ' images');
  }
}

/**
 * Test: Get new files
 */
function testGetNewFiles() {
  initConfig();

  Logger.log('=== Finding New (Unprocessed) Files ===');
  Logger.log('');

  var newFiles = DriveSource.getNewFiles();

  Logger.log('');
  Logger.log('New files: ' + newFiles.length);

  for (var i = 0; i < Math.min(newFiles.length, 10); i++) {
    var f = newFiles[i];
    Logger.log((i + 1) + '. ' + f.fileName);
    Logger.log('   Folder: ' + f.folderName);
    Logger.log('   Campaign: ' + f.campaignId);
    Logger.log('');
  }
}

/**
 * Test: List parent folder contents
 */
function testListParentFolder() {
  initConfig();

  var parentId = CONFIG.DRIVE.PARENT_FOLDER_ID;

  if (!parentId) {
    Logger.log('No parent folder configured');
    return;
  }

  Logger.log('Listing parent folder...');

  try {
    var folder = DriveApp.getFolderById(parentId);
    Logger.log('Parent folder: ' + folder.getName());
    Logger.log('');

    // List subfolders
    var subfolders = folder.getFolders();
    var count = 0;

    while (subfolders.hasNext()) {
      var sub = subfolders.next();
      count++;
      Logger.log(count + '. [FOLDER] ' + sub.getName());
    }

    // List files in root
    var files = folder.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      count++;
      Logger.log(count + '. [FILE] ' + file.getName());
    }

    Logger.log('');
    Logger.log('Total items: ' + count);

  } catch (e) {
    Logger.log('ERROR: ' + e.message);
  }
}
