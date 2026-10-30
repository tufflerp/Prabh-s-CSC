# Prabh's CSC

[![CI](https://github.com/tufflerp/Prabh-s-CSC/actions/workflows/ci.yml/badge.svg)](https://github.com/tufflerp/Prabh-s-CSC/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Claude Skill Connector**: browse safety-checked skills and install them into
Claude Code with one click.

Claude Code can learn new abilities from *skills*: folders with a `SKILL.md` file
that Claude reads when a task calls for it. Installing one by hand means finding
it, checking it is safe, and copying it into the right hidden folder. Prabh's CSC
does all of that for you, and it never installs a skill without scanning it first.

- **331 ready-to-use skills** bundled in the app, all scanned before they ship
- **Security report** for every skill, including ones you add from GitHub, with
  risk levels, exact file and line, and what to do
- **One-click install** into personal or project skill folders, with update,
  compare, remove and undo
- **Update center** for library and GitHub skills, with diffs before anything changes
- **Skill editor** for multi-file skills, with live checks and preview
- **A real Windows app** with its own window and Start-menu entry, plus a
  browser version for any computer
- **Works offline**: no account, no tracking, no server
- **Open source** (MIT): everything the app does is in this repository

---

## Contents

- [Install](#install)
- [Using the app](#using-the-app)
- [How the safety scan works](#how-the-safety-scan-works)
- [Privacy and what the app can touch](#privacy-and-what-the-app-can-touch)
- [Where it runs](#where-it-runs)
- [For developers](#for-developers)
- [Project layout](#project-layout)
- [Contributing, security and license](#contributing-security-and-license)

---

## Install

All downloads are on the [Releases](https://github.com/tufflerp/Prabh-s-CSC/releases)
page. GitHub Actions builds every release from the tagged source in this
repository, so what you download matches the code you can read here.

### Windows desktop app (recommended)

1. Download `Prabhs-CSC-Setup-<version>.exe` (about 125 MB).
2. Run it. It installs for your user only, so no administrator rights are
   needed, and opens the app when it finishes.
   - Files go to `%LOCALAPPDATA%\Programs\Prabhs-CSC`.
   - It adds a **Prabh's CSC** shortcut to the Start menu and the desktop.
3. To remove it, go to **Settings > Apps > Installed apps > Prabh's CSC > Uninstall**.

The desktop app is the same app in its own window, built with
[Electron](https://www.electronjs.org). It cannot reach any website except
GitHub (see [Privacy](#privacy-and-what-the-app-can-touch)).

> **The app is not code-signed yet.** Windows SmartScreen may show "Windows
> protected your PC". Choose **More info > Run anyway** only if you downloaded the
> file from this repository's Releases page. On PCs with Smart App Control, Windows
> may block unsigned programs outright. If it does, use the browser version below.

**No installer:** download `Prabhs-CSC-<version>-win-x64.zip`, extract it, and
run `Prabhs-CSC.exe`.

### Browser version (any computer)

1. Download `Prabhs-CSC.zip`.
2. Right-click it, choose **Extract All**, and open the extracted folder.
3. Double-click **Open Prabh's CSC.bat** (Windows), or open **Prabh's CSC.html**
   in Chrome or Edge.

### From source (Windows, macOS, Linux)

```bash
git clone https://github.com/tufflerp/Prabh-s-CSC
cd Prabh-s-CSC
npm install
npm start
```

`npm start` opens the desktop app. You can also open
`apps/skill-connector/index.html` in Chrome or Edge without installing anything.

---

## Using the app

### 1. Connect to Claude Code (once)

1. Click **Connect to Claude** at the top right, then **Choose folder**.
2. In the folder picker, go to your Claude skills folder:
   - Windows: `C:\Users\<your name>\.claude\skills`
   - macOS / Linux: `~/.claude/skills`

   `.claude` is a hidden folder. On Windows, paste the path into the picker's
   address bar. Create the `skills` folder if it does not exist yet.
3. Click **Select folder**. In the browser version, also click **Edit files**
   when the browser asks.

You only do this once. The desktop app remembers the folder and reconnects by
itself every time it starts. Browsers may ask you to click **Reconnect** after
they restart, because they reset folder access.

Skills in this folder work in every project. To install a skill for a single
project, add the project's folder on the **Projects** page or with the folder
switcher. The app then installs into `<project>/.claude/skills`.

### 2. Home

The **Home** page shows real numbers from your library and folders: skills in
the library, skills installed, personal and project skills, updates available,
and skills that need a security look. It also lists what you added, installed
and scanned recently, and has quick actions for the common jobs. In the desktop
app, **Open skills folder** opens `~/.claude/skills` in File Explorer.

### 3. Find skills

- **All skills**: the full library. Search by name, description or category,
  click a topic chip such as `roblox` or `testing`, or use the filters:
  - **Category**: Development, Frontend, Backend, Debugging, Testing, Security,
    DevOps, Design, Documentation, Productivity, Research, Data or Games. A skill
    only gets a category when its own name or description uses that category's
    words, so some skills have none.
  - **Status**: installed, not installed, update available, or needs a security review.
  - **Sort**: by name, category, or most recently updated.
- **Details**: click **Details** on any card to see:
  - **Overview**: source, commit, categories, file count and size, every
    frontmatter field, and whether Claude Code will load it.
  - **SKILL.md**: formatted or as raw text.
  - **Files**: every file, with line numbers. Lines with security findings are
    highlighted.
  - **Security**: the full security report (see below).
  - **Install**: exactly where the skill is installed, when it was last
    modified, and which of your other folders also have it.
- **Selected**: the skills you have ticked.
- **Installed**: what is in your connected skills folder right now, including
  skills you installed some other way.

Skills marked **Made for Prabh's CSC** were written for this app.

### 4. Install

Tick the skills you want and click **Install** in the **Connect to Claude** panel.
After installing, the app reads each skill back to confirm Claude Code will
load it. Start a new Claude Code session and the skills are ready.

The panel offers two other ways to use skills:

| Tab | Use it for |
|---|---|
| **Install** | Write the skills straight into Claude Code, or download a `.zip` for the Claude desktop or web app |
| **CLAUDE.md** | A block to paste into a project's `CLAUDE.md` that helps Claude pick the right skills |
| **Claude API** | A system prompt that contains the selected skills, for your own API apps |

Installing never overwrites anything silently. If a skill is already installed,
the app asks first, backs up the current copy, writes the new files, reads them
back to verify them, and puts the old copy back if anything fails.

### Personal and project skills

The **Projects** page lists your personal skills folder and every project folder
you added, with how many skills each holds. From there you can switch where
skills install, see a folder's skills and its history, and remove a project from
the list (its files are not touched). A comparison table shows which skills are
in which folders, and flags names that are installed in more than one place.

### Updates

The **Updates** page only shows updates that really exist:

- **Library versions**: installed skills whose files differ from the library's
  copy. **Compare** shows a line-by-line diff before you update.
- **GitHub imports**: **Check GitHub for updates** looks up the newest commit of
  each repository, and asks GitHub which files changed since the commit you
  imported. A skill only counts as updated when files in its own folder changed.
  **Review update** downloads the new version, scans it, and shows the diff and
  its security report. Nothing changes until you accept. The previous version
  is kept, so you can restore it.

### History, removal and undo

- **History** lists every install, update, removal, GitHub import, skill you
  created or edited, and security scan, with the date and the result. Filter it
  by type or by folder.
- Recent installs, updates and removals can be undone. Undo restores the files
  that were there before, and warns you if you edited a skill since then.
- **Security > Scan installed skills** runs the current rules over everything
  already in your skills folder.
- The app warns when two folders contain a skill with the same name, because
  Claude would see duplicates.

### Add skills from GitHub

1. Click **Add from GitHub**, paste a link to a public repository, and click
   **Scan**. Any of these work: a repo, a branch, a folder, a link to a
   `SKILL.md` file, or the short form `owner/repo`.
2. The app shows the repository, its author, the branch and the exact commit it
   resolved. It downloads the files, with a progress bar, and scans every skill
   it finds on this computer.
3. Each skill shows its scan result and risk level, how many files it has, and
   whether it clashes with a skill already in your library or installed.
   **Details and files** opens the full view before you decide.
4. Choose the skills you want and click **Add to library**. Blocked skills
   cannot be chosen, and the app asks before adding one it could not fully check.

GitHub content is never trusted just because it is on GitHub: every imported
skill goes through the same scanner. Large repositories are capped (30 skills,
300 files and 15 MB per skill per scan), and the app stops politely when it
reaches GitHub's limit for lookups without signing in.

Click **Watch this repo** to keep an eye on a repository. The app checks it for new
commits at most once an hour, and a notice appears when there are changes to
re-scan.

### Create and edit skills

Click **Create a skill**, or **Edit a copy** on any skill's details:

- The name and description fields write the `SKILL.md` frontmatter for you.
  The instructions start from a template (When to Use, How It Works, Examples).
- Add supporting files and folders (`scripts/`, `references/`, `assets/`),
  rename them, delete them, and edit text files in place.
- **Preview** shows the Markdown formatted.
- Live checks show whether the name follows the rules, whether Claude Code and
  the Claude app will load the skill, and the safety-scan result for **every**
  file. A file detected as dangerous blocks saving.
- **Export .zip** saves the finished skill as a zip file.

Your skills are saved in the library and can be edited, installed or deleted later.

### Settings

Theme (match Windows, light or dark), start page, default install location,
whether to ask before removing a skill, how many recent changes keep a backup,
clearing history, whether skills that could not be fully checked may be
installed at all, and automatic checks of watched repositories. The About
section shows the version and links to this repository.

---

## How the safety scan works

Every file in a skill is checked before it can be installed. The same rules run
in the app, in the build that bundles the library, and in this repository's
tests. They live in [`scripts/lib/skill-scan-core.js`](scripts/lib/skill-scan-core.js).

Every skill gets a **security report**. It shows the overall risk and, for each
finding:

- the risk tier
- whether it is a detected threat or a suspicious pattern
- the exact file and line, with a **View** button that jumps to it
- what was detected, why it matters, and what to do

| Risk | Meaning |
|---|---|
| **Critical** | A known dangerous pattern, such as running downloaded code, stealing credentials, or a reverse shell. The skill cannot be installed. |
| **High** | Strongly suspicious, such as obfuscated code, starting at login, or disabling security tools. Blocked in scripts. |
| **Warning** | Worth a look: a pattern that is often legitimate, a risky command mentioned in documentation, or a part that could not be checked. |
| **Info** | Informational only, such as "makes network requests", or a finding the library maintainers reviewed. |

Patterns it looks for include:

- Downloading a script and running it immediately (`curl … | sh`, PowerShell download-and-run)
- Windows tools abused to fetch or run code (`certutil`, `bitsadmin`, `mshta`, `regsvr32`, `rundll32`)
- Hidden, encoded or obfuscated code (base64 payloads, character-code tricks, encoded PowerShell)
- Reverse shells and remote access
- Reading passwords, SSH keys, cloud credentials, Windows saved credentials, or
  browser password and cookie stores
- Dumping every environment variable, or sending secrets to a remote server or webhook
- Connections to bare public IP addresses
- Destructive commands, such as wiping the home folder or a disk
- Making something start automatically at login or on a schedule
- Changing Claude's own settings or permissions, or turning off security tools
- Crypto miners
- Prompt injection: text aimed at overriding Claude or hiding actions from you
- Invisible or direction-changing Unicode characters that can hide instructions
- Executable binaries, archives, oversized files, and file names Windows cannot store

The **Security** page shows these results for the whole library, scans your
installed skills on demand, lists recent scans and imports, and explains every
rule. Scanning is entirely local. The scanner never removes or changes anything
by itself.

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
  The desktop app enforces this: it blocks every request to any other site
  ([`desktop/main.js`](desktop/main.js)), and links open in your normal browser.
- **Files.** The app can only read and write the folders you pick in the folder
  picker. It cannot see anything else on your computer. In the desktop app, the
  page has no access to Node.js or the rest of the system. It can make exactly
  two requests to the app itself ([`desktop/preload.js`](desktop/preload.js)):
  open `~/.claude/skills` in File Explorer, and read the app version.
- **Stored data.** Your library additions, history, activity log, settings and
  backups for undo are kept in local storage (IndexedDB) on your own computer.
  The theme choice is stored in `localStorage`.

---

## Where it runs

Installing straight into a folder uses the File System Access API.

| Where | Support |
|---|---|
| Desktop app (Windows; macOS and Linux from source) | Everything works |
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
| `npm start` | Runs the desktop app from source |
| `npm run build` | Scans `skills/` and regenerates `apps/skill-connector/data` |
| `npm test` | Checks that the app's files and data match `skills/`, and unit-tests the scanner |
| `npm run check` | Full browser test of the app with Playwright |
| `npm run check:desktop` | Launches the desktop app and checks it loads and stays locked down |
| `npm run claude-e2e` | Installs a test skill through the app and confirms Claude Code uses it. Needs a signed-in `claude` CLI. |
| `npm run installer` | Builds the Windows installer and the no-installer zip in `dist/desktop` |
| `npm run package` | Builds the browser version, `dist/Prabhs-CSC.zip` |
| `npm run artifact` | Builds a single-page version for hosting as a claude.ai Artifact |

### Releasing

1. Update `version` in `package.json` and commit.
2. Tag the commit and push the tag, for example
   `git tag v1.0.1` then `git push origin v1.0.1`.
3. The **Release** workflow builds the installer, the no-installer zip and the
   browser zip on GitHub's Windows runners, and publishes them as a GitHub release.

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
desktop/
  main.js, app.ico              the desktop app (Electron) that hosts the page
  preload.js                    the two desktop-only calls the page may use
skills/                         source of the bundled skills
config/
  skill-scan-allowlist.json     reviewed exceptions to scan findings
  original-skills.json          skills written for this app
  try-prompts.json              curated "Try it in Claude" examples
scripts/
  skill-connector-*.js          build, test and packaging scripts
  desktop-check.js              desktop app smoke test
  lib/                          safety scan, skill index, zip writer
  ci/scan-skills.js             scans skills/ in CI
tests/ci/                       app, data and scanner tests
docs/UPGRADE-PLAN.md            what was reviewed and changed in the skill-manager redesign
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
