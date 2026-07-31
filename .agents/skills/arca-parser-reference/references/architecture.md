# Architecture Notes

Trust current code when it differs from this reference, then update this file in the same change.

## Supported Scope

- Sites: `arca.live`, `x.com`, `twitter.com`
- Media: images, GIFs, videos
- Runtime root: `src/`
- Site engines: `arca_article`, `tweet_media`

## Runtime Ownership

### `src/shared/media-utils.js`

Own:

- Windows-safe path and basename normalization
- URL filename parsing
- tweet and video ID extraction
- X main bundle URL allow-listing
- recursive API media discovery
- highest-bitrate MP4 selection
- DOM/API video matching

### `src/content/content.js`

Own:

- site config lookup
- `siteAdapters` registry
- Arca article and list DOM collection
- X/Twitter tweet and media target collection
- media item and folder title bridge exposed to the UI

Arca rules include `.fr-view.article-content`, original `ac-o.namu.la` links, `video[data-orig="gif"]`, `.fr-video video`, and emoticon exclusion.

### `src/content/twitter-resolver.js`

Resolve X/Twitter video in this order:

1. Direct `video.twimg.com` URL
2. Current page-session API request
3. Background guest GraphQL request

Use the current `abs.twimg.com/responsive-web/client-web.../main.*.js` URL only after shared validation. Keep GIF UI type independent from the MP4 transport format.

### `src/content/content-ui.js`

Own:

- closed Shadow DOM UI
- filters, selection, existing markers
- inline X/Twitter action buttons
- start, append, cancel, retry, and status interactions
- local Blob download coordination

### `src/background/twitter-api.js`

Own bearer token, guest token, operation ID, GraphQL variables/features, and status-based metadata refresh. Do not add queue or filename state.

### `src/background/background.js`

Own:

- action message routing
- normalized queue items
- folder-and-basename deduplication
- per-site parallelism and delay
- retry alarms and failure history
- Chrome download events
- persistence and state broadcasts

## Message Actions

The current background handles:

- `appendDownloads`
- `cancel`
- `checkExisting`
- `clearFailureHistory`
- `getFailureHistory`
- `getSiteConfig`
- `getState`
- `getTwitterDetailsRequest`
- `removeBatchItem`
- `reportDownloadResult`
- `resolveTwitterVideo`
- `resumePausedBatchFromPage`
- `startDownload`

## Change Impact

- Selector or media classification change: update site config or content adapter, then media tests and browser checks.
- X/Twitter API change: update shared parsing or background API, then mocked network tests and manual video checks.
- UI state change: check existing markers, append, cancel, progress, and failure history.
- Queue change: check deduplication, persistence, site concurrency, delay, retries, and filenames.
- Host or permission change: update manifest, privacy, public docs, tests, and AGENTS together.
