/**
 * SlackClient Module
 * Send notifications to Slack for change requests and execution results
 *
 * PLATFORM: Google Ads Scripts
 * USED BY: ChangeRequestManager.gs, Main.gs
 * DEPENDS ON: Config.gs
 */

var SlackClient = (function() {

  // ============================================================================
  // CORE SEND FUNCTION
  // ============================================================================

  /**
   * Send a message to Slack
   * @param {Object} payload - Slack message payload (text, blocks, attachments)
   * @returns {Object} {success, error}
   */
  function sendMessage(payload) {
    if (!CONFIG.SLACK.ENABLED || !CONFIG.SLACK.WEBHOOK_URL) {
      Logger.log('Slack notifications disabled or not configured');
      return { success: false, error: 'Slack not configured' };
    }

    try {
      var response = UrlFetchApp.fetch(CONFIG.SLACK.WEBHOOK_URL, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });

      var code = response.getResponseCode();
      if (code === 200) {
        return { success: true };
      } else {
        return { success: false, error: 'HTTP ' + code + ': ' + response.getContentText() };
      }

    } catch (e) {
      Logger.log('Slack error: ' + e.message);
      return { success: false, error: e.message };
    }
  }

  /**
   * Send a simple text message
   * @param {string} text - Message text
   * @returns {Object} {success, error}
   */
  function sendText(text) {
    return sendMessage({ text: text });
  }

  // ============================================================================
  // ANALYSIS NOTIFICATIONS
  // ============================================================================

  /**
   * Notify that analysis is complete
   * @param {Object} summary - {autoExecuted: [], pending: [], skipped: number}
   */
  function notifyAnalysisComplete(summary) {
    var blocks = [];

    // Header
    blocks.push({
      type: 'header',
      text: {
        type: 'plain_text',
        text: '📊 Asset Analysis Complete',
        emoji: true
      }
    });

    // Summary section
    var summaryLines = [];

    if (summary.autoExecuted && summary.autoExecuted.length > 0) {
      summaryLines.push('✅ *Auto-executed:* ' + summary.autoExecuted.length + ' changes');
    }

    if (summary.pending && summary.pending.length > 0) {
      summaryLines.push('⏳ *Pending approval:* ' + summary.pending.length + ' changes');
    }

    if (summary.skipped) {
      summaryLines.push('⏭️ *Skipped:* ' + summary.skipped + ' assets');
    }

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: summaryLines.join('\n')
      }
    });

    // Auto-executed details
    if (summary.autoExecuted && summary.autoExecuted.length > 0) {
      blocks.push({ type: 'divider' });
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Auto-executed changes:*'
        }
      });

      for (var i = 0; i < Math.min(summary.autoExecuted.length, 5); i++) {
        var change = summary.autoExecuted[i];
        var actionEmoji = change.action === 'REMOVE' ? '🗑️' : '➕';
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: actionEmoji + ' *' + change.action + '* ' + (change.currentAssetName || change.newAssetName || 'Asset') +
                  '\n_' + (change.reason || 'No reason provided') + '_'
          }
        });
      }

      if (summary.autoExecuted.length > 5) {
        blocks.push({
          type: 'context',
          elements: [{
            type: 'mrkdwn',
            text: '...and ' + (summary.autoExecuted.length - 5) + ' more'
          }]
        });
      }
    }

    // Pending details with approval reminder
    if (summary.pending && summary.pending.length > 0) {
      blocks.push({ type: 'divider' });
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Pending approval:*\nReview in the ChangeRequests sheet and set status to `APPROVED` or `REJECTED`'
        }
      });

      for (var j = 0; j < Math.min(summary.pending.length, 5); j++) {
        var pending = summary.pending[j];
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '🔄 *' + pending.action + '* ' + (pending.currentAssetName || 'Asset') +
                  ' → ' + (pending.newAssetName || 'TBD') +
                  '\n_' + (pending.reason || 'No reason provided') + '_'
          }
        });
      }

      if (summary.pending.length > 5) {
        blocks.push({
          type: 'context',
          elements: [{
            type: 'mrkdwn',
            text: '...and ' + (summary.pending.length - 5) + ' more pending changes'
          }]
        });
      }
    }

    // Sheet link (if configured)
    if (CONFIG.SHEETS.SPREADSHEET_ID) {
      blocks.push({ type: 'divider' });
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '<https://docs.google.com/spreadsheets/d/' + CONFIG.SHEETS.SPREADSHEET_ID + '|📋 Open ChangeRequests Sheet>'
        }
      });
    }

    return sendMessage({ blocks: blocks });
  }

  // ============================================================================
  // EXECUTION NOTIFICATIONS
  // ============================================================================

  /**
   * Notify that approved changes were executed
   * @param {Array} results - Array of {requestId, success, error, change}
   */
  function notifyExecutionComplete(results) {
    var blocks = [];

    var successCount = results.filter(function(r) { return r.success; }).length;
    var failCount = results.length - successCount;

    // Header
    var headerEmoji = failCount === 0 ? '✅' : (successCount > 0 ? '⚠️' : '❌');
    blocks.push({
      type: 'header',
      text: {
        type: 'plain_text',
        text: headerEmoji + ' Execution Complete',
        emoji: true
      }
    });

    // Summary
    var summaryText = '*' + successCount + '* successful';
    if (failCount > 0) {
      summaryText += ', *' + failCount + '* failed';
    }

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: summaryText
      }
    });

    // Details for failures (most important to show)
    var failures = results.filter(function(r) { return !r.success; });
    if (failures.length > 0) {
      blocks.push({ type: 'divider' });
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Failed changes:*'
        }
      });

      for (var i = 0; i < Math.min(failures.length, 5); i++) {
        var fail = failures[i];
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '❌ ' + (fail.requestId || 'Unknown') +
                  '\n_Error: ' + (fail.error || 'Unknown error') + '_'
          }
        });
      }
    }

    // Brief success summary
    var successes = results.filter(function(r) { return r.success; });
    if (successes.length > 0 && successes.length <= 3) {
      blocks.push({ type: 'divider' });
      for (var j = 0; j < successes.length; j++) {
        var succ = successes[j];
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '✅ ' + (succ.requestId || 'Change') + ' executed successfully'
          }
        });
      }
    }

    return sendMessage({ blocks: blocks });
  }

  // ============================================================================
  // ERROR NOTIFICATIONS
  // ============================================================================

  /**
   * Notify of a critical error
   * @param {string} context - Where the error occurred
   * @param {Error|string} error - The error
   */
  function notifyError(context, error) {
    var errorMessage = error instanceof Error ? error.message : String(error);
    var errorStack = error instanceof Error ? error.stack : '';

    var blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🚨 Script Error',
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Context:* ' + context + '\n*Error:* ' + errorMessage
        }
      }
    ];

    if (errorStack) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '```' + errorStack.substring(0, 500) + '```'
        }
      });
    }

    return sendMessage({ blocks: blocks });
  }

  // ============================================================================
  // SIMPLE NOTIFICATIONS
  // ============================================================================

  /**
   * Notify that no changes were needed
   */
  function notifyNoChanges() {
    return sendMessage({
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '✨ *Analysis complete* - No changes needed. All assets performing well.'
          }
        }
      ]
    });
  }

  /**
   * Notify that script is starting
   * @param {string} mode - 'analysis' or 'execution'
   */
  function notifyStart(mode) {
    var emoji = mode === 'execution' ? '⚡' : '🔍';
    var text = mode === 'execution' ? 'Executing approved changes...' : 'Starting asset analysis...';

    return sendMessage({
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: emoji + ' ' + text
          }
        }
      ]
    });
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  return {
    sendMessage: sendMessage,
    sendText: sendText,
    notifyAnalysisComplete: notifyAnalysisComplete,
    notifyExecutionComplete: notifyExecutionComplete,
    notifyError: notifyError,
    notifyNoChanges: notifyNoChanges,
    notifyStart: notifyStart
  };

})();


