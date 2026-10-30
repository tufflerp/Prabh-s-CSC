# Prabh's CSC

Claude Skill Connector: a small offline web app for browsing safety-checked
skills and installing them into Claude Code with one click.

## Layout

- `apps/skill-connector/` - the app (`index.html`, `app.js`, `boot.js`) and its
  generated `data/`
- `skills/` - source skills bundled into the app
- `scripts/` - build, test and packaging scripts
- `installer/` (inside the app folder) - NSIS script and icon for the Windows installer

## Commands

Needs Node.js 18 or newer. Run `npm install` first.

| Command | What it does |
|---|---|
| `npm run build` | Safety-scans `skills/` and regenerates `apps/skill-connector/data` |
| `npm test` | Checks the app files and data match `skills/` |
| `npm run check` | Browser test of the app (Playwright) |
| `npm run claude-e2e` | Installs a test skill through the app and confirms Claude Code uses it (needs a signed-in `claude` CLI) |
| `npm run package` | Builds the portable `dist/Prabhs-CSC.zip` |
| `npm run installer` | Builds `dist/Prabhs-CSC-Setup.exe` (needs NSIS `makensis`) |

To use Microsoft Edge instead of Playwright's own browser, set
`PLAYWRIGHT_CHROMIUM_PATH` to `msedge.exe`.

## Windows installer and Smart App Control

The installer is unsigned. On Windows 11 PCs with Smart App Control turned on,
Windows blocks it until it is code-signed. Use the portable zip on those PCs.

## License

MIT. Based on [ECC (everything-claude-code)](https://github.com/affaan-m/ECC);
see `LICENSE`.
