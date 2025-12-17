# App Campaign Asset Automation System

## Project Documentation v1.1

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Architecture](#2-system-architecture)
3. [Data Models](#3-data-models)
4. [Filename Convention & Parsing](#4-filename-convention--parsing)
5. [API Integrations](#5-api-integrations)
6. [Core Workflows](#6-core-workflows)
7. [Scheduling & Triggers](#7-scheduling--triggers)
8. [Code Structure](#8-code-structure)
9. [Configuration](#9-configuration)
10. [Error Handling](#10-error-handling)
11. [Security](#11-security)
12. [Implementation Roadmap](#12-implementation-roadmap)
13. [Testing Checklist](#13-testing-checklist)

---

## 1. Project Overview

### 1.1 Purpose

Build an automated system for managing Google Ads App Campaign creative assets for **Abrello** that:

- **Monitors** asset performance (videos, images, headlines, descriptions)
- **Discovers** new assets from YouTube playlists (videos) and Notion (images)
- **Analyzes** performance using Google's asset ratings (LOW/GOOD/BEST)
- **Recommends** replacements for underperforming assets
- **Generates** AI-assisted text variations for headlines/descriptions
- **Executes** approved changes with human approval via Slack OR Notion
- **Tracks** lifetime performance for rollback capability

### 1.2 Scope

| Dimension | Value |
|-----------|-------|
| App | Abrello |
| Google Ads Account | Single account |
| Number of Campaigns | ~10 App Install/Engagement campaigns |
| Campaign Structure | Each campaign targets a different geo/language |
| Asset Pool | Common creative pool, localized per language |
| Ad Groups per Campaign | 1 (standard for App campaigns) |
| Asset Types | Videos, Images, Headlines, Descriptions |
| Approval Workflow | Single person via Slack OR Notion |

### 1.3 Key Constraints

| Constraint | Details |
|------------|---------|
| Runtime | Google Apps Script (6-min execution limit) |
| Google Ads API | Via `AdsApp` object (Scripts environment) |
| Campaign Type | `MULTI_CHANNEL` (App campaigns only) |
| Asset Limits | Headlines: 2-5, Descriptions: 1-5, Images: 1-20, Videos: 0-20 |
| Video Source | YouTube playlists (pre-uploaded, outside system scope) |
| Image Source | Notion database |

### 1.4 Success Metrics

- Automated detection of LOW-performing assets within 24 hours
- < 5 minutes manual effort per day for approvals
- Complete audit trail of all asset changes
- Ability to rollback to previously good-performing assets

### 1.5 Asset Rotation Rules

| Current Performance | Action |
|---------------------|--------|
| BEST | Keep - no rotation |
| GOOD | Replace only if newer asset with GOOD/BEST history is available |
| LOW | Replace with newest available asset that has GOOD/BEST previous performance |
| Protected (any) | Never rotate - manual override via Notion |

---

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA SOURCES                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   YouTube    │  │   Notion     │  │   Google     │  │   Notion     │    │
│  │   Playlist   │  │   (Images)   │  │   Ads        │  │   (Text)     │    │
│  │   (Videos)   │  │              │  │   (Perf.)    │  │              │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
│         │                 │                 │                 │             │
│         └─────────────────┼─────────────────┼─────────────────┘             │
│                           │                 │                               │
│                           ▼                 ▼                               │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                     GOOGLE APPS SCRIPT                                │  │
│  │                     (Processing Engine)                               │  │
│  │                                                                       │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │  │
│  │  │    Sync     │  │  Analysis   │  │    Text     │  │  Execution  │  │  │
│  │  │   Module    │  │   Module    │  │  Generator  │  │   Module    │  │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │  │
│  │                                                                       │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                           │                 │                               │
│                           ▼                 ▼                               │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                          NOTION                                       │  │
│  │                    (Central Data Store)                               │  │
│  │                                                                       │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │  │
│  │  │  Creative   │  │   Asset     │  │ Performance │  │   Change    │  │  │
│  │  │    Sets     │  │  Registry   │  │  Snapshots  │  │  Requests   │  │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │  │
│  │  │   Source    │  │  Campaign   │  │    Text     │  │    App      │  │  │
│  │  │    Queue    │  │   Config    │  │  Examples   │  │   Config    │  │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │  │
│  │                                                                       │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                           │                                                 │
│                           ▼                                                 │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                          OUTPUTS                                      │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │  │
│  │  │    Slack     │  │   Google     │  │   Notion     │                │  │
│  │  │ Notifications│  │   Ads        │  │   Updates    │                │  │
│  │  │              │  │  (Mutate)    │  │              │                │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘                │  │
│  │                                                                       │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Component Overview

| Component | Technology | Purpose |
|-----------|------------|---------|
| Runtime | Google Apps Script | Execute all automation logic |
| Data Store | Notion | Store all asset data, history, approvals |
| Notifications | Slack Webhooks | Alert user, request approvals |
| AI Text Gen | Claude API | Generate headline/description variations |
| Video Source | YouTube Playlists | Pre-uploaded video assets |
| Image Source | Notion Database | Image assets with metadata |
| Ad Platform | Google Ads | Performance data, asset management |

### 2.3 Creative Asset Hierarchy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CREATIVE SET (Parent Entity)                          │
│                                                                              │
│  External ID: CS-202509-DF7X2K                                              │
│  Full Name: Sprint32-SocialSavannah-Diego-video1_c-Diego_s-Fiverr_          │
│             d-Sep25_t-Video_m-WhatIsAneSim                                  │
│                                                                              │
│  Parsed Metadata:                                                            │
│  ├─ Creator: Diego          ├─ Source: Fiverr                               │
│  ├─ Date: Sep25             ├─ Type: Video                                  │
│  ├─ Protected: No           └─ Message: WhatIsAneSim                        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 1:N relationship
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      FORMAT VARIATIONS (Child Entities)                      │
│                      (Not all formats required)                              │
│                                                                              │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐  │
│  │   9x16 (Vertical)   │  │  16x9 (Landscape)   │  │    1x1 (Square)     │  │
│  │                     │  │                     │  │                     │  │
│  │  Source:            │  │  Source:            │  │  Source:            │  │
│  │  • YT: dQw4w9WgXcQ  │  │  • YT: xYz123AbC    │  │  • Notion: page_id  │  │
│  │                     │  │                     │  │                     │  │
│  │  Google Ads:        │  │  Google Ads:        │  │  Google Ads:        │  │
│  │  • Asset ID:        │  │  • Asset ID:        │  │  • Asset ID:        │  │
│  │    customers/123/   │  │    customers/123/   │  │    customers/123/   │  │
│  │    assets/456       │  │    assets/789       │  │    assets/012       │  │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key Principles:**
- Creative Set ID is the primary external identifier
- Each format variation gets its own Google Ads Asset ID
- Not all formats are required - some Creative Sets may have only one format
- Protected status at Creative Set level prevents any rotation

---

## 3. Data Models

### 3.1 Notion Database Schema

#### Database 1: `App Config`

*Simple configuration for Abrello app details and AI text generation context*

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| `config_key` | Title | ✓ | Configuration item name | `app_name` |
| `config_value` | Text | ✓ | Configuration value | `Abrello` |
| `category` | Select | | Grouping | `IDENTITY`, `VALUE_PROP`, `MESSAGING` |
| `language` | Select | | Language if applicable | `EN`, `DE`, `ES` |
| `notes` | Text | | Additional context | |

**Default entries to create:**

| Key | Value | Category |
|-----|-------|----------|
| `app_name` | Abrello | IDENTITY |
| `app_store_ios` | (App Store ID) | IDENTITY |
| `app_store_android` | (Play Store ID) | IDENTITY |
| `value_prop_1` | (Primary value proposition) | VALUE_PROP |
| `value_prop_2` | (Secondary value proposition) | VALUE_PROP |
| `value_prop_3` | (Tertiary value proposition) | VALUE_PROP |
| `target_audience` | (Description) | MESSAGING |
| `tone_of_voice` | (Description) | MESSAGING |
| `avoid_words` | (Comma-separated list) | MESSAGING |

---

#### Database 2: `Creative Sets`

*Parent entity - one per creative concept, regardless of formats*

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| `creative_set_id` | Title | ✓ | Primary external tracking ID | `CS-202509-DF7X2K` |
| `full_name` | Text | ✓ | Complete filename (no extension/format) | `Sprint32-SocialSavannah-Diego-video1_c-Diego_s-Fiverr_d-Sep25_t-Video_m-WhatIsAneSim` |
| `short_name` | Text | | Shortened name for YouTube uploads | `Diego-WhatIsAneSim-Sep25` |
| `creator` | Select | | Parsed from `c-` parameter | `Diego`, `MariahAmarae`, `Casey` |
| `source` | Select | | Parsed from `s-` parameter | `Fiverr`, `SocialSavanna`, `Influee`, `Internal` |
| `production_date` | Text | | Parsed from `d-` parameter (MonYY) | `Sep25`, `Oct24` |
| `asset_type` | Select | | Parsed from `t-` parameter | `Video`, `Static`, `Motion` |
| `message_theme` | Text | | Parsed from `m-` parameter | `WhatIsAneSim`, `HowToInstall` |
| `target_gender` | Select | | Parsed from `gen-` parameter | `Male`, `Female`, `All` |
| `target_age` | Text | | Parsed from `age-` parameter | `18-24`, `25-34` |
| `hook_variant` | Text | | Parsed from `h-` parameter | Hook identifier |
| `offer_type` | Text | | Parsed from `o-` parameter | Offer identifier |
| `format_assets` | Relation | | → Asset Registry (all formats) | Links to 9x16, 16x9, 1x1 |
| `protected` | Checkbox | | If true, never auto-rotate | `false` |
| `lifecycle_status` | Select | ✓ | Overall status | `ACTIVE`, `PAUSED`, `ARCHIVED` |
| `best_historical_performance` | Select | | Best rating ever achieved | `BEST`, `GOOD`, `LOW` |
| `created_at` | Date | ✓ | When first discovered | |
| `notes` | Text | | Free-form notes | |

**Select Options:**

- `creator`: Dynamic based on discovered assets
- `source`: `Fiverr`, `SocialSavanna`, `Influee`, `Internal`, `Other`
- `asset_type`: `Video`, `Static`, `Motion`
- `target_gender`: `Male`, `Female`, `All`
- `lifecycle_status`: `ACTIVE`, `PAUSED`, `ARCHIVED`
- `best_historical_performance`: `BEST`, `GOOD`, `LOW`, `NONE`

---

#### Database 3: `Asset Registry`

*Individual format variations - each has its own Google Ads Asset ID*

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| `asset_id` | Title | ✓ | Google Ads Resource Name (PK) | `customers/1234567890/assets/9876543210` |
| `creative_set` | Relation | ✓ | → Creative Sets (parent) | Link to `CS-202509-DF7X2K` |
| `format` | Select | ✓ | Aspect ratio | `9x16`, `16x9`, `1x1`, `4x5`, `4x3` |
| `asset_type` | Select | ✓ | Type classification | `VIDEO`, `IMAGE`, `HEADLINE`, `DESCRIPTION` |
| `source_type` | Select | ✓ | Where source file lives | `YOUTUBE`, `NOTION`, `MANUAL` |
| `source_id` | Text | | YouTube Video ID or Notion Page ID | `dQw4w9WgXcQ` |
| `source_url` | URL | | Direct link to source | |
| `youtube_title` | Text | | Title as uploaded to YouTube | `Diego-WhatIsAneSim-Sep25-9x16` |
| `youtube_description` | Text | | Full asset name in YT description | Full filename |
| `notion_page_id` | Text | | For images: Notion page ID | |
| `content` | Text | | For text assets: the actual text | `Download the app today!` |
| `file_size_bytes` | Number | | File size | `15234567` |
| `duration_seconds` | Number | | For videos: length | `30` |
| `lifecycle_status` | Select | ✓ | Status of this format | `QUEUED`, `UPLOADED`, `ACTIVE`, `PAUSED`, `ARCHIVED` |
| `pause_reason` | Select | | Why paused | `PERFORMANCE_LOW`, `REPLACED_BY_NEW`, `MANUAL`, `POLICY` |
| `campaigns` | Relation | | → Campaign Config | Multi-select |
| `first_activated` | Date | | When first added to campaign | |
| `last_deactivated` | Date | | When removed | |
| `times_activated` | Number | | Reactivation count | `2` |
| `lifetime_impressions` | Number | | Total impressions | |
| `lifetime_clicks` | Number | | Total clicks | |
| `lifetime_conversions` | Number | | Total conversions | |
| `lifetime_cost_micros` | Number | | Total cost (micros) | |
| `best_performance_label` | Select | | Best rating achieved | `BEST`, `GOOD`, `LOW` |
| `current_performance_label` | Select | | Current rating | `PENDING`, `LEARNING`, `LOW`, `GOOD`, `BEST` |
| `created_at` | Date | ✓ | Record creation | |
| `updated_at` | Date | | Last update | |

**Select Options:**

- `format`: `9x16`, `16x9`, `1x1`, `4x5`, `4x3`, `N/A` (for text)
- `asset_type`: `VIDEO`, `IMAGE`, `HEADLINE`, `DESCRIPTION`
- `source_type`: `YOUTUBE`, `NOTION`, `MANUAL`
- `lifecycle_status`: `QUEUED`, `UPLOADED`, `ACTIVE`, `PAUSED`, `ARCHIVED`
- `pause_reason`: `PERFORMANCE_LOW`, `REPLACED_BY_NEW`, `MANUAL`, `POLICY`
- `current_performance_label`: `PENDING`, `LEARNING`, `LOW`, `GOOD`, `BEST`, `UNKNOWN`
- `best_performance_label`: `LOW`, `GOOD`, `BEST`

---

#### Database 4: `Image Assets`

*Source images stored in Notion (replaces Google Drive)*

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| `image_name` | Title | ✓ | Filename following naming convention | `Diego-WhatIsAneSim-Sep25_c-Diego_s-Fiverr_d-Sep25_t-Static_1x1` |
| `image_file` | Files | ✓ | The actual image file | Uploaded image |
| `creative_set` | Relation | | → Creative Sets | Link to parent |
| `format` | Select | ✓ | Aspect ratio | `9x16`, `16x9`, `1x1`, `4x5`, `4x3` |
| `creator` | Select | | Parsed from filename | `Diego` |
| `source` | Select | | Parsed from filename | `Fiverr` |
| `production_date` | Text | | Parsed from filename | `Sep25` |
| `message_theme` | Text | | Parsed from filename | `WhatIsAneSim` |
| `status` | Select | ✓ | Processing status | `NEW`, `APPROVED`, `UPLOADED`, `REJECTED` |
| `uploaded_to_ads` | Checkbox | | Whether uploaded to Google Ads | `false` |
| `google_ads_asset_id` | Text | | Resource name after upload | |
| `uploaded_at` | Date | | When uploaded to Google Ads | |
| `notes` | Text | | | |

---

#### Database 5: `Performance Snapshots`

*Point-in-time performance captures for audit trail*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `snapshot_id` | Title | ✓ | `{asset_id}_{date}` |
| `asset` | Relation | ✓ | → Asset Registry |
| `creative_set` | Relation | | → Creative Sets (for filtering) |
| `campaign` | Relation | ✓ | → Campaign Config |
| `format` | Select | | Format of this asset |
| `snapshot_date` | Date | ✓ | When taken |
| `snapshot_type` | Select | ✓ | `DAILY`, `WEEKLY`, `PRE_CHANGE`, `POST_CHANGE` |
| `period_start` | Date | ✓ | Measurement period start |
| `period_end` | Date | ✓ | Measurement period end |
| `performance_label` | Select | ✓ | `PENDING`, `LEARNING`, `LOW`, `GOOD`, `BEST` |
| `impressions` | Number | | Period impressions |
| `clicks` | Number | | Period clicks |
| `conversions` | Number | | Period conversions |
| `cost_micros` | Number | | Period cost |
| `ctr` | Number | | Click-through rate (calculated) |
| `cvr` | Number | | Conversion rate (calculated) |
| `cpa` | Number | | Cost per acquisition (calculated) |
| `rank_in_campaign` | Number | | Rank among same type in campaign |
| `decision_made` | Select | | `KEEP`, `REMOVE`, `REPLACE`, `NONE` |
| `decision_reason` | Text | | Why this decision |

---

#### Database 6: `Change Requests`

*Approval workflow for all asset changes - can be approved in Slack OR Notion*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `request_id` | Title | ✓ | Auto-generated ID |
| `campaign` | Relation | ✓ | → Campaign Config |
| `action` | Select | ✓ | `ADD`, `REMOVE`, `REPLACE`, `REACTIVATE` |
| `asset_type` | Select | ✓ | `VIDEO`, `IMAGE`, `HEADLINE`, `DESCRIPTION` |
| `target_asset` | Relation | | → Asset Registry (to remove) |
| `target_creative_set` | Relation | | → Creative Sets |
| `new_asset` | Relation | | → Asset Registry (to add) |
| `new_content` | Text | | For text assets: new text |
| `reason` | Text | ✓ | Why this change |
| `supporting_data` | Text | | JSON with metrics |
| `priority` | Select | ✓ | `HIGH`, `MEDIUM`, `LOW` |
| `status` | Select | ✓ | `PENDING`, `APPROVED`, `REJECTED`, `EXECUTED`, `FAILED` |
| `created_at` | Date | ✓ | Request creation |
| `reviewed_at` | Date | | When reviewed |
| `reviewed_by` | Text | | Who reviewed |
| `review_source` | Select | | `SLACK`, `NOTION` |
| `executed_at` | Date | | When executed |
| `execution_result` | Text | | Result details |
| `rollback_available` | Checkbox | | Can this be rolled back |
| `rolled_back` | Checkbox | | Has been rolled back |

**Note:** If status remains `PENDING`, the system waits indefinitely. No auto-approval or timeout.

---

#### Database 7: `Source Assets Queue`

*Discovered assets waiting to be processed*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source_id` | Title | ✓ | YouTube Video ID or Notion Page ID |
| `source_type` | Select | ✓ | `YOUTUBE`, `NOTION` |
| `raw_filename` | Text | ✓ | Original filename as discovered |
| `parsed_creative_set_id` | Text | | Extracted or generated CS ID |
| `parsed_full_name` | Text | | Filename without format suffix |
| `parsed_format` | Select | | Extracted aspect ratio |
| `parsed_creator` | Text | | Extracted `c-` value |
| `parsed_source` | Text | | Extracted `s-` value |
| `parsed_date` | Text | | Extracted `d-` value |
| `parsed_type` | Text | | Extracted `t-` value |
| `parsed_message` | Text | | Extracted `m-` value |
| `youtube_description` | Text | | For YT: full name in description |
| `preview_url` | URL | | Link to preview |
| `thumbnail_url` | URL | | Thumbnail |
| `discovered_at` | Date | ✓ | When found |
| `status` | Select | ✓ | `NEW`, `APPROVED`, `UPLOADED`, `REJECTED`, `DUPLICATE` |
| `existing_creative_set` | Relation | | → Creative Sets (if exists) |
| `created_asset` | Relation | | → Asset Registry (after upload) |
| `target_campaigns` | Relation | | → Campaign Config |
| `notes` | Text | | |

---

#### Database 8: `Campaign Config`

*Settings per campaign - each campaign targets a different geo/language*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `campaign_name` | Title | ✓ | Human-readable name |
| `campaign_id` | Text | ✓ | Google Ads Campaign ID |
| `ad_group_id` | Text | ✓ | Google Ads Ad Group ID |
| `status` | Select | ✓ | `ENABLED`, `PAUSED`, `REMOVED` |
| `app_store` | Select | | `GOOGLE_PLAY`, `APP_STORE` |
| `app_id` | Text | | App package/bundle ID |
| `geo_target` | Select | ✓ | Target country | `US`, `DE`, `ES`, `FR`, etc. |
| `language` | Select | ✓ | Target language | `EN`, `DE`, `ES`, `FR`, etc. |
| `auto_replace_low` | Checkbox | | Auto-approve LOW removals |
| `min_headlines` | Number | | Minimum headlines (default: 2) |
| `min_descriptions` | Number | | Minimum descriptions (default: 1) |
| `min_images` | Number | | Minimum images (default: 1) |
| `min_videos` | Number | | Minimum videos (default: 0) |
| `last_synced` | Date | | Last performance sync |
| `notes` | Text | | |

---

#### Database 9: `Text Examples`

*Good/bad examples for AI text generation*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `example_id` | Title | ✓ | Auto-generated |
| `asset_type` | Select | ✓ | `HEADLINE`, `DESCRIPTION` |
| `text_content` | Text | ✓ | The actual text |
| `language` | Select | ✓ | Language of this example |
| `quality` | Select | ✓ | `GOOD`, `BAD` |
| `campaign` | Relation | | Optional campaign context |
| `peak_performance` | Select | | Best label achieved |
| `peak_ctr` | Number | | Best CTR achieved |
| `why_good` | Text | | Explanation of why good |
| `why_bad` | Text | | Explanation of why bad |
| `patterns` | Multi-select | | `CTA`, `NUMBERS`, `URGENCY`, `SOCIAL_PROOF`, `QUESTION`, `BENEFIT`, `FEATURE` |
| `source_asset` | Relation | | → Asset Registry |
| `created_at` | Date | ✓ | |

---

### 3.2 Database Relationships Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      NOTION DATABASE RELATIONSHIPS                           │
└─────────────────────────────────────────────────────────────────────────────┘

    App Config (standalone)

    Creative Sets (1) ──────────────────┐
         │                               │
         │ 1:N                           │
         ▼                               │
    Asset Registry (N) ◄────────────────┤
         │                               │
         │ N:M                           │
         ▼                               │
    Campaign Config (M) ◄───────────────┤
         │                               │
         │                               │
         ▼                               │
    Performance Snapshots ◄─────────────┤
         │                               │
         │                               │
    Change Requests ◄───────────────────┤
         │                               │
         │                               │
    Source Assets Queue ────────────────┘
         │
         │
    Image Assets ──────► Creative Sets
         │
         │
    Text Examples

Legend:
─────── = Relation
1:N = One-to-Many
N:M = Many-to-Many
```

---

## 4. Filename Convention & Parsing

### 4.1 Filename Structure

```
CreativeName_param1-value_param2-value_param3-value_FORMAT.ext

Example:
Sprint32-SocialSavannah-Diego-video1_c-Diego_s-Fiverr_d-Sep25_t-Video_m-WhatIsAneSim_9x16.mp4
```

### 4.2 Parameter Reference

#### Core Parameters (Used in Matching)

| Prefix | Name | Description | Examples |
|--------|------|-------------|----------|
| `c-` | Creator | Person who created/appears in content | `c-Diego`, `c-MariahAmarae` |
| `s-` | Source | Agency, platform, or origin | `s-Fiverr`, `s-SocialSavanna`, `s-Internal` |
| `d-` | Date | When produced (MonYY format) | `d-Sep25`, `d-Oct24` |

#### Content Classification Parameters

| Prefix | Name | Description | Examples |
|--------|------|-------------|----------|
| `t-` | Type | Asset format/type | `t-Static`, `t-Motion`, `t-Video` |
| `as-` | Asset Style | Brand/style classification | `as-Brand` |
| `m-` or `m_` | Message/Theme | Core message or theme | `m-WhatIsAneSim`, `m-HowToInstall` |

#### Targeting Parameters

| Prefix | Name | Description | Examples |
|--------|------|-------------|----------|
| `gen-` or `gen_` | Gender | Target gender | `gen-Male`, `gen-Female`, `gen-All` |
| `age-` | Age Range | Target age | `age-18-24`, `age-25-34` |

#### Technical Parameters

| Prefix | Name | Description | Examples |
|--------|------|-------------|----------|
| `h-` | Hook | Hook/opening style | Hook identifier |
| `p-` | Product | Product focus | Product identifier |
| `o-` | Offer | Promotional offer | Offer identifier |
| `len-` | Length | Video duration | `len-15s`, `len-30s` |
| `id-` | ID | Unique tracking ID | Internal ID code |

### 4.3 Format Specifications

| Format | Notation Variants | Usage |
|--------|-------------------|-------|
| 16:9 | `16x9`, `16:9` | Landscape (YouTube, Desktop) |
| 9:16 | `9x16`, `9:16` | Vertical (TikTok, Reels, Stories) |
| 1:1 | `1x1`, `1:1` | Square (Feed posts) |
| 4:5 | `4x5`, `4:5` | Portrait (Facebook/Instagram Feed) |
| 4:3 | `4x3`, `4:3` | Traditional TV |

### 4.4 Source Values

| Source Value | Description |
|--------------|-------------|
| `s-SocialSavanna` / `s-SocialSavannah` | Legacy UGC agency |
| `s-Influee` | Creator marketplace platform |
| `s-Fiverr` | Low-cost freelance UGC creators |
| `s-Internal` | In-house produced content |

### 4.5 Filename Parser Logic

The filename parser module should:

1. **Remove extension** from filename
2. **Extract format** by matching format patterns (16x9, 9x16, 1x1, 4x5, 4x3)
3. **Extract parameters** using regex patterns for each prefix (c-, s-, d-, t-, m-, etc.)
4. **Generate Creative Set ID** if not present using format: `CS-YYYYMM-XXXX`
5. **Build short name** for YouTube display (creator + message + date)
6. **Support description parsing** for YouTube videos where full name is in description

### 4.6 YouTube Description Template

When uploading videos to YouTube with shortened titles, include full metadata in description:

```
Full asset name: Sprint32-SocialSavannah-Diego-video1_c-Diego_s-Fiverr_d-Sep25_t-Video_m-WhatIsAneSim
Format: 9x16
Creative Set: CS-202509-DF7X2K

[Additional description content...]
```

---

## 5. API Integrations

### 5.1 Notion API

| Specification | Value |
|---------------|-------|
| Base URL | `https://api.notion.com/v1` |
| Auth | Bearer token (Integration token) |
| Version Header | `Notion-Version: 2022-06-28` |
| Rate Limit | 3 requests/second (average) |
| Pagination | 100 results per query, use `start_cursor` |

#### Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/databases/{id}/query` | POST | Query database pages |
| `/pages` | POST | Create new page |
| `/pages/{id}` | PATCH | Update page properties |
| `/pages/{id}` | GET | Get page details |

#### Key Operations

- **Query database with filters** - for finding assets, campaigns, pending requests
- **Create page** - for new assets, snapshots, change requests
- **Update page** - for status changes, metric updates
- **Paginated queries** - handle large result sets with cursor pagination
- **Find by property** - locate specific records by ID or name

---

### 5.2 Slack API (Webhooks)

| Specification | Value |
|---------------|-------|
| Method | POST to webhook URL |
| Auth | URL contains token |
| Format | JSON with Block Kit |
| Rate Limit | 1 message/second |

#### Message Types

1. **Daily Summary** - LOW performers, new assets available, pending approvals
2. **Execution Confirmation** - Changes that were executed
3. **Error Notification** - System errors requiring attention

#### Approval Flow

- Slack notifications include "Review in Notion" button
- User can approve in Slack (if interactive messages enabled) OR in Notion
- System checks both sources for approval status

---

### 5.3 Claude API (Anthropic)

| Specification | Value |
|---------------|-------|
| Base URL | `https://api.anthropic.com/v1` |
| Auth | `x-api-key` header |
| Model | `claude-sonnet-4-20250514` |
| Endpoint | `POST /messages` |

#### Text Generation Context

The system should:

1. Fetch App Config from Notion for value propositions and messaging guidelines
2. Fetch good/bad Text Examples from Notion filtered by language
3. Fetch existing assets to avoid duplicates
4. Generate variations with character count validation (30 for headlines, 90 for descriptions)

---

### 5.4 YouTube Data API

| Specification | Value |
|---------------|-------|
| Access | YouTube Advanced Service in Apps Script |
| Auth | Automatic via Apps Script OAuth |
| Quota | 10,000 units/day |
| Pagination | 50 items max per request |

#### Operations

- **Get playlist videos** - discover new video assets
- **Get video details** - duration, description for metadata extraction
- **Parse duration** - convert ISO 8601 to seconds

**Note:** Video uploading is outside scope. Playlists are pre-populated manually.

---

### 5.5 Google Ads API (via AdsApp)

#### Key Queries

1. **Get App Campaigns** - `MULTI_CHANNEL` type, `ENABLED` status
2. **Get Ad Groups** - for campaign asset management
3. **Get Asset Performance** - `ad_group_ad_asset_view` with metrics

#### Key Mutations

1. **Create YouTube video asset** - from YouTube video ID
2. **Create image asset** - from Notion image data
3. **Create text asset** - headlines and descriptions
4. **Link asset to ad group** - via mutate operation
5. **Remove asset from ad group** - via mutate operation

---

## 6. Core Workflows

### 6.1 Source Asset Sync Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SOURCE ASSET SYNC FLOW                               │
│                         (Daily at 6:00 AM)                                   │
└─────────────────────────────────────────────────────────────────────────────┘

START
  │
  ├─► Get YouTube playlist videos
  │     │
  │     ├─► For each video:
  │     │     │
  │     │     ├─► Check if source_id exists in Source Queue
  │     │     │     │
  │     │     │     ├─► YES: Skip (already discovered)
  │     │     │     │
  │     │     │     └─► NO: Continue
  │     │     │
  │     │     ├─► Parse filename from title or description
  │     │     │
  │     │     ├─► Extract metadata (creator, source, date, etc.)
  │     │     │
  │     │     ├─► Extract format from filename
  │     │     │
  │     │     ├─► Generate/extract Creative Set ID
  │     │     │
  │     │     ├─► Check if Creative Set exists in Notion
  │     │     │     │
  │     │     │     ├─► YES: Link to existing Creative Set
  │     │     │     │
  │     │     │     └─► NO: Will create new Creative Set on approval
  │     │     │
  │     │     └─► Create Source Queue entry (status: NEW)
  │     │
  │     └─► Log sync results
  │
  ├─► Get Image Assets from Notion (status: NEW)
  │     │
  │     └─► [Same parsing and queue flow as YouTube]
  │
  └─► Update last sync timestamp

END
```

### 6.2 Performance Analysis Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PERFORMANCE ANALYSIS FLOW                              │
│                         (Daily at 7:00 AM)                                   │
└─────────────────────────────────────────────────────────────────────────────┘

START
  │
  ├─► Get Campaign Config from Notion
  │
  ├─► For each campaign:
  │     │
  │     ├─► Query Google Ads for asset performance (LAST_7_DAYS)
  │     │
  │     ├─► For each asset:
  │     │     │
  │     │     ├─► Find/create Asset Registry record
  │     │     │
  │     │     ├─► Create Performance Snapshot in Notion
  │     │     │
  │     │     ├─► Update lifetime metrics (impressions, clicks, etc.)
  │     │     │
  │     │     ├─► Update current_performance_label
  │     │     │
  │     │     └─► Track best_performance_label (for replacement priority)
  │     │
  │     ├─► Analyze performance distribution
  │     │     │
  │     │     ├─► Count LOW / GOOD / BEST performers
  │     │     │
  │     │     └─► Identify candidates for replacement
  │     │
  │     └─► Generate recommendations
  │
  ├─► For LOW performers (not protected):
  │     │
  │     ├─► Create Change Request (action: REMOVE)
  │     │
  │     └─► Find replacement (newest with GOOD/BEST history)
  │           │
  │           └─► YES: Create Change Request (action: REPLACE)
  │
  ├─► For GOOD performers with newer GOOD/BEST assets available:
  │     │
  │     └─► Create Change Request (action: REPLACE, priority: LOW)
  │
  ├─► For text assets needing refresh:
  │     │
  │     ├─► Get App Config for value propositions
  │     │
  │     ├─► Get Text Examples from Notion (by language)
  │     │
  │     ├─► Call Claude API for new variations
  │     │
  │     └─► Create Change Requests (action: ADD)
  │
  ├─► Send Slack summary notification
  │
  └─► Update last analysis timestamp

END
```

### 6.3 Change Execution Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CHANGE EXECUTION FLOW                                 │
│                      (Every 2 hours, on approval)                            │
└─────────────────────────────────────────────────────────────────────────────┘

START
  │
  ├─► Query Notion for APPROVED Change Requests
  │
  ├─► For each approved request:
  │     │
  │     ├─► Validate request still valid
  │     │     │
  │     │     ├─► Check asset still exists
  │     │     │
  │     │     ├─► Check campaign still active
  │     │     │
  │     │     └─► Check Creative Set not protected (for removals)
  │     │
  │     ├─► Execute based on action type:
  │     │     │
  │     │     ├─► ADD:
  │     │     │     │
  │     │     │     ├─► For video: Create YouTube asset in Google Ads
  │     │     │     │
  │     │     │     ├─► For image: Upload from Notion to Google Ads
  │     │     │     │
  │     │     │     ├─► For text: Create text asset
  │     │     │     │
  │     │     │     ├─► Link asset to campaign via mutate()
  │     │     │     │
  │     │     │     ├─► Create Asset Registry record
  │     │     │     │
  │     │     │     └─► Update lifecycle_status to ACTIVE
  │     │     │
  │     │     ├─► REMOVE:
  │     │     │     │
  │     │     │     ├─► Verify minimum asset counts maintained
  │     │     │     │
  │     │     │     ├─► Remove asset from campaign via mutate()
  │     │     │     │
  │     │     │     ├─► Update Asset Registry status to PAUSED
  │     │     │     │
  │     │     │     └─► Set pause_reason
  │     │     │
  │     │     ├─► REPLACE:
  │     │     │     │
  │     │     │     ├─► Execute ADD for new asset
  │     │     │     │
  │     │     │     └─► Execute REMOVE for old asset
  │     │     │
  │     │     └─► REACTIVATE:
  │     │           │
  │     │           ├─► Find paused asset in registry
  │     │           │
  │     │           ├─► Re-link to campaign
  │     │           │
  │     │           ├─► Update status to ACTIVE
  │     │           │
  │     │           └─► Increment times_activated
  │     │
  │     ├─► Update Change Request:
  │     │     │
  │     │     ├─► status: EXECUTED or FAILED
  │     │     │
  │     │     ├─► executed_at: now
  │     │     │
  │     │     └─► execution_result: details
  │     │
  │     └─► Update Source Queue (if applicable)
  │
  ├─► Send Slack execution confirmation
  │
  └─► Log execution results

END
```

### 6.4 Replacement Priority Logic

When identifying replacements for underperforming assets:

1. **Filter candidates**: Only assets with `best_historical_performance` = GOOD or BEST
2. **Sort by date**: Newest first (based on `production_date`)
3. **Match criteria**: Same asset type, compatible format
4. **Exclude protected**: Never replace with protected Creative Sets
5. **Exclude active**: Don't use assets already active in the campaign

### 6.5 Protected Asset Handling

Assets marked as `protected = true` in Creative Sets:

- Never auto-removed regardless of performance
- Never included in replacement recommendations
- Can still be manually managed via direct Notion edits
- Protected status checked before any REMOVE or REPLACE execution

---

## 7. Scheduling & Triggers

### 7.1 Trigger Configuration

| Trigger | Function | Schedule | Purpose |
|---------|----------|----------|---------|
| Source Sync | `syncSourceAssets()` | Daily 6:00 AM | Discover new videos/images |
| Analysis | `runPerformanceAnalysis()` | Daily 7:00 AM | Analyze and recommend |
| Execution | `executeApprovedChanges()` | Every 2 hours | Execute approved changes |
| Maintenance | `weeklyMaintenance()` | Sundays 2:00 AM | Cleanup and archival |

### 7.2 Trigger Setup

Triggers should be created using `ScriptApp.newTrigger()` with:

- Time-based triggers for daily operations
- Timezone: `Europe/Prague`
- Buffer time before 6-minute limit
- Progress saving for continuation if needed

---

## 8. Code Structure

### 8.1 File Organization

```
Google Apps Script Project: "App Campaign Asset Automation"
│
├── appsscript.json          # Project manifest
├── Config.gs                # Configuration constants
├── Main.gs                  # Entry points for triggers
├── Utils.gs                 # Helper functions
│
├── // API Clients
├── NotionClient.gs          # Notion API interactions
├── SlackClient.gs           # Slack notifications
├── ClaudeClient.gs          # AI text generation
├── YouTubeClient.gs         # YouTube playlist sync
├── GoogleAdsClient.gs       # Google Ads API interactions
│
├── // Core Modules
├── FilenameParser.gs        # Filename parsing logic
├── SourceSync.gs            # Source asset discovery
├── PerformanceAnalysis.gs   # Performance analysis
├── RecommendationEngine.gs  # Generate recommendations
├── TextGenerator.gs         # AI text generation workflow
├── ChangeExecutor.gs        # Execute approved changes
│
├── // Data Management
├── NotionDataManager.gs     # High-level Notion operations
├── StateManager.gs          # Script Properties state
│
└── // Utilities
    ├── ErrorHandler.gs      # Error handling & logging
    └── TimeoutManager.gs    # Execution time management
```

### 8.2 Project Manifest Requirements

Required OAuth scopes:
- `https://www.googleapis.com/auth/ads`
- `https://www.googleapis.com/auth/script.external_request`
- `https://www.googleapis.com/auth/script.scriptapp`

Required Advanced Services:
- YouTube Data API v3

Runtime: V8

---

## 9. Configuration

### 9.1 Configuration Constants

| Category | Setting | Description |
|----------|---------|-------------|
| Google Ads | `CUSTOMER_ID` | Google Ads customer ID (no dashes) |
| Sources | `YOUTUBE_PLAYLIST_ID` | Playlist to monitor for videos |
| Limits | `MAX_HEADLINES` | 5 (Google Ads limit) |
| Limits | `MIN_HEADLINES` | 2 (Google Ads minimum) |
| Limits | `MAX_DESCRIPTIONS` | 5 |
| Limits | `MIN_DESCRIPTIONS` | 1 |
| Limits | `MAX_IMAGES` | 20 |
| Limits | `MIN_IMAGES` | 1 |
| Limits | `MAX_VIDEOS` | 20 |
| Limits | `MIN_VIDEOS` | 0 |
| Limits | `HEADLINE_MAX_CHARS` | 30 |
| Limits | `DESCRIPTION_MAX_CHARS` | 90 |
| Analysis | `PERFORMANCE_WINDOW_DAYS` | 7 |
| Analysis | `MIN_IMPRESSIONS_FOR_DECISION` | 1000 |
| Analysis | `SNAPSHOT_RETENTION_DAYS` | 90 |
| Schedule | `SYNC_HOUR` | 6 |
| Schedule | `ANALYSIS_HOUR` | 7 |
| Schedule | `TIMEZONE` | Europe/Prague |
| Text Gen | `GOOD_EXAMPLES_COUNT` | 5 |
| Text Gen | `BAD_EXAMPLES_COUNT` | 3 |
| Text Gen | `VARIATIONS_TO_GENERATE` | 5 |

### 9.2 Required Script Properties

Set in: File > Project Properties > Script Properties

| Property Name | Description |
|---------------|-------------|
| `NOTION_API_KEY` | Notion integration token |
| `NOTION_APP_CONFIG_DB` | App Config database ID |
| `NOTION_CREATIVE_SETS_DB` | Creative Sets database ID |
| `NOTION_ASSET_REGISTRY_DB` | Asset Registry database ID |
| `NOTION_IMAGE_ASSETS_DB` | Image Assets database ID |
| `NOTION_SNAPSHOTS_DB` | Performance Snapshots database ID |
| `NOTION_CHANGE_REQUESTS_DB` | Change Requests database ID |
| `NOTION_SOURCE_QUEUE_DB` | Source Assets Queue database ID |
| `NOTION_CAMPAIGNS_DB` | Campaign Config database ID |
| `NOTION_TEXT_EXAMPLES_DB` | Text Examples database ID |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook URL |
| `CLAUDE_API_KEY` | Anthropic API key |

---

## 10. Error Handling

### 10.1 Error Categories

| Category | Examples | Recoverable |
|----------|----------|-------------|
| API Errors | Notion rate limit, Slack timeout | Yes (retry) |
| Business Logic | Min assets violation, duplicate asset | Yes (skip) |
| System Errors | Timeout, config error | Partial |

### 10.2 Retry Logic

- Rate limit errors (429): Exponential backoff, max 3 retries
- Service unavailable (503): Retry with backoff
- Timeout errors: Save progress, continue next run

### 10.3 Error Notifications

- Critical errors: Immediate Slack notification
- Recoverable errors: Logged, included in daily summary
- All errors: Stored in Script Properties history (last 20)

### 10.4 Timeout Management

- Max execution: 5.5 minutes (30s buffer before 6-min limit)
- Progress checkpoint: Save state before timeout
- Continuation: Pick up from saved state on next run

---

## 11. Security

### 11.1 Credential Management

| Requirement | Implementation |
|-------------|----------------|
| API keys storage | Script Properties (encrypted at rest) |
| No hardcoded secrets | All secrets via `getSecrets()` |
| Access control | Script runs under authorized user |

### 11.2 Access Permissions

| Service | Required Permission | Scope |
|---------|---------------------|-------|
| Google Ads | Standard or Admin access | Target account only |
| Notion | Internal integration | Shared databases only |
| YouTube | Read-only | Playlist access only |
| Slack | Webhook | Single channel posting |

### 11.3 Data Protection

- All API calls use HTTPS
- No PII stored (only ad performance metrics)
- Asset content referenced by ID, not stored
- Complete audit trail in Notion

---

## 12. Implementation Roadmap

### Phase 1: Foundation

- [ ] Create Notion workspace
- [ ] Create all 9 databases with correct schemas
- [ ] Populate App Config with Abrello value propositions
- [ ] Create Notion internal integration
- [ ] Share databases with integration
- [ ] Set up Slack channel and webhook
- [ ] Create Apps Script project
- [ ] Configure `appsscript.json`
- [ ] Set Script Properties with all secrets
- [ ] Implement `Config.gs`
- [ ] Implement `Utils.gs`
- [ ] Implement `NotionClient.gs`
- [ ] Implement `SlackClient.gs`
- [ ] Test Notion and Slack connectivity

### Phase 2: Read Operations

- [ ] Implement `FilenameParser.gs`
- [ ] Implement `YouTubeClient.gs`
- [ ] Implement `GoogleAdsClient.gs` (read operations)
- [ ] Implement `SourceSync.gs`
- [ ] Test YouTube playlist sync
- [ ] Test Notion image asset sync
- [ ] Test Google Ads campaign queries
- [ ] Test asset performance queries

### Phase 3: Data Management

- [ ] Implement `NotionDataManager.gs`
- [ ] Implement Creative Set creation/lookup
- [ ] Implement Asset Registry management
- [ ] Implement Performance Snapshot creation
- [ ] Implement Source Queue management
- [ ] Test full sync cycle
- [ ] Implement `StateManager.gs`

### Phase 4: Analysis & Recommendations

- [ ] Implement `PerformanceAnalysis.gs`
- [ ] Implement `RecommendationEngine.gs` with replacement priority logic
- [ ] Implement protected asset checking
- [ ] Implement Change Request creation
- [ ] Implement daily summary Slack notification
- [ ] Test analysis workflow end-to-end
- [ ] Implement `ClaudeClient.gs`
- [ ] Implement `TextGenerator.gs` with App Config integration
- [ ] Test AI text generation

### Phase 5: Execution

- [ ] Implement `ChangeExecutor.gs`
- [ ] Implement asset upload (YouTube videos)
- [ ] Implement asset upload (Notion images)
- [ ] Implement asset linking via mutate()
- [ ] Implement asset removal
- [ ] Implement rollback functionality
- [ ] Test execution workflow

### Phase 6: Integration & Polish

- [ ] Implement `ErrorHandler.gs`
- [ ] Implement `TimeoutManager.gs`
- [ ] Set up all triggers via `setupTriggers()`
- [ ] End-to-end testing with 1-2 campaigns
- [ ] Error handling improvements
- [ ] Performance optimization
- [ ] Documentation updates
- [ ] Create runbook for operations

---

## 13. Testing Checklist

### 13.1 Unit Tests

| Test | Purpose |
|------|---------|
| `testNotionConnection()` | Verify Notion API connectivity |
| `testSlackConnection()` | Verify Slack webhook works |
| `testYouTubeConnection()` | Verify YouTube playlist access |
| `testGoogleAdsConnection()` | Verify Google Ads API access |
| `testFilenameParser()` | Verify filename parsing logic |
| `testClaudeConnection()` | Verify Claude API works |

### 13.2 Integration Tests

| Test | Description | Expected Result |
|------|-------------|-----------------|
| Full Sync Cycle | Run `syncSourceAssets()` | Source Queue populated |
| Full Analysis Cycle | Run `runPerformanceAnalysis()` | Snapshots created, Slack sent |
| Change Execution | Approve request, run `executeApprovedChanges()` | Asset added/removed |
| Rollback | Create REACTIVATE request | Paused asset restored |
| Protected Asset | Mark asset protected, trigger removal | Removal blocked |

### 13.3 Manual Verification Points

- [ ] Notion databases have correct relations
- [ ] Slack notifications format correctly
- [ ] Google Ads UI reflects asset changes
- [ ] Performance labels update correctly
- [ ] Audit trail is complete
- [ ] Protected assets are never rotated
- [ ] Replacement uses newest GOOD/BEST assets

---

## Appendix A: Google Ads Asset Resource Names

Format: `customers/{customer_id}/assets/{asset_id}`

Example: `customers/1234567890/assets/9876543210`

Used for:
- Primary key in Asset Registry
- mutate() operations
- Performance queries

---

## Appendix B: Notion Property Type Mappings

| Notion Type | Apps Script Representation |
|-------------|---------------------------|
| Title | `{ title: [{ text: { content: "value" } }] }` |
| Rich Text | `{ rich_text: [{ text: { content: "value" } }] }` |
| Select | `{ select: { name: "value" } }` |
| Multi-select | `{ multi_select: [{ name: "value" }] }` |
| Number | `{ number: 123 }` |
| Checkbox | `{ checkbox: true }` |
| Date | `{ date: { start: "2024-01-01" } }` |
| URL | `{ url: "https://..." }` |
| Relation | `{ relation: [{ id: "page_id" }] }` |
| Files | `{ files: [{ name: "file.png", file: { url: "..." } }] }` |

---

## Appendix C: Performance Label Definitions

| Label | Meaning | Google's Description |
|-------|---------|---------------------|
| PENDING | Not yet evaluated | Asset recently added |
| LEARNING | Gathering data | Insufficient impressions |
| LOW | Below average | Worst performing in group |
| GOOD | Average | Moderate performance |
| BEST | Above average | Top performer in group |

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2024-XX-XX | Initial comprehensive documentation |
| 1.1 | 2024-XX-XX | Added App Config database, protected status, updated image source to Notion, clarified replacement logic, removed all code |

---

*End of Documentation*
