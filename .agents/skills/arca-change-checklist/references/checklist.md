# Detailed Checklist

## Manifest and Scope

Check `src/manifest.json`:

- `content_scripts.matches`
- `host_permissions`
- `permissions`
- background service worker
- injected script order
- icon paths

If a host or permission changes, update README, privacy policy, site config, publishing checklist, and AGENTS in the same change.

## Extraction and Media Semantics

Check:

- `src/config/site-config.default.json`
- `src/content/content.js`
- `src/content/twitter-resolver.js`
- `src/shared/media-utils.js`

Preserve Arca original URL conversion, emoticon exclusion, GIF/video distinction, title normalization, and `sourceIndex`. Preserve X/Twitter image grouping, GIF-as-MP4 behavior, direct video preference, page-session fallback, background GraphQL fallback, and highest-bitrate MP4 selection.

## Page UI

Check `src/content/content-ui.js`:

- panel and inline button lifecycle
- media filters and selection
- existing-download markers
- start versus append behavior
- progress, retry, failure history, and cancel states
- local Blob versus background download routing

## Background Queue

Check:

- `src/background/twitter-api.js`
- `src/background/background.js`

Preserve normalized item shape, folder-and-basename deduplication, persistence, event routing, retry alarms, cancellation, and per-site queue settings. Arca defaults to parallelism `2`; X/Twitter defaults to parallelism `1` and delay `700ms`.

## Tests and Public Safety

- Add minimal synthetic test objects rather than captured pages.
- Mock every network call and fail unexpected URLs.
- Run all scripts under `tools/`.
- Inspect `src/` for repository-only files.
- Search public files for credentials, personal paths, browser data, and accidental identifiers.
- Inspect the generated ZIP and Git history before publishing.

## Documentation

Update `AGENTS.md` whenever current architecture, support scope, permissions, release structure, or important regression risks change. Do not maintain a dated work log.
