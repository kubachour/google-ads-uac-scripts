# App Campaign Asset Automation - Google Apps Script

## Setup Instructions

### 1. Create Google Apps Script Project

1. Go to [script.google.com](https://script.google.com)
2. Click "New project"
3. Rename project to "App Campaign Asset Automation"

### 2. Copy Script Files

Copy the contents of each `.gs` file into separate files in the Apps Script editor:

- `Config.gs` - Configuration and secrets management
- `YouTubeClient.gs` - YouTube API client
- `Main.gs` - Main entry points and sync logic

### 3. Update appsscript.json

1. In Apps Script editor, click the gear icon (Project Settings)
2. Check "Show 'appsscript.json' manifest file in editor"
3. Click on `appsscript.json` in the file list
4. Replace contents with the provided `appsscript.json`

### 4. Enable YouTube API

1. In Apps Script editor, click "Services" (+ icon in left panel)
2. Find "YouTube Data API v3"
3. Click "Add"
4. Make sure the identifier is set to "YouTube"

### 5. Set Script Properties

1. In Apps Script editor, click gear icon (Project Settings)
2. Scroll to "Script Properties"
3. Click "Add script property"
4. Add the following property:

| Property | Value |
|----------|-------|
| `YOUTUBE_PLAYLIST_ID` | Your YouTube playlist ID |

**How to find playlist ID:**
- Open your YouTube playlist
- URL will be like: `youtube.com/playlist?list=PLxxxxxxxxxxxxxx`
- The `PLxxxxxxxxxxxxxx` part is your playlist ID

### 6. Authorize the Script

1. In Apps Script editor, select `testGetPlaylistInfo` from the function dropdown
2. Click "Run"
3. Follow the authorization prompts
4. Grant access to YouTube

### 7. Test the Setup

Run these test functions in order:

1. `testGetPlaylistInfo` - Verifies playlist access
2. `testGetPlaylistVideos` - Lists videos in playlist
3. `testParseFilename` - Tests filename parsing logic
4. `testSyncSourceAssets` - Runs full sync (without Notion)

## File Structure

```
src/
├── appsscript.json      # Project manifest
├── Config.gs            # Configuration constants
├── YouTubeClient.gs     # YouTube API client
├── Main.gs              # Main entry points
└── README.md            # This file
```

## Usage

### Manual Run

Run `syncSourceAssets()` to manually sync videos from the YouTube playlist.

### View Logs

After running any function:
1. Click "Execution log" at the bottom of the editor
2. Or go to "Executions" in the left menu for historical logs

## Next Steps

After YouTube sync is working:

1. Add Notion integration (`NotionClient.gs`)
2. Add Source Queue management
3. Add Slack notifications
4. Set up scheduled triggers

## Troubleshooting

### "YouTube is not defined"

- Make sure YouTube Data API v3 is enabled in Services
- Check that `appsscript.json` has the YouTube service configured

### "Access denied" or "Playlist not found"

- Verify the playlist is public or unlisted (not private)
- Check that the playlist ID is correct
- Make sure you authorized the script

### "Quota exceeded"

- YouTube API has a daily quota of 10,000 units
- Each playlist item list costs ~1 unit
- Each video details request costs ~1 unit
- Wait 24 hours for quota reset

## API Quota Usage

| Operation | Cost |
|-----------|------|
| Get playlist info | 1 unit |
| List playlist items (50 per page) | 1 unit |
| Get video details (50 per batch) | 1 unit |

For a playlist with 100 videos:
- Playlist info: 1 unit
- Playlist items: 2 units (2 pages of 50)
- Video details: 2 units (2 batches of 50)
- **Total: ~5 units per sync**
