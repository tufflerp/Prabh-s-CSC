# Upgrade plan: Prabh's CSC as a Claude Code skill manager

Written after a full read of the codebase. It records what already works, what is
missing, and the order of work. Everything stays Claude Code only.

## What already works (keep)

- Library of bundled skills with search, topic chips, selection and preview.
- Install into `~/.claude/skills` or `<project>/.claude/skills`. Every install
  backs up the existing copy, writes the files, reads `SKILL.md` back to verify
  it, and restores the backup on any failure.
- History with undo, backups for the latest changes, and a warning when undo
  would discard later edits.
- Update detection for bundled skills (fingerprint compare), duplicate-name
  detection, and "Update all".
- GitHub import: link parsing, commit resolution, tree listing, caps on files
  and size, a scan of every file, and watched repositories.
- Safety scanner shared by the build, CI and the app. Reviewed exceptions are
  pinned by SHA-256.
- Desktop shell: sandboxed page, network allowlist, permission handler, and
  automatic reconnection.

## Gaps against the brief, in priority order

1. **Security report.** Findings have no risk tier, no explanation, no
   recommended action and no code excerpt. There is no security overview, and
   detection is missing Windows LOLBins, obfuscation, environment harvesting,
   raw-IP network use and Windows credential stores.
2. **Skill detail.** The preview shows only the raw `SKILL.md` body: no file
   tree, no file contents, no rendered Markdown, no install location and no dates.
3. **Library.** No categories, no installed/not-installed filter, no sorting,
   no way to clear filters.
4. **Dashboard.** No home page with real statistics or quick actions.
5. **Projects.** Project folders can be targets, but personal and project skills
   cannot be compared, and there is no project overview.
6. **Updates.** Updates are detected only for bundled skills. GitHub imports have
   no update check, no diff and no update center.
7. **History.** Only file changes are logged. Imports, created skills and scans
   are missing, and history cannot be filtered by folder.
8. **Settings.** Only a theme toggle exists.
9. **Editor.** Only `SKILL.md` can be edited. There is no Markdown preview, no
   supporting files, no folders, no rename and no export.
10. **GitHub import UX.** No file preview before adding, and the author, commit
    and duplicates are not shown clearly.

## Order of work

| Phase | Work |
|---|---|
| 1 | Scanner rule metadata (risk, kind, why, action), new rules with tests, and a security report component |
| 2 | Skill detail view (tabs: overview, SKILL.md rendered and raw, files, security, install), library filters, categories and sort |
| 3 | Dashboard, security overview, projects page, update center, activity history, settings, desktop "open folder" bridge |
| 4 | Multi-file skill editor with preview and export; GitHub import preview and summary |
| 5 | Tests for each feature, browser and desktop runs, and fixes |

## Status

All five phases are implemented:

- **Scanner:** `skill-scan-core.js` gained risk tiers, threat and suspicious
  kinds, explanations and recommended actions (`RULE_INFO`, `describeFinding`,
  `summarizeFindings`). It also gained rules for Windows LOLBins, obfuscation,
  environment dumps, raw-IP endpoints and Windows credential stores, plus an
  informational network-use note and conservative categories. Bundled skills
  carry their build-time findings. Unit tests are in
  `tests/ci/skill-scan-core.test.js`.
- **App:** grouped sidebar, Home, filters and sort, a tabbed skill detail view,
  Projects, Updates (with GitHub commit comparison, diff review and restore),
  Security, activity history with filters, Settings, a multi-file editor with
  preview and export, and GitHub import with source details, progress and
  clash notes.
- **Desktop:** `desktop/preload.js` exposes two calls, open the skills folder
  and the version, and the main process accepts them only from the app's own page.
- **Tests:** the browser check covers each new feature (132 checks). The desktop
  check verifies the bridge stays limited to those two calls.

Not done, by design: account sign-in for GitHub (the app stays account-free),
and automatic installation of updates (updates are always reviewed first).

## Rules followed

No new runtime dependencies. No placeholder data or controls that do nothing.
The page stays sandboxed, and any desktop-only feature goes through a narrow
preload API. The browser version keeps working. Nothing is ever overwritten
without a backup.
