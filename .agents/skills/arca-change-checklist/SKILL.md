---
name: arca-change-checklist
description: Use when changing supported sites, extraction behavior, download orchestration, manifest permissions, public documentation, or release packaging in Arca Image Downloader.
---

# Arca Change Checklist

## Workflow

1. Classify the change as runtime, permission, UI, queue, documentation, or release work.
2. Trace the complete path from `src/manifest.json` and site config through the responsible content and background modules.
3. Update synthetic tests before behavior changes.
4. Keep README, privacy policy, architecture, publishing checklist, and AGENTS aligned with current behavior.
5. Run the targeted tests, full validator, and package inspection before reporting completion.

## Cross-Cutting Rules

- Treat `src/` as the only deployable extension root.
- Support `arca.live`, `x.com`, and `twitter.com`; do not change support claims without matching manifest and runtime changes.
- Keep shared file and X/Twitter media logic in `src/shared/media-utils.js`.
- Keep X/Twitter token and GraphQL requests in `src/background/twitter-api.js`.
- Keep queue state mutations in `src/background/background.js`.
- Use only synthetic objects and mocked network calls in repository tests.
- Never package documentation, tools, editor settings, or project skills.

## Verification

Run:

```powershell
node tools/test-validate-extension.js
node tools/test-media-utils.js
node tools/test-twitter-api.js
node tools/validate-extension.js
```

For release work, also run:

```powershell
pwsh -File tools/package-extension.ps1
```

## Resources

Read `references/checklist.md` when a change crosses more than one runtime or documentation boundary.
