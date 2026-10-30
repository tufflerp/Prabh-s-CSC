# Security policy

Prabh's CSC installs files that Claude Code will read and act on, so security
reports are taken seriously.

## What to report

- A skill (bundled, or from GitHub) that does something harmful but passes the
  safety scan
- A way to make the app write outside the folder you picked
- A way for a web page or a GitHub repository to run code in the app
- Anything that leaks your files or data off your computer

## How to report

Please do **not** open a public issue for a vulnerability. Use GitHub's private
reporting instead: go to the repository's **Security** tab and click
**Report a vulnerability**.

Include:

- What you found, and how to reproduce it (a link or a minimal skill is ideal)
- What an attacker could do with it
- The app version (shown on the installer, or the commit you are running)

You should hear back within a week. Once a fix is released, you will be credited
in the release notes unless you would rather not be.

## Scope notes

- The safety scan is pattern-based. Bypasses are in scope and very welcome:
  each one becomes a new rule and a test.
- Skills you write yourself in **Create a skill** are still scanned, but what
  you choose to install is up to you.
