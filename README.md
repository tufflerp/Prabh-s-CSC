# Prabh's CSC

**Claude Skill Connector**: browse safety-checked skills and install them into
Claude Code with one click.

Claude Code can learn new abilities from *skills*: folders with a `SKILL.md` file
that Claude reads when a task calls for it. Installing one by hand means finding
it, checking it is safe, and copying it into the right hidden folder. Prabh's CSC
does all of that for you, and it never installs a skill without scanning it first.

- **331 ready-to-use skills** bundled in the app, all scanned before they ship
- **Safety scan** on every skill, including ones you add from GitHub
- **One-click install** into Claude Code, with update, remove and undo
- **Works offline**: no account, no tracking, no server
- **Open source** (MIT): everything the app does is in this repository

---

## Contents

- [Install](#install)
- [Using the app](#using-the-app)
- [How the safety scan works](#how-the-safety-scan-works)
- [Privacy and what the app can touch](#privacy-and-what-the-app-can-touch)
- [Browser support](#browser-support)
- [For developers](#for-developers)
- [Project layout](#project-layout)
- [Contributing, security and license](#contributing-security-and-license)

---

## Install

### Windows installer

1. Download `Prabhs-CSC-Setup.exe` from the [Releases](https://github.com/tufflerp/Prabh-s-CSC/releases) page.
2. Run it. It installs for your user only, so no administrator rights are needed.
   - Files go to `%LOCALAPPDATA%\Programs\Prabhs-CSC`.
   - It adds a **Prabh's CSC** shortcut to the Start menu and the desktop.
3. To remove it, go to **Settings > Apps > Installed apps > Prabh's CSC > Uninstall**.

> **Smart App Control.** The installer is not code-signed yet. On Windows 11
> PCs with Smart App Control turned on, Windows blocks unsigned programs, and it
> offers no "run anyway" option. If that happens, use the portable zip below.
> SmartScreen may also show "Windows protected your PC"; choose
> **More info > Run anyway** only if you downloaded the file from this repository.

### Portable zip (no installer)

1. Download `Prabhs-CSC.zip` from [Releases](https://github.com/tufflerp/Prabh-s-CSC/releases).
2. Right-click it, choose **Extract All**, and open the extracted folder.
3. Double-click **Open Prabh's CSC.bat**. It opens the app in a Microsoft Edge
   window. Or open **Prabh's CSC.html** in Chrome or Edge.

### From source

```bash
git clone https://github.com/tufflerp/Prabh-s-CSC
```

Then open `apps/skill-connector/index.html` in Chrome or Edge.

---

## Using the app

### 1. Connect to Claude Code (once)

1. Click **Connect to Claude** at the top right, then **Choose folder**.
2. In the folder picker, go to your Claude skills folder:
   - Windows: `C:\Users\<your name>\.claude\skills`
   - macOS / Linux: `~/.claude/skills`

   `.claude` is a hidden folder. On Windows, paste the path into the picker's
   address bar. Create the `skills` folder if it does not exist yet.
3. Click **Select folder**, then **Edit files** when the browser asks.

Skills in this folder work in every project. To install a skill for a single
project, use the folder switcher to add the project's folder. The app then
installs into `<project>/.claude/skills`.

### 2. Find skills

- **All skills**: the full library. Search by name or by what a skill does, or
  click a topic chip such as `roblox`, `testing` or `security`. Skills marked **Made for Prabh's CSC** were
  written for this app.
- **Preview**: shows what a skill contains, its safety-scan result, and a
  **Try it in Claude** example request you can copy.
- **Selected**: the skills you have ticked.
- **Installed**: what is in your connected skills folder right now, including
  skills you installed some other way.

### 3. Install

Tick the skills you want and click **Install** in the **Connect to Claude** panel.
After installing, the app reads each skill back to confirm Claude Code will
load it. Start a new Claude Code session and the skills are ready.

The panel offers two other ways to use skills:

| Tab | Use it for |
|---|---|
| **Install** | Write the skills straight into Claude Code, or download a `.zip` for the Claude desktop or web app |
| **CLAUDE.md** | A block to paste into a project's `CLAUDE.md` that helps Claude pick the right skills |
| **Claude API** | A system prompt that contains the selected skills, for your own API apps |

### Updates, removal and undo

- When a bundled skill has a newer version than the one you installed, its card
  shows **Update**.
- **History** lists every install, update and removal. Recent changes can be
  undone, which restores the files that were there before. The app warns you if
  you have edited a skill since then, because undo would discard those edits.
- **Re-scan installed** runs the current safety rules over everything already
  in your skills folder.
- The app warns when two folders contain a skill with the same name, because
  Claude would see duplicates.

### Add skills from GitHub

1. Click **Add from GitHub**, paste a link to a public repository, and click
   **Scan**. Any of these work: a repo, a branch, a folder, a link to a
   `SKILL.md` file, or the short form `owner/repo`.
2. The app downloads the files and scans every skill it finds. Each one is
   labelled **Passed safety scan**, a warning, or blocked.
3. Choose the skills you want and click **Add to library**. Blocked skills
   cannot be chosen, and the app asks before adding one it could not fully check.

Click **Watch this repo** to keep an eye on a repository. The app checks it for new
commits at most once an hour, and a notice appears when there are changes to
re-scan.

### Create your own skill

Click **Create a skill** and fill in a name, a description and instructions.
Live checks show whether the skill follows the naming rules, whether Claude
will recognise it, and whether it passes the safety scan. Your skills are saved
in the library and can be edited or deleted later.

---

## How the safety scan works

Every file in a skill is checked before it can be installed. The same rules run
in the app, in the build that bundles the library, and in this repository's
tests. They live in [`scripts/lib/skill-scan-core.js`](scripts/lib/skill-scan-core.js).

Each finding gets one of three levels:

| Level | Meaning |
|---|---|
| **Block** | Looks dangerous. The skill cannot be installed. |
| **Warn** | Allowed, but shown so you can check it is expected. |
| **Unverified** | Could not be checked (for example, the file is too large). The app asks before installing; the bundled library never ships these. |

Patterns it looks for include:

- Downloading a script and running it immediately (`curl … | sh`, PowerShell download-and-run)
- Hidden or encoded payloads that are decoded and run
- Reverse shells and remote access
- Reading passwords, SSH keys, browser password stores or cookies
- Sending secrets or environment variables to a remote server or webhook
- Destructive commands, such as wiping the home folder or a disk
- Making something start automatically at login or on a schedule
- Changing Claude's own settings or permissions, or turning off security tools
- Crypto miners
- Prompt injection: text aimed at overriding Claude or hiding actions from you
- Invisible or direction-changing Unicode characters that can hide instructions
- Executable binaries, oversized files, and file names Windows cannot store

The scan also checks that Claude will recognise the skill: a valid `SKILL.md`
with a correct name and description.

No scanner catches everything. Treat the scan as a strong first filter, and read
skills from sources you do not trust before installing them.

---

## Privacy and what the app can touch

- **No accounts, analytics or tracking.** The app has no server.
- **Network.** The app only goes online when you use **Add from GitHub** or
  watch a repository. Then it contacts `api.github.com` and
  `raw.githubusercontent.com`, and nothing else. The bundled library works fully offline.
- **Files.** The app can only read and write the folders you pick in the folder
  picker, and only after you approve access in the browser. It cannot see
  anything else on your computer.
- **Stored data.** Your library additions, history and backups for undo are
  kept in your browser's local storage (IndexedDB) on your own computer. The
  theme choice is stored in `localStorage`.

---

## Browser support

Installing straight into a folder uses the browser's File System Access API.

| Browser | Support |
|---|---|
| Microsoft Edge, Google Chrome (desktop) | Everything works |
| Firefox, Safari, mobile browsers | Browse, preview and scan work. Installs come as `.zip` downloads that you unzip into your skills folder. |

---

## For developers

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
```

| Command | What it does |
|---|---|
| `npm run build` | Scans `skills/` and regenerates `apps/skill-connector/data` |
| `npm test` | Checks that the app's files and data match `skills/` |
| `npm run check` | Full browser test of the app with Playwright |
| `npm run claude-e2e` | Installs a test skill through the app and confirms Claude Code uses it. Needs a signed-in `claude` CLI. |
| `npm run package` | Builds the portable `dist/Prabhs-CSC.zip` |
| `npm run installer` | Builds `dist/Prabhs-CSC-Setup.exe`. Needs NSIS (`makensis`). |
| `npm run artifact` | Builds a single-page version for hosting as a claude.ai Artifact |

The browser tests use Playwright's Chromium. To use an installed browser
instead, set `PLAYWRIGHT_CHROMIUM_PATH`, for example to the path of `msedge.exe`.

### Adding a skill to the library

1. Add a folder under `skills/` with a `SKILL.md`. It needs frontmatter with
   `name` (lowercase words joined by hyphens) and a `description` that says when
   Claude should use it.
2. Run `npm run build`. The build refuses to bundle any skill that fails the scan.
3. Run `npm test` and `npm run check`, then commit `skills/` together with the
   regenerated `apps/skill-connector/data`.

Optional: add a curated example request for the skill to `config/try-prompts.json`.

---

## Project layout

```text
apps/skill-connector/
  index.html, app.js, boot.js   the app (no framework, no build step needed to run)
  data/                         generated by npm run build: skill index, files, scan rules
  installer/                    NSIS script and icon for the Windows installer
skills/                         source of the bundled skills
config/
  skill-scan-allowlist.json     reviewed exceptions to scan findings
  original-skills.json          skills written for this app
  try-prompts.json              curated "Try it in Claude" examples
scripts/
  skill-connector-*.js          build, test, package and installer scripts
  lib/                          safety scan, skill index, zip writer
  ci/scan-skills.js             scans skills/ in CI
tests/ci/                       app and data consistency tests
```

---

## Contributing, security and license

- Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).
- Found a security problem, or a skill that gets past the scan? Please follow
  [SECURITY.md](SECURITY.md) rather than opening a public issue.
- Licensed under the [MIT License](LICENSE). Many of the bundled skills and the
  scanning code come from [ECC (everything-claude-code)](https://github.com/affaan-m/ECC),
  also MIT licensed.

Prabh's CSC is an independent project and is not affiliated with or endorsed by Anthropic.
