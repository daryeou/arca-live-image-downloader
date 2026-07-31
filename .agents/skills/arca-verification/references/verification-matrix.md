# Verification Matrix

Use this matrix to select the smallest verification set that proves a change.

| Change | Automated checks | Manual checks |
| --- | --- | --- |
| Manifest or paths | `node tools/test-validate-extension.js`, `node tools/validate-extension.js` | Load `src/` as an unpacked extension |
| File naming or media matching | `node tools/test-media-utils.js` | Confirm output names and media order |
| X/Twitter metadata or GraphQL | `node tools/test-twitter-api.js` | Confirm image, GIF, direct MP4, and `blob:` video tweets |
| Arca extraction | validator plus added synthetic unit coverage | Confirm article images, GIFs, video, and emoticon exclusion |
| UI state | all Node checks | Confirm filters, selection, existing markers, append, progress, and cancel |
| Queue behavior | all Node checks | Confirm per-site concurrency, delay, retry, failure history, and deduplication |
| Permissions or hosts | validator plus documentation scan | Confirm only intended sites receive content scripts |
| Release | all automated checks and package script | Install the generated package and inspect ZIP entries |

## Public Test Data Rules

- Use minimal synthetic objects for parser and media cases.
- Mock `fetch` and reject every unexpected URL in network tests.
- Never add captured pages, browser profiles, cookies, real tokens, or download histories.
- Label manual browser coverage separately from static or synthetic coverage.

## Verification Notes

Report:

- Commands run and their exit status
- Runtime paths or flows inspected
- Browser scenarios completed
- Package name and manifest location
- Privacy scan findings
- Any behavior that remains unverified
