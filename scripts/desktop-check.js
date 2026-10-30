#!/usr/bin/env node
/**
 * Smoke test of the desktop (Electron) app.
 *
 * Usage:
 *   node scripts/desktop-check.js
 *
 * Launches desktop/main.js with Playwright's Electron driver and checks that
 * the app loads its skills, can write to folders, and stays locked down: no
 * Node access in the page, no network except GitHub, no extra windows. The
 * app's own features are covered by scripts/skill-connector-check.js.
 */

'use strict';

/* global window, document, fetch -- used inside page.evaluate callbacks, which run in the app window */

const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    console.error('[desktop-check] Playwright is not installed. Install it with: npm i -D playwright');
    process.exit(2);
  }
}

async function main() {
  const { _electron: electron } = loadPlaywright();
  const failures = [];
  const check = (ok, label) => {
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (!ok) failures.push(label);
  };

  const app = await electron.launch({ args: [ROOT], cwd: ROOT });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('#boot', { state: 'detached', timeout: 15000 });

    console.log('Window');
    check((await page.title()) === 'Prabh’s CSC', 'window shows the app');
    const total = Number(await page.textContent('#count-all'));
    check(total > 0, `loads skills (${total})`);
    check(await page.evaluate(() => typeof window.showDirectoryPicker === 'function'), 'can install straight into a folder');
    check(await app.evaluate(({ Menu }) => process.platform === 'darwin' || Menu.getApplicationMenu() === null), 'no menu bar on Windows and Linux');

    console.log('Locked down');
    check(await page.evaluate(() => typeof window.require === 'undefined' && typeof window.process === 'undefined'), 'page has no Node access');
    const blocked = await page.evaluate(() => fetch('https://example.com/').then(() => false, () => true));
    check(blocked, 'requests to other sites are blocked');
    // Record links instead of opening the real browser.
    await app.evaluate(({ shell }) => {
      globalThis.opened = [];
      shell.openExternal = async (url) => {
        globalThis.opened.push(url);
      };
    });
    await page.evaluate(() => window.open('https://example.com/'));
    await page.waitForTimeout(500);
    check(app.windows().length === 1, 'links do not open new app windows');
    check((await app.evaluate(() => globalThis.opened)).includes('https://example.com/'), 'links open in the default browser');
    check((await page.evaluate(() => document.location.protocol)) === 'file:', 'app runs from local files');
  } finally {
    await app.close();
  }

  console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nDesktop app checks passed');
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`[desktop-check] ${err.message}`);
  process.exit(1);
});
