---
name: arca-parser-reference
description: Use when tracing or changing Arca Image Downloader media extraction, X/Twitter video resolution, UI messaging, filename generation, duplicate detection, or download state behavior.
---

# Arca Parser Reference

## Start Here

Read `references/architecture.md` before a non-trivial parser, resolver, UI, or queue change.

Map work to one owner:

- Shared normalization and X/Twitter media selection: `src/shared/media-utils.js`
- Site config and adapter selection: `src/config/site-config.default.json`, `src/content/content.js`
- X/Twitter page and direct URL resolution: `src/content/twitter-resolver.js`
- Selection and status UI: `src/content/content-ui.js`
- X/Twitter guest GraphQL: `src/background/twitter-api.js`
- Queue and persistent state: `src/background/background.js`

## Trace a Media Item

1. Start from the matching site entry and adapter.
2. Follow the DOM result into `content-ui.js`.
3. For X/Twitter video, inspect direct, page-session, then background resolution.
4. Follow the message action into `background.js`.
5. Check normalization, `sourceIndex`, folder title, basename, and deduplication.
6. Verify state broadcasts and completion or failure handling.

## Invariants

- Keep `shared/media-utils.js` first in the manifest content script list.
- Preserve Arca emoticon exclusion and original media host conversion.
- Preserve X/Twitter GIF media type even when the downloaded file is MP4.
- Validate the X main bundle host and path before background fetches it.
- Keep queue state in background and site-specific DOM state in content scripts.
- Use synthetic tests and report manual browser coverage separately.

## Resources

Read `references/architecture.md` for selectors, fallback order, message actions, and change impacts.
