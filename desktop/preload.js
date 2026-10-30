'use strict';

/**
 * The only desktop features the page can reach. It gets these two calls and
 * nothing else: no Node.js, no file system, no shell.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cscDesktop', {
  /** Open ~/.claude/skills in the system file manager (created if missing). */
  openSkillsFolder: () => ipcRenderer.invoke('csc:open-skills-folder'),
  /** The app version from package.json. */
  version: () => ipcRenderer.invoke('csc:version'),
});