// ============================================================================
// TEST FUNCTIONS
// ============================================================================

/**
 * Test: Send a simple message
 */
function testSlackSimpleMessage() {
  initConfig();

  var result = SlackClient.sendText('Test message from Google Ads Scripts');
  Logger.log('Result: ' + JSON.stringify(result));
}

/**
 * Test: Analysis complete notification
 */
function testSlackAnalysisComplete() {
  initConfig();

  var summary = {
    autoExecuted: [
      { action: 'REMOVE', currentAssetName: 'OldVideo-9x16', reason: 'LOW for 14 days with 12K impressions' },
      { action: 'ADD', newAssetName: 'NewVideo-9x16', reason: 'Replacement for removed asset' }
    ],
    pending: [
      { action: 'REPLACE', currentAssetName: 'GoodVideo-16x9', newAssetName: 'BetterVideo-16x9', reason: 'GOOD for 30 days, better performer available' }
    ],
    skipped: 15
  };

  var result = SlackClient.notifyAnalysisComplete(summary);
  Logger.log('Result: ' + JSON.stringify(result));
}

/**
 * Test: Execution complete notification
 */
function testSlackExecutionComplete() {
  initConfig();

  var results = [
    { requestId: 'REQ-001', success: true, change: { action: 'REMOVE' } },
    { requestId: 'REQ-002', success: false, error: 'Asset not found', change: { action: 'ADD' } }
  ];

  var result = SlackClient.notifyExecutionComplete(results);
  Logger.log('Result: ' + JSON.stringify(result));
}

/**
 * Test: Error notification
 */
function testSlackError() {
  initConfig();

  try {
    throw new Error('Test error message');
  } catch (e) {
    var result = SlackClient.notifyError('testSlackError', e);
    Logger.log('Result: ' + JSON.stringify(result));
  }
}
