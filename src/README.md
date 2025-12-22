# Google Ads App Campaign Asset Automation

Google Apps Script toolkit for automating asset management in Google Ads App (UAC) campaigns. Syncs videos from YouTube playlists, parses structured filenames for metadata, and manages campaign assets programmatically.

> **Note:** All IDs in this codebase are placeholders. Replace customer IDs, playlist IDs, and spreadsheet URLs with your actual values before use.

---

## What This Does

1. **YouTube Sync** - Fetches videos from configured playlists, extracts metadata from titles/descriptions
2. **Filename Parsing** - Parses structured filenames like `Alex-DiscoverMaps-Sep25_c-Alex_s-Fiverr_d-Sep25_t-Video_m-DiscoverMaps_9x16.mp4` into creator, source, date, format, and message theme
3. **Google Ads Integration** - Creates and manages assets (images, videos, headlines, descriptions) in App campaigns
4. **Performance Tracking** - Queries asset performance data and outputs to Google Sheets
5. **Decision Engine** - Analyzes performance and recommends asset replacements
6. **Change Management** - Tracks and executes approved asset changes

---

## File Structure

```
src/
├── Config.gs              # Configuration, secrets, playlist mappings
├── Main.gs                # Entry points, orchestration, test functions
├── YouTubeClient.gs       # YouTube Data API integration
├── GoogleAdsClient.gs     # Google Ads API queries and mutations
├── SheetsRepository.gs    # Google Sheets data persistence
├── DecisionEngine.gs      # Performance analysis and recommendations
├── ChangeRequestManager.gs # Asset change workflow management
├── DriveSource.gs         # Google Drive image handling
└── SlackClient.gs         # Slack notifications
```

---

## Installation

1. Go to [script.google.com](https://script.google.com) and create a new project
2. Copy each `.gs` file content into separate files in the editor (keep the same names)
3. Click gear icon > check "Show appsscript.json" > replace with provided manifest
4. Click "Services" (+) > add "YouTube Data API v3" with identifier "YouTube"
5. Update `Config.gs` with your playlist IDs, spreadsheet URL, and Google Ads IDs
6. Select `main()` from dropdown and click "Run" to authorize
7. Run `testGetPlaylistInfo()` to verify YouTube access

---

## Configuration

Edit these values in `Config.gs`:

```javascript
// Your output spreadsheet
var OUTPUT_SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/YOUR_ID/edit';

// Your YouTube playlists by language
var HARDCODED_PLAYLISTS = {
  'en': 'PLxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  'de': 'PLyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy',
};

// Your Google Ads account
GOOGLE_ADS: {
  CUSTOMER_ID: '1234567890',  // No dashes
  CAMPAIGNS: [{ id: '...', adGroupId: '...', name: '...', geo: 'US', language: 'EN' }]
}
```

---

## Filename Convention

Assets use a structured naming format for automatic metadata extraction:

```
CreativeName_c-Creator_s-Source_d-Date_t-Type_m-Message_FORMAT.ext
```

| Parameter | Description | Example |
|-----------|-------------|---------|
| `c-` | Creator name | `c-Alex` |
| `s-` | Source/agency | `s-Fiverr`, `s-Internal` |
| `d-` | Production date | `d-Sep25` |
| `t-` | Asset type | `t-Video`, `t-Static` |
| `m-` | Message/theme | `m-DiscoverMaps` |
| Format suffix | Aspect ratio | `9x16`, `16x9`, `1x1`, `4x5` |

---

## Best Practices for UAC Scripts

### Script Environment Constraints

- **Single execution context** - All code runs from one entry point (`main()` or trigger function). No module imports, no external JSON files
- **6-minute execution limit** - Long operations need checkpointing via `PropertiesService` or Sheets
- **No `PropertiesService` in Ads Scripts** - Use a config spreadsheet or hardcode values

### Asset Mutations

App campaign assets ARE mutable via API. Use `AdService` with correct `updateMask`:

```javascript
var payload = {
  adOperation: {
    update: {
      resourceName: 'customers/1234567890/ads/123456789012',
      appAd: {
        headlines: [
          { text: 'Headline One' },
          { text: 'Headline Two' }
        ]
      }
    },
    updateMask: 'app_ad.headlines'  // Critical: must match the field being updated
  }
};
AdsApp.mutate(payload);
```

### Update Mask Reference

| Asset Type | Update Mask |
|------------|-------------|
| Headlines | `app_ad.headlines` |
| Descriptions | `app_ad.descriptions` |
| Images | `app_ad.images` |
| Videos | `app_ad.youtube_videos` |

### Proven Gotchas

**Temporary Asset IDs (`-1`)**
- Asset creation may return `customers/xxx/assets/-1` instead of a real ID
- Cause 1: Running in "Preview" mode instead of "Run" - mutations don't execute
- Cause 2: Duplicate content - Google deduplicates identical images and returns `-1`
- Solution: Always use "Run", and add unique identifiers (timestamps) to asset names

**Image Aspect Ratios**
- App campaigns only accept specific ratios: `1.91:1`, `1:1`, `4:5`
- Other ratios (3:4, 1.5:1) fail with `ASPECT_RATIO_NOT_ALLOWED`
- Validate dimensions before upload

**Asset Arrays Are Replaced, Not Appended**
- When updating `images` or `youtubeVideos`, you must include ALL assets you want to keep
- Omitting existing assets removes them from the ad

```javascript
// WRONG: This removes all existing images except the new one
appAd: { images: [{ asset: 'new-asset-id' }] }

// RIGHT: Include existing assets + new one
appAd: { images: [
  { asset: 'existing-1' },
  { asset: 'existing-2' },
  { asset: 'new-asset-id' }
]}
```

**YouTube Video Assets**
- Videos must be public or unlisted (not private)
- YouTube asset creation returns real IDs immediately (unlike images)
- Use `youtubeVideoAsset.youtubeVideoId` with just the video ID, not full URL

**Text Assets Use Different Format**
- Headlines/descriptions use `{ text: 'content' }` format
- Images/videos use `{ asset: 'resource-name' }` format

**Error Extraction**
- Failed mutations don't throw - check `result.isSuccessful()`
- Error details are in `result.sc.Ia.errors` (undocumented structure)

```javascript
if (!result.isSuccessful() && result.sc && result.sc.Ia) {
  result.sc.Ia.errors.forEach(function(err) {
    Logger.log('Error: ' + JSON.stringify(err.errorCode) + ' - ' + err.message);
  });
}
```

---

## Working API Calls

See `successful-ad-scripts-calls.md` for tested, working code examples including:
- Image upload from Google Drive
- YouTube video asset creation
- Adding/removing assets from ads
- Headline and description updates
- Batch mutations

See `app-campaign-asset-mutation-guide.md` for comprehensive API reference.

---

## Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| "YouTube is not defined" | API not enabled | Add YouTube Data API v3 in Services |
| "Playlist not found" | Private playlist or wrong ID | Make playlist public/unlisted, verify ID |
| "Quota exceeded" | Over 10,000 units/day | Wait 24h for reset |
| `ASPECT_RATIO_NOT_ALLOWED` | Wrong image dimensions | Use 1.91:1, 1:1, or 4:5 ratios |
| Asset ID is `-1` | Preview mode or duplicate | Use "Run" mode, add unique identifiers |

---

## License

MIT
