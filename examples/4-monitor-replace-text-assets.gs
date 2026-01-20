/**
 * EXAMPLE SCRIPT: Monitor and Replace LOW Performing Text Assets
 *
 * Description:
 * Monitors text asset performance (headlines/descriptions) in App campaigns
 * and replaces LOW performing assets with new variations.
 *
 * Use Case:
 * Mapy.com has App campaigns with multiple text assets. Need to automatically
 * identify LOW performers and replace them with fresh variations while keeping
 * GOOD/BEST performers.
 *
 * Frequency: Weekly
 * Platform: Google Ads Scripts
 *
 * Features:
 * - Performance monitoring using performance_label (LOW/GOOD/BEST)
 * - Automatic text replacement
 * - Respects min/max asset limits
 * - DRY_RUN mode for safe testing
 *
 * IMPORTANT Notes:
 * - Text assets use { text: 'content' } format
 * - Image/video assets use { asset: 'resource-name' } format
 * - Must include ALL existing assets when updating (arrays are replaced, not appended)
 * - Use correct updateMask for each asset type
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

var CONFIG = {
  // Google Ads account settings
  GOOGLE_ADS: {
    CUSTOMER_ID: '1234567890',  // Without dashes
    CAMPAIGN_IDS: [
      '12345678901',  // Campaign 1
      '12345678902'   // Campaign 2
    ]
  },

  // Performance criteria
  PERFORMANCE: {
    MIN_IMPRESSIONS: 1000,         // Minimum impressions to evaluate
    REPLACE_PERFORMANCE_LABEL: 'LOW',  // Replace assets with this label
    KEEP_LABELS: ['GOOD', 'BEST']      // Keep assets with these labels
  },

  // Asset limits (Google Ads requirements)
  LIMITS: {
    MIN_HEADLINES: 2,
    MAX_HEADLINES: 5,
    MIN_DESCRIPTIONS: 1,
    MAX_DESCRIPTIONS: 5,
    HEADLINE_MAX_CHARS: 30,
    DESCRIPTION_MAX_CHARS: 90
  },

  // Replacement text variations
  REPLACEMENTS: {
    headlines: [
      'Find Local Spots Fast',
      'Navigate Any City',
      'Discover Hidden Gems',
      'Get There Easily',
      'Explore Smart Routes'
    ],
    descriptions: [
      'Turn-by-turn navigation for any destination',
      'Real-time traffic updates and route optimization',
      'Discover local businesses and attractions nearby'
    ]
  },

  // Script behavior
  DRY_RUN: true  // Set false to actually update ads
};

// ============================================================================
// GOOGLE ADS QUERY FUNCTIONS
// ============================================================================

/**
 * Get all App campaign ads with text asset performance
 *
 * Returns asset-level performance data including:
 * - performance_label (LOW/GOOD/BEST/UNRATED/LEARNING)
 * - Impressions, clicks, conversions
 *
 * @param {String} campaignId - Campaign ID
 * @returns {Array} Array of ad objects with asset performance
 */
function getAdTextAssetPerformance(campaignId) {
  Logger.log('  Querying campaign ' + campaignId + '...');

  var ads = {};

  // Query text asset performance
  // IMPORTANT: Must include campaign.advertising_channel_sub_type in SELECT
  // when using it in WHERE clause
  var query =
    "SELECT " +
    "ad_group_ad.ad.id, " +
    "ad_group_ad.ad.name, " +
    "ad_group_ad.ad.app_ad.headlines, " +
    "ad_group_ad.ad.app_ad.descriptions, " +
    "ad_group_ad_asset_view.field_type, " +
    "ad_group_ad_asset_view.performance_label, " +
    "asset.text_asset.text, " +
    "metrics.impressions, " +
    "metrics.clicks, " +
    "metrics.conversions, " +
    "campaign.advertising_channel_sub_type " +
    "FROM ad_group_ad_asset_view " +
    "WHERE campaign.id = " + campaignId + " " +
    "AND campaign.advertising_channel_sub_type IN ('APP_CAMPAIGN', 'APP_CAMPAIGN_FOR_ENGAGEMENT') " +
    "AND ad_group_ad.status = 'ENABLED' " +
    "AND segments.date DURING LAST_30_DAYS";

  var result = AdsApp.search(query);

  while (result.hasNext()) {
    var row = result.next();
    var adId = row.adGroupAd.ad.id;

    // Initialize ad object
    if (!ads[adId]) {
      ads[adId] = {
        adId: adId,
        adName: row.adGroupAd.ad.name || 'Ad ' + adId,
        headlines: row.adGroupAd.ad.appAd.headlines || [],
        descriptions: row.adGroupAd.ad.appAd.descriptions || [],
        headlinePerformance: {},
        descriptionPerformance: {}
      };
    }

    // Store asset performance
    var text = row.asset.textAsset.text;
    var fieldType = row.adGroupAdAssetView.fieldType;
    var performanceLabel = row.adGroupAdAssetView.performanceLabel || 'UNRATED';
    var impressions = row.metrics.impressions || 0;

    var perfData = {
      text: text,
      performanceLabel: performanceLabel,
      impressions: impressions,
      clicks: row.metrics.clicks || 0,
      conversions: row.metrics.conversions || 0
    };

    if (fieldType === 'HEADLINE') {
      ads[adId].headlinePerformance[text] = perfData;
    } else if (fieldType === 'DESCRIPTION') {
      ads[adId].descriptionPerformance[text] = perfData;
    }
  }

  return Object.keys(ads).map(function(key) { return ads[key]; });
}

