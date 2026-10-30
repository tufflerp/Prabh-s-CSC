# Contributing

Thanks for helping. Bug reports, new skills, scan rules and fixes are all welcome.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on
  the approach.
- Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Setup

```bash
git clone https://github.com/tufflerp/Prabh-s-CSC
cd Prabh-s-CSC
npm install
npx playwright install chromium
```

## Making a change

1. Create a branch.
2. Make your change:
   - **App:** `apps/skill-connector/app.js`, `index.html` and `boot.js`.
     These are plain JavaScript and HTML, with no framework and no build step.
   - **Skills:** add or edit a folder under `skills/`. Each skill needs a
     `SKILL.md` with `name` and `description` frontmatter.
   - **Scan rules:** `scripts/lib/skill-scan-core.js`.
3. If you touched `skills/` or the scan rules, run `npm run build` and commit
   the regenerated `apps/skill-connector/data` with your change.
4. Run the checks:

   ```bash
   npm test
   npm run check
   ```

5. Open a pull request that says what changed and why.

## Style

- Plain CommonJS JavaScript, Node 18 or newer, no TypeScript.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org)
  (`fix: …`, `feat: …`, `docs: …`).
- Keep the app usable offline. New network calls need a clear reason, and the
  README's privacy section must be updated to list them.
