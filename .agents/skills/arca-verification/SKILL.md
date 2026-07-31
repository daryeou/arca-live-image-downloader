---
name: arca-verification
description: Use when verifying Arca Image Downloader parser, UI, queue, permissions, public repository safety, or release package behavior before sharing or publishing changes.
---

# Arca Verification

## Start

From the repository root, list required targets:

```powershell
pwsh -File .agents/skills/arca-verification/scripts/list_verification_targets.ps1
```

Read `references/verification-matrix.md` and select checks that cover the changed boundary.

## Automated Checks

```powershell
node tools/test-validate-extension.js
node tools/test-media-utils.js
node tools/test-twitter-api.js
node tools/validate-extension.js
```

For release work:

```powershell
pwsh -File tools/package-extension.ps1
```

Inspect the ZIP root and confirm it contains runtime files only.

## Browser Checks

When browser execution is available, verify the affected Arca or X/Twitter flow, including selection, existing markers, start, append, progress, cancel, retry, and output names. Use a clean browser profile when existing download history could hide selection.

## Public Safety

- Reject captured pages, browser profiles, network archives, logs, real credentials, and private local paths.
- Use synthetic objects and mocked requests in automated tests.
- Compare manifest permissions with README and privacy policy.
- Inspect Git history when sensitive files were deleted before publication.

## Reporting

State the commands run, pass/fail counts, browser coverage, package inspection, privacy findings, and any remaining unverified behavior. Never imply browser coverage from static tests.

## Resources

- `references/verification-matrix.md`
- `scripts/list_verification_targets.ps1`