// ============================================================================
// ANALYSIS FUNCTIONS
// ============================================================================

/**
 * Identify LOW performing text assets that should be replaced
 *
 * @param {Object} ad - Ad object with performance data
 * @returns {Object} { lowHeadlines: [], lowDescriptions: [] }
 */
function identifyLowPerformers(ad) {
  var lowHeadlines = [];
  var lowDescriptions = [];

  // Check headlines
  for (var i = 0; i < ad.headlines.length; i++) {
    var headline = ad.headlines[i].text;
    var perf = ad.headlinePerformance[headline];

    if (perf &&
        perf.impressions >= CONFIG.PERFORMANCE.MIN_IMPRESSIONS &&
        perf.performanceLabel === CONFIG.PERFORMANCE.REPLACE_PERFORMANCE_LABEL) {
      lowHeadlines.push(headline);
    }
  }

  // Check descriptions
  for (var i = 0; i < ad.descriptions.length; i++) {
    var description = ad.descriptions[i].text;
    var perf = ad.descriptionPerformance[description];

    if (perf &&
        perf.impressions >= CONFIG.PERFORMANCE.MIN_IMPRESSIONS &&
        perf.performanceLabel === CONFIG.PERFORMANCE.REPLACE_PERFORMANCE_LABEL) {
      lowDescriptions.push(description);
    }
  }

  return {
    lowHeadlines: lowHeadlines,
    lowDescriptions: lowDescriptions
  };
}

/**
 * Generate replacement text assets
 * Ensures no duplicates and respects character limits
 *
 * @param {Array} existingTexts - Current text assets
 * @param {Array} replacementPool - Available replacements
 * @param {Number} count - How many to generate
 * @param {Number} maxChars - Character limit
 * @returns {Array} New text assets
 */
function generateReplacements(existingTexts, replacementPool, count, maxChars) {
  var replacements = [];
  var used = {};

  // Mark existing texts as used
  for (var i = 0; i < existingTexts.length; i++) {
    used[existingTexts[i]] = true;
  }

  // Pick replacements
  for (var i = 0; i < replacementPool.length && replacements.length < count; i++) {
    var text = replacementPool[i];

    // Check if not already used and within character limit
    if (!used[text] && text.length <= maxChars) {
      replacements.push(text);
      used[text] = true;
    }
  }

  return replacements;
}

// ============================================================================
// MUTATION FUNCTIONS
// ============================================================================

/**
 * Replace LOW performing text assets in an ad
 *
 * IMPORTANT:
 * - Text assets use { text: 'content' } format (not { asset: 'id' })
 * - Must update ALL assets at once (array replacement, not append)
 * - Must use correct updateMask for each field type
 *
 * @param {String} adResourceName - Ad resource name
 * @param {Array} newHeadlines - New headline array
 * @param {Array} newDescriptions - New description array
 * @returns {Object} Mutation result
 */
function replaceTextAssets(adResourceName, newHeadlines, newDescriptions) {
  if (CONFIG.DRY_RUN) {
    Logger.log('    [DRY RUN] Would replace text assets');
    return { dryRun: true };
  }

  var payload = {
    adOperation: {
      update: {
        resourceName: adResourceName,
        appAd: {
          headlines: newHeadlines.map(function(text) {
            return { text: text };
          }),
          descriptions: newDescriptions.map(function(text) {
            return { text: text };
          })
        }
      },
      updateMask: 'app_ad.headlines,app_ad.descriptions'
    }
  };

  try {
    var result = AdsApp.mutate(payload);

    // Check for errors
    if (!result.isSuccessful()) {
      var errors = [];
      if (result.sc && result.sc.Ia && result.sc.Ia.errors) {
        errors = result.sc.Ia.errors.map(function(err) {
          return err.message;
        });
      }
      throw new Error('Mutation failed: ' + errors.join(', '));
    }

    return result;

  } catch (e) {
    throw new Error('Update failed: ' + e.message);
  }
}

// ============================================================================
// MAIN LOGIC
// ============================================================================

