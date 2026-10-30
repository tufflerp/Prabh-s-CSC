/* Prabh's CSC (Claude Skill Connector) - browser app logic.
 *
 * Data comes from data/skills-data.js (window.SKILLS). Full skill files are
 * loaded on demand from data/skill-files/<dir>.js (window.SKILL_FILES).
 * Safety rules, the SKILL.md parser and the "will Claude recognise it" check
 * come from data/scan-core.js (window.SkillScanCore), shared with the
 * repository's CI. ZIP downloads use data/zip-store.js.
 *
 * Claude Code loads personal skills from ~/.claude/skills/<name>/SKILL.md and
 * picks up changes live (code.claude.com/docs/en/skills). The Claude desktop
 * and web app take one uploaded zip per skill instead.
 */
(function () {
  'use strict';

  const Scan = window.SkillScanCore;
  const ALLOWLIST = window.SKILL_SCAN_ALLOWLIST || [];
  const Zip = window.ZipStore;

  // Bundled skills carry the findings of the build-time scan (reviewed exceptions marked "allowed").
  const bundled = (window.SKILLS || []).map((s) => Object.assign({}, s, { id: s.dir, source: 'bundled', findings: s.findings || [], status: statusOf(s.findings || []) }));
  let github = [];
  let custom = []; // skills made in the app (Skill maker)
  let local = []; // installed in Claude but not part of this library
  let byId = new Map();
  const selected = new Set();
  const state = {
    view: 'home',
    mode: 'install',
    query: '',
    open: { app: false, terminal: false },
    showAllTags: false,
    filters: { category: '', status: '', sort: 'name' },
    historyFilter: { type: '', target: '' },
  };
  // Views that show a page instead of the skill grid and install panel.
  const PAGE_VIEWS = new Set(['home', 'projects', 'updates', 'security', 'settings']);
  const APP_INFO = window.CSC_APP || { version: '', homepage: '' };
  // Desktop app only: a narrow bridge from desktop/preload.js (no Node access in the page).
  const DESKTOP = window.cscDesktop || null;

  const DEFAULT_SETTINGS = { startView: 'home', backupsKept: 3, allowUnverified: true, autoCheckWatched: true, confirmRemove: true, defaultTargetId: '' };
  let settings = { ...DEFAULT_SETTINGS };

  const $ = (id) => document.getElementById(id);
  const grid = $('grid');
  const search = $('search');
  const connectBody = $('connect-body');
  const preview = $('preview');
  const toast = $('toast');
  let previewId = null;

  const CHIPS = ['original', 'roblox', 'game', 'animation', 'testing', 'security', 'react', 'python', 'api', 'agent', 'docs'];
  const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const ORIGINAL_LABEL = "Made for Prabh's CSC";
  // Hosted on claude.ai (an Artifact): a locked-down frame that can't reach GitHub or write
  // folders, but can offer files through the `downloads` capability.
  const HOSTED = Boolean(window.claude && typeof window.claude.use === 'function');
  const SUPPORTS_FOLDER_WRITE = !HOSTED && typeof window.showDirectoryPicker === 'function';
  let hostedDownloads = null;
  const APP_DESCRIPTION_LIMIT = 200;

  const STATUS = {
    passed: { label: 'Passed safety scan', cls: 'pill-passed' },
    warnings: { label: 'Passed with notes', cls: 'pill-warnings' },
    unverified: { label: "Couldn't be checked", cls: 'pill-unverified' },
    invalid: { label: "Claude can't load this", cls: 'pill-blocked' },
    blocked: { label: 'Blocked: unsafe', cls: 'pill-blocked' },
  };
  const NOT_INSTALLABLE = new Set(['blocked', 'invalid']);

  const ICONS = {
    check: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
    x: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    eye: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    spark: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>',
    install: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14"/></svg>',
    zip: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M10 12h2m-2 3h2m-2 3h2"/></svg>',
    warn: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4m0 4h.01"/></svg>',
    ok: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4m0-4h.01"/></svg>',
  };

  // ---------------------------------------------------------------- helpers

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== null && text !== undefined) node.textContent = text;
    return node;
  }

  function withIcon(node, icon, label) {
    node.innerHTML = icon;
    node.appendChild(document.createTextNode(label));
    return node;
  }

  /** Remember which control had focus, re-render, then put focus back on its replacement. */
  function keepFocus(render) {
    const active = document.activeElement;
    const key = active && active.dataset ? active.dataset.focusKey : null;
    render();
    if (!key) return;
    const target = document.querySelector(`[data-focus-key="${CSS.escape(key)}"]`);
    if (target && !target.disabled && target.offsetParent !== null) target.focus({ preventScroll: true });
    else if (!document.activeElement || document.activeElement === document.body) $('results-title').focus({ preventScroll: true });
  }

  function library() {
    return bundled.concat(github, custom);
  }

  function reindex() {
    byId = new Map(library().concat(local).map((s) => [s.id, s]));
  }

  function chosen() {
    return library().filter((s) => selected.has(s.id));
  }

  function plural(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
  }

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  function formatDate(value) {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function timeAgo(value) {
    const ms = Date.now() - new Date(value).getTime();
    if (!Number.isFinite(ms)) return '';
    const min = Math.round(ms / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h} h ago`;
    const days = Math.round(h / 24);
    return days < 30 ? `${days} day${days === 1 ? '' : 's'} ago` : formatDate(value);
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Inline Markdown on already-escaped text: code, bold, italics, and http(s) links only. */
  function mdInline(escaped) {
    const codes = [];
    let out = escaped.replace(/`([^`]+)`/g, (m, c) => `\u0000${codes.push(c) - 1}\u0000`);
    out = out
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, label, href) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
    return out.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${codes[Number(i)]}</code>`);
  }

  /**
   * Small, safe Markdown renderer for previews: everything is escaped first, so
   * skill content can never inject markup or scripts. Handles headings, lists,
   * code blocks, quotes, tables, rules and paragraphs.
   */
  function renderMarkdown(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const html = [];
    let i = 0;
    const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
    const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => mdInline(escapeHtml(c.trim())));
    while (i < lines.length) {
      const line = lines[i];
      const fence = line.match(/^\s*(```|~~~)/);
      if (fence) {
        const code = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++]);
        i++;
        html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        continue;
      }
      if (!line.trim()) { i++; continue; }
      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        const level = Math.min(heading[1].length, 4);
        html.push(`<h${level}>${mdInline(escapeHtml(heading[2].replace(/\s+#+\s*$/, '')))}</h${level}>`);
        i++;
        continue;
      }
      if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { html.push('<hr>'); i++; continue; }
      if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
        html.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
        continue;
      }
      if (/^\s*>/.test(line)) {
        const quote = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
        html.push(`<blockquote>${mdInline(escapeHtml(quote.join(' ')))}</blockquote>`);
        continue;
      }
      const listItem = /^\s*(?:[-*+]|\d+[.)])\s+/;
      if (listItem.test(line)) {
        const ordered = /^\s*\d+[.)]/.test(line);
        const items = [];
        while (i < lines.length && (listItem.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
          if (listItem.test(lines[i])) items.push(lines[i].replace(listItem, ''));
          else items[items.length - 1] += ` ${lines[i].trim()}`;
          i++;
        }
        const tag = ordered ? 'ol' : 'ul';
        html.push(`<${tag}>${items.map((it) => `<li>${mdInline(escapeHtml(it.replace(/^\[( |x)\]\s+/i, (m, x) => (x.trim() ? '☑ ' : '☐ '))))}</li>`).join('')}</${tag}>`);
        continue;
      }
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*(```|~~~)|\s*>|\s*(?:[-*+]|\d+[.)])\s+)/.test(lines[i])) para.push(lines[i++].trim());
      if (!para.length) para.push(lines[i++].trim());
      html.push(`<p>${mdInline(escapeHtml(para.join(' ')))}</p>`);
    }
    return html.join('\n');
  }

  /** Categories of a library skill: from the build for bundled skills, otherwise from its own text. */
  function categoriesOf(skill) {
    if (!skill.categories) skill.categories = Scan.categorize(skill.name, skill.description);
    return skill.categories;
  }

  /** Security summary of a skill's findings (cached on the skill). */
  function reportOf(skill) {
    const findings = skill.findings || [];
    if (!skill.report || skill.report.n !== findings.length) skill.report = Object.assign(Scan.summarizeFindings(findings), { n: findings.length });
    return skill.report;
  }

  function needsReview(skill) {
    return ['critical', 'high', 'warning'].includes(reportOf(skill).level);
  }

  /** When a skill last changed, where known: installed copy, import or save time. */
  function updatedTime(skill) {
    const info = installed.get(skill.installDir);
    const times = [info && installState(skill) ? info.modified : 0, Date.parse(skill.addedAt || '') || 0, Date.parse(skill.updatedAt || '') || 0];
    return Math.max(...times);
  }

  function showToast(message, ms) {
    toast.textContent = message;
    // Re-show as a popover so the toast lands above any open dialog.
    if (toast.showPopover) {
      try {
        if (toast.matches(':popover-open')) toast.hidePopover();
        toast.showPopover();
      } catch {
        /* popover unsupported: fall back to the fixed-position toast */
      }
    }
    requestAnimationFrame(() => toast.classList.add('show'));
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        if (toast.hidePopover && toast.matches(':popover-open') && !toast.classList.contains('show')) toast.hidePopover();
      }, 250);
    }, ms || 2200);
  }

  function statusOf(findings) {
    if (findings.some((f) => f.severity === 'block')) return 'blocked';
    if (findings.some((f) => f.severity === 'invalid')) return 'invalid';
    if (findings.some((f) => f.severity === 'unverified')) return 'unverified';
    if (findings.some((f) => f.severity === 'warn')) return 'warnings';
    return 'passed';
  }

  async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Apply the repository's reviewed exceptions. An exception only applies when
   * the file is byte-for-byte the version that was reviewed (same SHA-256).
   */
  async function applyAllowlist(dir, files, findings) {
    for (const f of findings) {
      if (f.severity !== 'block' && f.severity !== 'unverified') continue;
      const entry = ALLOWLIST.find((e) => e.skill === dir && e.file === f.file && e.rule === f.rule);
      const file = entry && files.find((x) => x.path === f.file);
      if (file && (await sha256Hex(file.bytes)) === entry.sha256) f.severity = 'allowed';
    }
  }

  function firstReason(skill, severity) {
    const f = (skill.findings || []).find((x) => x.severity === severity);
    return f ? `${f.message}${f.file && f.file !== '.' ? ` (${f.file})` : ''}` : '';
  }

  // ---------------------------------------------------------- security report

  const RISK_LABEL = { critical: 'Critical', high: 'High', warning: 'Warning', info: 'Info', clean: 'Clean' };
  const KIND_LABEL = { threat: 'Detected threat pattern', suspicious: 'Suspicious pattern', unverified: "Couldn't be checked", compat: 'Compatibility', reviewed: 'Reviewed exception', info: 'Informational' };
  const LEVEL_TEXT = {
    critical: 'Critical risk: dangerous behaviour was detected',
    high: 'High risk: review before installing',
    warning: 'Review recommended',
    info: 'No risky patterns found (informational notes only)',
    clean: 'No known risky patterns found',
  };

  function riskBadge(level) {
    return el('span', `risk ${level}`, RISK_LABEL[level]);
  }

  function labelled(label, text) {
    const p = el('p');
    p.appendChild(el('strong', null, `${label}: `));
    p.appendChild(document.createTextNode(text));
    return p;
  }

  /**
   * A security report: overall risk, then each finding with its tier, what was
   * detected, where, why it matters and what to do. `opts.onView(file, line)`
   * adds a View button for files that `opts.canView(file)` can show.
   */
  function renderReport(findings, opts) {
    const options = opts || {};
    const report = Scan.summarizeFindings(findings);
    const wrap = el('div', 'report');
    const summary = el('div', `report-summary ${report.level}`);
    summary.appendChild(riskBadge(report.level));
    summary.appendChild(el('span', 'level', LEVEL_TEXT[report.level]));
    const counts = el('div', 'counts');
    for (const k of ['critical', 'high', 'warning', 'info']) {
      if (report.counts[k]) counts.appendChild(el('span', 'pill', `${report.counts[k]} ${RISK_LABEL[k].toLowerCase()}`));
    }
    summary.appendChild(counts);
    wrap.appendChild(summary);
    for (const f of report.findings) {
      const card = el('div', 'finding');
      const head = el('div', 'finding-head');
      head.appendChild(riskBadge(f.risk));
      head.appendChild(el('span', 'finding-title', f.title));
      head.appendChild(el('span', 'finding-kind', KIND_LABEL[f.kind] || ''));
      const where = el('span', 'finding-where');
      if (f.file && f.file !== '.') {
        where.appendChild(el('code', null, f.file + (f.line ? `:${f.line}` : '')));
        if (options.onView && (!options.canView || options.canView(f.file))) {
          const view = el('button', 'btn btn-sm btn-ghost', 'View');
          view.type = 'button';
          view.setAttribute('aria-label', `View ${f.file}${f.line ? ` line ${f.line}` : ''}`);
          view.addEventListener('click', () => options.onView(f.file, f.line));
          where.appendChild(view);
        }
      }
      head.appendChild(where);
      card.appendChild(head);
      if (f.message && f.message !== f.title) card.appendChild(labelled('Detected', f.message));
      if (f.why) card.appendChild(labelled('Why it matters', f.why));
      if (f.action) card.appendChild(labelled('Recommended', f.action));
      wrap.appendChild(card);
    }
    wrap.appendChild(el('p', 'report-note', 'The scan runs on this computer and looks for known risky patterns. A clean result is not a guarantee that a skill is safe. Nothing is removed or changed automatically.'));
    return wrap;
  }

  const decoder = new TextDecoder('utf-8');
  const encoder = new TextEncoder();

  /** Scan a skill's files ([{ path, bytes }]) the same way the build and GitHub import do. */
  async function scanFiles(dir, files) {
    const findings = [];
    for (const f of files) {
      findings.push(...Scan.inspectPath(f.path).filter((x) => x.severity === 'block'));
      findings.push(...Scan.inspectFile(f.path, f.bytes));
    }
    if (!files.some((f) => f.path === 'SKILL.md')) findings.push({ severity: 'invalid', rule: 'missing-skill-md', file: '.', line: 0, message: 'Folder has no SKILL.md' });
    await applyAllowlist(dir, files, findings);
    return findings;
  }

  /** Normalise SKILL.md so Claude Code reads the frontmatter (no BOM before ---). */
  function normalizeSkillMd(text) {
    return text.replace(/^\uFEFF/, '');
  }

  const IS_WINDOWS = /Win/i.test(navigator.platform || navigator.userAgent);
  const SKILLS_PATH = IS_WINDOWS ? '.claude\\skills' : '.claude/skills';

  // ------------------------------------------------------------ confirm UI

  function confirmDialog(title, paragraphs, okLabel, items, danger) {
    const dialog = $('confirm');
    $('confirm-title').textContent = title;
    const body = $('confirm-body');
    body.textContent = '';
    paragraphs.forEach((p) => body.appendChild(el('p', null, p)));
    if (items && items.length) {
      const ul = el('ul');
      items.forEach((item) => ul.appendChild(el('li', null, item)));
      body.appendChild(ul);
    }
    const ok = $('confirm-ok');
    ok.textContent = okLabel;
    ok.classList.toggle('btn-danger', Boolean(danger));
    $('confirm-cancel').hidden = okLabel === 'OK';
    dialog.showModal();
    return new Promise((resolve) => {
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        ok.onclick = null;
        $('confirm-cancel').onclick = null;
        dialog.removeEventListener('close', onClose);
        if (dialog.open) dialog.close();
        resolve(value);
      };
      // A close event queued by the previous dialog can arrive after this one opens; ignore it.
      const onClose = () => {
        if (!dialog.open) done(false);
      };
      ok.onclick = () => done(true);
      $('confirm-cancel').onclick = () => done(false);
      dialog.addEventListener('close', onClose);
    });
  }

  /** A one-button message in the confirm dialog. */
  function messageDialog(title, paragraphs, items) {
    return confirmDialog(title, paragraphs, 'OK', items);
  }

  // ------------------------------------------------------------ skill files

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => {
        script.remove();
        resolve();
      };
      script.onerror = () => {
        script.remove();
        reject(new Error(`Could not load ${src}`));
      };
      document.head.appendChild(script);
    });
  }

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  /** Every file of a skill as [{ path, bytes }], with SKILL.md normalised for Claude. */
  async function getFiles(skill) {
    let files;
    if (skill.source === 'github' || skill.source === 'custom') {
      files = skill.files;
    } else {
      window.SKILL_FILES = window.SKILL_FILES || {};
      if (!window.SKILL_FILES[skill.dir]) {
        await loadScript(`data/skill-files/${encodeURIComponent(skill.dir)}.js`).catch(() => {
          throw new Error(`The files for "${skill.name}" are missing. Re-download the app, or run node scripts/skill-connector-build.js.`);
        });
      }
      files = window.SKILL_FILES[skill.dir].map((f) => ({
        path: f.path,
        bytes: typeof f.text === 'string' ? encoder.encode(f.text) : base64ToBytes(f.base64),
      }));
      delete window.SKILL_FILES[skill.dir]; // decoded copy above is all we need; free the bundle
    }
    return files.map((f) => (f.path === 'SKILL.md'
      ? { path: f.path, bytes: encoder.encode(normalizeSkillMd(decoder.decode(f.bytes))) }
      : f));
  }

  function safeRelativePath(p) {
    const parts = p.split('/');
    return parts.length > 0 && parts.every((part) => part && part !== '.' && part !== '..' && !/[\\:*?"<>|]/.test(part));
  }

  /**
   * Rewrite SKILL.md frontmatter for the Claude app: the name must match the
   * folder, and descriptions are limited to 200 characters.
   */
  // Top-level SKILL.md keys the Claude app accepts; anything else moves under metadata.
  const APP_ALLOWED_KEYS = new Set(['license', 'allowed-tools', 'compatibility', 'metadata']);

  /**
   * Rewrite SKILL.md frontmatter for the Claude app: the name must match the
   * folder, descriptions are limited to 200 characters, and only a few
   * top-level keys are accepted (others are kept under `metadata`).
   */
  function prepareForClaudeApp(text, installDir) {
    const normalized = normalizeSkillMd(text).replace(/\r\n/g, '\n');
    const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
    const parsed = Scan.parseFrontmatter(normalized);
    let description = parsed.attributes.description || '';
    let shortened = false;
    if (description.length > APP_DESCRIPTION_LIMIT) {
      const cut = description.slice(0, APP_DESCRIPTION_LIMIT - 3);
      description = `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 120)).replace(/[\s,;:.-]+$/, '')}...`;
      shortened = true;
    }

    // Split the frontmatter into top-level key blocks (key line + indented continuation).
    const blocks = [];
    if (match) {
      for (const line of match[1].split('\n')) {
        const key = (line.match(/^([A-Za-z0-9_-]+):/) || [])[1];
        if (key) blocks.push({ key, lines: [line] });
        else if (blocks.length) blocks[blocks.length - 1].lines.push(line);
      }
    }
    const kept = [];
    const extras = [];
    let metadata = null;
    for (const block of blocks) {
      if (block.key === 'name' || block.key === 'description') continue;
      if (block.key === 'metadata') metadata = block.lines.slice();
      else if (APP_ALLOWED_KEYS.has(block.key)) kept.push(...block.lines);
      else {
        const value = [block.lines[0].replace(/^[A-Za-z0-9_-]+:\s*/, '')]
          .concat(block.lines.slice(1).map((l) => l.trim().replace(/^-\s+/, '')))
          .filter((v) => v && !/^[|>][+-]?\d*$/.test(v))
          .join(' ')
          .replace(/^(['"])([\s\S]*)\1$/, '$2');
        extras.push({ key: block.key, value });
      }
    }

    let moved = 0;
    if (extras.length) {
      if (!metadata) metadata = ['metadata:'];
      const inline = metadata[0].replace(/^metadata:\s*/, '');
      if (/^\{.*\}$/.test(inline)) {
        // Flow mapping: add the keys inside the braces.
        let body = inline.slice(1, -1).trim();
        for (const x of extras) {
          if (new RegExp(`(^|,)\\s*${x.key}\\s*:`).test(body)) continue;
          body += `${body ? ', ' : ''}${x.key}: ${JSON.stringify(x.value)}`;
          moved++;
        }
        metadata = [`metadata: {${body}}`];
      } else if (!inline || inline.startsWith('#')) {
        // Block mapping: match the indentation of existing children, skip keys already there.
        const child = metadata.slice(1).find((l) => /^\s+\S/.test(l));
        const indent = child ? child.match(/^\s+/)[0] : '  ';
        const existing = new Set(metadata.slice(1).map((l) => (l.match(/^\s+([A-Za-z0-9_-]+):/) || [])[1]).filter(Boolean));
        for (const x of extras) {
          if (existing.has(x.key)) continue;
          metadata.push(`${indent}${x.key}: ${JSON.stringify(x.value)}`);
          moved++;
        }
      }
      // Any other metadata form (a plain scalar) is left as is; the extra keys are dropped.
    }
    if (metadata) kept.push(...metadata);

    const head = [`name: ${installDir}`, `description: ${JSON.stringify(description)}`].concat(kept).join('\n');
    const bodyText = match ? normalized.slice(match[0].length) : normalized;
    return { text: `---\n${head}\n---\n${bodyText}`, shortened, movedToMetadata: moved };
  }

  // ------------------------------------------------ Claude Code skills folder

  const DB_NAME = 'prabhs-csc';
  function idb(mode, fn) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore('handles');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        try {
          const tx = open.result.transaction('handles', mode);
          const req = fn(tx.objectStore('handles'));
          tx.oncomplete = () => resolve(req && req.result);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        } catch (err) {
          // e.g. a handle the browser cannot store; the caller treats this as "not remembered"
          reject(err);
        }
      };
    });
  }
  const idbGet = (key) => idb('readonly', (store) => store.get(key)).catch(() => null);
  const idbPut = (key, value) => idb('readwrite', (store) => store.put(value, key)).then(() => true, () => false);
  // Skills added from GitHub are kept (with their scanned files) so they survive a reload.
  const saveGithub = () => idbPut('github-skills', github);
  const loadGithub = () => idbGet('github-skills');
  const saveCustom = () => idbPut('custom-skills', custom);
  const loadCustom = () => idbGet('custom-skills');

  /** 'unsupported' | 'disconnected' | 'needs-permission' | 'connected' */
  let connection = SUPPORTS_FOLDER_WRITE ? 'disconnected' : 'unsupported';
  let installed = new Map(); // installDir -> { name, description, body, fp }
  let lastInstall = null;
  let duplicateNames = new Map(); // skill name -> folders, when installed more than once
  let busy = false; // an install or download is running
  function setBusy(value) {
    busy = value;
    // Pages show busy-dependent buttons, so redraw them; elsewhere only the status box changes.
    if (PAGE_VIEWS.has(state.view) && typeof renderAll === 'function') renderAll();
    else if (typeof renderStatus === 'function') renderStatus();
  }

  // Where skills install: the personal folder (~/.claude/skills, every project) or a
  // project folder (<project>/.claude/skills, that project only).
  let targets = []; // { id, kind: 'personal'|'project', label, handle }
  let currentTargetId = null;
  const currentTarget = () => targets.find((t) => t.id === currentTargetId) || null;
  const saveTargets = () => idbPut('targets', { targets, current: currentTargetId });

  async function loadTargets() {
    const saved = await idbGet('targets');
    if (saved && Array.isArray(saved.targets)) {
      targets = saved.targets;
      currentTargetId = saved.current || (targets[0] && targets[0].id) || null;
      return;
    }
    const legacy = await idbGet('skills-dir'); // folder remembered by earlier versions
    if (legacy) {
      targets = [{ id: 'personal', kind: 'personal', label: 'Personal (all projects)', handle: legacy }];
      currentTargetId = 'personal';
      saveTargets();
    }
  }

  function useTarget(target) {
    targets = targets.filter((t) => t.id !== target.id).concat(target);
    targets.sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'personal' ? -1 : 1));
    currentTargetId = target.id;
    saveTargets();
  }

  /** The skills folder inside a target; with `create`, makes .claude/skills in a project. */
  async function skillsDirOf(target, create) {
    if (target.kind === 'personal') return target.handle;
    try {
      const claudeDir = await target.handle.getDirectoryHandle('.claude', { create });
      return await claudeDir.getDirectoryHandle('skills', { create });
    } catch (err) {
      if (!create && err && (err.name === 'NotFoundError' || err.name === 'TypeMismatchError')) return null;
      throw err;
    }
  }

  async function pickSkillsFolder() {
    const ok = await confirmDialog(
      'Connect to Claude Code',
      [
        'In the next window, open your user folder, then .claude, then skills. Create the skills folder if it is not there yet.',
        `On Windows this is C:\\Users\\<your name>\\.claude\\skills. Skills here work in every project. You only need to do this once.`,
      ],
      'Choose folder'
    );
    if (!ok) return null;
    const handle = await window.showDirectoryPicker({ id: 'claude-skills', mode: 'readwrite' });
    if (handle.name !== 'skills') {
      const keep = await confirmDialog(
        'Use this folder?',
        [`This folder is called "${handle.name}". Claude Code only looks for skills in a folder called "skills" inside .claude, so skills installed here will not show up in Claude. Use "${handle.name}" anyway?`],
        'Use it anyway'
      );
      if (!keep) return null;
    }
    useTarget({ id: 'personal', kind: 'personal', label: 'Personal (all projects)', handle });
    connection = 'connected';
    return handle;
  }

  /** Add a project folder as an install target (skills go into <project>/.claude/skills). */
  async function addProjectTarget() {
    if (!SUPPORTS_FOLDER_WRITE) return;
    const ok = await confirmDialog(
      'Add a project folder',
      [
        'Choose the folder you open in Claude Code for that project (its main folder).',
        'Skills installed there go into .claude/skills inside it and only load in that project. The app creates the folder when you first install.',
      ],
      'Choose project folder'
    );
    if (!ok) return;
    try {
      const handle = await window.showDirectoryPicker({ id: 'claude-project', mode: 'readwrite' });
      if (handle.name === 'skills' || handle.name === '.claude') {
        const keep = await confirmDialog(
          'Is this the project folder?',
          [`You picked a folder called "${handle.name}". Choose the project's main folder instead (the one that contains .claude), so skills end up in the right place.`],
          `Use "${handle.name}" anyway`
        );
        if (!keep) return;
      }
      // The same folder added again reuses its entry.
      let existing = null;
      for (const t of targets) if (t.kind === 'project' && (await t.handle.isSameEntry(handle))) existing = t;
      useTarget(existing || { id: `project:${handle.name}:${Date.now()}`, kind: 'project', label: `Project: ${handle.name}`, handle });
      lastInstall = null;
      rescan = new Map();
      await refreshInstalled();
      renderAll();
      showToast(`Now installing into ${handle.name}/.claude/skills.`, 3500);
    } catch (err) {
      if (!(err && err.name === 'AbortError')) showToast(`Couldn't add the project: ${err.message}`, 5000);
    }
  }

  async function switchTarget(id) {
    if (id === currentTargetId || busy) return;
    rescan = new Map();
    currentTargetId = id;
    saveTargets();
    lastInstall = null;
    await refreshInstalled();
    renderAll();
  }

  /** Make sure a target's folder can be written, asking for access if needed (run from a click). */
  async function ensureAccess(target) {
    let permission = await target.handle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') permission = await target.handle.requestPermission({ mode: 'readwrite' });
    return permission === 'granted';
  }

  /**
   * Get the current target's writable skills folder, prompting only when needed (must run
   * from a click). With `noPick`, never opens the folder picker (used by Remove and Undo).
   */
  async function getSkillsFolder(forcePick, noPick) {
    const target = currentTarget();
    if (!forcePick && target) {
      if (await ensureAccess(target)) {
        connection = 'connected';
        return skillsDirOf(target, true);
      }
      if (noPick) return null;
      if (target.kind === 'project') {
        showToast('Access to the project folder was not allowed.', 4000);
        return null;
      }
      showToast('Access to the skills folder was not allowed. Choose it again to reconnect.', 4000);
    } else if (!forcePick && noPick) {
      return null;
    }
    return pickSkillsFolder();
  }

  // ------------------------------------------------------------ skill maker

  const MAKER_TEMPLATE = [
    '# Skill title',
    '',
    '## When to Use',
    '',
    '- Describe the situations where Claude should use this skill.',
    '',
    '## How It Works',
    '',
    '1. Step one.',
    '2. Step two.',
    '',
    '## Examples',
    '',
    '**Request:** "An example of what the user might ask."',
    '**What Claude does:** How Claude should respond using this skill.',
    '',
  ].join('\n');
  let editingId = null;

  function makerSkillMd() {
    const name = $('maker-name').value.trim();
    const description = $('maker-description').value.replace(/\s+/g, ' ').trim();
    const body = $('maker-body').value.replace(/\r\n/g, '\n').trim();
    return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}\n`;
  }

  /** Live checks shown while writing a skill. Returns whether it can be saved. */
  function updateMaker() {
    const name = $('maker-name').value.trim();
    const description = $('maker-description').value.replace(/\s+/g, ' ').trim();
    const text = makerSkillMd();
    const compat = Scan.checkClaudeCompat(text, name || 'new-skill');
    const findings = makerFindings(text);
    const safety = statusOf(findings);
    const clash = name && library().find((s) => s.installDir === name && s.id !== editingId);
    const ownClash = clash && clash.source === 'custom';
    // Agent Skills naming: lowercase words joined by single hyphens, at most 64 characters.
    const validName = name.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
    const body = $('maker-body').value.trim();

    $('maker-desc-count').textContent = `${description.length}/200 for the Claude app`;
    $('maker-desc-count').classList.toggle('over', description.length > 200);

    const list = $('maker-checks');
    list.textContent = '';
    const row = (ok, label, detail) => {
      const li = el('li', ok === true ? 'ok' : ok === false ? 'bad' : 'warn');
      li.appendChild(el('strong', null, label));
      if (detail) li.appendChild(el('span', null, detail));
      list.appendChild(li);
    };
    row(validName, 'Name', validName ? `Installs as the folder "${name}"` : 'Use lowercase words joined by single hyphens, like "my-skill" (no "--", no hyphen at the start or end)');
    row(description.length > 0 ? (description.length > 200 ? null : true) : false, 'Description',
      !description ? 'Say what the skill does and when Claude should use it' : description.length > 200 ? 'Works in Claude Code; shortened to 200 characters for the Claude app' : 'Good length');
    const codeIssue = compat.issues.find((i) => i.target === 'code' && i.level !== 'info');
    row(compat.code === 'ready' ? true : compat.code === 'warn' ? null : false, 'Claude Code', codeIssue ? codeIssue.message : 'Claude Code will load it');
    const appIssue = compat.issues.find((i) => i.target === 'app' && i.level !== 'info');
    row(compat.app === 'ready' ? true : compat.app === 'warn' ? null : false, 'Claude app', appIssue ? appIssue.message : 'Ready to upload');
    row(safety === 'blocked' ? false : safety === 'warnings' ? null : true, 'Safety scan',
      safety === 'blocked' ? firstReason({ findings }, 'block') : safety === 'warnings' ? firstReason({ findings }, 'warn') : 'Passed');
    if (!body) row(false, 'Instructions', 'Write what Claude should do when it uses this skill');
    if (ownClash) row(false, 'Name in use', `You already made a skill called "${name}". Pick another name, or edit that one instead.`);
    else if (clash) row(null, 'Name in use', `"${name}" is already a skill in the library. Only one of them can be installed at a time.`);
    row(true, 'Files', `${plural(makerFiles.length + 1, 'file')}, ${formatBytes(makerFiles.reduce((n, f) => n + f.bytes.length, encoder.encode(text).length))}`);

    const canSave = validName && description && body && !ownClash && compat.code !== 'error' && safety !== 'blocked';
    $('maker-save').disabled = !canSave;
    $('maker-export').disabled = !canSave;
    const problems = list.querySelectorAll('li.bad').length;
    $('maker-summary').textContent = canSave ? 'Ready to save.' : `${plural(problems || 1, 'thing')} to fix before saving.`;
    return canSave;
  }

  // Supporting files of the skill being edited ([{ path, bytes }]); SKILL.md is built from the fields.
  let makerFiles = [];
  let makerCurrent = 'SKILL.md';
  let makerView = 'edit';

  /** Safety findings for the SKILL.md being written plus every supporting file. */
  function makerFindings(skillMdText) {
    const findings = Scan.scanText('SKILL.md', skillMdText);
    for (const f of makerFiles) {
      findings.push(...Scan.inspectPath(f.path).filter((x) => x.severity === 'block'));
      findings.push(...Scan.inspectFile(f.path, f.bytes));
    }
    return findings;
  }

  function renderMakerFiles() {
    const tree = $('maker-files');
    tree.textContent = '';
    const paths = ['SKILL.md'].concat(makerFiles.map((f) => f.path).sort());
    for (const path of paths) {
      const li = el('li');
      const btn = el('button');
      btn.type = 'button';
      btn.setAttribute('aria-current', String(path === makerCurrent));
      btn.appendChild(el('span', null, path));
      const file = makerFiles.find((f) => f.path === path);
      if (file) btn.appendChild(el('span', 'size', formatBytes(file.bytes.length)));
      btn.addEventListener('click', () => selectMakerFile(path));
      li.appendChild(btn);
      tree.appendChild(li);
    }
    $('maker-rename-file').disabled = makerCurrent === 'SKILL.md';
    $('maker-delete-file').disabled = makerCurrent === 'SKILL.md';
  }

  function selectMakerFile(path) {
    makerCurrent = path;
    const isSkillMd = path === 'SKILL.md';
    $('maker-skillmd').hidden = !isSkillMd;
    const file = makerFiles.find((f) => f.path === path);
    if (!isSkillMd && file) {
      const text = Scan.decodeText(file.bytes);
      $('maker-file-label').textContent = text === null ? `${path} (binary file: kept as is, not editable here)` : path;
      $('maker-file-text').value = text === null ? '' : text;
      $('maker-file-text').disabled = text === null;
    }
    renderMakerFiles();
    renderMakerView();
  }

  function renderMakerView() {
    const isSkillMd = makerCurrent === 'SKILL.md';
    const previewing = makerView === 'preview';
    $('maker-body-field').hidden = !isSkillMd || previewing;
    $('maker-file-field').hidden = isSkillMd || previewing;
    $('maker-preview').hidden = !previewing;
    document.querySelectorAll('[data-maker-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.makerTab === makerView)));
    if (!previewing) return;
    const preview = $('maker-preview');
    if (isSkillMd) {
      preview.innerHTML = renderMarkdown($('maker-body').value);
    } else {
      const file = makerFiles.find((f) => f.path === makerCurrent);
      const text = file ? Scan.decodeText(file.bytes) : null;
      if (text === null) preview.textContent = 'Binary file: no preview.';
      else if (/\.(md|mdx|markdown)$/i.test(makerCurrent)) preview.innerHTML = renderMarkdown(text);
      else {
        preview.textContent = '';
        preview.appendChild(el('pre', null, text));
      }
    }
  }

  /** A prompt in the app's own dialog (Electron has no window.prompt). Resolves to the text or null. */
  function promptDialog(title, sub, value, validate) {
    const dialog = $('prompt');
    $('prompt-title').textContent = title;
    $('prompt-sub').textContent = sub || '';
    const input = $('prompt-input');
    input.value = value || '';
    $('prompt-error').textContent = '';
    dialog.showModal();
    input.focus();
    input.select();
    return new Promise((resolve) => {
      const finish = (result) => {
        $('prompt-form').onsubmit = null;
        $('prompt-cancel').onclick = null;
        dialog.onclose = null;
        if (dialog.open) dialog.close();
        resolve(result);
      };
      $('prompt-form').onsubmit = (e) => {
        e.preventDefault();
        const text = input.value.trim();
        const problem = validate ? validate(text) : '';
        if (problem) {
          $('prompt-error').textContent = problem;
          return;
        }
        finish(text);
      };
      $('prompt-cancel').onclick = () => finish(null);
      dialog.onclose = () => finish(null);
    });
  }

  /** Why a path can't be used for a new or renamed file, or '' when it can. */
  function makerPathProblem(path, except) {
    const p = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!p) return 'Type a file name.';
    if (!safeRelativePath(p) || Scan.inspectPath(p).length) return 'Use a plain path such as scripts/helper.py: no "..", and no characters Windows refuses.';
    if (p.toLowerCase() === 'skill.md') return 'SKILL.md is written from the fields on the left.';
    const taken = makerFiles.some((f) => f.path !== except && (f.path.toLowerCase() === p.toLowerCase() || f.path.toLowerCase().startsWith(`${p.toLowerCase()}/`) || p.toLowerCase().startsWith(`${f.path.toLowerCase()}/`)));
    return taken ? 'A file or folder with that name already exists.' : '';
  }

  async function makerAddFile() {
    const dir = makerCurrent.includes('/') ? `${makerCurrent.split('/').slice(0, -1).join('/')}/` : '';
    const path = await promptDialog('New file', 'Path inside the skill, for example scripts/helper.py or references/guide.md.', `${dir}new-file.md`, (p) => makerPathProblem(p));
    if (!path) return;
    const clean = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    makerFiles.push({ path: clean, bytes: new Uint8Array(0) });
    selectMakerFile(clean);
    updateMaker();
  }

  async function makerAddFolder() {
    const name = await promptDialog('New folder', 'Common folders are scripts, references and assets. An empty .gitkeep file keeps the folder until you add files.', 'references', (p) => (p.replace(/[\\/]/g, '') ? makerPathProblem(`${p}/.gitkeep`) : 'Type a folder name.'));
    if (!name) return;
    const clean = `${name.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')}/.gitkeep`;
    makerFiles.push({ path: clean, bytes: new Uint8Array(0) });
    selectMakerFile(clean);
    updateMaker();
  }

  async function makerRenameFile() {
    if (makerCurrent === 'SKILL.md') return;
    const from = makerCurrent;
    const to = await promptDialog('Rename file', 'Type the new path. Use "/" to move it into a folder.', from, (p) => makerPathProblem(p, from));
    if (!to) return;
    const clean = to.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    makerFiles = makerFiles.map((f) => (f.path === from ? { path: clean, bytes: f.bytes } : f));
    selectMakerFile(clean);
    updateMaker();
  }

  async function makerDeleteFile() {
    if (makerCurrent === 'SKILL.md') return;
    const ok = await confirmDialog(`Delete ${makerCurrent}?`, ['The file is removed from this skill when you save.'], 'Delete', null, true);
    if (!ok) return;
    makerFiles = makerFiles.filter((f) => f.path !== makerCurrent);
    selectMakerFile('SKILL.md');
    updateMaker();
  }

  let makerStart = '';
  const makerDraft = () => [$('maker-name').value, $('maker-description').value, $('maker-body').value]
    .concat(makerFiles.map((f) => `${f.path}:${Scan.hashText(decoder.decode(f.bytes))}`).sort())
    .join('\u0000');

  /** Close the maker, asking first when there are unsaved changes. */
  async function closeMaker() {
    if (makerDraft() !== makerStart) {
      const discard = await confirmDialog('Discard this skill?', ['Your changes have not been saved.'], 'Discard', null, true);
      if (!discard) return;
    }
    $('maker').close();
  }

  /** Open the editor: blank (null), for a skill you made, or (`asCopy`) for a copy of any skill. */
  async function openMaker(skill, asCopy) {
    editingId = skill && !asCopy ? skill.id : null;
    makerFiles = [];
    let description = skill ? skill.description : '';
    let body = skill ? skill.body : MAKER_TEMPLATE;
    if (skill) {
      try {
        const files = skill.source === 'custom' && !asCopy ? skill.files : await filesForSkill(skill);
        const md = files.find((f) => f.path === 'SKILL.md');
        if (md) {
          const parsed = Scan.parseFrontmatter(decoder.decode(md.bytes));
          description = parsed.attributes.description || description;
          body = parsed.body;
        }
        makerFiles = files.filter((f) => f.path !== 'SKILL.md').map((f) => ({ path: f.path, bytes: f.bytes }));
      } catch (err) {
        showToast(`Couldn't load all files: ${err.message}`, 5000);
      }
    }
    $('maker-title').textContent = !skill ? 'Create a skill' : asCopy ? `Edit a copy of ${skill.name}` : `Edit ${skill.name}`;
    $('maker-name').value = skill ? (asCopy ? skill.installDir : skill.name) : '';
    $('maker-description').value = description;
    $('maker-body').value = body;
    makerView = 'edit';
    selectMakerFile('SKILL.md');
    updateMaker();
    makerStart = makerDraft();
    if (preview.open) preview.close();
    $('maker').showModal();
    $('maker-name').focus();
  }

  function makerSkillFiles() {
    const text = makerSkillMd();
    return [{ path: 'SKILL.md', bytes: encoder.encode(text) }].concat(makerFiles.map((f) => ({ path: f.path, bytes: f.bytes })));
  }

  function saveMaker() {
    if (!updateMaker()) return;
    const text = makerSkillMd();
    const parsed = Scan.parseFrontmatter(text);
    const name = parsed.attributes.name;
    const files = makerSkillFiles();
    const findings = makerFindings(text);
    const previous = custom.find((s) => s.id === editingId);
    const now = new Date().toISOString();
    const skill = {
      id: `custom:${name}`,
      source: 'custom',
      name,
      dir: name,
      installDir: name,
      description: parsed.attributes.description,
      body: parsed.body,
      files,
      fp: Scan.skillFingerprint(text, files.map((f) => ({ path: f.path, size: f.bytes.length }))),
      findings,
      status: statusOf(findings),
      addedAt: (previous && previous.addedAt) || now,
      updatedAt: now,
    };
    if (editingId) selected.delete(editingId);
    custom = custom.filter((s) => s.id !== editingId && s.id !== skill.id).concat(skill);
    selected.add(skill.id);
    lastInstall = null;
    saveCustom().then((ok) => {
      if (!ok) showToast("This browser didn't let the app save your skill, so it will be gone after you close the app. Install it or download it now.", 8000);
    });
    logActivity(previous ? 'edit' : 'create', name, `${plural(files.length, 'file')}; safety scan: ${LEVEL_TEXT[Scan.summarizeFindings(findings).level].toLowerCase()}`, needsReview(skill) ? 'warning' : 'ok');
    reindex();
    makerStart = makerDraft();
    $('maker').close();
    renderAll();
    showToast(`Saved ${name} to your library and selected it. Click Install to add it to Claude.`, 4500);
  }

  async function exportMaker() {
    if (!updateMaker()) return;
    const name = $('maker-name').value.trim();
    try {
      await saveBlob(Zip.createZip(makerSkillFiles().map((f) => ({ path: `${name}/${f.path}`, data: f.bytes }))), `${name}.zip`);
      showToast(`Exported ${name}.zip. Unzip it into ${SKILLS_PATH} to install it by hand.`, 4500);
    } catch (err) {
      if (!(err && err.name === 'AbortError')) showToast(`Export failed: ${err.message}`, 5000);
    }
  }

  async function deleteCustom(skill) {
    const ok = await confirmDialog(`Delete ${skill.name}?`, ['This removes the skill you made from the library. If it is installed in Claude, it stays installed until you remove it there.'], 'Delete', null, true);
    if (!ok) return;
    custom = custom.filter((s) => s.id !== skill.id);
    selected.delete(skill.id);
    saveCustom();
    logActivity('delete', skill.name, 'Removed from your library');
    reindex();
    if (preview.open) preview.close();
    renderAll();
  }

  // -------------------------------------------------------- re-scan installed

  let rescan = new Map(); // installDir -> { status, findings, checkedAt }
  let rescanTarget = null; // the folder the results above belong to

  /** Run today's safety rules over every installed skill in the current folder. */
  async function rescanInstalled() {
    const target = currentTarget();
    if (!target || busy) return;
    setBusy(true);
    try {
      if (!(await ensureAccess(target))) {
        showToast('Access to the folder was not allowed, so nothing was checked.', 4000);
        return;
      }
      const dir = await skillsDirOf(target, false);
      const results = new Map();
      if (dir) {
        const dirs = [];
        for await (const [name, handle] of dir.entries()) {
          if (handle.kind === 'directory' && !name.startsWith('.') && installed.has(name)) dirs.push([name, handle]);
        }
        let n = 0;
        for (const [name, handle] of dirs) {
          showToast(`Checking ${name} (${++n} of ${dirs.length})...`, 60000);
          const files = await readFolderFiles(handle);
          const findings = await scanFiles(name, files);
          results.set(name, { status: statusOf(findings), findings, checkedAt: new Date().toISOString() });
        }
      }
      rescan = results;
      rescanTarget = target.id;
      const count = (st) => [...results.values()].filter((r) => r.status === st).length;
      const problems = [...results.entries()].filter(([, r]) => r.status === 'blocked' || r.status === 'unverified');
      const flagged = [...results.entries()].filter(([, r]) => ['critical', 'high', 'warning'].includes(Scan.summarizeFindings(r.findings).level));
      logActivity('scan', `${plural(results.size, 'installed skill')}`, flagged.length
        ? `${flagged.length} need a look: ${flagged.slice(0, 5).map(([name, r]) => `${name} (${Scan.summarizeFindings(r.findings).level})`).join(', ')}`
        : 'No risky patterns found', flagged.length ? 'warning' : 'ok', target);
      renderAll();
      showToast(`Checked ${plural(results.size, 'installed skill')}.`, 2500);
      await messageDialog(
        problems.length ? 'Some installed skills need a look' : 'All installed skills passed',
        [`Checked ${plural(results.size, 'skill')} with today's safety rules: ${count('passed')} passed, ${count('warnings')} passed with notes, ${count('unverified')} couldn't be checked, ${count('blocked')} unsafe.`,
          problems.length ? 'Open a skill to see what was found. You can remove it from Claude there.' : 'Nothing unsafe was found.'],
        problems.map(([name, r]) => `${name}: ${r.status === 'blocked' ? 'unsafe' : "couldn't be checked"} (${firstReason(r, r.status === 'blocked' ? 'block' : 'unverified')})`)
      );
    } catch (err) {
      showToast(`Re-scan failed: ${err.message}`, 5000);
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------- history

  // Every install, update and removal, with what was there before so it can be undone.
  let history = [];
  const saveHistory = () => idbPut('history', history);

  // Other activity (imports, skills made or edited, scans, library changes). File
  // changes with backups stay in `history`; the History view shows both.
  let activity = [];
  const saveActivity = () => idbPut('activity', activity);
  const saveSettings = () => idbPut('settings', settings);

  function logActivity(type, skill, detail, result, target) {
    activity = [{
      type,
      skill,
      detail: detail || '',
      result: result || 'ok',
      time: new Date().toISOString(),
      targetId: target ? target.id : '',
      targetLabel: target ? target.label : '',
    }].concat(activity).slice(0, 200);
    saveActivity();
  }

  function recordHistory(entries, target) {
    if (!entries.length) return null;
    const batch = Date.now();
    history = entries.map((e) => ({ ...e, batch, time: new Date().toISOString(), targetId: target && target.id, targetLabel: target ? target.label : '', undone: false }))
      .concat(history)
      .slice(0, 80);
    // Keep backups only for the latest few changes (undo records do not count); older ones stay listed.
    const recent = [...new Set(history.filter((e) => e.action !== 'undo').map((e) => e.batch))].slice(0, settings.backupsKept);
    history = history.map((e) => (e.action === 'undo' || recent.includes(e.batch) ? e : { ...e, undo: null }));
    saveHistory();
    return batch;
  }

  /** A batch can be undone while any of its changes still has a backup and is not undone. */
  function canUndo(batch) {
    return history.some((e) => e.batch === batch && e.action !== 'undo' && e.undo && !e.undone);
  }

  function undoableBatch() {
    const latest = history.find((e) => e.action !== 'undo');
    return latest && canUndo(latest.batch) ? latest.batch : null;
  }

  async function undoBatch(batch) {
    const entries = history.filter((e) => e.batch === batch && e.action !== 'undo' && e.undo && !e.undone);
    if (!entries.length || busy) return;
    const target = targets.find((t) => t.id === entries[0].targetId);
    if (!target) {
      showToast('That folder is no longer connected, so this change cannot be undone.', 4000);
      return;
    }
    if (!(await ensureAccess(target))) {
      showToast('Access to the folder was not allowed, so nothing was changed.', 4000);
      return;
    }
    const dir = await skillsDirOf(target, true);
    // Warn when a skill was changed after this install/update; undo would discard those edits.
    const changedSince = [];
    for (const e of entries) {
      if (!e.fpAfter) continue;
      try {
        const handle = await dir.getDirectoryHandle(e.dir);
        const text = await readSkillMd(handle);
        if (Scan.skillFingerprint(text, await listFolder(handle, '')) !== e.fpAfter) changedSince.push(e.skill);
      } catch {
        /* folder gone: nothing to lose */
      }
    }
    const paragraphs = [`This puts ${entries.length === 1 ? 'this skill' : `these ${entries.length} skills`} in "${target.label}" back the way ${entries.length === 1 ? 'it was' : 'they were'} before.`];
    if (changedSince.length) paragraphs.push(`Changed since then, and those changes will be lost: ${changedSince.join(', ')}.`);
    const ok = await confirmDialog(
      'Undo this change?',
      paragraphs,
      'Undo',
      entries.map((e) => `${e.skill}: ${{ install: 'remove the newly installed copy', update: 'restore the previous version', remove: 'put it back' }[e.action]}`),
      changedSince.length > 0
    );
    if (!ok) return;
    setBusy(true);
    try {
      const failed = [];
      for (const e of entries.slice().reverse()) {
        try {
          await removeIfPresent(dir, e.dir);
          if (e.undo.kind === 'restore') await writeSkill(dir, e.dir, e.undo.files);
          e.undone = true;
        } catch (err) {
          failed.push(`${e.skill}: ${err.message}`);
        }
      }
      const restored = entries.filter((e) => e.undone).map((e) => e.skill);
      if (restored.length) {
        history = [{ action: 'undo', skill: restored.join(', '), dir: '', batch: Date.now(), time: new Date().toISOString(), targetId: target.id, targetLabel: target.label, undo: null, undone: false }].concat(history);
      }
      saveHistory();
      rescan = new Map();
      lastInstall = null;
      if (target.id !== currentTargetId) await switchTarget(target.id);
      else {
        await refreshInstalled();
        renderAll();
      }
      showToast(failed.length ? `Undo finished with problems: ${failed.join('; ')}` : 'Undone. Your skills are back the way they were.', 5000);
    } finally {
      setBusy(false);
    }
  }

  async function readSkillMd(dirHandle) {
    const info = await readSkillMdInfo(dirHandle);
    return info ? info.text : null;
  }

  /** SKILL.md text and its last-modified time, or null when it is missing or unreadable. */
  async function readSkillMdInfo(dirHandle) {
    try {
      const file = await (await dirHandle.getFileHandle('SKILL.md')).getFile();
      return { text: await file.text(), modified: file.lastModified || 0 };
    } catch {
      return null;
    }
  }

  /** Every file in an installed skill folder as [{ path, bytes, modified }] (caches skipped). */
  async function readFolderFiles(dirHandle) {
    const out = [];
    for (const f of await listFolder(dirHandle, '')) {
      const file = await f.handle.getFile();
      out.push({ path: f.path, bytes: new Uint8Array(await file.arrayBuffer()), modified: file.lastModified || 0 });
    }
    return out;
  }

  // What every connected folder holds: target id -> { state, skills: Map(dir -> { name, modified }), at }.
  let targetStats = new Map();

  async function readTargetSkills(target) {
    if ((await target.handle.queryPermission({ mode: 'readwrite' })) !== 'granted') return { state: 'needs-permission', skills: new Map(), at: Date.now() };
    const skills = new Map();
    try {
      const folder = await skillsDirOf(target, false);
      if (folder) {
        for await (const [dir, handle] of folder.entries()) {
          if (handle.kind !== 'directory' || dir.startsWith('.')) continue;
          const md = await readSkillMdInfo(handle);
          if (!md) continue;
          skills.set(dir, { name: Scan.parseFrontmatter(md.text).attributes.name || dir, modified: md.modified });
        }
      }
      return { state: folder ? 'ok' : 'empty', skills, at: Date.now() };
    } catch (err) {
      return { state: 'error', error: err.message, skills, at: Date.now() };
    }
  }

  /** Refresh the snapshot of every connected folder (no prompts). */
  async function refreshTargetStats() {
    if (!SUPPORTS_FOLDER_WRITE) return;
    const next = new Map();
    for (const t of targets) next.set(t.id, await readTargetSkills(t));
    targetStats = next;
  }

  /**
   * Every file under a folder handle as [{ path, size, handle }]. Skips caches and
   * system files unless `everything` is set (backups must keep every file).
   */
  async function listFolder(dirHandle, prefix, everything) {
    const out = [];
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === 'directory') {
        if (everything || !Scan.IGNORED_DIR_NAMES.has(name)) out.push(...(await listFolder(handle, `${prefix}${name}/`, everything)));
      } else if (everything || !Scan.IGNORED_FILE_NAMES.has(name)) {
        const file = await handle.getFile();
        out.push({ path: `${prefix}${name}`, size: file.size, handle });
      }
    }
    return out;
  }

  /** Re-read what is installed in Claude Code's skills folder (no prompts). */
  async function refreshInstalled() {
    if (!SUPPORTS_FOLDER_WRITE) return;
    const target = currentTarget();
    if (!target) {
      connection = 'disconnected';
      installed = new Map();
      local = [];
      reindex();
      return;
    }
    if ((await target.handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
      connection = 'needs-permission';
      return;
    }
    connection = 'connected';
    const next = new Map();
    try {
      const folder = await skillsDirOf(target, false);
      if (folder) for await (const [dir, handle] of folder.entries()) {
        if (handle.kind !== 'directory' || dir.startsWith('.')) continue;
        const md = await readSkillMdInfo(handle);
        if (md === null) continue;
        const parsed = Scan.parseFrontmatter(md.text);
        const files = await listFolder(handle, '');
        next.set(dir, {
          name: parsed.attributes.name || dir,
          description: parsed.attributes.description || '',
          body: parsed.body,
          fp: Scan.skillFingerprint(md.text, files),
          modified: md.modified,
        });
      }
    } catch {
      connection = 'needs-permission';
      return;
    }
    installed = next;
    targetStats.set(target.id, { state: 'ok', skills: new Map([...next].map(([d, i]) => [d, { name: i.name, modified: i.modified }])), at: Date.now() });
    // Folders sharing one skill name: Claude sees duplicates.
    const byName = new Map();
    for (const [dir, info] of installed) byName.set(info.name, (byName.get(info.name) || []).concat(dir));
    duplicateNames = new Map([...byName].filter(([, dirs]) => dirs.length > 1));
    const known = new Set(library().map((s) => s.installDir));
    local = [...installed.entries()]
      .filter(([dir]) => !known.has(dir))
      .map(([dir, info]) => ({ id: `local:${dir}`, source: 'local', dir, installDir: dir, name: info.name, description: info.description, body: info.body }));
    reindex();
  }

  /** Other installed folders that hold a skill with this skill's name. */
  function otherCopies(skill) {
    return [...installed.entries()].filter(([dir, info]) => dir !== skill.installDir && info.name === skill.name).map(([dir]) => dir);
  }

  /** 'installed' | 'update' | 'elsewhere' | null for a library skill. */
  function installState(skill) {
    const info = installed.get(skill.installDir);
    if (!info) return otherCopies(skill).length ? 'elsewhere' : null;
    if (skill.source === 'local') return 'installed';
    if (info.fp === skill.fp) return 'installed';
    // The installed copy is another library skill with the same name (e.g. one you made).
    if (library().some((o) => o !== skill && o.installDir === skill.installDir && o.fp === info.fp)) return 'other';
    return 'update';
  }

  async function folderExists(parent, name) {
    try {
      await parent.getDirectoryHandle(name);
      return true;
    } catch {
      return false;
    }
  }

  async function writeSkill(parent, folder, files) {
    const root = await parent.getDirectoryHandle(folder, { create: true });
    for (const file of files) {
      if (!safeRelativePath(file.path)) throw new Error(`Unsafe file path in ${folder}: ${file.path}`);
      const parts = file.path.split('/');
      let dir = root;
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
      const handle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
      const writable = await handle.createWritable();
      await writable.write(file.bytes);
      await writable.close();
    }
  }

  /** Read the installed SKILL.md back and confirm Claude Code will load it. */
  async function verifyInstalled(parent, skill) {
    try {
      const text = await readSkillMd(await parent.getDirectoryHandle(skill.installDir));
      if (text === null) return 'SKILL.md was not written';
      const compat = Scan.checkClaudeCompat(text, skill.installDir);
      if (compat.code === 'error') return compat.issues.find((i) => i.target === 'code' && i.level === 'error').message;
      if (compat.installDir !== skill.installDir) return 'Folder name does not match the skill name';
      return null;
    } catch (err) {
      return err.message;
    }
  }

  // ------------------------------------------------------- install / download

  async function confirmUnverified(picks) {
    const risky = picks.filter((s) => s.status === 'unverified');
    if (!risky.length) return true;
    if (!settings.allowUnverified) {
      await messageDialog(
        `${plural(risky.length, 'skill')} couldn't be fully checked`,
        ['Your settings only allow skills that were fully checked. Deselect these, or change "Allow skills that couldn\'t be fully checked" in Settings.'],
        risky.map((s) => `${s.name}: ${firstReason(s, 'unverified')}`)
      );
      return false;
    }
    return confirmDialog(
      `${plural(risky.length, 'skill')} couldn't be checked`,
      ['The safety scan could not inspect everything in these skills, so it cannot tell you they are safe. Only continue if you trust where they came from.'],
      'Install anyway',
      risky.map((s) => `${s.name}: ${firstReason(s, 'unverified')}`)
    );
  }

  /**
   * Read a whole installed skill folder into memory (to restore or undo later).
   * Returns null only when the folder does not exist; any other failure throws,
   * so nothing is ever replaced or removed without a working backup.
   */
  async function backupFolder(parent, dir) {
    let handle;
    try {
      handle = await parent.getDirectoryHandle(dir);
    } catch (err) {
      if (err && err.name === 'NotFoundError') return null;
      throw err;
    }
    const files = await listFolder(handle, '', true);
    return Promise.all(files.map(async (f) => ({ path: f.path, bytes: new Uint8Array(await (await f.handle.getFile()).arrayBuffer()) })));
  }

  async function removeIfPresent(parent, dir) {
    try {
      await parent.removeEntry(dir, { recursive: true });
    } catch (err) {
      if (err && err.name === 'NotFoundError') return;
      throw err;
    }
  }

  /**
   * Install one skill; on any failure put the previous copy back.
   * Returns { problem } or { history } describing how to undo it.
   */
  async function installOne(folder, s) {
    let files;
    try {
      files = await getFiles(s);
    } catch (err) {
      return { problem: err.message };
    }
    const unsafe = files.find((f) => !safeRelativePath(f.path));
    if (unsafe) return { problem: `the file name "${unsafe.path}" is not allowed on this computer` };
    try {
      const old = await folder.getFileHandle(s.installDir);
      if (old) return { problem: `a file named "${s.installDir}" is in the way in your skills folder` };
    } catch {
      /* no file in the way */
    }
    let backup;
    try {
      backup = await backupFolder(folder, s.installDir);
    } catch (err) {
      return { problem: `the current copy could not be backed up (${err.message}), so nothing was changed` };
    }
    try {
      await removeIfPresent(folder, s.installDir);
      await writeSkill(folder, s.installDir, files);
      const problem = await verifyInstalled(folder, s);
      if (problem) throw new Error(problem);
      const after = Scan.skillFingerprint(decoder.decode(files.find((f) => f.path === 'SKILL.md').bytes), files.map((f) => ({ path: f.path, size: f.bytes.length })));
      return {
        history: backup
          ? { action: 'update', skill: s.name, dir: s.installDir, fpAfter: after, undo: { kind: 'restore', files: backup } }
          : { action: 'install', skill: s.name, dir: s.installDir, fpAfter: after, undo: { kind: 'remove' } },
      };
    } catch (err) {
      try {
        await removeIfPresent(folder, s.installDir);
        if (backup) await writeSkill(folder, s.installDir, backup);
      } catch {
        return { problem: `${err.message} (and the previous copy could not be restored)` };
      }
      return { problem: `${err.message}${backup ? ' (the previous copy was kept)' : ''}` };
    }
  }

  function installSelected(forcePick) {
    return installSkills(chosen(), forcePick);
  }

  /** Library skills whose installed copy (in the current folder) is out of date. */
  function updatable() {
    // One candidate per folder: when several library skills share a name, prefer the bundled one.
    const seen = new Set();
    return library()
      .filter((s) => installState(s) === 'update')
      .sort((a, b) => (a.source === 'bundled' ? -1 : 0) - (b.source === 'bundled' ? -1 : 0))
      .filter((s) => !seen.has(s.installDir) && seen.add(s.installDir));
  }

  async function installSkills(picks, forcePick) {
    if (!picks.length || busy) return;
    setBusy(true);
    try {
      const sameFolder = new Map();
      for (const s of picks) sameFolder.set(s.installDir, (sameFolder.get(s.installDir) || []).concat(s));
      const clashes = [...sameFolder].filter(([, list]) => list.length > 1);
      if (clashes.length) {
        await messageDialog(
          'Two selected skills use the same name',
          ['Claude can only have one skill per name. Deselect one of each pair, then install again.'],
          clashes.map(([dir, list]) => `${dir}: ${list.map((s) => ({ github: `${s.origin} (GitHub)`, custom: 'made by you' }[s.source] || 'this library')).join(' and ')}`)
        );
        return;
      }
      if (!(await confirmUnverified(picks))) return;
      const folder = await getSkillsFolder(forcePick);
      if (!folder) return;
      const target = currentTarget(); // fixed for this whole install, even if the selector changes

      let wasEmpty = true;
      for await (const entry of folder.values()) {
        if (entry.kind === 'directory') {
          wasEmpty = false;
          break;
        }
      }

      const existing = [];
      for (const s of picks) if (await folderExists(folder, s.installDir)) existing.push(s.installDir);
      if (existing.length) {
        const replace = await confirmDialog(
          'Update installed skills?',
          [existing.length === 1
            ? 'This skill is already in Claude Code. It will be replaced with the version from this library. If anything goes wrong, the current copy is kept.'
            : `These ${existing.length} skills are already in Claude Code. They will be replaced with the versions from this library. If anything goes wrong, the current copies are kept.`],
          'Update',
          existing
        );
        if (!replace) return;
      }

      const dupes = picks.flatMap((s) => otherCopies(s).map((dir) => ({ s, dir })));
      let clean = false;
      if (dupes.length) {
        clean = await confirmDialog(
          'Remove old copies?',
          ['These skills are also installed under another folder name, so Claude would see two copies. Remove the old folders?'],
          'Remove old copies',
          dupes.map((d) => `${d.s.name}: folder "${d.dir}"`),
          true
        );
      }
      const failed = [];
      const changes = [];
      if (dupes.length && clean) {
        for (const d of dupes) {
          try {
            const backup = await backupFolder(folder, d.dir);
            await removeIfPresent(folder, d.dir);
            changes.push({ action: 'remove', skill: `${d.s.name} (old copy "${d.dir}")`, dir: d.dir, undo: backup ? { kind: 'restore', files: backup } : null });
          } catch (err) {
            failed.push(`old copy "${d.dir}": ${err.message}`);
          }
        }
      }
      let done = 0;
      for (const s of picks) {
        showToast(`Installing ${s.name} (${done + 1} of ${picks.length})...`, 60000);
        const result = await installOne(folder, s);
        if (result.problem) failed.push(`${s.name}: ${result.problem}`);
        else changes.push(result.history);
        done++;
      }

      const batch = recordHistory(changes, target);
      rescan = new Map();
      const skippedNotes = picks.filter((s) => s.skippedFiles).map((s) => `${s.name}: ${plural(s.skippedFiles, 'file')} were not installed because they couldn't be checked`);
      const updated = changes.filter((c) => c.action === 'update').length;
      lastInstall = { count: done - failed.length, updated, failed, notes: skippedNotes, wasEmpty, folder: target ? target.label : folder.name, batch };
      await refreshInstalled();
      renderAll();
      showToast(failed.length
        ? `Installed ${done - failed.length} of ${done}. ${plural(failed.length, 'skill')} could not be installed; see the panel for details.`
        : `Installed and verified ${plural(done, 'skill')} in Claude Code.`, 5000);
      updateJump();
    } catch (err) {
      if (!(err && err.name === 'AbortError')) showToast(`Install failed: ${err.message}`, 6000);
      await refreshInstalled();
      renderAll();
    } finally {
      setBusy(false);
    }
  }

  async function removeInstalled(skill) {
    if (busy) return;
    const target = currentTarget();
    if (!target) return;
    if (settings.confirmRemove) {
      const ok = await confirmDialog(
        `Remove ${skill.name} from Claude?`,
        [`This deletes the "${skill.installDir}" folder from ${target.label}. Claude stops using it straight away. A backup is kept, and you can undo this from History.`],
        'Remove',
        null,
        true
      );
      if (!ok) return;
    }
    const folder = await getSkillsFolder(false, true);
    if (!folder) {
      showToast('Reconnect to Claude Code first (sidebar or Installed view).', 4000);
      return;
    }
    setBusy(true);
    try {
      let backup;
      try {
        backup = await backupFolder(folder, skill.installDir);
      } catch (err) {
        showToast(`Not removed: the skill could not be backed up first (${err.message}).`, 6000);
        return;
      }
      await removeIfPresent(folder, skill.installDir);
      if (backup) recordHistory([{ action: 'remove', skill: skill.name, dir: skill.installDir, undo: { kind: 'restore', files: backup } }], target);
      lastInstall = null;
      rescan = new Map();
      showToast(`Removed ${skill.name} from Claude Code. You can undo this in History.`, 4000);
    } catch (err) {
      showToast(`Remove failed: ${err.message}`, 6000);
    } finally {
      setBusy(false);
    }
    await refreshInstalled();
    if (preview.open) {
      if (skill.source === 'local') preview.close();
      else openPreview(skill.id);
    }
    renderAll();
  }

  async function connectFolder(forcePick) {
    try {
      const folder = await getSkillsFolder(forcePick);
      if (!folder) return;
      if (forcePick) lastInstall = null;
      await refreshInstalled();
      renderAll();
      showToast(`Connected to Claude Code (${plural(installed.size, 'skill')} installed).`, 3500);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      showToast(`Couldn't connect: ${err.message}`, 6000);
    }
  }

  async function saveBlob(bytes, filename) {
    const blob = new Blob([bytes], { type: 'application/zip' });
    if (HOSTED) {
      if (!hostedDownloads) throw new Error('Saving files is not available in this view.');
      try {
        await hostedDownloads.save({ filename, data: blob });
      } catch (err) {
        if (err && err.code === 'declined') {
          const declined = new Error('Download cancelled.');
          declined.name = 'AbortError';
          throw declined;
        }
        throw new Error((err && err.message) || 'Saving files is not available in this view.');
      }
      return;
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  }

  /** One zip with every selected skill folder, for unzipping into .claude/skills. */
  async function downloadCodeZip() {
    const picks = chosen();
    if (!picks.length || busy) return;
    setBusy(true);
    try {
      if (!(await confirmUnverified(picks))) return;
      const entries = [];
      for (const s of picks) {
        for (const f of await getFiles(s)) {
          if (!safeRelativePath(f.path)) throw new Error(`The file name "${f.path}" in ${s.installDir} is not allowed on this computer`);
          entries.push({ path: `${s.installDir}/${f.path}`, data: f.bytes });
        }
      }
      await saveBlob(Zip.createZip(entries), picks.length === 1 ? `${picks[0].installDir}.zip` : 'claude-code-skills.zip');
      showToast(`Download started. Unzip it into your ${SKILLS_PATH} folder.`, 4000);
    } catch (err) {
      if (!(err && err.name === 'AbortError')) showToast(`Download failed: ${err.message}`, 6000);
    } finally {
      setBusy(false);
    }
  }

  /** One zip per skill, shaped the way the Claude desktop/web app expects. */
  async function downloadAppZips() {
    const picks = chosen();
    if (!picks.length || busy) return;
    setBusy(true);
    let saved = 0;
    try {
      if (!(await confirmUnverified(picks))) return;
      let shortened = 0;
      for (let i = 0; i < picks.length; i++) {
        const s = picks[i];
        const entries = [];
        for (const f of await getFiles(s)) {
          if (!safeRelativePath(f.path)) throw new Error(`The file name "${f.path}" in ${s.installDir} is not allowed on this computer`);
          let data = f.bytes;
          if (f.path === 'SKILL.md') {
            const prepared = prepareForClaudeApp(decoder.decode(f.bytes), s.installDir);
            if (prepared.shortened) shortened++;
            data = encoder.encode(prepared.text);
          }
          entries.push({ path: `${s.installDir}/${f.path}`, data });
        }
        await saveBlob(Zip.createZip(entries), `${s.installDir}.zip`);
        saved++;
        if (i < picks.length - 1 && !HOSTED) await new Promise((r) => setTimeout(r, 400));
      }
      const fitted = shortened ? ` (${shortened} description${shortened === 1 ? '' : 's'} shortened to fit)` : '';
      showToast(`${HOSTED ? 'Saved' : 'Started'} ${plural(picks.length, 'download')} for the Claude app${fitted}. Upload them in Customize > Skills.`, 6000);
    } catch (err) {
      if (err && err.name === 'AbortError') {
        if (saved) showToast(`Stopped after ${saved} of ${picks.length} downloads.`, 4000);
        return;
      }
      showToast(`Download failed: ${err.message}`, 6000);
    } finally {
      setBusy(false);
    }
  }

  // ------------------------------------------------------------ GitHub scan

  const GH_LIMITS = { skills: 30, filesPerSkill: 300, bytesPerSkill: 15 * 1024 * 1024, parallel: 6 };
  let ghFound = [];
  let ghScan = null; // AbortController of the scan in progress
  let lastScan = null; // { link, label, sha } of the last successful scan

  // Watched repositories: { link, label, sha, checkedAt, changed }
  let watched = [];
  const WATCH_INTERVAL = 60 * 60 * 1000;
  const saveWatched = () => idbPut('watched-repos', watched);

  /** Same repo/branch/folder whatever the link looks like (trailing slash, .git, www...). */
  function watchKey(link) {
    try {
      const t = parseGitHubUrl(link);
      return `${t.owner}/${t.repo}/${(t.refParts || []).join('/')}`.toLowerCase().replace(/\/+$/, '');
    } catch {
      return link;
    }
  }
  const findWatched = (link) => watched.find((w) => watchKey(w.link) === watchKey(link));

  function watchLink(link, label, sha) {
    watched = watched.filter((w) => watchKey(w.link) !== watchKey(link)).concat({ link, label, sha, checkedAt: Date.now(), changed: false });
    saveWatched();
    renderWatched();
    renderWatchNotice();
  }

  function unwatch(link) {
    watched = watched.filter((w) => w.link !== link);
    saveWatched();
    renderWatched();
    renderWatchNotice();
    $('github-url').focus();
  }

  /** Check watched repos for new commits (at most once an hour each, to respect GitHub's limit). */
  async function checkWatched(force) {
    let changedAny = false;
    for (const w of watched) {
      if (!force && Date.now() - (w.checkedAt || 0) < WATCH_INTERVAL) continue;
      try {
        const { commit } = await resolveRef(parseGitHubUrl(w.link));
        w.checkedAt = Date.now();
        if (commit.sha !== w.sha) {
          w.changed = true;
          changedAny = true;
        }
      } catch (err) {
        // Offline: try next time. Rate-limited: stop now instead of spending more lookups.
        if (/limit/i.test(err && err.message)) break;
      }
    }
    saveWatched();
    renderWatchNotice();
    return changedAny;
  }

  function renderWatchNotice() {
    const changed = watched.filter((w) => w.changed);
    // The sidebar copy shows on wide screens, the main-column copy on phones.
    for (const id of ['watch-notice', 'watch-notice-main']) {
      const box = $(id);
      box.textContent = '';
      box.hidden = !changed.length;
      if (!changed.length) continue;
      box.appendChild(el('div', 'watch-title', changed.length === 1 ? 'New changes on GitHub' : `${changed.length} watched repos changed`));
      for (const w of changed) {
        const row = el('div', 'watch-row');
        row.appendChild(el('span', null, w.label));
        const scan = el('button', 'link-btn', 'Scan now');
        scan.setAttribute('aria-label', `Scan ${w.label} now`);
        scan.addEventListener('click', () => scanLink(w.link));
        row.appendChild(scan);
        box.appendChild(row);
      }
    }
  }

  function renderWatched() {
    const wrap = $('github-watched');
    wrap.textContent = '';
    wrap.hidden = !watched.length;
    if (!watched.length) return;
    wrap.appendChild(el('p', 'section-label', 'Watched repositories'));
    for (const w of watched) {
      const row = el('div', 'watch-row');
      row.appendChild(el('span', null, `${w.label}${w.changed ? ' (changed)' : ''}`));
      const scan = el('button', 'link-btn', 'Scan');
      scan.type = 'button';
      scan.setAttribute('aria-label', `Scan ${w.label}`);
      scan.addEventListener('click', () => scanLink(w.link));
      const stop = el('button', 'link-btn', 'Stop watching');
      stop.type = 'button';
      stop.setAttribute('aria-label', `Stop watching ${w.label}`);
      stop.addEventListener('click', () => unwatch(w.link));
      row.appendChild(scan);
      row.appendChild(stop);
      wrap.appendChild(row);
    }
  }

  /** Open the GitHub dialog with a link and scan it. */
  function scanLink(link) {
    if (!$('github').open) $('github').showModal();
    $('github-url').value = link;
    renderWatched();
    $('github-form').requestSubmit();
  }

  function parseGitHubUrl(input) {
    let text = input.trim();
    if (!text) throw new Error('Paste a GitHub link first.');
    const ssh = text.match(/^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
    if (ssh) text = `https://github.com/${ssh[1]}/${ssh[2]}`;
    if (/\s/.test(text)) throw new Error("That doesn't look like a link. Paste something like https://github.com/owner/repo.");
    // Shorthand: owner/repo, or owner/repo/tree/branch/path
    if (/^[\w.-]+\/[\w.-]+(?:\/|$)/.test(text) && !/^(?:www\.)?github\.com\//i.test(text) && !text.includes('.com/') && !/^\w+:/.test(text)) {
      text = `https://github.com/${text}`;
    }
    let url;
    try {
      url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    } catch {
      throw new Error("That doesn't look like a link. Paste something like https://github.com/owner/repo.");
    }
    if (!/^(?:www\.)?github\.com$/i.test(url.hostname)) {
      throw new Error('Only github.com links are supported (not gists, raw files or other sites).');
    }
    let parts;
    try {
      parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
      throw new Error('This link has a broken %-code in it. Copy it again from the address bar.');
    }
    if (parts.length < 2 || !/^[\w.-]+$/.test(parts[0]) || !/^[\w.-]+$/.test(parts[1])) {
      throw new Error('Use a link to a repository, like https://github.com/owner/repo.');
    }
    const result = { owner: parts[0], repo: parts[1].replace(/\.git$/, ''), refParts: null, path: '', blob: false };
    const kind = parts[2];
    if ((kind === 'tree' || kind === 'blob') && parts[3]) {
      result.refParts = parts.slice(3); // branch names can contain "/": resolved against GitHub later
      result.blob = kind === 'blob';
    } else if (kind === 'commit' && parts[3]) {
      result.refParts = [parts[3]];
    } else if (kind === 'releases' && parts[3] === 'tag' && parts[4]) {
      result.refParts = [parts[4]];
    }
    return result;
  }

  async function githubApi(path, signal) {
    let res;
    try {
      res = await fetch(`https://api.github.com${path}`, { headers: { Accept: 'application/vnd.github+json' }, signal });
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      throw new Error("Couldn't reach GitHub. Check your internet connection and try again.");
    }
    if (res.status === 404) throw Object.assign(new Error('Repository, branch or folder not found. Private repositories are not supported.'), { status: 404 });
    if (res.status === 409) throw Object.assign(new Error('This repository is empty.'), { status: 409 });
    if (res.status === 422) throw Object.assign(new Error('That branch or commit was not found in this repository.'), { status: 422 });
    if (res.status === 403 || res.status === 429) {
      if (res.headers.get('x-ratelimit-remaining') === '0' || res.status === 429) {
        const reset = Number(res.headers.get('x-ratelimit-reset'));
        const when = reset ? ` Try again after ${new Date(reset * 1000).toLocaleTimeString()}.` : ' Try again later.';
        throw new Error(`GitHub's limit for lookups without signing in was reached.${when}`);
      }
      throw new Error('GitHub refused access to this repository (it may be blocked or restricted).');
    }
    if (!res.ok) throw new Error(`GitHub returned an error (${res.status}). Try again in a moment.`);
    return res.json();
  }

  /** Resolve the branch/commit and folder from a tree/blob link (branch names may contain "/"). */
  async function resolveRef(target, signal) {
    if (!target.refParts) {
      const repo = await githubApi(`/repos/${target.owner}/${target.repo}`, signal);
      return { commit: await githubApi(`/repos/${target.owner}/${target.repo}/commits/${encodeURIComponent(repo.default_branch)}`, signal), path: '', ref: repo.default_branch };
    }
    const parts = target.refParts;
    let lastError = null;
    for (let take = 1; take <= Math.min(parts.length, 4); take++) {
      try {
        const commit = await githubApi(`/repos/${target.owner}/${target.repo}/commits/${encodeURIComponent(parts.slice(0, take).join('/'))}`, signal);
        let path = parts.slice(take).join('/');
        if (target.blob) path = path.split('/').slice(0, -1).join('/'); // a file link scans its folder
        return { commit, path, ref: parts.slice(0, take).join('/') };
      } catch (err) {
        if (!err.status || (err.status !== 404 && err.status !== 422)) throw err;
        lastError = err;
      }
    }
    throw lastError;
  }

  function rawUrl(target, sha, filePath) {
    return `https://raw.githubusercontent.com/${target.owner}/${target.repo}/${sha}/${filePath.split('/').map(encodeURIComponent).join('/')}`;
  }

  async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
  }

  /**
   * Find and scan every skill in a GitHub repo or folder.
   *
   * Anything that cannot be inspected is reported as `unverified` (the user is
   * warned and asked) rather than blocked; only content detected as dangerous
   * is `block`. Files are kept in memory so the exact scanned bytes are what
   * gets installed.
   */
  async function scanGitHub(input, onStatus, signal) {
    const target = parseGitHubUrl(input);
    onStatus(`Looking up ${target.owner}/${target.repo}...`, 0);
    const { commit, path: subPath, ref } = await resolveRef(target, signal);
    const sha = commit.sha;
    const tree = await githubApi(`/repos/${target.owner}/${target.repo}/git/trees/${sha}?recursive=1`, signal);

    const prefix = subPath ? `${subPath.replace(/\/$/, '')}/` : '';
    const entries = tree.tree.filter((e) => !prefix || e.path.startsWith(prefix) || `${e.path}/` === prefix);
    let roots = entries
      .filter((e) => e.type === 'blob' && (e.path === 'SKILL.md' || e.path.endsWith('/SKILL.md')))
      .map((e) => e.path.slice(0, -'SKILL.md'.length).replace(/\/$/, ''));
    if (!roots.length) {
      throw new Error(tree.truncated
        ? 'This repository is too large to list. Paste a link to the folder that contains the skill.'
        : 'No skills found here. A skill is a folder containing a SKILL.md file.');
    }
    const totalSkills = roots.length;
    roots = roots.slice(0, GH_LIMITS.skills);

    const results = [];
    for (let r = 0; r < roots.length; r++) {
      if (signal && signal.aborted) throw Object.assign(new Error('Scan cancelled'), { name: 'AbortError' });
      const root = roots[r];
      const rootPrefix = root ? `${root}/` : '';
      const nested = roots.filter((other) => other !== root && other.startsWith(rootPrefix));
      const own = entries.filter((e) => (!root || e.path.startsWith(rootPrefix))
        && !nested.some((n) => e.path.startsWith(`${n}/`)));
      const label = root.split('/').pop() || target.repo;
      onStatus(`Scanning ${label} (${r + 1} of ${roots.length})...`, r / roots.length);

      const findings = [];
      const files = [];
      let skipped = 0;
      const add = (severity, rule, file, message) => findings.push({ severity, rule, file, line: 0, message });
      if (tree.truncated) add('unverified', 'tree-truncated', '.', 'The repository is too large to list every file');

      const blobs = [];
      let skippedDeps = 0;
      for (const e of own) {
        const rel = e.path.slice(rootPrefix.length);
        if (e.type === 'tree') continue;
        if (e.type === 'commit') {
          add('unverified', 'submodule', rel, "Links to another repository that wasn't checked or installed");
          continue;
        }
        if (/(^|\/)(node_modules|\.git|__pycache__)\//.test(rel)) {
          skippedDeps++;
          continue;
        }
        findings.push(...Scan.inspectPath(rel));
        if (e.mode === '120000') {
          add('unverified', 'symlink', rel, "A shortcut (symlink) that couldn't be followed; it is installed as a plain file");
        }
        blobs.push({ rel, path: e.path, size: e.size || 0 });
      }
      if (skippedDeps) {
        skipped += skippedDeps;
        add('unverified', 'vendored-directory', '.', "Bundled dependencies or caches weren't checked and won't be installed");
      }

      // SKILL.md first, so the file cap and size budget never cut it.
      blobs.sort((a, b) => (a.rel === 'SKILL.md' ? -1 : b.rel === 'SKILL.md' ? 1 : 0));
      if (blobs.length > GH_LIMITS.filesPerSkill) {
        skipped += blobs.length - GH_LIMITS.filesPerSkill;
        add('unverified', 'too-many-files', '.', `Has more than ${GH_LIMITS.filesPerSkill} files; the rest weren't checked and won't be installed`);
        blobs.length = GH_LIMITS.filesPerSkill;
      }

      let budget = GH_LIMITS.bytesPerSkill;
      const skillMdBlob = blobs.find((b) => b.rel === 'SKILL.md');
      await mapLimit(blobs, GH_LIMITS.parallel, async (blob) => {
        const decision = Scan.classifyFile(blob.rel, blob.size);
        if (decision.action === 'finding') {
          skipped++;
          findings.push({ ...decision.finding, message: `${decision.finding.message}; it won't be installed` });
          return;
        }
        if (budget - blob.size < 0) {
          skipped++;
          add('unverified', 'scan-budget', blob.rel, "Skipped because the skill is too large to check in one go; it won't be installed");
          return;
        }
        budget -= blob.size;
        let bytes;
        try {
          const res = await fetch(rawUrl(target, sha, blob.path), { signal });
          if (!res.ok) throw new Error(String(res.status));
          bytes = new Uint8Array(await res.arrayBuffer());
        } catch (err) {
          if (err && err.name === 'AbortError') throw err;
          skipped++;
          add('unverified', 'download-failed', blob.rel, "Couldn't download this file to check it, so it won't be installed");
          return;
        }
        files.push({ path: blob.rel, bytes });
        findings.push(...Scan.inspectFile(blob.rel, bytes));
      });

      const skillMd = files.find((f) => f.path === 'SKILL.md');
      const skillMdText = skillMd ? decoder.decode(skillMd.bytes) : null;
      const fallback = label.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
      const compat = Scan.checkClaudeCompat(skillMdText, fallback);
      if (skillMd) {
        for (const issue of compat.issues) {
          if (issue.target === 'code' && issue.level === 'error') add('invalid', 'claude-compat', 'SKILL.md', issue.message);
        }
      } else if (skillMdBlob) {
        // It exists but could not be fetched or checked: unknown, not invalid.
        add('unverified', 'skill-md-unavailable', 'SKILL.md', "SKILL.md couldn't be downloaded or checked");
      }
      const parsed = skillMdText !== null ? Scan.parseFrontmatter(skillMdText) : { body: '' };

      files.sort((a, b) => a.path.localeCompare(b.path));
      await applyAllowlist(compat.installDir, files, findings);
      results.push({
        id: `gh:${target.owner}/${target.repo}:${root || '.'}`,
        source: 'github',
        origin: `${target.owner}/${target.repo}`,
        commit: sha.slice(0, 7),
        commitFull: sha,
        commitDate: (commit.commit && commit.commit.committer && commit.commit.committer.date) || '',
        root,
        ref: target.refParts ? ref : '',
        sourceLink: input.trim(),
        url: `https://github.com/${target.owner}/${target.repo}/tree/${sha}/${root}`,
        name: compat.name,
        dir: compat.installDir,
        installDir: compat.installDir,
        description: compat.description,
        body: parsed.body,
        compat,
        files,
        skippedFiles: skipped,
        fp: Scan.skillFingerprint(skillMdText, files.map((f) => ({ path: f.path, size: f.bytes.length }))),
        findings,
        status: statusOf(findings),
      });
    }

    return { target, sha, ref, subPath, commitDate: (commit.commit && commit.commit.committer && commit.commit.committer.date) || '', skills: results, totalSkills, truncatedSkills: totalSkills > roots.length };
  }

  const STATUS_ORDER = { blocked: 0, invalid: 1, unverified: 2, warnings: 3, passed: 4 };

  function renderGitHubResults() {
    const wrap = $('github-results');
    wrap.textContent = '';
    const bundledNames = new Set(bundled.map((b) => b.installDir));
    ghFound
      .slice()
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name))
      .forEach((s) => {
        const row = el('label', 'gh-row');
        const box = document.createElement('input');
        box.type = 'checkbox';
        const allowed = !NOT_INSTALLABLE.has(s.status) && (settings.allowUnverified || s.status !== 'unverified');
        box.checked = allowed;
        box.disabled = !allowed;
        box.addEventListener('change', updateGitHubAdd);
        box.dataset.id = s.id;
        box.setAttribute('aria-label', `Add ${s.name}`);
        row.appendChild(box);

        const name = el('div', 'gh-row-name', s.name);
        name.appendChild(el('span', `pill ${STATUS[s.status].cls}`, STATUS[s.status].label));
        name.appendChild(riskBadge(reportOf(s).level));
        row.appendChild(name);
        row.appendChild(el('div', 'gh-row-desc', s.description || 'No description provided.'));
        row.appendChild(el('div', 'gh-row-meta', `Folder: ${s.root || '(repository root)'} · ${plural(s.files.length, 'file')}, ${formatBytes(s.files.reduce((n, f) => n + f.bytes.length, 0))}`));
        const inLibrary = github.find((g) => g.installDir === s.installDir && g.id !== s.id) || custom.find((c) => c.installDir === s.installDir);
        if (inLibrary) row.appendChild(el('div', 'gh-row-meta', `Your library already has a skill named "${s.installDir}" (${inLibrary.source === 'custom' ? 'made by you' : inLibrary.origin}). Only one can be installed.`));
        if (github.some((g) => g.id === s.id)) row.appendChild(el('div', 'gh-row-meta', 'Already in your library from this folder: adding replaces that copy with this version.'));
        if (installed.has(s.installDir)) row.appendChild(el('div', 'gh-row-meta', `"${s.installDir}" is installed in ${(currentTarget() || {}).label || 'Claude Code'}. Installing this one will replace it, after a backup.`));
        if (!allowed && s.status === 'unverified') row.appendChild(el('div', 'gh-row-note unverified', 'Your settings only allow skills that were fully checked.'));
        const actions = el('div', 'gh-row-actions');
        const details = el('button', 'link-btn', 'Details and files');
        details.type = 'button';
        details.addEventListener('click', (e) => {
          e.preventDefault();
          openPreview(s);
        });
        actions.appendChild(details);
        row.appendChild(actions);
        if (s.status === 'blocked') row.appendChild(el('div', 'gh-row-note blocked', `Can't be installed: ${firstReason(s, 'block')}`));
        if (s.status === 'invalid') row.appendChild(el('div', 'gh-row-note blocked', `Can't be installed: ${firstReason(s, 'invalid')}`));
        if (s.status === 'unverified') row.appendChild(el('div', 'gh-row-note unverified', `Warning: couldn't be checked. ${firstReason(s, 'unverified')}`));
        if (s.status === 'warnings') row.appendChild(el('div', 'gh-row-note warn', `Note: ${firstReason(s, 'warn')}`));
        if (s.skippedFiles) row.appendChild(el('div', 'gh-row-note unverified', `${plural(s.skippedFiles, 'file')} won't be installed, so the skill may not work fully.`));
        if (bundledNames.has(s.installDir)) row.appendChild(el('div', 'gh-row-meta', `Same name as "${s.installDir}" in this library. Only one of them can be installed.`));
        wrap.appendChild(row);
      });
    updateGitHubAdd();
  }

  function ghChecked() {
    return [...$('github-results').querySelectorAll('input[type="checkbox"]:checked')].map((b) => b.dataset.id);
  }

  function updateGitHubAdd() {
    const n = ghChecked().length;
    $('github-add').disabled = n === 0;
    $('github-add').textContent = n ? `Add ${plural(n, 'skill')} to library` : 'Add to library';
  }

  function setGitHubProgress(fraction) {
    $('github-progress').hidden = fraction === null || fraction === undefined;
    if (fraction !== null && fraction !== undefined) $('github-progress-bar').style.width = `${Math.round(Math.max(0.04, fraction) * 100)}%`;
  }

  function renderGitHubSource(result) {
    const box = $('github-source');
    box.textContent = '';
    box.hidden = !result;
    if (!result) return;
    const { target, sha, ref, subPath, commitDate } = result;
    const add = (label, value, href) => {
      const part = el('span');
      part.appendChild(document.createTextNode(`${label} `));
      if (href) {
        const a = el('a', null, value);
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        const code = el('code');
        code.appendChild(a);
        part.appendChild(code);
      } else part.appendChild(el('code', null, value));
      box.appendChild(part);
    };
    add('Repository', `${target.owner}/${target.repo}`, `https://github.com/${target.owner}/${target.repo}`);
    add('Author', target.owner, `https://github.com/${target.owner}`);
    if (ref) add('Branch', ref);
    add('Commit', sha.slice(0, 7), `https://github.com/${target.owner}/${target.repo}/commit/${sha}`);
    if (commitDate) add('Committed', formatDate(commitDate));
    if (subPath) add('Folder', subPath);
  }

  function setGitHubStatus(text, kind) {
    const status = $('github-status');
    status.textContent = '';
    status.className = 'gh-status';
    if (kind === 'busy') status.appendChild(el('span', 'spinner'));
    if (kind === 'error') {
      status.className = 'gh-status notice danger';
      status.insertAdjacentHTML('beforeend', ICONS.warn);
    }
    status.appendChild(el('span', null, text));
  }

  async function runGitHubScan(event) {
    event.preventDefault();
    if (ghScan) ghScan.abort();
    const controller = new AbortController();
    ghScan = controller;
    const input = $('github-url').value;
    ghFound = [];
    renderGitHubResults();
    renderGitHubSource(null);
    $('github-scan').disabled = true;
    try {
      $('github-watch').hidden = true;
      const result = await scanGitHub(input, (text, fraction) => {
        setGitHubStatus(text, 'busy');
        setGitHubProgress(fraction);
      }, controller.signal);
      const { skills, totalSkills, truncatedSkills, sha } = result;
      if (controller.signal.aborted) return;
      setGitHubProgress(null);
      renderGitHubSource(result);
      ghFound = skills;
      const counts = skills.reduce((acc, s) => Object.assign(acc, { [s.status]: (acc[s.status] || 0) + 1 }), {});
      const parts = [`Found ${plural(totalSkills, 'skill')}`];
      if (counts.blocked) parts.push(`${counts.blocked} blocked as unsafe`);
      if (counts.invalid) parts.push(`${counts.invalid} Claude can't load`);
      if (counts.unverified) parts.push(`${counts.unverified} couldn't be checked`);
      setGitHubStatus(parts.join(' · ') + (truncatedSkills ? `. Showing the first ${GH_LIMITS.skills}; paste a folder link for the others.` : '.'));
      renderGitHubResults();
      const target = parseGitHubUrl(input);
      const link = input.trim();
      lastScan = { link, label: `${target.owner}/${target.repo}${target.refParts ? `/${target.refParts.join('/')}` : ''}`, sha };
      const known = findWatched(link);
      $('github-watch').hidden = HOSTED;
      $('github-watch').textContent = known ? 'Watching' : 'Watch this repo';
      $('github-watch').disabled = Boolean(known);
      if (counts.unverified) showToast(`Heads up: ${plural(counts.unverified, 'skill')} couldn't be checked for safety.`, 4000);
    } catch (err) {
      setGitHubProgress(null);
      if (err && err.name === 'AbortError') return;
      setGitHubStatus(`Couldn't scan this link. ${err.message}`, 'error');
    } finally {
      if (ghScan === controller) {
        ghScan = null;
        $('github-scan').disabled = false;
      }
    }
  }

  /** Stop a running scan and reset the dialog when it closes. */
  function closeGitHub() {
    if (ghScan) {
      ghScan.abort();
      ghScan = null;
      setGitHubStatus('Scan cancelled.');
      $('github-scan').disabled = false;
    }
    if ($('github').open) $('github').close();
  }

  function addGitHubSkills() {
    const ids = new Set(ghChecked());
    const now = new Date().toISOString();
    const adding = ghFound.filter((s) => ids.has(s.id) && !NOT_INSTALLABLE.has(s.status));
    adding.forEach((s) => {
      s.addedAt = now;
      // Keep the copy being replaced, so it can be restored from Updates.
      const old = github.find((g) => g.id === s.id);
      if (old && old.fp !== s.fp) s.previous = snapshotOf(old);
    });
    const replacing = new Set(adding.map((s) => s.id));
    // A new scan of the same repo and folder replaces the older copy.
    github.filter((s) => replacing.has(s.id)).forEach((s) => selected.delete(s.id));
    github = github.filter((s) => !replacing.has(s.id)).concat(adding);
    reindex();
    adding.forEach((s) => selected.add(s.id));
    saveGithub();
    const seen = lastScan && findWatched(lastScan.link);
    if (seen) {
      seen.sha = lastScan.sha;
      seen.changed = false;
      seen.checkedAt = Date.now();
      saveWatched();
      renderWatchNotice();
    }
    const skipped = ghFound.length - adding.length;
    logActivity('import', adding.map((s) => s.name).join(', '),
      `${lastScan ? lastScan.label : 'GitHub'} at ${adding[0] ? adding[0].commit : '?'}: added ${adding.length}${skipped ? `, ${skipped} not added` : ''}${adding.some((s) => needsReview(s)) ? '; some need a security review' : ''}`,
      adding.some((s) => s.status === 'unverified' || needsReview(s)) ? 'warning' : 'ok');
    closeGitHub();
    state.view = 'github';
    renderAll();
    const unverified = adding.filter((s) => s.status === 'unverified').length;
    showToast(unverified
      ? `Added ${plural(adding.length, 'skill')}. ${unverified} couldn't be checked for safety; install only if you trust the source.`
      : `Added ${plural(adding.length, 'skill')} and selected them. Click Install to add them to Claude.`, 5000);
  }

  function removeFromLibrary(skill) {
    github = github.filter((s) => s.id !== skill.id);
    selected.delete(skill.id);
    reindex();
    saveGithub();
    logActivity('library-remove', skill.name, `${skill.origin} at ${skill.commit}`);
    if (preview.open) preview.close();
    renderAll();
    showToast(`Removed ${skill.name} from the library. It is still installed in Claude if you installed it.`, 4000);
  }

  // ------------------------------------------------------------- rendering

  function visible() {
    const q = state.query.trim().toLowerCase();
    let pool;
    if (state.view === 'installed') pool = library().filter((s) => installState(s)).concat(local);
    else if (state.view === 'github') pool = github;
    else if (state.view === 'selected') pool = chosen();
    else pool = library();
    let out = pool;
    if (q === 'original') out = pool.filter((s) => s.original);
    else if (q) {
      out = pool.filter((s) => s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q)
        || (s.original && ORIGINAL_LABEL.toLowerCase().includes(q)) || categoriesOf(s).some((c) => c.toLowerCase() === q));
    }
    const f = state.filters;
    if (f.category === '__none') out = out.filter((s) => !categoriesOf(s).length);
    else if (f.category) out = out.filter((s) => categoriesOf(s).includes(f.category));
    if (f.status === 'installed') out = out.filter((s) => s.source === 'local' || ['installed', 'update', 'other'].includes(installState(s)));
    else if (f.status === 'not-installed') out = out.filter((s) => s.source !== 'local' && !installState(s));
    else if (f.status === 'update') out = out.filter((s) => installState(s) === 'update' || hasGitHubUpdate(s));
    else if (f.status === 'review') out = out.filter((s) => needsReview(s));
    if (f.sort === 'category') {
      const first = (s) => categoriesOf(s)[0] || '￿';
      out = out.slice().sort((a, b) => first(a).localeCompare(first(b)) || a.name.localeCompare(b.name));
    } else if (f.sort === 'recent') {
      out = out.slice().sort((a, b) => updatedTime(b) - updatedTime(a) || a.name.localeCompare(b.name));
    } else if (state.view !== 'installed') {
      out = out.slice().sort((a, b) => a.name.localeCompare(b.name));
    }
    return out;
  }

  function filtersActive() {
    const f = state.filters;
    return Boolean(state.query.trim() || f.category || f.status);
  }

  function clearFilters() {
    state.query = '';
    search.value = '';
    state.filters = { category: '', status: '', sort: 'name' };
    $('filter-status').value = '';
    $('sort').value = 'name';
    renderCategoryFilter();
    keepFocus(() => {
      renderGrid();
      renderChips();
    });
  }

  /** Category options with counts from the current library. */
  function renderCategoryFilter() {
    const select = $('filter-category');
    const counts = new Map();
    let none = 0;
    for (const s of library()) {
      const cats = categoriesOf(s);
      if (!cats.length) none++;
      cats.forEach((c) => counts.set(c, (counts.get(c) || 0) + 1));
    }
    select.textContent = '';
    const opt = (value, text) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      o.selected = state.filters.category === value;
      select.appendChild(o);
    };
    opt('', 'All categories');
    Scan.CATEGORY_NAMES.filter((c) => counts.has(c)).forEach((c) => opt(c, `${c} (${counts.get(c)})`));
    if (none) opt('__none', `Uncategorized (${none})`);
  }

  function selectable(skill) {
    return skill && skill.source !== 'local' && !NOT_INSTALLABLE.has(skill.status);
  }

  function toggle(id) {
    const skill = byId.get(id);
    if (!selectable(skill)) return;
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    if (state.view === 'selected') renderAll();
    else refreshSelection();
  }

  /** Cheap update after the selection changes: no card rebuild. */
  function refreshSelection() {
    lastInstall = null;
    keepFocus(() => {
      grid.querySelectorAll('.card-main[role="checkbox"]').forEach((m) => {
        m.setAttribute('aria-checked', String(selected.has(m.dataset.id)));
      });
      updateResultsBar(visible());
      renderNav();
      renderConnect();
      if (preview.open && previewId) syncPreviewButtons();
    });
  }

  function renderChips() {
    const wrap = $('chips');
    wrap.textContent = '';
    CHIPS.forEach((word) => {
      const chip = el('button', 'chip', word);
      chip.dataset.focusKey = `chip:${word}`;
      chip.setAttribute('aria-pressed', String(state.query.trim().toLowerCase() === word));
      chip.addEventListener('click', () => {
        state.query = state.query.trim().toLowerCase() === word ? '' : word;
        search.value = state.query;
        keepFocus(() => {
          renderGrid();
          renderChips();
        });
      });
      wrap.appendChild(chip);
    });
  }

  function installPill(skill) {
    const st = installState(skill);
    if (skill.source === 'local' && duplicateNames.has(skill.name)) return el('span', 'pill pill-unverified', 'Duplicate name: Claude sees two copies');
    if (st === 'installed') return el('span', 'pill pill-passed', skill.source === 'local' ? 'Installed (not in library)' : 'Installed in Claude');
    if (st === 'update') return el('span', 'pill pill-unverified', 'Update available');
    if (st === 'elsewhere') return el('span', 'pill pill-unverified', `Installed as "${otherCopies(skill)[0]}"`);
    if (st === 'other') return el('span', 'pill', 'A different skill with this name is installed');
    return null;
  }

  function emptyState() {
    const empty = el('div', 'empty');
    const add = (title, text) => {
      empty.appendChild(el('h3', null, title));
      empty.appendChild(el('p', null, text));
    };
    if (filtersActive()) {
      add('No matching skills', 'Try a different word or filter.');
      const btn = el('button', 'btn', 'Clear search and filters');
      btn.addEventListener('click', clearFilters);
      empty.appendChild(btn);
    }
    else if (state.view === 'github') add('No GitHub skills yet', 'Use "Add from GitHub" to scan a repository and add its skills.');
    else if (state.view === 'selected') add('Nothing selected yet', 'Pick skills from All skills and they will show up here.');
    else if (state.view === 'installed' && connection === 'unsupported') add('Not available in this browser', IS_IOS || HOSTED ? 'Seeing what is installed needs the Windows download of the app in Edge or Chrome.' : 'Open the app in Microsoft Edge or Google Chrome to connect to Claude Code.');
    else if (state.view === 'installed' && connection !== 'connected') {
      add('Not connected to Claude Code', 'Connect to your Claude skills folder (or a project folder) to see what is installed.');
      const btn = el('button', 'btn btn-primary', connection === 'needs-permission' ? 'Reconnect' : 'Connect');
      btn.dataset.focusKey = 'empty-connect';
      btn.addEventListener('click', () => connectFolder(false));
      empty.appendChild(btn);
    }
    else if (state.view === 'installed') add('No skills installed yet', 'Select skills and click Install to add them to Claude Code.');
    else add('No skills', 'Run node scripts/skill-connector-build.js to build the library.');
    return empty;
  }

  function updateResultsBar(shown) {
    const title = $('results-title');
    title.textContent = '';
    title.appendChild(el('strong', null, String(shown.length)));
    const scope = { selected: ' selected', github: ' from GitHub', installed: ' installed in Claude Code' }[state.view] || '';
    const q = state.query.trim();
    const matching = q === 'original' ? ` made for Prabh’s CSC` : q ? ` matching “${q}”` : '';
    title.appendChild(document.createTextNode(`${shown.length === 1 ? ' skill' : ' skills'}${scope}${matching}`));
    $('select-visible').disabled = !shown.some((s) => selectable(s) && !selected.has(s.id));
    $('clear').disabled = !selected.size;
  }

  const ACTION_LABEL = { install: 'Installed', update: 'Updated', remove: 'Removed', undo: 'Undid a change:' };

  const ACTIVITY_LABEL = {
    import: 'Imported from GitHub',
    create: 'Created',
    edit: 'Edited',
    delete: 'Deleted from library',
    'library-remove': 'Removed from library',
    'library-update': 'Updated library copy',
    restore: 'Restored previous version',
    scan: 'Security scan of',
  };
  const HISTORY_TYPES = [
    ['', 'All activity'],
    ['changes', 'Installs, updates and removals'],
    ['import', 'GitHub imports'],
    ['made', 'Created and edited skills'],
    ['scan', 'Security scans'],
    ['library', 'Library changes'],
  ];

  function historyTypeOf(entry) {
    if (entry.kind === 'change') return 'changes';
    if (entry.type === 'import') return 'import';
    if (entry.type === 'create' || entry.type === 'edit') return 'made';
    if (entry.type === 'scan') return 'scan';
    return 'library';
  }

  function historyFilters() {
    const wrap = el('div', 'history-filters');
    const make = (id, label, options, value, onChange) => {
      const select = document.createElement('select');
      select.className = 'select';
      select.id = id;
      select.setAttribute('aria-label', label);
      for (const [v, text] of options) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = text;
        o.selected = v === value;
        select.appendChild(o);
      }
      select.addEventListener('change', () => onChange(select.value));
      wrap.appendChild(select);
    };
    make('history-type', 'Show', HISTORY_TYPES, state.historyFilter.type, (v) => {
      state.historyFilter.type = v;
      keepFocus(renderGrid);
    });
    const folders = [['', 'All folders']].concat(targets.map((t) => [t.id, t.label]));
    make('history-target', 'Folder', folders, state.historyFilter.target, (v) => {
      state.historyFilter.target = v;
      keepFocus(renderGrid);
    });
    return wrap;
  }

  function renderHistory() {
    grid.textContent = '';
    const title = $('results-title');
    title.textContent = '';
    // One timeline: file-change batches (undoable) and other activity, newest first.
    const groups = [...new Set(history.map((e) => e.batch))].map((batch) => {
      const entries = history.filter((e) => e.batch === batch);
      return { kind: 'change', batch, entries, time: entries[0].time, targetId: entries[0].targetId };
    }).concat(activity.map((a) => ({ kind: 'activity', ...a })));
    const f = state.historyFilter;
    const shown = groups
      .filter((g) => !f.type || historyTypeOf(g) === f.type)
      .filter((g) => !f.target || g.targetId === f.target)
      .sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
    title.appendChild(el('strong', null, String(shown.length)));
    title.appendChild(document.createTextNode(shown.length === 1 ? ' entry' : ' entries'));
    if (groups.length) grid.appendChild(historyFilters());
    if (!shown.length) {
      const empty = el('div', 'empty');
      empty.appendChild(el('h3', null, groups.length ? 'Nothing matches these filters' : 'No changes yet'));
      empty.appendChild(el('p', null, 'Installs, updates, removals, imports, created skills and security scans show up here. Recent installs, updates and removals can be undone.'));
      grid.appendChild(empty);
      return;
    }
    const undoable = undoableBatch();
    const list = el('div', 'history-list');
    for (const g of shown) {
      const group = el('div', 'history-group');
      const head = el('div', 'history-head');
      head.appendChild(el('span', 'history-time', new Date(g.time).toLocaleString()));
      const ul = el('ul', 'history-items');
      if (g.kind === 'change') {
        head.appendChild(el('span', 'pill', g.entries[0].targetLabel || 'Claude Code'));
        if (g.entries.every((e) => e.undone)) head.appendChild(el('span', 'pill', 'Undone'));
        else if (g.entries.some((e) => e.undo) && g.entries[0].action !== 'undo') head.appendChild(el('span', 'pill', 'Backup kept'));
        if (g.batch === undoable) {
          const undo = el('button', 'btn', 'Undo');
          undo.dataset.focusKey = `undo:${g.batch}`;
          undo.addEventListener('click', () => undoBatch(g.batch));
          head.appendChild(undo);
        }
        for (const e of g.entries) ul.appendChild(el('li', e.undone ? 'undone' : null, `${ACTION_LABEL[e.action] || e.action} ${e.skill}`));
      } else {
        head.appendChild(el('span', `pill ${g.result === 'ok' ? '' : g.result === 'failed' ? 'pill-blocked' : 'pill-unverified'}`, g.result === 'ok' ? 'Done' : g.result === 'failed' ? 'Failed' : 'Needs a look'));
        if (g.targetLabel) head.appendChild(el('span', 'pill', g.targetLabel));
        ul.appendChild(el('li', null, `${ACTIVITY_LABEL[g.type] || g.type} ${g.skill}`));
        if (g.detail) ul.appendChild(el('li', null, g.detail));
      }
      group.appendChild(head);
      group.appendChild(ul);
      list.appendChild(group);
    }
    grid.appendChild(list);
  }

  function renderGrid() {
    const historyView = state.view === 'history';
    $('select-visible').hidden = historyView;
    $('clear').hidden = historyView;
    document.querySelector('.composer').hidden = historyView;
    $('chips').hidden = historyView;
    $('filters').hidden = historyView;
    $('clear-filters').hidden = !(filtersActive() || state.filters.sort !== 'name');
    $('rescan').hidden = !(state.view === 'installed' && connection === 'connected' && installed.size);
    if (historyView) {
      renderHistory();
      return;
    }
    const shown = visible();
    grid.textContent = '';
    updateResultsBar(shown);

    if (!shown.length) {
      grid.appendChild(emptyState());
      return;
    }

    const frag = document.createDocumentFragment();
    shown.forEach((s, index) => {
      const canSelect = selectable(s);
      const card = el('div', 'card');
      if (NOT_INSTALLABLE.has(s.status)) card.classList.add('card-disabled');

      // The checkbox (or, for skills only installed in Claude, a preview button) is
      // its own element so the Preview button is not nested inside it.
      const main = el('div', 'card-main');
      const nameId = `card-name-${index}`;
      const descId = `card-desc-${index}`;
      main.tabIndex = 0;
      main.dataset.id = s.id;
      main.dataset.focusKey = `card:${s.id}`;
      main.setAttribute('role', canSelect ? 'checkbox' : 'button');
      if (canSelect) main.setAttribute('aria-checked', String(selected.has(s.id)));
      main.setAttribute('aria-labelledby', nameId);
      main.setAttribute('aria-describedby', descId);
      main.setAttribute('aria-keyshortcuts', 'p');
      if (canSelect) {
        const check = el('span', 'check');
        check.innerHTML = ICONS.check;
        check.setAttribute('aria-hidden', 'true');
        main.appendChild(check);
      }
      const name = el('div', 'card-name', s.name);
      name.id = nameId;
      main.appendChild(name);
      const pills = el('div', 'pills');
      if (s.original) pills.appendChild(el('span', 'pill pill-original', ORIGINAL_LABEL));
      if (s.source === 'custom') pills.appendChild(el('span', 'pill pill-original', 'Made by you'));
      if (s.source === 'github') {
        pills.appendChild(el('span', 'pill', `${s.origin}@${s.commit || ''}`));
        pills.appendChild(el('span', `pill ${STATUS[s.status].cls}`, STATUS[s.status].label));
      }
      const ip = installPill(s);
      if (ip) pills.appendChild(ip);
      const checked = state.view === 'installed' && rescan.get(s.installDir);
      if (checked) pills.appendChild(el('span', `pill ${STATUS[checked.status].cls}`, `Re-scan: ${STATUS[checked.status].label}`));
      if (s.source === 'bundled' && needsReview(s)) pills.appendChild(el('span', 'pill pill-info', 'Security notes'));
      if (hasGitHubUpdate(s)) pills.appendChild(el('span', 'pill pill-info', 'New version on GitHub'));
      if (pills.childNodes.length) main.appendChild(pills);
      const desc = el('div', 'card-desc', s.description || 'No description provided.');
      desc.id = descId;
      main.appendChild(desc);
      card.appendChild(main);

      const foot = el('div', 'card-foot');
      foot.appendChild(el('span', 'card-cats', s.source === 'local' ? 'Installed outside this library' : categoriesOf(s).join(' · ')));
      const view = withIcon(el('button', 'btn btn-ghost'), ICONS.eye, 'Details');
      view.tabIndex = -1; // keyboard users press P on the card; keeps one Tab stop per card
      view.dataset.focusKey = `preview:${s.id}`;
      view.setAttribute('aria-label', `Details for ${s.name}`);
      view.addEventListener('click', (e) => {
        e.stopPropagation();
        openPreview(s.id);
      });
      foot.appendChild(view);
      card.appendChild(foot);

      card.addEventListener('click', () => (canSelect ? toggle(s.id) : openPreview(s.id)));
      main.addEventListener('keydown', (e) => {
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          if (canSelect) toggle(s.id);
          else openPreview(s.id);
        } else if (e.key === 'p' || e.key === 'P') {
          e.preventDefault();
          openPreview(s.id);
        }
      });
      frag.appendChild(card);
    });
    grid.appendChild(frag);
  }

  function shellQuote(value) {
    return `'${value.replace(/'/g, "'\\''")}'`;
  }

  // The terminal commands copy from this repository's skills/ folder, so they only make sense there.
  const IN_REPO = /\/apps\/skill-connector\/index\.html$/.test(decodeURIComponent(location.pathname));

  function terminalCommands(picks) {
    const localPicks = picks.filter((s) => s.source === 'bundled');
    const lines = ['mkdir -p ~/.claude/skills'];
    for (const s of localPicks) {
      // Replace the whole folder so old files go and "cp -r" never nests a copy inside it.
      lines.push(`rm -rf ~/.claude/skills/${shellQuote(s.installDir)} && cp -r skills/${shellQuote(s.dir)} ~/.claude/skills/${shellQuote(s.installDir)}`);
    }
    if (localPicks.length < picks.length) lines.push('# Skills from GitHub: use Install or a .zip download above');
    return lines.join('\n');
  }

  function buildOutput(picks) {
    if (state.mode === 'claudemd') {
      return `# Skills\n\nThese skills are installed in Claude Code. Use them when a task matches:\n\n${picks.map((s) => `- **${s.name}**: ${s.description}`).join('\n')}\n`;
    }
    return picks.map((s) => `## Skill: ${s.name}\n\n${s.body}`).join('\n\n---\n\n');
  }

  const DISPLAY_LIMIT = 20000;

  function codeBlock(label, text) {
    const code = el('div', 'code');
    const head = el('div', 'code-head');
    head.appendChild(el('span', null, label));
    const copy = withIcon(el('button', 'btn btn-ghost'), ICONS.copy, 'Copy');
    copy.addEventListener('click', () => copyText(text));
    head.appendChild(copy);
    code.appendChild(head);
    const pre = el('pre', null, text.length > DISPLAY_LIMIT ? text.slice(0, DISPLAY_LIMIT) : text);
    pre.tabIndex = 0;
    code.appendChild(pre);
    if (text.length > DISPLAY_LIMIT) {
      code.appendChild(el('div', 'code-note', `Showing the first ${DISPLAY_LIMIT.toLocaleString()} of ${text.length.toLocaleString()} characters. Copy copies everything.`));
    }
    return code;
  }

  function notice(kind, icon, nodes) {
    const box = el('div', `notice ${kind}`);
    box.innerHTML = icon;
    const body = el('div');
    (Array.isArray(nodes) ? nodes : [nodes]).forEach((n) => body.appendChild(typeof n === 'string' ? el('div', null, n) : n));
    box.appendChild(body);
    return box;
  }

  function steps(items) {
    const ol = el('ol', 'steps');
    items.forEach((t) => ol.appendChild(el('li', null, t)));
    return ol;
  }

  function renderInstallResult() {
    if (!lastInstall) return;
    const verb = lastInstall.updated === lastInstall.count ? 'Updated' : lastInstall.updated ? 'Installed or updated' : 'Installed';
    const lines = [lastInstall.count
      ? `${verb} and verified ${plural(lastInstall.count, 'skill')} in "${lastInstall.folder}". Claude Code picks them up automatically, even in sessions that are already open.`
      : 'Nothing was installed.'];
    if (lastInstall.wasEmpty) lines.push('These are your first skills, so run /reload-skills once in any Claude Code session that is already open.');
    lines.push('To confirm, type /skills in Claude Code.');
    (lastInstall.notes || []).forEach((n) => lines.push(`Note: ${n}`));
    lastInstall.failed.forEach((f) => lines.push(`Not installed: ${f}`));
    const result = notice(lastInstall.failed.length ? 'danger' : 'ok', lastInstall.failed.length ? ICONS.warn : ICONS.ok, lines);
    result.id = 'install-result';
    if (lastInstall.batch && undoableBatch() === lastInstall.batch) {
      const undo = el('button', 'link-btn', 'Undo this change');
      undo.id = 'undo-last';
      undo.dataset.focusKey = 'undo-last';
      undo.addEventListener('click', () => undoBatch(lastInstall.batch));
      result.lastChild.appendChild(undo);
    }
    connectBody.appendChild(result);
  }

  function renderInstall(picks) {
    renderInstallResult();

    const unverified = picks.filter((s) => s.status === 'unverified');
    if (unverified.length) {
      connectBody.appendChild(notice('', ICONS.warn,
        `${plural(unverified.length, 'selected skill')} couldn't be checked for safety. You'll be asked to confirm before installing.`));
    }

    const actions = el('div', 'install-actions');
    if (SUPPORTS_FOLDER_WRITE) {
      const states = picks.map((s) => installState(s));
      let verb = 'Install';
      if (states.every((st) => st === 'installed')) verb = 'Reinstall';
      else if (states.every((st) => st === 'installed' || st === 'update')) verb = 'Update';
      const install = withIcon(el('button', 'btn btn-primary'), ICONS.install, `${verb} ${plural(picks.length, 'skill')} in Claude Code`);
      install.id = 'install-now';
      install.addEventListener('click', () => installSelected(false));
      actions.appendChild(install);
    }
    const row = el('div', 'install-row');
    const app = withIcon(el('button', `btn${SUPPORTS_FOLDER_WRITE ? '' : ' btn-primary'}`), ICONS.zip, 'Claude app (.zip)');
    app.id = 'download-app';
    app.title = 'One zip per skill, ready to upload to the Claude desktop or web app';
    app.addEventListener('click', downloadAppZips);
    const code = withIcon(el('button', 'btn'), ICONS.zip, 'Claude Code (.zip)');
    code.id = 'download-zip';
    code.title = `All selected skills in one zip, to unzip into ${SKILLS_PATH}`;
    code.addEventListener('click', downloadCodeZip);
    row.appendChild(app);
    row.appendChild(code);
    actions.appendChild(row);
    connectBody.appendChild(actions);

    const target = el('div', 'target-line');
    if (connection === 'connected' && currentTarget()) {
      const t = currentTarget();
      target.appendChild(document.createTextNode('Installs into'));
      target.appendChild(el('code', null, t.kind === 'project' ? `${t.handle.name}/.claude/skills` : t.label));
      const change = el('button', 'link-btn', 'Change');
      change.addEventListener('click', () => {
        const select = ['target-select', 'target-select-m'].map((x) => document.getElementById(x)).find((x) => x && x.offsetParent);
        if (select) select.focus();
        else connectFolder(true);
      });
      target.appendChild(change);
    }
    if (SUPPORTS_FOLDER_WRITE && targets.length) {
      const mobile = el('div', 'mobile-only target-mobile');
      mobile.appendChild(targetSelect('target-select-m'));
      const updateAll = updateAllButton('update-all-m');
      if (updateAll) mobile.appendChild(updateAll);
      connectBody.appendChild(mobile);
    } else if (SUPPORTS_FOLDER_WRITE) {
      target.appendChild(document.createTextNode(`First time? You'll pick your ${SKILLS_PATH} folder once.`));
    } else {
      target.appendChild(document.createTextNode(IS_IOS || HOSTED
        ? `${IS_IOS ? 'On iPhone and iPad' : 'In this web version'}, the app cannot write into folders. Use "Claude app (.zip)" and upload the zip in Claude (Customize > Skills), or use the Windows download for one-click install.`
        : `One-click install needs Microsoft Edge or Google Chrome. Here, use "Claude Code (.zip)" and unzip it into ${SKILLS_PATH}.`));
    }
    connectBody.appendChild(target);

    const appHelp = el('details', 'more');
    appHelp.open = state.open.app;
    appHelp.addEventListener('toggle', () => { state.open.app = appHelp.open; });
    appHelp.appendChild(el('summary', null, 'Using the Claude desktop or web app?'));
    const appBody = el('div', 'more-body');
    appBody.appendChild(steps([
      'Click "Claude app (.zip)". You get one zip per skill.',
      'In Claude, open Settings > Capabilities and turn on code execution (file creation).',
      'Go to Customize > Skills, click +, then "Upload a skill", and choose a zip.',
    ]));
    appBody.appendChild(el('p', 'more-note', 'Descriptions longer than 200 characters are shortened automatically, because the Claude app rejects them. Names containing "claude" or "anthropic" may be refused by the Claude app.'));
    appHelp.appendChild(appBody);
    connectBody.appendChild(appHelp);

    if (IN_REPO) {
      const more = el('details', 'more');
      more.open = state.open.terminal;
      more.addEventListener('toggle', () => { state.open.terminal = more.open; });
      more.appendChild(el('summary', null, 'Install from a terminal instead'));
      more.appendChild(codeBlock('Run in the repository folder (macOS, Linux or Git Bash)', terminalCommands(picks)));
      connectBody.appendChild(more);
    }
  }

  function renderConnect() {
    const picks = chosen();
    connectBody.textContent = '';

    if (!picks.length) {
      if (state.mode === 'install') renderInstallResult();
      const ph = el('div', 'placeholder');
      ph.innerHTML = ICONS.spark;
      ph.appendChild(el('div', null, 'Select one or more skills to install them or generate the setup.'));
      connectBody.appendChild(ph);
      return;
    }

    const selWrap = el('div');
    selWrap.appendChild(el('p', 'section-label', `${picks.length} selected`));
    const list = el('div', 'selected-list');
    const TAG_LIMIT = 12;
    const shownTags = state.showAllTags ? picks : picks.slice(0, TAG_LIMIT);
    shownTags.forEach((s) => {
      const tag = el('span', 'tag');
      tag.appendChild(el('span', null, s.name));
      const rm = el('button');
      rm.innerHTML = ICONS.x;
      rm.setAttribute('aria-label', `Remove ${s.name} from selection`);
      rm.dataset.focusKey = `tag:${s.id}`;
      rm.addEventListener('click', () => toggle(s.id));
      tag.appendChild(rm);
      list.appendChild(tag);
    });
    if (picks.length > TAG_LIMIT) {
      const more = el('button', 'link-btn', state.showAllTags ? 'Show fewer' : `+${picks.length - TAG_LIMIT} more`);
      more.dataset.focusKey = 'tags-more';
      more.addEventListener('click', () => {
        state.showAllTags = !state.showAllTags;
        keepFocus(renderConnect);
      });
      list.appendChild(more);
    }
    selWrap.appendChild(list);
    connectBody.appendChild(selWrap);

    if (state.mode === 'install') {
      renderInstall(picks);
      return;
    }

    const unchecked = picks.filter((s) => s.status === 'unverified').length;
    if (unchecked) connectBody.appendChild(notice('', ICONS.warn, `${plural(unchecked, 'selected skill')} couldn't be checked for safety. Only use ${unchecked === 1 ? 'it' : 'them'} if you trust the source.`));
    const stepsWrap = el('div');
    stepsWrap.appendChild(el('p', 'section-label', 'How to use'));
    stepsWrap.appendChild(steps({
      claudemd: ['Install the skills first (Install tab); this block only helps Claude pick them.', 'Open or create CLAUDE.md in your project root and paste the block below.', 'Claude Code reads it at the start of every session.'],
      api: ['Copy the text below.', 'Pass it as the system parameter in your Claude API request.'],
    }[state.mode]));
    connectBody.appendChild(stepsWrap);
    connectBody.appendChild(codeBlock(state.mode === 'claudemd' ? 'CLAUDE.md' : 'System prompt', buildOutput(picks)));
  }

  function copyText(text) {
    const ok = () => showToast('Copied to clipboard');
    const fail = () => showToast('Copy failed. Select the text and copy it manually.');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fail);
    else fail();
  }

  /**
   * The "install into" selector. Arrow keys only move the highlight (Chromium fires
   * change on arrows); Enter or a mouse pick applies it.
   */
  function targetSelect(id) {
    const select = document.createElement('select');
    select.id = id;
    select.className = 'target-select';
    select.dataset.focusKey = id;
    select.disabled = busy;
    select.setAttribute('aria-label', 'Install skills into');
    const option = (value, text, isSelected) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = text;
      opt.selected = Boolean(isSelected);
      select.appendChild(opt);
    };
    for (const tg of targets) option(tg.id, tg.label, tg.id === currentTargetId);
    option('__add-project', '+ Add a project folder...');
    if (!targets.some((tg) => tg.kind === 'personal')) option('__add-personal', '+ Connect personal skills folder...');
    const current = currentTarget();
    if (current && current.kind === 'project') option('__remove-project', `- Remove "${current.handle.name}" from this list`);

    let lastKey = '';
    const apply = () => {
      const value = select.value;
      if (value === currentTargetId) return;
      select.value = currentTargetId;
      if (value === '__add-project') addProjectTarget();
      else if (value === '__add-personal') connectFolder(true);
      else if (value === '__remove-project') removeProjectTarget();
      else switchTarget(value);
    };
    select.addEventListener('keydown', (e) => {
      lastKey = e.key;
      if (e.key === 'Enter') {
        e.preventDefault();
        apply();
      }
    });
    select.addEventListener('pointerdown', () => { lastKey = ''; });
    select.addEventListener('change', () => {
      if (/^(Arrow|Page|Home|End)/.test(lastKey)) return; // wait for Enter
      apply();
    });
    select.addEventListener('blur', () => { select.value = currentTargetId; });
    return select;
  }

  function updateAllButton(id) {
    const updates = connection === 'connected' ? updatable().length : 0;
    if (!updates) return null;
    const btn = el('button', 'btn btn-primary claude-connect', `Update all (${updates})`);
    btn.id = id;
    btn.dataset.focusKey = id;
    btn.disabled = busy;
    btn.addEventListener('click', () => installSkills(updatable(), false));
    return btn;
  }

  async function removeProjectTarget() {
    const current = currentTarget();
    if (!current || current.kind !== 'project' || busy) return;
    const ok = await confirmDialog(
      `Remove "${current.handle.name}" from the list?`,
      ['The app stops installing into this project. Skills already installed there stay where they are.'],
      'Remove from list'
    );
    if (!ok) return;
    targets = targets.filter((t) => t.id !== current.id);
    currentTargetId = (targets.find((t) => t.kind === 'personal') || targets[0] || {}).id || null;
    saveTargets();
    lastInstall = null;
    rescan = new Map();
    await refreshInstalled();
    renderAll();
  }

  function renderStatus() {
    const box = $('claude-status');
    box.textContent = '';
    box.className = `claude-status ${connection}`;
    const line = el('div', 'claude-status-line');
    line.appendChild(el('span', 'status-dot'));
    const t = currentTarget();
    const text = {
      connected: `${t ? (t.kind === 'project' ? t.handle.name : 'Claude Code') : 'Claude Code'} connected · ${plural(installed.size, 'skill')}`,
      'needs-permission': `${t && t.kind === 'project' ? t.handle.name : 'Claude Code'}: allow access again`,
      disconnected: 'Claude Code not connected',
      unsupported: IS_IOS || HOSTED ? 'Use "Claude app (.zip)" to add skills' : 'Open in Edge or Chrome to install directly',
    }[connection];
    line.appendChild(el('span', null, text));
    box.appendChild(line);

    if (SUPPORTS_FOLDER_WRITE && targets.length) box.appendChild(targetSelect('target-select'));

    const updateAll = updateAllButton('update-all');
    if (updateAll) box.appendChild(updateAll);
    if (connection === 'disconnected' || connection === 'needs-permission') {
      const btn = el('button', 'btn claude-connect', connection === 'disconnected' ? 'Connect' : 'Reconnect');
      btn.id = 'connect-claude';
      btn.dataset.focusKey = 'connect-claude';
      btn.addEventListener('click', () => connectFolder(false));
      box.appendChild(btn);
    }
  }

  function updateJump() {
    const jump = $('jump-install');
    jump.hidden = !selected.size || jump.dataset.panelVisible === 'true';
    jump.textContent = `${plural(selected.size, 'skill')} selected · Install`;
  }

  function renderNav() {
    $('count-all').textContent = String(library().length);
    $('count-selected').textContent = String(selected.size);
    $('count-github').textContent = String(github.length);
    $('count-installed').textContent = connection === 'connected' ? String(installed.size) : '-';
    $('count-history').textContent = String(history.filter((e) => e.action !== 'undo').length + activity.length);
    $('count-projects').textContent = String(targets.filter((t) => t.kind === 'project').length);
    const updates = updateCount();
    $('count-updates').textContent = String(updates);
    $('count-updates').classList.toggle('alert', updates > 0);
    const review = library().filter(needsReview).length + [...rescan.values()].filter((r) => ['critical', 'high'].includes(Scan.summarizeFindings(r.findings).level)).length;
    $('count-security').textContent = String(review);
    document.querySelectorAll('.nav-item[data-view]').forEach((item) => {
      item.setAttribute('aria-current', String(item.getAttribute('data-view') === state.view));
    });
    $('eyebrow').textContent = { selected: 'Your selection', github: 'Imported from GitHub', installed: `Installed in ${(currentTarget() || {}).label || 'Claude Code'}`, history: 'Activity' }[state.view] || 'Skills library';
    $('lib-title').textContent = { selected: 'Selected skills', github: 'GitHub skills', installed: 'Installed skills', history: 'History' }[state.view] || 'Skills for Claude Code';
    renderStatus();
    updateJump();
  }

  function renderAll() {
    const pageMode = PAGE_VIEWS.has(state.view);
    $('app').classList.toggle('page-mode', pageMode);
    $('lib').hidden = pageMode;
    $('page').hidden = !pageMode;
    keepFocus(() => {
      renderNav();
      if (pageMode) renderPage();
      else {
        renderCategoryFilter();
        renderGrid();
        renderConnect();
      }
      if (preview.open && previewId) syncPreviewButtons();
    });
  }

  /** Switch view (sidebar or a link inside a page) and start at the top. */
  function goTo(view) {
    state.view = view;
    renderAll();
    $('main').scrollTop = 0;
    window.scrollTo(0, 0);
  }

  function appIssues(skill) {
    if (skill.compat) return skill.compat.issues.filter((i) => i.level !== 'info');
    const issues = [];
    if (skill.description && skill.description.length > APP_DESCRIPTION_LIMIT) {
      issues.push({ target: 'app', level: 'warn', message: `Description is ${skill.description.length} characters; shortened to 200 in the Claude app download` });
    }
    return issues;
  }

  /** An example request for a skill: the curated one, or one built from its description. */
  function tryPromptFor(s) {
    if (s.tryPrompt) return s.tryPrompt;
    let first = (s.description || '').split(/(?<=[.!?])\s/)[0].replace(/[.!?]+$/, '').trim();
    if (first.length > 160) first = `${first.slice(0, 157).replace(/\s+\S*$/, '')}...`;
    return first ? `I'd like help with something this covers: ${first}.` : `Use the ${s.name} skill to help me with my current task.`;
  }

  // ------------------------------------------------------------ skill detail

  let previewSkill = null; // the skill shown; may be a GitHub scan result not yet in the library
  let previewFiles = null; // [{ path, bytes, modified? }] once loaded
  let previewFindings = null; // findings for exactly those files
  let previewToken = 0;
  let previewFile = null;
  let previewRaw = false;
  const fileCache = new Map(); // recent bundled skills' decoded files

  const SOURCE_LABEL = { bundled: 'Prabh’s CSC library', github: 'GitHub', custom: 'Made by you', local: 'Installed in Claude Code (not in this library)' };

  function installPathOf(target, dir) {
    if (!target) return '';
    const sep = IS_WINDOWS ? '\\' : '/';
    const base = target.kind === 'project' ? `${target.handle.name}${sep}${SKILLS_PATH}` : (IS_WINDOWS ? `%USERPROFILE%\\${SKILLS_PATH}` : `~/${SKILLS_PATH}`);
    return `${base}${sep}${dir}`;
  }

  function openPreview(idOrSkill, tab) {
    const s = typeof idOrSkill === 'string' ? byId.get(idOrSkill) : idOrSkill;
    if (!s) return;
    previewId = byId.get(s.id) === s ? s.id : null;
    previewSkill = s;
    previewFiles = null;
    previewFindings = null;
    previewFile = null;
    previewRaw = false;
    $('preview-title').textContent = s.name;
    const origin = { github: ` (from ${s.origin}, commit ${s.commit || '?'})`, local: ' (installed in Claude Code, not part of this library)' }[s.source] || '';
    $('preview-desc').textContent = `${s.description || 'No description provided.'}${origin}`;
    $('preview-try-text').textContent = tryPromptFor(s);
    renderPreviewOverview();
    renderPreviewSkillMd();
    renderPreviewFiles();
    renderPreviewSecurity();
    renderPreviewInstall();
    selectPreviewTab(tab || 'overview');
    syncPreviewButtons();
    if (!preview.open) preview.showModal();
    preview.querySelector('.dialog-body').scrollTop = 0;
    loadPreviewFiles(s);
  }

  async function filesForSkill(s) {
    if (s.source === 'local') {
      const folder = await getSkillsFolder(false, true);
      if (!folder) throw new Error("Connect to the folder to see this skill's files.");
      return readFolderFiles(await folder.getDirectoryHandle(s.installDir));
    }
    if (s.source === 'bundled') {
      if (!fileCache.has(s.id)) {
        fileCache.set(s.id, await getFiles(s));
        if (fileCache.size > 6) fileCache.delete(fileCache.keys().next().value);
      }
      return fileCache.get(s.id);
    }
    return getFiles(s);
  }

  async function loadPreviewFiles(s) {
    const token = ++previewToken;
    try {
      const files = (await filesForSkill(s)).slice().sort((a, b) => (a.path === 'SKILL.md' ? -1 : b.path === 'SKILL.md' ? 1 : a.path.localeCompare(b.path)));
      const findings = s.source === 'local' ? await scanFiles(s.installDir, files) : (s.findings || []);
      if (token !== previewToken) return;
      previewFiles = files;
      previewFindings = findings;
      if (s.source === 'local') s.findings = findings;
    } catch (err) {
      if (token !== previewToken) return;
      previewFiles = [];
      previewFindings = s.findings || [];
      previewSkill.loadError = err.message;
    }
    renderPreviewOverview();
    renderPreviewSkillMd();
    renderPreviewFiles();
    renderPreviewSecurity();
    renderPreviewInstall();
  }

  function selectPreviewTab(tab) {
    document.querySelectorAll('#preview-tabs [role="tab"]').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      $(`pv-${b.dataset.tab}`).hidden = !on;
    });
  }

  function skillMdText() {
    const f = previewFiles && previewFiles.find((x) => x.path === 'SKILL.md');
    return f ? decoder.decode(f.bytes) : null;
  }

  function renderPreviewOverview() {
    const s = previewSkill;
    const head = $('preview-findings');
    head.textContent = '';
    const pills = el('li', 'findings-head');
    if (s.original) pills.appendChild(el('span', 'pill pill-original', ORIGINAL_LABEL));
    if (s.source === 'github') pills.appendChild(el('span', `pill ${STATUS[s.status].cls}`, STATUS[s.status].label));
    const ip = byId.get(s.id) === s ? installPill(s) : null;
    if (ip) pills.appendChild(ip);
    pills.appendChild(el('span', 'pill', `Folder: ${s.installDir}`));
    const level = Scan.summarizeFindings(previewFindings || s.findings || []).level;
    const sec = el('button', 'link-btn', `Security: ${LEVEL_TEXT[level]}`);
    sec.type = 'button';
    sec.addEventListener('click', () => selectPreviewTab('security'));
    pills.appendChild(sec);
    head.appendChild(pills);
    appIssues(s).forEach((i) => {
      const li = el('li');
      li.appendChild(el('strong', null, i.target === 'app' ? 'Claude app' : 'Claude Code'));
      li.appendChild(el('span', null, i.message));
      head.appendChild(li);
    });

    const meta = $('preview-meta');
    meta.textContent = '';
    const row = (label, value) => {
      if (value === null || value === undefined || value === '') return;
      meta.appendChild(el('dt', null, label));
      const dd = el('dd');
      if (value instanceof Node) dd.appendChild(value);
      else dd.textContent = value;
      meta.appendChild(dd);
    };
    row('Source', s.source === 'github' ? `${s.origin} (author: ${s.origin.split('/')[0]})` : SOURCE_LABEL[s.source]);
    if (s.source === 'github') {
      const link = el('a', 'mono', `${s.commit}${s.commitDate ? ` · ${formatDate(s.commitDate)}` : ''}`);
      link.href = `https://github.com/${s.origin}/commit/${s.commitFull || s.commit}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      row('Commit', link);
      row('Folder in repository', s.root || '(repository root)');
    }
    row('Installs as', el('code', null, s.installDir));
    row('Categories', categoriesOf(s).join(', ') || 'None (no category words in its name or description)');
    if (s.addedAt) row('Added to library', formatDate(s.addedAt));
    if (s.updatedAt) row('Last edited', formatDate(s.updatedAt));
    const info = installed.get(s.installDir);
    if (info && (s.source === 'local' || installState(s))) row('Installed copy modified', formatDate(info.modified));
    if (previewFiles) {
      row('Files', `${plural(previewFiles.length, 'file')}, ${formatBytes(previewFiles.reduce((n, f) => n + f.bytes.length, 0))}`);
      const text = skillMdText();
      if (text !== null) {
        const parsed = Scan.parseFrontmatter(text);
        row('Description length', `${(parsed.attributes.description || '').length} characters`);
        for (const [key, value] of Object.entries(parsed.attributes)) {
          if (key === 'name' || key === 'description') continue;
          row(`Frontmatter: ${key}`, value.length > 300 ? `${value.slice(0, 300)}...` : value);
        }
        const compat = Scan.checkClaudeCompat(text, s.installDir);
        row('Claude Code', compat.code === 'ready' ? 'Will load this skill' : (compat.issues.find((i) => i.target === 'code' && i.level !== 'info') || {}).message || compat.code);
      }
    } else if (s.loadError) row('Files', s.loadError);
    else row('Files', 'Loading...');
  }

  function renderPreviewSkillMd() {
    const s = previewSkill;
    const full = skillMdText();
    const body = full !== null ? Scan.parseFrontmatter(full).body : s.body;
    $('preview-rendered').innerHTML = body ? renderMarkdown(body) : '<p>SKILL.md could not be read.</p>';
    $('preview-body').textContent = full !== null ? full : (s.body || 'SKILL.md could not be read.');
    $('preview-rendered').hidden = previewRaw;
    $('preview-body').hidden = !previewRaw;
    $('preview-md-toggle').textContent = previewRaw ? 'Show formatted' : 'Show raw text';
  }

  function worstRiskIn(path) {
    const order = ['critical', 'high', 'warning'];
    const risks = Scan.summarizeFindings((previewFindings || []).filter((f) => f.file === path)).findings.map((f) => f.risk);
    return order.find((r) => risks.includes(r)) || '';
  }

  function renderPreviewFiles() {
    const tree = $('preview-files');
    tree.textContent = '';
    const view = $('preview-file-view');
    $('pv-tab-files').textContent = previewFiles ? `Files (${previewFiles.length})` : 'Files';
    if (!previewFiles) {
      view.textContent = 'Loading files...';
      return;
    }
    if (!previewFiles.length) {
      view.textContent = previewSkill.loadError || 'No files.';
      return;
    }
    if (!previewFile || !previewFiles.some((f) => f.path === previewFile)) previewFile = previewFiles[0].path;
    for (const f of previewFiles) {
      const li = el('li');
      const btn = el('button');
      btn.type = 'button';
      btn.setAttribute('aria-current', String(f.path === previewFile));
      const risk = worstRiskIn(f.path);
      if (risk) {
        const dot = el('span', `flag ${risk}`);
        dot.title = `${RISK_LABEL[risk]} finding in this file`;
        btn.appendChild(dot);
      }
      btn.appendChild(el('span', null, f.path));
      btn.appendChild(el('span', 'size', formatBytes(f.bytes.length)));
      btn.addEventListener('click', () => {
        previewFile = f.path;
        renderPreviewFiles();
      });
      li.appendChild(btn);
      tree.appendChild(li);
    }
    renderFileView(view, previewFiles.find((f) => f.path === previewFile), previewFindings || []);
  }

  const FILE_VIEW_LIMIT = 400 * 1024;

  /** One file with line numbers; lines with findings are highlighted. */
  function renderFileView(view, file, findings) {
    view.textContent = '';
    const head = el('div', 'file-view-head');
    head.appendChild(el('span', null, file.path));
    head.appendChild(el('span', null, formatBytes(file.bytes.length)));
    if (file.modified) head.appendChild(el('span', null, `modified ${formatDate(file.modified)}`));
    view.appendChild(head);
    const text = Scan.decodeText(file.bytes.subarray(0, FILE_VIEW_LIMIT));
    if (text === null) {
      view.appendChild(el('div', 'panel-empty', 'Binary file: not shown. Its type and contents were checked by the safety scan where possible.'));
      return;
    }
    const hits = new Map();
    for (const f of Scan.summarizeFindings(findings.filter((x) => x.file === file.path && x.line)).findings) {
      if (!hits.has(f.line)) hits.set(f.line, f);
    }
    const lines = el('div', 'file-lines');
    text.replace(/\r\n/g, '\n').split('\n').forEach((line, i) => {
      const hit = hits.get(i + 1);
      const row = el('div', hit ? `hit ${hit.risk === 'warning' || hit.risk === 'info' ? 'warning' : ''}` : null, line);
      if (hit) row.title = hit.title;
      row.dataset.line = String(i + 1);
      lines.appendChild(row);
    });
    view.appendChild(lines);
    if (file.bytes.length > FILE_VIEW_LIMIT) view.appendChild(el('div', 'code-note', `Showing the first ${formatBytes(FILE_VIEW_LIMIT)}.`));
  }

  /** Jump from a finding to its file and line. */
  function viewFileAt(path, line) {
    previewFile = path;
    selectPreviewTab('files');
    renderPreviewFiles();
    const row = line && document.querySelector(`#preview-file-view .file-lines div[data-line="${line}"]`);
    if (row) row.scrollIntoView({ block: 'center' });
  }

  function renderPreviewSecurity() {
    const s = previewSkill;
    const box = $('preview-report');
    box.textContent = '';
    const findings = previewFindings || s.findings || [];
    box.appendChild(renderReport(findings, {
      onView: viewFileAt,
      canView: (path) => Boolean(previewFiles && previewFiles.some((f) => f.path === path)),
    }));
    const rescanned = rescan.get(s.installDir);
    if (rescanned && (s.source === 'local' || installState(s))) {
      box.appendChild(el('p', 'section-label', `Installed copy, re-scanned ${formatDate(rescanned.checkedAt)}`));
      box.lastChild.style.marginTop = '18px';
      box.appendChild(renderReport(rescanned.findings));
    }
  }

  function renderPreviewInstall() {
    const s = previewSkill;
    const box = $('preview-install');
    box.textContent = '';
    if (!SUPPORTS_FOLDER_WRITE) {
      box.appendChild(notice('info', ICONS.info, `This browser can't write into folders. Select the skill and use a .zip download from the install panel, then unzip it into ${SKILLS_PATH}.`));
      return;
    }
    const inLibrary = byId.get(s.id) === s;
    if (!inLibrary) {
      box.appendChild(notice('info', ICONS.info, 'Add this skill to your library first, then install it from there.'));
      return;
    }
    const target = currentTarget();
    const meta = el('dl', 'meta-grid');
    const row = (label, value) => {
      meta.appendChild(el('dt', null, label));
      const dd = el('dd');
      if (value instanceof Node) dd.appendChild(value);
      else dd.textContent = value;
      meta.appendChild(dd);
    };
    if (!target || connection !== 'connected') {
      box.appendChild(notice('info', ICONS.info, connection === 'needs-permission' ? 'Allow access to your skills folder again to see where this skill is installed.' : 'Connect to your Claude Code skills folder to install skills and see where they are.'));
      const btn = el('button', 'btn btn-primary', connection === 'needs-permission' ? 'Reconnect' : 'Connect to Claude Code');
      btn.addEventListener('click', async () => {
        await connectFolder(false);
        renderPreviewInstall();
      });
      box.appendChild(btn);
      return;
    }
    const st = s.source === 'local' ? 'installed' : installState(s);
    const stateText = {
      installed: 'Installed, same version as the library',
      update: 'Installed, but a different version: an update is available',
      elsewhere: `Installed under another folder name: "${otherCopies(s)[0]}"`,
      other: 'A different skill with this name is installed',
    }[st] || 'Not installed in this folder';
    row('Folder', target.label);
    row('Status', stateText);
    row('Location', el('code', null, installPathOf(target, s.installDir)));
    const info = installed.get(s.installDir);
    if (info && st) row('Last modified', formatDate(info.modified) || 'Unknown');
    const elsewhere = targets.filter((t) => t.id !== target.id && targetStats.get(t.id) && targetStats.get(t.id).skills.has(s.installDir));
    row('Other folders', elsewhere.length ? elsewhere.map((t) => t.label).join(', ') : 'Not found in your other connected folders');
    if (duplicateNames.has(s.name)) row('Duplicates', `Claude sees ${duplicateNames.get(s.name).length} copies named "${s.name}": ${duplicateNames.get(s.name).join(', ')}`);
    box.appendChild(meta);
    const actions = el('div', 'install-row');
    actions.style.gridTemplateColumns = 'repeat(auto-fit, minmax(160px, 1fr))';
    if (selectable(s)) {
      const verb = st === 'installed' ? 'Reinstall' : st === 'update' ? 'Update' : 'Install';
      const btn = withIcon(el('button', 'btn btn-primary'), ICONS.install, `${verb} in ${target.kind === 'project' ? target.handle.name : 'Claude Code'}`);
      btn.disabled = busy;
      btn.addEventListener('click', async () => {
        await installSkills([s], false);
        renderPreviewInstall();
      });
      actions.appendChild(btn);
    }
    if (st === 'update') {
      const cmp = el('button', 'btn', 'Compare versions');
      cmp.addEventListener('click', () => compareInstalled(s));
      actions.appendChild(cmp);
    }
    if (st && st !== 'elsewhere') {
      const rm = el('button', 'btn btn-danger-ghost', 'Remove from this folder');
      rm.addEventListener('click', () => removeInstalled(s));
      actions.appendChild(rm);
    }
    box.appendChild(actions);
    box.appendChild(el('p', 'report-note', 'Installing never overwrites silently: you are asked first, the current copy is backed up, and the change can be undone from History.'));
  }

  function syncPreviewButtons() {
    const s = byId.get(previewId);
    const toggleBtn = $('preview-toggle');
    toggleBtn.hidden = !selectable(s);
    toggleBtn.textContent = selected.has(previewId) ? 'Deselect' : 'Select';
    const st = s && installState(s);
    $('preview-remove').hidden = !(s && (st || s.source === 'local') && st !== 'elsewhere' && SUPPORTS_FOLDER_WRITE);
    $('preview-remove-library').hidden = !(s && s.source === 'github');
    $('preview-edit').hidden = !(s && s.source === 'custom');
    $('preview-delete').hidden = !(s && s.source === 'custom');
    $('preview-copy-edit').hidden = !(s && s.source !== 'custom');
  }

  // ---------------------------------------------------------------- compare

  /** Line diff (LCS) as [{ op: ' ' | '+' | '-', text }], or null when too large to compare. */
  function lineDiff(oldText, newText) {
    const a = oldText.replace(/\r\n/g, '\n').split('\n');
    const b = newText.replace(/\r\n/g, '\n').split('\n');
    if (a.length * b.length > 4000000) return null;
    const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
    const out = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { out.push({ op: ' ', text: a[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ op: '-', text: a[i++] });
      else out.push({ op: '+', text: b[j++] });
    }
    while (i < a.length) out.push({ op: '-', text: a[i++] });
    while (j < b.length) out.push({ op: '+', text: b[j++] });
    return out;
  }

  function sameBytes(x, y) {
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }

  /** Per-file comparison of two versions: added, removed, changed or same. */
  function compareFiles(oldFiles, newFiles) {
    const oldMap = new Map(oldFiles.map((f) => [f.path, f]));
    const newMap = new Map(newFiles.map((f) => [f.path, f]));
    const paths = [...new Set([...oldMap.keys(), ...newMap.keys()])].sort();
    return paths.map((path) => {
      const o = oldMap.get(path);
      const n = newMap.get(path);
      const status = !o ? 'added' : !n ? 'removed' : sameBytes(o.bytes, n.bytes) ? 'same' : 'changed';
      return { path, status, oldFile: o, newFile: n };
    });
  }

  function renderDiff(oldText, newText) {
    const ops = lineDiff(oldText, newText);
    if (!ops) return el('p', 'report-note', 'Too large to compare line by line.');
    const box = el('div', 'diff');
    const CONTEXT = 3;
    const keep = ops.map((op, i) => op.op !== ' ' || ops.slice(Math.max(0, i - CONTEXT), i + CONTEXT + 1).some((x) => x.op !== ' '));
    let gap = false;
    ops.forEach((op, i) => {
      if (!keep[i]) {
        if (!gap) box.appendChild(el('div', 'gap', '...'));
        gap = true;
        return;
      }
      gap = false;
      box.appendChild(el('div', op.op === '+' ? 'add' : op.op === '-' ? 'del' : null, `${op.op} ${op.text}`));
    });
    return box;
  }

  let compareApply = null;

  /**
   * Show what changes between two versions of a skill. `opts`: title, subtitle,
   * oldFiles, newFiles, newFindings (security report of the new version),
   * applyLabel and onApply.
   */
  function openCompare(opts) {
    $('compare-title').textContent = opts.title;
    $('compare-sub').textContent = opts.subtitle || '';
    const body = $('compare-body');
    body.textContent = '';
    const changes = compareFiles(opts.oldFiles, opts.newFiles).filter((c) => c.status !== 'same');
    const count = (st) => changes.filter((c) => c.status === st).length;
    body.appendChild(el('p', 'section-label', changes.length
      ? `${plural(changes.length, 'file')} differ: ${count('changed')} changed, ${count('added')} added, ${count('removed')} removed`
      : 'The files are identical'));
    const list = el('ul', 'file-changes');
    changes.forEach((c) => list.appendChild(el('li', c.status, `${{ added: '+', removed: '-', changed: '~' }[c.status]} ${c.path}`)));
    body.appendChild(list);
    let shown = 0;
    for (const c of changes) {
      if (shown >= 12) {
        body.appendChild(el('p', 'report-note', 'More changed files are not shown here.'));
        break;
      }
      const oldText = c.oldFile ? Scan.decodeText(c.oldFile.bytes) : '';
      const newText = c.newFile ? Scan.decodeText(c.newFile.bytes) : '';
      body.appendChild(el('p', 'section-label', c.path));
      if (oldText === null || newText === null) body.appendChild(el('p', 'report-note', 'Binary file: not compared line by line.'));
      else body.appendChild(renderDiff(oldText, newText));
      shown++;
    }
    if (opts.newFindings) {
      const label = el('p', 'section-label', 'Security report of the new version');
      label.style.marginTop = '16px';
      body.appendChild(label);
      body.appendChild(renderReport(opts.newFindings));
    }
    const apply = $('compare-apply');
    apply.hidden = !opts.onApply;
    apply.textContent = opts.applyLabel || 'Apply';
    apply.disabled = false;
    compareApply = opts.onApply || null;
    if (!$('compare').open) $('compare').showModal();
    body.scrollTop = 0;
  }

  async function compareInstalled(s) {
    try {
      const folder = await getSkillsFolder(false, true);
      if (!folder) throw new Error('Reconnect to the folder first.');
      const installedFiles = await readFolderFiles(await folder.getDirectoryHandle(s.installDir));
      const libraryFiles = await getFiles(s);
      openCompare({
        title: `${s.name}: installed copy vs library`,
        subtitle: `Lines marked - are in the installed copy in ${(currentTarget() || {}).label}; lines marked + are in the library version.`,
        oldFiles: installedFiles,
        newFiles: libraryFiles,
        applyLabel: 'Update installed copy',
        onApply: () => installSkills([s], false),
      });
    } catch (err) {
      showToast(`Couldn't compare: ${err.message}`, 5000);
    }
  }

  // ---------------------------------------------------------------- updates

  function hasGitHubUpdate(s) {
    return Boolean(s && s.source === 'github' && s.updateCheck && s.updateCheck.changed === true);
  }

  function updateCount() {
    return (connection === 'connected' ? updatable().length : 0) + github.filter(hasGitHubUpdate).length;
  }

  function snapshotOf(s) {
    return {
      commit: s.commit, commitFull: s.commitFull, commitDate: s.commitDate, fp: s.fp, files: s.files, findings: s.findings,
      status: s.status, name: s.name, description: s.description, body: s.body, compat: s.compat, skippedFiles: s.skippedFiles, addedAt: s.addedAt,
    };
  }

  let ghCheck = null; // { running, at, error, checked }

  /**
   * Ask GitHub whether imported skills changed: one lookup for each repository and
   * branch, and one comparison for each imported commit. A skill only counts as
   * updated when the comparison shows files in its folder changed.
   */
  async function checkGitHubUpdates() {
    if (!github.length || (ghCheck && ghCheck.running)) return;
    ghCheck = { running: true, at: Date.now(), error: '', checked: 0 };
    renderAll();
    const latestFor = new Map();
    const compareFor = new Map();
    try {
      for (const s of github) {
        const [owner, repo] = s.origin.split('/');
        const refKey = `${s.origin}@${s.ref || ''}`;
        if (!latestFor.has(refKey)) {
          const target = { owner, repo, refParts: s.ref ? s.ref.split('/') : null, path: '', blob: false };
          latestFor.set(refKey, (await resolveRef(target)).commit.sha);
        }
        const latest = latestFor.get(refKey);
        const base = s.commitFull || s.commit;
        const check = { checkedAt: new Date().toISOString(), latest, changed: false, files: [] };
        if (!latest.startsWith(base)) {
          const cmpKey = `${s.origin}:${base}...${latest}`;
          if (!compareFor.has(cmpKey)) compareFor.set(cmpKey, await githubApi(`/repos/${owner}/${repo}/compare/${base}...${latest}`));
          const cmp = compareFor.get(cmpKey);
          const inFolder = (name) => !s.root || name === s.root || name.startsWith(`${s.root}/`);
          check.files = (cmp.files || []).filter((f) => inFolder(f.filename) || (f.previous_filename && inFolder(f.previous_filename))).map((f) => `${f.status} ${f.filename}`);
          // GitHub lists at most 300 files per comparison; beyond that we can't tell.
          check.changed = check.files.length ? true : (cmp.files || []).length >= 300 ? null : false;
        }
        s.updateCheck = check;
        ghCheck.checked++;
      }
    } catch (err) {
      ghCheck.error = err.message;
    }
    ghCheck.running = false;
    saveGithub();
    renderAll();
  }

  /** Download the newer version of an imported skill, scan it, and show what changes. */
  async function reviewGitHubUpdate(s) {
    if (!s.updateCheck || busy) return;
    setBusy(true);
    showToast(`Downloading and scanning the new version of ${s.name}...`, 60000);
    try {
      const link = `https://github.com/${s.origin}/tree/${s.updateCheck.latest}/${s.root || ''}`.replace(/\/$/, '');
      const result = await scanGitHub(link, () => {});
      const found = result.skills.find((x) => x.id === s.id) || result.skills.find((x) => x.installDir === s.installDir);
      if (!found) throw new Error('The skill is no longer in that folder of the repository.');
      showToast('Ready to review.', 1500);
      openCompare({
        title: `${s.name}: update from GitHub`,
        subtitle: `${s.origin}: ${s.commit} → ${found.commit}. Lines marked - are in your library copy; lines marked + are in the new version.`,
        oldFiles: s.files,
        newFiles: found.files,
        newFindings: found.findings,
        applyLabel: NOT_INSTALLABLE.has(found.status) ? 'Cannot update: new version is blocked' : 'Update library copy',
        onApply: NOT_INSTALLABLE.has(found.status) ? null : () => applyGitHubUpdate(s, found),
      });
    } catch (err) {
      showToast(`Couldn't get the new version: ${err.message}`, 6000);
    } finally {
      setBusy(false);
    }
  }

  async function applyGitHubUpdate(old, found) {
    const wasInstalled = ['installed', 'update'].includes(installState(old));
    const next = Object.assign(found, {
      addedAt: old.addedAt,
      updatedAt: new Date().toISOString(),
      sourceLink: old.sourceLink,
      ref: old.ref,
      previous: snapshotOf(old),
      updateCheck: null,
    });
    github = github.map((g) => (g.id === old.id ? next : g));
    reindex();
    saveGithub();
    logActivity('library-update', next.name, `${old.origin}: ${old.commit} → ${next.commit}`, needsReview(next) ? 'warning' : 'ok');
    $('compare').close();
    renderAll();
    showToast(`Updated ${next.name} in your library. The previous version can be restored from Updates.`, 5000);
    if (wasInstalled && SUPPORTS_FOLDER_WRITE && connection === 'connected') {
      const go = await confirmDialog(`Install the new version of ${next.name}?`, [`It is installed in ${(currentTarget() || {}).label}. The installed copy is backed up first.`], 'Install update');
      if (go) await installSkills([next], false);
    }
  }

  async function restorePrevious(s) {
    if (!s.previous) return;
    const ok = await confirmDialog(`Restore the previous version of ${s.name}?`, [`Your library copy goes back to commit ${s.previous.commit}. The current version (${s.commit}) is kept, so you can switch back.`], 'Restore');
    if (!ok) return;
    const current = snapshotOf(s);
    const next = Object.assign({}, s, s.previous, { previous: current, updateCheck: null, report: null, categories: null, updatedAt: new Date().toISOString() });
    github = github.map((g) => (g.id === s.id ? next : g));
    reindex();
    saveGithub();
    logActivity('restore', s.name, `${current.commit} → ${next.commit}`);
    renderAll();
    showToast(`Restored ${s.name} to ${next.commit}. Install it again to update Claude Code.`, 5000);
  }

  // ------------------------------------------------------------------ pages

  function pageHead(eyebrow, title, sub) {
    const head = el('div', 'hero');
    const e = el('div', 'hero-eyebrow');
    e.appendChild(el('span', 'dot'));
    e.appendChild(el('span', null, eyebrow));
    head.appendChild(e);
    head.appendChild(el('h1', null, title));
    if (sub) head.appendChild(el('p', 'page-sub', sub));
    return head;
  }

  function panel(title, actions) {
    const box = el('section', 'panel');
    const head = el('div', 'panel-head');
    head.appendChild(el('h2', null, title));
    (actions || []).forEach((a) => head.appendChild(a));
    box.appendChild(head);
    return box;
  }

  function button(label, cls, onClick, id) {
    const b = el('button', `btn ${cls || ''}`.trim(), label);
    b.type = 'button';
    if (id) b.dataset.focusKey = id;
    b.addEventListener('click', onClick);
    return b;
  }

  function statCard(value, label, note, onClick) {
    const card = el(onClick ? 'button' : 'div', 'stat');
    if (onClick) {
      card.type = 'button';
      card.addEventListener('click', onClick);
    }
    card.appendChild(el('span', 'stat-value', String(value)));
    card.appendChild(el('span', 'stat-label', label));
    if (note) card.appendChild(el('span', 'stat-note', note));
    return card;
  }

  function rowsList(items, emptyText) {
    if (!items.length) return el('div', 'panel-empty', emptyText);
    const ul = el('ul', 'rows');
    items.forEach((it) => {
      const li = el('li');
      if (it.badge) li.appendChild(it.badge);
      const main = el('div', 'row-main');
      main.appendChild(el('span', 'row-title', it.title));
      if (it.sub) main.appendChild(el('span', 'row-sub', it.sub));
      li.appendChild(main);
      if (it.actions && it.actions.length) {
        const a = el('div', 'row-actions');
        it.actions.forEach((x) => a.appendChild(x));
        li.appendChild(a);
      }
      ul.appendChild(li);
    });
    return ul;
  }

  let statsRefreshing = false;
  /** Refresh folder snapshots in the background, then redraw the page once. */
  function refreshStatsSoon() {
    const stale = targets.some((t) => !targetStats.get(t.id) || Date.now() - targetStats.get(t.id).at > 15000);
    if (!stale || statsRefreshing || !SUPPORTS_FOLDER_WRITE) return;
    statsRefreshing = true;
    refreshTargetStats().finally(() => {
      statsRefreshing = false;
      if (PAGE_VIEWS.has(state.view)) renderAll();
    });
  }

  function countIn(kind) {
    let known = false;
    let n = 0;
    for (const t of targets.filter((x) => x.kind === kind)) {
      const st = targetStats.get(t.id);
      if (st && st.state !== 'needs-permission') {
        known = true;
        n += st.skills.size;
      }
    }
    return known ? n : '-';
  }

  function renderPage() {
    const page = $('page');
    page.textContent = '';
    ({ home: renderHome, projects: renderProjects, updates: renderUpdates, security: renderSecurity, settings: renderSettings })[state.view](page);
  }

  function renderHome(page) {
    refreshStatsSoon();
    page.appendChild(pageHead('Home', 'Claude Code skills at a glance', 'Everything here is read from your library and the folders you connected.'));
    const stats = el('div', 'stats');
    stats.appendChild(statCard(library().length, 'Skills in library', `${bundled.length} bundled · ${github.length} GitHub · ${custom.length} yours`, () => goTo('all')));
    stats.appendChild(statCard(connection === 'connected' ? installed.size : '-', 'Installed here', connection === 'connected' ? (currentTarget() || {}).label : 'Not connected', () => goTo('installed')));
    stats.appendChild(statCard(countIn('personal'), 'Personal skills', 'In ~/.claude/skills, every project', () => goTo('projects')));
    stats.appendChild(statCard(countIn('project'), 'Project skills', `${plural(targets.filter((t) => t.kind === 'project').length, 'project folder')}`, () => goTo('projects')));
    stats.appendChild(statCard(updateCount(), 'Updates available', github.some((s) => s.updateCheck) ? 'Library and GitHub' : 'Library versions', () => goTo('updates')));
    stats.appendChild(statCard(library().filter(needsReview).length, 'Need a security look', 'Library skills with findings', () => goTo('security')));
    page.appendChild(stats);

    const quick = panel('Quick actions');
    const q = el('div', 'quick panel-body');
    q.appendChild(button('Browse skills', '', () => goTo('all')));
    q.appendChild(button('Import from GitHub', '', () => $('open-github').click()));
    q.appendChild(button('Create a skill', '', () => openMaker(null)));
    q.appendChild(button('Manage installations', '', () => goTo('installed')));
    q.appendChild(button('Run a security scan', '', () => {
      goTo('security');
      if (connection === 'connected' && installed.size) rescanInstalled();
    }));
    if (DESKTOP && DESKTOP.openSkillsFolder) q.appendChild(button('Open skills folder', '', openSkillsFolder));
    else if (SUPPORTS_FOLDER_WRITE && connection !== 'connected') q.appendChild(button('Connect skills folder', '', () => connectFolder(false)));
    quick.appendChild(q);
    page.appendChild(quick);

    const cols = el('div', 'two-col');
    const added = github.concat(custom).filter((s) => s.addedAt || s.updatedAt)
      .sort((a, b) => Date.parse(b.updatedAt || b.addedAt) - Date.parse(a.updatedAt || a.addedAt)).slice(0, 6);
    const recentAdded = panel('Recently added or edited');
    recentAdded.appendChild(rowsList(added.map((s) => ({
      title: s.name,
      sub: `${s.source === 'github' ? `From ${s.origin}` : 'Made by you'} · ${timeAgo(s.updatedAt || s.addedAt)}`,
      actions: [button('Details', 'btn-sm btn-ghost', () => openPreview(s.id))],
    })), 'Skills you import or create show up here.'));
    cols.appendChild(recentAdded);

    const updatedInstalled = [...installed.entries()].sort((a, b) => (b[1].modified || 0) - (a[1].modified || 0) || a[0].localeCompare(b[0])).slice(0, 6);
    const recentUpdated = panel('Recently updated in Claude Code');
    recentUpdated.appendChild(rowsList(updatedInstalled.map(([dir, i]) => ({
      title: i.name,
      sub: `${dir} · ${i.modified ? `modified ${timeAgo(i.modified)}` : 'modified date unknown'}`,
      actions: [button('Details', 'btn-sm btn-ghost', () => openPreview(byId.get(dir) ? dir : (library().find((s) => s.installDir === dir) || {}).id || `local:${dir}`))],
    })), connection === 'connected' ? 'No installed skills yet.' : 'Connect to your skills folder to see installed skills.'));
    cols.appendChild(recentUpdated);

    const installs = history.filter((e) => e.action !== 'undo').slice(0, 6);
    const recentInstalls = panel('Recent installations', [button('History', 'btn-sm btn-ghost', () => goTo('history'))]);
    recentInstalls.appendChild(rowsList(installs.map((e) => ({
      title: `${ACTION_LABEL[e.action] || e.action} ${e.skill}`,
      sub: `${e.targetLabel || 'Claude Code'} · ${timeAgo(e.time)}${e.undone ? ' · undone' : ''}`,
    })), 'Installs, updates and removals show up here.'));
    cols.appendChild(recentInstalls);

    const findings = activity.filter((a) => (a.type === 'scan' || a.type === 'import') && a.result !== 'ok').slice(0, 6);
    const recentFindings = panel('Recent security findings', [button('Security', 'btn-sm btn-ghost', () => goTo('security'))]);
    recentFindings.appendChild(rowsList(findings.map((a) => ({
      badge: riskBadge('warning'),
      title: `${ACTIVITY_LABEL[a.type]} ${a.skill}`,
      sub: `${a.detail} · ${timeAgo(a.time)}`,
    })), 'Imports and scans that found something to look at show up here.'));
    cols.appendChild(recentFindings);
    page.appendChild(cols);
  }

  function renderProjects(page) {
    refreshStatsSoon();
    page.appendChild(pageHead('Claude Code', 'Personal and project skills', 'Personal skills (~/.claude/skills) work in every project. Project skills (<project>/.claude/skills) only work in that project.'));
    if (!SUPPORTS_FOLDER_WRITE) {
      page.appendChild(notice('info', ICONS.info, 'Managing folders needs the desktop app, Microsoft Edge or Google Chrome.'));
      return;
    }
    const list = panel('Folders', [button('Add a project folder', 'btn-primary btn-sm', addProjectTarget, 'add-project')]);
    const personal = targets.find((t) => t.kind === 'personal');
    const items = [];
    if (!personal) {
      items.push({ title: 'Personal skills folder', sub: 'Not connected', actions: [button('Connect', 'btn-sm', () => connectFolder(true))] });
    }
    for (const t of targets) {
      const st = targetStats.get(t.id);
      const isCurrent = t.id === currentTargetId;
      const actions = [];
      if (!st || st.state === 'needs-permission') actions.push(button('Allow access', 'btn-sm', async () => {
        if (await ensureAccess(t)) {
          targetStats.set(t.id, await readTargetSkills(t));
          renderAll();
        }
      }));
      actions.push(button('Show skills', 'btn-sm', async () => {
        if (!isCurrent) await switchTarget(t.id);
        goTo('installed');
      }));
      actions.push(button('History', 'btn-sm btn-ghost', () => {
        state.historyFilter = { type: '', target: t.id };
        goTo('history');
      }));
      if (t.kind === 'project') {
        actions.push(button('Remove from list', 'btn-sm btn-ghost', async () => {
          if (!isCurrent) await switchTarget(t.id);
          await removeProjectTarget();
        }));
      }
      const count = st && st.state !== 'needs-permission' ? plural(st.skills.size, 'skill') : 'access needed';
      items.push({
        badge: el('span', `pill ${t.kind === 'personal' ? 'pill-original' : ''}`, t.kind === 'personal' ? 'Personal' : 'Project'),
        title: `${t.kind === 'project' ? t.handle.name : 'Personal skills'}${isCurrent ? ' (install target)' : ''}`,
        sub: `${installPathOf(t, '').replace(/[\\/]$/, '')} · ${count}${st && st.state === 'error' ? ` · ${st.error}` : ''}`,
        actions,
      });
    }
    list.appendChild(rowsList(items, ''));
    page.appendChild(list);

    // Compare: which skill names live where, and which clash.
    const known = targets.filter((t) => targetStats.get(t.id) && targetStats.get(t.id).state !== 'needs-permission');
    if (known.length) {
      const names = new Map();
      for (const t of known) {
        for (const [dir, info] of targetStats.get(t.id).skills) {
          const key = info.name;
          if (!names.has(key)) names.set(key, new Map());
          names.get(key).set(t.id, dir);
        }
      }
      const clashes = [...names.entries()].filter(([, where]) => where.size > 1);
      const cmp = panel('Compare folders');
      if (clashes.length) {
        cmp.appendChild(notice('', ICONS.warn, `${plural(clashes.length, 'skill name')} ${clashes.length === 1 ? 'is' : 'are'} installed in more than one folder. Claude Code may use only one of them in a project, so check they are the version you expect.`));
        cmp.lastChild.style.margin = '12px 14px 0';
      }
      const wrapTable = el('div');
      wrapTable.style.overflowX = 'auto';
      const table = el('table', 'compare-table');
      const head = el('tr');
      head.appendChild(el('th', null, 'Skill'));
      known.forEach((t) => head.appendChild(el('th', null, t.kind === 'project' ? t.handle.name : 'Personal')));
      table.appendChild(head);
      [...names.entries()].sort((a, b) => (b[1].size - a[1].size) || a[0].localeCompare(b[0])).slice(0, 200).forEach(([name, where]) => {
        const tr = el('tr');
        const nameCell = el('td', null, name);
        if (where.size > 1) {
          const pill = el('span', 'pill pill-unverified', 'In several folders');
          pill.style.marginLeft = '8px';
          nameCell.appendChild(pill);
        }
        tr.appendChild(nameCell);
        known.forEach((t) => tr.appendChild(el('td', where.has(t.id) ? 'yes' : 'no', where.has(t.id) ? '✓' : '–')));
        table.appendChild(tr);
      });
      wrapTable.appendChild(table);
      cmp.appendChild(wrapTable);
      if (names.size > 200) cmp.appendChild(el('div', 'panel-empty', `Showing 200 of ${names.size} skills.`));
      if (!names.size) cmp.appendChild(el('div', 'panel-empty', 'No skills installed in these folders yet.'));
      page.appendChild(cmp);
    }
  }

  function renderUpdates(page) {
    page.appendChild(pageHead('Claude Code', 'Updates', 'Updates are only shown when versions really differ: library and installed copies are compared file by file, and GitHub imports by commit.'));
    const lib = panel('Library versions newer than installed copies', connection === 'connected' && updatable().length
      ? [button(`Update all (${updatable().length})`, 'btn-primary btn-sm', () => installSkills(updatable(), false), 'updates-all')]
      : []);
    if (connection !== 'connected') {
      lib.appendChild(el('div', 'panel-empty', 'Connect to a skills folder to compare installed copies with the library.'));
    } else {
      lib.appendChild(rowsList(updatable().map((s) => ({
        title: s.name,
        sub: `${installPathOf(currentTarget(), s.installDir)}${installed.get(s.installDir) ? ` · installed copy modified ${formatDate(installed.get(s.installDir).modified)}` : ''}`,
        actions: [button('Compare', 'btn-sm', () => compareInstalled(s)), button('Update', 'btn-sm btn-primary', () => installSkills([s], false))],
      })), `Everything installed in ${(currentTarget() || {}).label} matches the library.`));
    }
    page.appendChild(lib);

    const checkBtn = button(ghCheck && ghCheck.running ? 'Checking...' : 'Check GitHub for updates', 'btn-sm', checkGitHubUpdates, 'gh-check');
    checkBtn.disabled = !github.length || Boolean(ghCheck && ghCheck.running);
    const gh = panel('Skills imported from GitHub', [checkBtn]);
    if (ghCheck && ghCheck.error) {
      gh.appendChild(notice('danger', ICONS.warn, `The check stopped: ${ghCheck.error}`));
      gh.lastChild.style.margin = '12px 14px 0';
    }
    gh.appendChild(rowsList(github.map((s) => {
      const c = s.updateCheck;
      let sub = `${s.origin} at ${s.commit}`;
      let badge = null;
      if (c) {
        if (c.changed === true) {
          badge = el('span', 'pill pill-info', 'Update available');
          sub += ` → ${c.latest.slice(0, 7)} (${plural(c.files.length, 'file')} changed in this skill)`;
        } else if (c.changed === null) {
          badge = el('span', 'pill', 'Unknown');
          sub += ' · too many changes in the repository to tell; review to be sure';
        } else sub += ` · up to date (checked ${timeAgo(c.checkedAt)})`;
      } else sub += ' · not checked yet';
      const actions = [];
      if (c && c.changed !== false) actions.push(button('Review update', 'btn-sm btn-primary', () => reviewGitHubUpdate(s)));
      if (s.previous) actions.push(button(`Restore ${s.previous.commit}`, 'btn-sm btn-ghost', () => restorePrevious(s)));
      actions.push(button('Details', 'btn-sm btn-ghost', () => openPreview(s.id)));
      return { badge, title: s.name, sub, actions };
    }), 'No GitHub skills in your library. Import some with "Add from GitHub".'));
    if (github.length) gh.appendChild(el('div', 'panel-empty', 'Checking uses a few GitHub lookups per repository (GitHub allows 60 an hour without signing in). Each update is downloaded, scanned and shown to you before anything changes.'));
    page.appendChild(gh);

    if (watched.length) {
      const w = panel('Watched repositories', [button('Manage', 'btn-sm btn-ghost', () => $('open-github').click())]);
      w.appendChild(rowsList(watched.map((x) => ({
        title: x.label,
        sub: x.changed ? 'New commits since your last scan' : `No new commits (checked ${timeAgo(x.checkedAt)})`,
        actions: [button('Scan now', 'btn-sm', () => scanLink(x.link))],
      })), ''));
      page.appendChild(w);
    }
  }

  function renderSecurity(page) {
    page.appendChild(pageHead('Insights', 'Security', 'Every skill is scanned on this computer before it can be installed. These results come from that scan; nothing is sent anywhere.'));
    const levels = { critical: 0, high: 0, warning: 0, info: 0, clean: 0 };
    const lib = library();
    lib.forEach((s) => levels[reportOf(s).level]++);
    const stats = el('div', 'stats');
    stats.appendChild(statCard(lib.length, 'Library skills scanned'));
    stats.appendChild(statCard(levels.clean + levels.info, 'No risky patterns'));
    stats.appendChild(statCard(levels.warning, 'Warnings to review', 'Notes, or parts that could not be checked', () => {
      state.filters.status = 'review';
      $('filter-status').value = 'review';
      goTo('all');
    }));
    stats.appendChild(statCard(levels.high + levels.critical, 'High or critical', 'Blocked from install unless reviewed'));
    stats.appendChild(statCard(connection === 'connected' && rescanTarget === currentTargetId ? rescan.size : '-', 'Installed skills re-scanned', connection === 'connected' ? (currentTarget() || {}).label : 'Not connected'));
    page.appendChild(stats);

    const scanBtn = button('Scan installed skills', 'btn-primary btn-sm', rescanInstalled, 'scan-installed');
    scanBtn.disabled = !(connection === 'connected' && installed.size) || busy;
    const inst = panel(`Installed in ${(currentTarget() || {}).label || 'Claude Code'}`, [scanBtn]);
    if (connection !== 'connected') inst.appendChild(el('div', 'panel-empty', 'Connect to a skills folder to scan what is installed.'));
    else if (rescanTarget !== currentTargetId || !rescan.size) inst.appendChild(el('div', 'panel-empty', `Not scanned yet in this session. ${plural(installed.size, 'skill')} installed.`));
    else {
      inst.appendChild(rowsList([...rescan.entries()]
        .map(([dir, r]) => ({ dir, r, level: Scan.summarizeFindings(r.findings).level }))
        .sort((a, b) => ['critical', 'high', 'warning', 'info', 'clean'].indexOf(a.level) - ['critical', 'high', 'warning', 'info', 'clean'].indexOf(b.level))
        .map(({ dir, r, level }) => ({
          badge: riskBadge(level),
          title: dir,
          sub: `${LEVEL_TEXT[level]} · scanned ${timeAgo(r.checkedAt)}`,
          actions: [button('Report', 'btn-sm btn-ghost', () => {
            const s = library().find((x) => x.installDir === dir && installState(x)) || byId.get(`local:${dir}`);
            if (s) openPreview(s.id, 'security');
          })],
        })), ''));
    }
    page.appendChild(inst);

    const review = lib.filter(needsReview).sort((a, b) => ['critical', 'high', 'warning'].indexOf(reportOf(a).level) - ['critical', 'high', 'warning'].indexOf(reportOf(b).level));
    const flagged = panel('Library skills with findings');
    flagged.appendChild(rowsList(review.slice(0, 50).map((s) => ({
      badge: riskBadge(reportOf(s).level),
      title: s.name,
      sub: reportOf(s).findings.filter((f) => f.risk !== 'info').slice(0, 2).map((f) => `${f.title} (${f.file}${f.line ? `:${f.line}` : ''})`).join(' · '),
      actions: [button('Report', 'btn-sm btn-ghost', () => openPreview(s.id, 'security'))],
    })), 'No library skill has findings beyond informational notes.'));
    page.appendChild(flagged);

    const recent = panel('Recent scans and imports');
    recent.appendChild(rowsList(activity.filter((a) => a.type === 'scan' || a.type === 'import').slice(0, 10).map((a) => ({
      badge: riskBadge(a.result === 'ok' ? 'clean' : 'warning'),
      title: `${ACTIVITY_LABEL[a.type]} ${a.skill}`,
      sub: `${a.detail} · ${timeAgo(a.time)}`,
    })), 'Scans and GitHub imports show up here.'));
    page.appendChild(recent);

    const rules = panel('What the scanner looks for');
    const body = el('div', 'panel-body');
    const kinds = [['threat', 'Detected threats (block install)'], ['suspicious', 'Suspicious patterns (worth a look)'], ['unverified', "Couldn't be checked"], ['compat', 'Compatibility'], ['info', 'Informational']];
    for (const [kind, label] of kinds) {
      const titles = [...new Set(Object.values(Scan.RULE_INFO).filter((r) => r.kind === kind).map((r) => r.title))];
      if (!titles.length) continue;
      body.appendChild(el('p', 'section-label', label));
      const ul = el('ul', 'steps');
      ul.style.margin = '0 0 12px';
      titles.forEach((t) => ul.appendChild(el('li', null, t)));
      body.appendChild(ul);
    }
    body.appendChild(el('p', 'report-note', 'Patterns are matched in every file, including look-alike letters and hidden characters. In documentation, most patterns are reported as notes, because instructions for a person are not run by the skill. A clean result is not a guarantee of safety.'));
    rules.appendChild(body);
    page.appendChild(rules);
  }

  function settingRow(title, sub, control) {
    const row = el('div', 'settings-row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', title));
    if (sub) main.appendChild(el('div', 'row-sub', sub));
    row.appendChild(main);
    row.appendChild(control);
    return row;
  }

  function toggleControl(id, checked, label, onChange) {
    const wrap = el('label', 'switch');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = checked;
    input.setAttribute('aria-label', label);
    input.dataset.focusKey = id;
    input.addEventListener('change', () => onChange(input.checked));
    wrap.appendChild(input);
    wrap.appendChild(el('span'));
    return wrap;
  }

  function selectControl(id, label, options, value, onChange) {
    const select = document.createElement('select');
    select.className = 'select';
    select.id = id;
    select.dataset.focusKey = id;
    select.setAttribute('aria-label', label);
    for (const [v, text] of options) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = text;
      o.selected = String(v) === String(value);
      select.appendChild(o);
    }
    select.addEventListener('change', () => onChange(select.value));
    return select;
  }

  function updateSetting(key, value) {
    settings[key] = value;
    saveSettings();
    renderAll();
  }

  function renderSettings(page) {
    page.appendChild(pageHead('Prabh’s CSC', 'Settings', 'Saved on this computer.'));

    const look = panel('Appearance');
    look.appendChild(settingRow('Theme', 'Follow Windows, or always light or dark.', selectControl('set-theme', 'Theme', [['system', 'Match system'], ['light', 'Light'], ['dark', 'Dark']], storedTheme() || 'system', (v) => setTheme(v))));
    look.appendChild(settingRow('Start page', 'What the app shows when it opens.', selectControl('set-start', 'Start page', [['home', 'Home'], ['all', 'All skills'], ['installed', 'Installed']], settings.startView, (v) => updateSetting('startView', v))));
    page.appendChild(look);

    const inst = panel('Installing');
    if (SUPPORTS_FOLDER_WRITE) {
      const options = [['', 'Last used folder']].concat(targets.map((t) => [t.id, t.label]));
      inst.appendChild(settingRow('Default install location', 'The folder selected when the app opens.', selectControl('set-default-target', 'Default install location', options, settings.defaultTargetId, (v) => updateSetting('defaultTargetId', v))));
      const personal = targets.find((t) => t.kind === 'personal');
      inst.appendChild(settingRow('Personal skills folder', personal ? `Connected: ${installPathOf(personal, '').replace(/[\\/]$/, '')}` : 'Not connected yet.', button(personal ? 'Choose again' : 'Connect', 'btn-sm', () => connectFolder(true))));
      if (DESKTOP && DESKTOP.openSkillsFolder) inst.appendChild(settingRow('Open the skills folder', 'Opens ~/.claude/skills in File Explorer.', button('Open', 'btn-sm', openSkillsFolder)));
    }
    inst.appendChild(settingRow('Ask before removing a skill', 'Removals are always backed up and can be undone, so you can turn this off. Updates always ask first.', toggleControl('set-confirm-remove', settings.confirmRemove, 'Ask before removing a skill', (v) => updateSetting('confirmRemove', v))));
    page.appendChild(inst);

    const backups = panel('Backups and history');
    backups.appendChild(settingRow('Keep backups for', 'How many recent install, update or removal batches can be undone. Older entries stay listed without a backup.', selectControl('set-backups', 'Keep backups for', [[3, 'Last 3 changes'], [5, 'Last 5 changes'], [10, 'Last 10 changes']], settings.backupsKept, (v) => {
      settings.backupsKept = Number(v);
      saveSettings();
    })));
    const stored = history.filter((e) => e.undo && e.undo.files).reduce((n, e) => n + e.undo.files.reduce((m, f) => m + f.bytes.length, 0), 0);
    const entryCount = history.filter((e) => e.action !== 'undo').length + activity.length;
    backups.appendChild(settingRow('Clear history', `${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}, ${formatBytes(stored)} of backups. Installed skills are not touched.`, button('Clear', 'btn-sm btn-danger-ghost', async () => {
      const ok = await confirmDialog('Clear all history and backups?', ['Past changes can no longer be undone. Installed skills stay exactly as they are.'], 'Clear history', null, true);
      if (!ok) return;
      history = [];
      activity = [];
      saveHistory();
      saveActivity();
      lastInstall = null;
      renderAll();
      showToast('History cleared.', 2500);
    })));
    page.appendChild(backups);

    const sec = panel('Security');
    sec.appendChild(settingRow('Allow skills that couldn\'t be fully checked', 'For example skills with programs, archives or very large files. When on, you are always asked first. Skills detected as dangerous can never be installed.', toggleControl('set-allow-unverified', settings.allowUnverified, 'Allow skills that could not be fully checked', (v) => updateSetting('allowUnverified', v))));
    page.appendChild(sec);

    const gh = panel('GitHub');
    gh.appendChild(settingRow('Check watched repositories automatically', 'When the app opens and every hour while it is open. Uses GitHub lookups without signing in.', toggleControl('set-auto-watch', settings.autoCheckWatched, 'Check watched repositories automatically', (v) => updateSetting('autoCheckWatched', v))));
    gh.appendChild(settingRow('Watched repositories', `${watched.length} ${watched.length === 1 ? 'repository' : 'repositories'}`, button('Manage', 'btn-sm', () => $('open-github').click())));
    page.appendChild(gh);

    const about = panel('About');
    const links = el('div', 'row-actions');
    const link = (label, href) => {
      const a = el('a', 'btn btn-sm', label);
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      links.appendChild(a);
    };
    const home = APP_INFO.homepage || 'https://github.com/tufflerp/Prabh-s-CSC';
    link('GitHub repository', home);
    link('Documentation', `${home}#readme`);
    link('Report a security issue', `${home}/security`);
    about.appendChild(settingRow(`Prabh’s CSC ${APP_INFO.version ? `version ${APP_INFO.version}` : ''}`.trim(), `${DESKTOP ? 'Desktop app' : HOSTED ? 'Web version' : 'Browser version'} · ${bundled.length} bundled skills · open source (MIT). No accounts, no tracking: everything stays on this computer.`, links));
    page.appendChild(about);
  }

  function openSkillsFolder() {
    if (!DESKTOP || !DESKTOP.openSkillsFolder) return;
    DESKTOP.openSkillsFolder().then((result) => {
      if (result && result.error) showToast(`Couldn't open the folder: ${result.error}`, 5000);
    }, (err) => showToast(`Couldn't open the folder: ${err.message}`, 5000));
  }

  // ------------------------------------------------------------------ theme

  function storedTheme() {
    try {
      return localStorage.getItem('skill-connector-theme');
    } catch {
      return null;
    }
  }
  function currentTheme() {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr) return attr;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    $('theme-label').textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
  }
  const saved = storedTheme();
  if (saved === 'light' || saved === 'dark') applyTheme(saved);
  else $('theme-label').textContent = currentTheme() === 'dark' ? 'Light mode' : 'Dark mode';

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (!document.documentElement.getAttribute('data-theme')) {
        $('theme-label').textContent = currentTheme() === 'dark' ? 'Light mode' : 'Dark mode';
      }
    });
  }

  /** 'system' follows Windows; 'light' or 'dark' is remembered (boot.js applies it before first paint). */
  function setTheme(choice) {
    try {
      if (choice === 'system') localStorage.removeItem('skill-connector-theme');
      else localStorage.setItem('skill-connector-theme', choice);
    } catch {
      /* storage unavailable */
    }
    if (choice === 'system') {
      document.documentElement.removeAttribute('data-theme');
      $('theme-label').textContent = currentTheme() === 'dark' ? 'Light mode' : 'Dark mode';
    } else applyTheme(choice);
  }

  $('theme-toggle').addEventListener('click', () => {
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    if (state.view === 'settings') renderAll();
  });

  // ----------------------------------------------------------------- events

  let searchTimer = null;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = search.value;
      renderGrid();
      renderChips();
    }, 80);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && document.activeElement !== search && !document.querySelector('dialog[open]')
      && !/^(INPUT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName)) {
      e.preventDefault();
      search.focus();
    }
  });

  document.querySelectorAll('.nav-item[data-view]').forEach((item) => {
    item.addEventListener('click', () => goTo(item.getAttribute('data-view')));
  });

  $('filter-category').addEventListener('change', () => {
    state.filters.category = $('filter-category').value;
    keepFocus(renderGrid);
  });
  $('filter-status').addEventListener('change', () => {
    state.filters.status = $('filter-status').value;
    keepFocus(renderGrid);
  });
  $('sort').addEventListener('change', () => {
    state.filters.sort = $('sort').value;
    keepFocus(renderGrid);
  });
  $('clear-filters').addEventListener('click', clearFilters);

  const tabs = [...document.querySelectorAll('.segmented [role="tab"]')];
  function selectTab(tab, focus) {
    state.mode = tab.getAttribute('data-mode');
    tabs.forEach((t) => {
      t.setAttribute('aria-selected', String(t === tab));
      t.tabIndex = t === tab ? 0 : -1;
    });
    connectBody.setAttribute('aria-labelledby', tab.id);
    if (focus) tab.focus();
    renderConnect();
  }
  tabs.forEach((tab, i) => {
    tab.tabIndex = tab.getAttribute('aria-selected') === 'true' ? 0 : -1;
    tab.addEventListener('click', () => selectTab(tab, false));
    tab.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (step) {
        e.preventDefault();
        selectTab(tabs[(i + step + tabs.length) % tabs.length], true);
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        selectTab(tabs[e.key === 'Home' ? 0 : tabs.length - 1], true);
      }
    });
  });

  $('select-visible').addEventListener('click', () => {
    visible().forEach((s) => {
      if (selectable(s)) selected.add(s.id);
    });
    if (state.view === 'selected') renderAll();
    else refreshSelection();
  });

  $('rescan').addEventListener('click', rescanInstalled);

  $('clear').addEventListener('click', () => {
    selected.clear();
    if (state.view === 'selected') renderAll();
    else refreshSelection();
  });

  $('preview-close').addEventListener('click', () => preview.close());
  $('preview-try-copy').addEventListener('click', () => copyText($('preview-try-text').textContent));
  $('preview-dismiss').addEventListener('click', () => preview.close());
  $('preview-toggle').addEventListener('click', () => toggle(previewId));
  $('preview-remove').addEventListener('click', () => {
    const s = byId.get(previewId);
    if (s) removeInstalled(s);
  });
  $('preview-remove-library').addEventListener('click', () => {
    const s = byId.get(previewId);
    if (s) removeFromLibrary(s);
  });
  // Close on a click that starts and ends on the backdrop (not a text-selection drag).
  let pressedOnBackdrop = false;
  preview.addEventListener('mousedown', (e) => { pressedOnBackdrop = e.target === preview; });
  preview.addEventListener('click', (e) => {
    if (e.target === preview && pressedOnBackdrop) preview.close();
  });
  preview.addEventListener('close', () => {
    previewToken++; // ignore file loads that finish after closing
    const opener = document.querySelector(`[data-focus-key="${CSS.escape(`card:${previewId}`)}"]`);
    if (opener) opener.focus({ preventScroll: true });
  });
  const previewTabs = [...document.querySelectorAll('#preview-tabs [role="tab"]')];
  previewTabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectPreviewTab(tab.dataset.tab));
    tab.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const next = previewTabs[(i + step + previewTabs.length) % previewTabs.length];
      selectPreviewTab(next.dataset.tab);
      next.focus();
    });
  });
  $('preview-md-toggle').addEventListener('click', () => {
    previewRaw = !previewRaw;
    renderPreviewSkillMd();
  });
  $('preview-md-copy').addEventListener('click', () => copyText($('preview-body').textContent));
  $('preview-copy-edit').addEventListener('click', () => {
    if (previewSkill) openMaker(previewSkill, true);
  });

  $('compare-close').addEventListener('click', () => $('compare').close());
  $('compare-cancel').addEventListener('click', () => $('compare').close());
  $('compare-apply').addEventListener('click', async () => {
    if (!compareApply) return;
    $('compare-apply').disabled = true;
    const apply = compareApply;
    compareApply = null;
    if ($('compare').open) $('compare').close();
    await apply();
  });

  $('open-github').addEventListener('click', () => {
    renderWatched();
    $('github').showModal();
    $('github-url').focus();
  });
  $('github-form').addEventListener('submit', runGitHubScan);
  $('github-watch').addEventListener('click', () => {
    if (!lastScan) return;
    watchLink(lastScan.link, lastScan.label, lastScan.sha);
    $('github-watch').textContent = 'Watching';
    $('github-watch').disabled = true;
    showToast(`Watching ${lastScan.label}. The app checks it for changes when it opens.`, 4000);
  });
  $('open-maker').addEventListener('click', () => openMaker(null));
  ['maker-name', 'maker-description', 'maker-body'].forEach((id) => $(id).addEventListener('input', updateMaker));
  $('maker-file-text').addEventListener('input', () => {
    const file = makerFiles.find((f) => f.path === makerCurrent);
    if (!file) return;
    file.bytes = encoder.encode($('maker-file-text').value);
    renderMakerFiles();
    updateMaker();
  });
  document.querySelectorAll('[data-maker-tab]').forEach((b) => b.addEventListener('click', () => {
    makerView = b.dataset.makerTab;
    renderMakerView();
  }));
  $('maker-add-file').addEventListener('click', makerAddFile);
  $('maker-add-folder').addEventListener('click', makerAddFolder);
  $('maker-rename-file').addEventListener('click', makerRenameFile);
  $('maker-delete-file').addEventListener('click', makerDeleteFile);
  $('maker-export').addEventListener('click', exportMaker);
  $('maker-form').addEventListener('submit', (e) => {
    e.preventDefault();
    saveMaker();
  });
  $('maker-cancel').addEventListener('click', closeMaker);
  $('maker-close').addEventListener('click', closeMaker);
  $('maker').addEventListener('cancel', (e) => {
    e.preventDefault();
    closeMaker();
  });
  $('preview-edit').addEventListener('click', () => {
    const s = byId.get(previewId);
    if (s) openMaker(s);
  });
  $('preview-delete').addEventListener('click', () => {
    const s = byId.get(previewId);
    if (s) deleteCustom(s);
  });
  $('github-add').addEventListener('click', addGitHubSkills);
  $('github-close').addEventListener('click', closeGitHub);
  $('github-cancel').addEventListener('click', closeGitHub);
  $('github').addEventListener('close', () => {
    if (ghScan) closeGitHub();
  });
  let ghPressedOnBackdrop = false;
  $('github').addEventListener('mousedown', (e) => { ghPressedOnBackdrop = e.target === $('github'); });
  $('github').addEventListener('click', (e) => {
    if (e.target === $('github') && ghPressedOnBackdrop) closeGitHub();
  });

  // Stay in sync when the user comes back from Claude Code or the file explorer.
  let lastRefresh = 0;
  window.addEventListener('focus', async () => {
    if (Date.now() - lastRefresh < 2000 || document.querySelector('dialog[open]')) return;
    lastRefresh = Date.now();
    const before = `${connection}|${[...installed.entries()].map(([k, v]) => `${k}:${v.fp}`).join(',')}`;
    await refreshInstalled();
    const after = `${connection}|${[...installed.entries()].map(([k, v]) => `${k}:${v.fp}`).join(',')}`;
    if (before !== after) renderAll();
  });

  // Small screens: the Install panel sits below the list, so offer a jump to it.
  const jump = $('jump-install');
  jump.addEventListener('click', () => {
    $('connect-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    const firstAction = document.getElementById('install-now') || document.getElementById('download-app');
    if (firstAction) setTimeout(() => firstAction.focus({ preventScroll: true }), 350);
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      jump.dataset.panelVisible = String(entries[0].isIntersecting);
      updateJump();
    }).observe($('connect-panel'));
  }

  if (!bundled.length) {
    $('results-title').textContent = 'No skills data found. Run: node scripts/skill-connector-build.js';
  }

  if (HOSTED) {
    // GitHub is unreachable from the hosted frame; the desktop download has the importer.
    $('open-github').hidden = true;
    document.querySelector('.nav-item[data-view="github"]').hidden = true;
    document.querySelector('.nav-item[data-view="history"]').hidden = true;
    window.claude.use('downloads').then((downloads) => {
      hostedDownloads = downloads;
      renderAll();
    }).catch(() => {});
  }

  reindex();
  renderChips();
  renderCategoryFilter();
  renderAll();
  // Settings first (start page, default folder); saved skills load before the first look
  // at the skills folder, so they are recognised as installed.
  const ready = idbGet('settings').then((saved) => {
    if (saved && typeof saved === 'object') settings = { ...DEFAULT_SETTINGS, ...saved };
    if (state.view === 'home' && settings.startView !== 'home') state.view = settings.startView;
    return Promise.all([
      SUPPORTS_FOLDER_WRITE ? loadTargets() : null,
      idbGet('history'),
      idbGet('activity'),
      loadCustom(),
      HOSTED ? null : loadGithub(),
    ]);
  }).then(([, savedHistory, savedActivity, savedCustom, savedGithub]) => {
    if (Array.isArray(savedHistory)) history = savedHistory;
    if (Array.isArray(savedActivity)) activity = savedActivity;
    if (Array.isArray(savedCustom)) custom = savedCustom.filter((s) => s && s.source === 'custom');
    if (Array.isArray(savedGithub)) github = savedGithub.filter((s) => s && s.source === 'github' && !NOT_INSTALLABLE.has(s.status));
    if (settings.defaultTargetId && targets.some((t) => t.id === settings.defaultTargetId)) currentTargetId = settings.defaultTargetId;
    reindex();
    renderCategoryFilter();
    return refreshInstalled();
  }).then(renderAll);
  if (!HOSTED) {
    idbGet('watched-repos').then(async (saved) => {
      if (Array.isArray(saved)) watched = saved;
      renderWatchNotice();
      await ready;
      return settings.autoCheckWatched ? checkWatched(false) : false;
    });
    // While the app stays open.
    setInterval(() => {
      if (settings.autoCheckWatched) checkWatched(false);
    }, WATCH_INTERVAL);
  }

  /**
   * Win back access to the saved folder without the user clicking Reconnect. Browsers
   * forget the permission on restart; the desktop app calls this at launch with a user
   * gesture, and its permission handler allows folders the user picked before.
   */
  async function restoreAccess() {
    await ready;
    const target = currentTarget();
    if (!target || connection !== 'needs-permission') return connection;
    try {
      if (await ensureAccess(target)) await refreshInstalled();
    } catch {
      // Folder gone or access refused: stay on "Reconnect".
    }
    renderAll();
    return connection;
  }

  // Exposed for the desktop app and automated checks (scripts/skill-connector-check.js).
  window.SkillConnector = { scanGitHub, parseGitHubUrl, statusOf, prepareForClaudeApp, refreshInstalled, restoreAccess, addProjectTarget, switchTarget, checkWatched, isBusy: () => busy };
})();
