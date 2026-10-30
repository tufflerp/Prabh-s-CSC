'use strict';

const fs = require('fs');
const path = require('path');
const { parseFrontmatter, checkClaudeCompat, skillFingerprint, categorize, IGNORED_DIR_NAMES } = require('./skill-scan-core');
const { scanSkill, applyAllowlist, loadAllowlist } = require('./skill-scan');

/**
 * Every file of a skill as { path, full, size }, sorted, skipping caches and
 * dependency folders. The build ships exactly these files.
 */
function listSkillFiles(skillDir) {
  const files = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIR_NAMES.has(entry.name)) visit(full);
      } else if (entry.isFile()) {
        files.push({ path: path.relative(skillDir, full).split(path.sep).join('/'), full, size: fs.statSync(full).size });
      }
    }
  };
  visit(skillDir);
  return files;
}

function loadOriginals(skillsDir) {
  const file = path.join(skillsDir, '..', 'config', 'original-skills.json');
  try {
    return new Set(JSON.parse(fs.readFileSync(file, 'utf8')).skills);
  } catch {
    return new Set();
  }
}

function loadTryPrompts(skillsDir) {
  const file = path.join(skillsDir, '..', 'config', 'try-prompts.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Read every `<skillsDir>/<name>/SKILL.md` and return a sorted list of skills.
 * Directories without a SKILL.md, or without a name, are skipped.
 *
 * @param {string} skillsDir - Directory containing one folder per skill
 * `dir` is the folder in this repo; `installDir` is the folder to install into
 * (the frontmatter name when it is a valid folder name, so it matches what
 * Claude shows); `name` is the frontmatter name; `original` marks skills
 * written from scratch for this app (config/original-skills.json); `fp` is the
 * version fingerprint (skillFingerprint) used to spot updates; `tryPrompt` is
 * an example request (config/try-prompts.json, scripts/generate-try-prompts.js).
 *
 * Each skill also carries its `categories` (from its name and description) and the
 * `findings` of the safety scan, with reviewed exceptions marked `allowed`.
 *
 * @returns {Array<{ name: string, dir: string, installDir: string, original: boolean, tryPrompt: string, fp: string, description: string, body: string, categories: string[], findings: object[] }>}
 */
function buildSkillIndex(skillsDir) {
  const skills = [];
  const originals = loadOriginals(skillsDir);
  const tryPrompts = loadTryPrompts(skillsDir);
  const allowlist = loadAllowlist(path.join(skillsDir, '..', 'config', 'skill-scan-allowlist.json'));

  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const file = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;

    const text = fs.readFileSync(file, 'utf8');
    const { attributes, body } = parseFrontmatter(text);
    const name = attributes.name || entry.name;
    const skillDir = path.join(skillsDir, entry.name);
    const scanned = applyAllowlist(scanSkill(skillDir, { ignoreCaches: true }), skillDir, allowlist);
    skills.push({
      name,
      dir: entry.name,
      installDir: checkClaudeCompat(text, entry.name).installDir,
      original: originals.has(entry.name),
      tryPrompt: tryPrompts[entry.name] || '',
      fp: skillFingerprint(text, listSkillFiles(path.join(skillsDir, entry.name))),
      description: attributes.description || '',
      body,
      categories: categorize(name, attributes.description || ''),
      findings: scanned.findings.map((f) => ({ severity: f.severity, rule: f.rule, file: f.file.split(path.sep).join('/'), line: f.line, message: f.message })),
    });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { parseFrontmatter, buildSkillIndex, listSkillFiles };