function main() {
  Logger.log('========================================');
  Logger.log('=== Monitor and Replace Text Assets ===');
  Logger.log('========================================');
  Logger.log('');

  if (CONFIG.DRY_RUN) {
    Logger.log('⚠ DRY RUN MODE - No changes will be made');
    Logger.log('');
  }

  var totalAdsAnalyzed = 0;
  var totalAdsUpdated = 0;
  var totalLowHeadlines = 0;
  var totalLowDescriptions = 0;

  // Process each campaign
  for (var c = 0; c < CONFIG.GOOGLE_ADS.CAMPAIGN_IDS.length; c++) {
    var campaignId = CONFIG.GOOGLE_ADS.CAMPAIGN_IDS[c];

    Logger.log('[Campaign ' + (c+1) + '/' + CONFIG.GOOGLE_ADS.CAMPAIGN_IDS.length + '] ID: ' + campaignId);
    Logger.log('');

    // Get ad performance data
    var ads = getAdTextAssetPerformance(campaignId);
    Logger.log('Found ' + ads.length + ' ads');
    Logger.log('');

    // Analyze each ad
    for (var i = 0; i < ads.length; i++) {
      var ad = ads[i];

      Logger.log('[Ad ' + (i+1) + '/' + ads.length + '] ' + ad.adName);

      // Identify low performers
      var lowPerformers = identifyLowPerformers(ad);

      if (lowPerformers.lowHeadlines.length === 0 && lowPerformers.lowDescriptions.length === 0) {
        Logger.log('  → No LOW performers found');
        Logger.log('');
        continue;
      }

      Logger.log('  → Found ' + lowPerformers.lowHeadlines.length + ' LOW headlines');
      Logger.log('  → Found ' + lowPerformers.lowDescriptions.length + ' LOW descriptions');

      totalLowHeadlines += lowPerformers.lowHeadlines.length;
      totalLowDescriptions += lowPerformers.lowDescriptions.length;

      // Build new headline array
      var newHeadlines = ad.headlines
        .map(function(h) { return h.text; })
        .filter(function(h) { return lowPerformers.lowHeadlines.indexOf(h) === -1; });

      var headlineReplacements = generateReplacements(
        newHeadlines,
        CONFIG.REPLACEMENTS.headlines,
        lowPerformers.lowHeadlines.length,
        CONFIG.LIMITS.HEADLINE_MAX_CHARS
      );

      newHeadlines = newHeadlines.concat(headlineReplacements);

      // Build new description array
      var newDescriptions = ad.descriptions
        .map(function(d) { return d.text; })
        .filter(function(d) { return lowPerformers.lowDescriptions.indexOf(d) === -1; });

      var descriptionReplacements = generateReplacements(
        newDescriptions,
        CONFIG.REPLACEMENTS.descriptions,
        lowPerformers.lowDescriptions.length,
        CONFIG.LIMITS.DESCRIPTION_MAX_CHARS
      );

      newDescriptions = newDescriptions.concat(descriptionReplacements);

      // Validate asset counts
      if (newHeadlines.length < CONFIG.LIMITS.MIN_HEADLINES) {
        Logger.log('  ✗ Cannot update: would have < ' + CONFIG.LIMITS.MIN_HEADLINES + ' headlines');
        Logger.log('');
        continue;
      }

      if (newDescriptions.length < CONFIG.LIMITS.MIN_DESCRIPTIONS) {
        Logger.log('  ✗ Cannot update: would have < ' + CONFIG.LIMITS.MIN_DESCRIPTIONS + ' descriptions');
        Logger.log('');
        continue;
      }

      // Replace text assets
      try {
        var adResourceName = 'customers/' + CONFIG.GOOGLE_ADS.CUSTOMER_ID + '/ads/' + ad.adId;

        replaceTextAssets(adResourceName, newHeadlines, newDescriptions);

        if (!CONFIG.DRY_RUN) {
          Logger.log('  ✓ Updated successfully');
        } else {
          Logger.log('  [DRY RUN] New headlines: ' + newHeadlines.join(', '));
          Logger.log('  [DRY RUN] New descriptions: ' + newDescriptions.join(', '));
        }

        totalAdsUpdated++;

      } catch (e) {
        Logger.log('  ✗ Update failed: ' + e.message);
      }

      Logger.log('');
      totalAdsAnalyzed++;
    }
  }

  // Summary
  Logger.log('========================================');
  Logger.log('=== MONITORING COMPLETE ===');
  Logger.log('========================================');
  Logger.log('Ads analyzed: ' + totalAdsAnalyzed);
  Logger.log('Ads updated: ' + totalAdsUpdated);
  Logger.log('LOW headlines found: ' + totalLowHeadlines);
  Logger.log('LOW descriptions found: ' + totalLowDescriptions);
  Logger.log('');

  if (CONFIG.DRY_RUN) {
    Logger.log('Set CONFIG.DRY_RUN = false to actually update ads');
  }
}
