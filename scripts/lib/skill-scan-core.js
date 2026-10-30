/**
 * Skill safety scan rules, shared by Node (scripts/lib/skill-scan.js) and the
 * Skill Connector browser app (copied to apps/skill-connector/data/scan-core.js
 * by scripts/skill-connector-build.js). No Node or DOM dependencies.
 *
 * Findings are `block` (detected as dangerous: must not be installed), `warn`
 * (allowed, reported), or `unverified` (could not be inspected, so safety is
 * unknown: the app warns and asks; the repository refuses to bundle it).
 *
 * Also holds the SKILL.md frontmatter parser and the "will Claude recognise
 * this skill?" check, so the app and CI agree on both.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SkillScanCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_FILE_BYTES = 2 * 1024 * 1024;
  const MAX_SKILL_BYTES = 20 * 1024 * 1024;

  const SCRIPT_EXTENSIONS = new Set([
    '.sh', '.bash', '.zsh', '.ps1', '.psm1', '.bat', '.cmd', '.vbs',
    '.py', '.js', '.cjs', '.mjs', '.ts', '.rb', '.pl', '.php', '.go',
    '.swift', '.kt', '.java', '.rs', '.c', '.cc', '.cpp', '.h', '.cs', '.lua', '.r',
  ]);

  const TEXT_EXTENSIONS = new Set([
    ...SCRIPT_EXTENSIONS,
    '.md', '.mdx', '.txt', '.json', '.yaml', '.yml', '.toml', '.xml',
    '.html', '.htm', '.css', '.csv', '.svg', '.ini', '.cfg', '.tsx', '.jsx',
    '.jsonl', '.sql', '.lock', '.env.example', '.gitignore', '.xsd', '.tmpl',
  ]);

  // Binary assets that are expected in skills (fonts, images) and cannot execute.
  const SAFE_BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp',
    '.ttf', '.otf', '.woff', '.woff2', '.pdf',
  ]);

  const EXECUTABLE_EXTENSIONS = new Set([
    '.exe', '.dll', '.so', '.dylib', '.scr', '.msi', '.com', '.jar',
    '.apk', '.app', '.deb', '.rpm', '.bin', '.elf', '.pyc', '.class',
  ]);

  const ARCHIVE_EXTENSIONS = new Set(['.zip', '.tar', '.gz', '.tgz', '.7z', '.rar', '.xz', '.bz2']);

  // Expected binary assets, trusted only when their contents match the extension.
  const SIGNATURES = {
    '.png': [[0x89, 0x50, 0x4e, 0x47]],
    '.jpg': [[0xff, 0xd8, 0xff]],
    '.jpeg': [[0xff, 0xd8, 0xff]],
    '.gif': [[0x47, 0x49, 0x46, 0x38]],
    '.webp': [[0x52, 0x49, 0x46, 0x46]],
    '.ico': [[0x00, 0x00, 0x01, 0x00]],
    '.bmp': [[0x42, 0x4d]],
    '.pdf': [[0x25, 0x50, 0x44, 0x46]],
    '.ttf': [[0x00, 0x01, 0x00, 0x00], [0x74, 0x72, 0x75, 0x65], [0x74, 0x74, 0x63, 0x66]],
    '.otf': [[0x4f, 0x54, 0x54, 0x4f]],
    '.woff': [[0x77, 0x4f, 0x46, 0x46]],
    '.woff2': [[0x77, 0x4f, 0x46, 0x32]],
  };

  // Documentation formats: risky commands here are usually instructions for a human,
  // so most code rules only add a note (SKILL.md is the exception, see SKILL_MD_BLOCKS).
  const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.markdown', '.rst', '.adoc', '.html', '.htm', '.ipynb']);

  // Paths that hold secrets. Read together with a read command, they block.
  const CRED = String.raw`(?:\.ssh[\/\\"' ,)]+(?:\s*\/\s*)?["']?id_(?:rsa|dsa|ecdsa|ed25519)\b(?!\.pub)|\.aws[\/\\"' ,)]+["']?credentials\b|\.git-credentials\b|\.config\/gh\/hosts\.yml|\.claude\/\.credentials\.json|\/etc\/shadow\b|\.netrc\b|\.pypirc\b|\.config\/gcloud\/(?:credentials|application_default)|cookies\.sqlite|login\.keychain)`;
  const CRED_RE = new RegExp(CRED, 'i');
  const NETWORK_SEND = /\b(?:curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm|scp|rsync)\b|\brequests\.(?:post|put)|\burllib\.request|\bhttpx\.(?:post|put)|\bfetch\s*\(|\baxios\.(?:post|put)|\bhttp\.request|\bsocket\.connect|\bnc(?:at)?\s+\S+\s+\d+/i;

  /**
   * Pattern rules. `scope` decides how a match is rated:
   *   all   - blocks in every file
   *   code  - blocks in scripts and other files; a note in documentation,
   *           except in SKILL.md when `skillMd: 'block'` (Claude follows SKILL.md)
   *   mild  - always a note: common in legitimate setup scripts
   *   info  - informational only (`codeOnly`: skipped in documentation)
   */
  const RULES = [
    {
      id: 'remote-pipe-to-shell',
      scope: 'code',
      message: 'Downloads a remote script and runs it straight away',
      pattern: /\b(?:curl|wget|iwr|Invoke-WebRequest)\b[^\n]*\|\s*(?:sudo(?:\s+-\S+)*\s+)?(?:\/\S*\/)?(?:ba|z|da|k|fi)?sh\b|\b(?:curl|wget)\b[^\n]*\|\s*(?:sudo\s+)?(?:\/\S*\/)?(?:python[23]?|node|perl|ruby|php)\b|\b(?:ba|z|k|da)?sh\s+(?:-\w+\s+)*-c\s+["']?\$\(\s*(?:curl|wget)\b|\b(?:ba|z|k|da)?sh\s+<\(\s*(?:curl|wget)\b|\bsource\s+<\(\s*(?:curl|wget)\b|\bexec\s*\(\s*(?:requests\.get|urlopen|urllib\.request\.urlopen|httpx\.get)\s*\(|\beval\s*\(\s*(?:await\s+)?\(?\s*(?:await\s+)?\(?\s*fetch\s*\(|\b(?:curl|wget)\b[^\n]*?\s-(?:o|O|-output)\s+["']?([\w./~-]+\.(?:sh|ps1|py))\b[\s\S]{0,300}?\b(?:(?:ba|z)?sh|python[23]?|pwsh|powershell|source)\s+["']?[\w./~-]*\1/i,
    },
    {
      id: 'powershell-download-exec',
      scope: 'code',
      message: 'PowerShell download-and-run pattern',
      pattern: /\b(?:iex|Invoke-Expression)\b[^\n]*(?:DownloadString|Invoke-WebRequest|iwr|irm|Invoke-RestMethod|Net\.WebClient)|\b(?:irm|iwr|Invoke-RestMethod|Invoke-WebRequest)\b[^\n]*\|\s*(?:iex|Invoke-Expression)\b|DownloadString\([^)]*\)\s*\|\s*iex|\[scriptblock\]::Create\s*\(|\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]*\s-(?:e|ec|en|enc|enco|encod|encode|encoded|encodedcommand)\s+[A-Za-z0-9+/=]{16,}/i,
    },
    {
      id: 'encoded-exec',
      scope: 'code',
      skillMd: 'block',
      message: 'Decodes a hidden payload and runs it',
      pattern: /(?:exec|eval)\s*\(\s*(?:base64\.b64decode|codecs\.decode|bytes\.fromhex|zlib\.decompress|marshal\.loads|__import__\(\s*["'](?:base64|codecs|zlib|marshal))|\beval\s*\(\s*(?:atob|Buffer\.from)\s*\(|\b(?:new\s+)?Function\s*\(\s*(?:atob|Buffer\.from)\s*\(|\b(?:b64decode|a85decode|b32decode|unhexlify|atob)\s*\([\s\S]{0,300}?\b(?:exec|eval)\s*\(|base64\s+(?:-d|--decode)[^\n]*\|\s*(?:ba|z)?sh\b|-EncodedCommand\b/i,
    },
    {
      id: 'reverse-shell',
      scope: 'code',
      skillMd: 'block',
      message: 'Opens a remote shell on this computer',
      pattern: /\/dev\/(?:tcp|udp)\/[\w.-]+\/\d+|\bnc(?:at)?\b[^\n]*\s-[ec]\s+["']?\/bin\/(?:ba|z)?sh|\bmkfifo\b[^\n]*\bnc(?:at)?\b|\bsocat\b[^\n]*exec:|\bpty\.spawn\s*\(\s*["']\/bin\/(?:ba|z)?sh|\bsocket\b[\s\S]{0,400}?\bdup2\s*\(/i,
    },
    {
      id: 'credential-access',
      scope: 'code',
      skillMd: 'block',
      message: 'Reads passwords, keys or other credentials',
      pattern: new RegExp(String.raw`(?:\bcat\b|\btype\b|Get-Content|\bgc\b|open\s*\(|read_text|read_bytes|readFile(?:Sync)?|\bscp\b|\bcp\b|\bless\b|\bhead\b|\btail\b|\bbase64\b|\bxxd\b|Copy-Item|fs\.read)[^\n]{0,120}${CRED}|${CRED}[^\n]{0,60}(?:\.read_text|\.read_bytes|\.read\(\))|security\s+(?:find-generic-password|find-internet-password|dump-keychain)|\bcmdkey(?:\.exe)?\s+\/list\b|\bvaultcmd(?:\.exe)?\s+\/list|\bGet-StoredCredential\b|\bCryptUnprotectData\b`, 'i'),
    },
    {
      id: 'lolbin-exec',
      scope: 'code',
      skillMd: 'block',
      message: 'Uses a built-in Windows tool to download or run code',
      pattern: /\bcertutil(?:\.exe)?\s+[^\n]*-(?:urlcache|decode)\b|\bbitsadmin(?:\.exe)?\s+[^\n]*\/transfer\b|\bmshta(?:\.exe)?\s+["']?(?:https?:|vbscript:|javascript:)|\bregsvr32(?:\.exe)?\s+[^\n]*\/i:\s*["']?https?:|\brundll32(?:\.exe)?\s+[^\n]*javascript:/i,
    },
    {
      id: 'obfuscated-code',
      scope: 'code',
      message: 'Builds commands from character codes or escapes to hide what they do',
      pattern: /String\.fromCharCode\(\s*\d+(?:\s*,\s*\d+){15,}\s*\)|(?:\\x[0-9a-fA-F]{2}){24,}|\bchr\(\s*\d+\s*\)(?:\s*\+\s*chr\(\s*\d+\s*\)){9,}|\[char\[\]\]\s*\(\s*\d+(?:\s*,\s*\d+){15,}/,
    },
    {
      id: 'browser-credential-access',
      scope: 'code',
      skillMd: 'block',
      message: 'Reads browser password or cookie stores',
      // Case-sensitive on purpose: "local state" is common prose in UI docs.
      pattern: /(?:Chrome|Chromium|Edge|Brave|Firefox|Opera)[^\n]{0,80}(?:Login Data|Local State|Cookies|logins\.json|key4\.db)/,
    },
    {
      id: 'secret-exfiltration',
      scope: 'code',
      skillMd: 'block',
      message: 'Sends environment variables or secrets to a remote host',
      // Sending an API key as its own auth header is normal API use, not exfiltration.
      allow: (m) => /Authorization:|x-api-key|api-key:|Bearer\s+\$/i.test(m) && !/process\.env|os\.environ|\$\(env\)|printenv|\benv\b\s*\|/i.test(m),
      pattern: /(?:curl|wget|requests\.post|fetch|axios\.post|http\.request)[^\n]{0,120}(?:process\.env|os\.environ|\$\(env\)|printenv|ANTHROPIC_API_KEY|AWS_SECRET|GITHUB_TOKEN)|\b(?:env|printenv|set)\b\s*\|\s*(?:curl|wget|nc(?:at)?)\b|JSON\.stringify\(\s*process\.env\s*\)|\bos\.environ\b[^\n]{0,80}(?:requests\.(?:post|put)|urlopen|httpx\.post)/i,
    },
    {
      id: 'exfil-webhook',
      scope: 'code',
      skillMd: 'block',
      message: 'Sends data to a known exfiltration or tunnelling endpoint',
      pattern: /\b(?:webhook\.site|requestbin|pipedream\.net|ngrok\.io|ngrok-free\.app|trycloudflare\.com|burpcollaborator|oastify\.com|interact\.sh|oast\.(?:fun|me|pro|live|site|online)|pastebin\.com\/api|transfer\.sh|discord(?:app)?\.com\/api\/webhooks)\b/i,
    },
    {
      id: 'destructive-command',
      scope: 'code',
      skillMd: 'block',
      message: 'Deletes the home folder, the whole disk, or similar',
      pattern: /\brm\s+(?:(?:-[a-zA-Z]+|--recursive|--force|--no-preserve-root)\s+)+["']?(?:\/|~\/?|\$\{?HOME\}?\/?)["']?(?=\s|\*|$|;|&|\|)|\bshutil\.rmtree\(\s*(?:os\.path\.expanduser\(\s*["']~\/?["']\s*\)|Path\.home\(\)|["']\/["']|os\.environ\[["']HOME)|\bfs\.(?:rmSync|rm|rmdirSync)\(\s*(?:os\.homedir\(\)|["']\/["'])|\bmkfs\.|\bdd\s+if=[^\n]*of=\/dev\/(?:sd|nvme|disk)|:\(\)\s*\{\s*:\|:&\s*\};:|\bformat\s+[a-z]:\s*\/q|Remove-Item\s+[^\n]*-Recurse[^\n]*(?:C:\\\s|C:\\["']|\$env:USERPROFILE|\$HOME\b)/i,
    },
    {
      id: 'persistence',
      scope: 'code',
      message: 'Makes something run automatically at login or on a schedule',
      pattern: /\|\s*crontab\s+-(?:\s|$)|(?:>>?|\btee\s+(?:-a\s+)?)\s*["']?(?:~|\$\{?HOME\}?)\/\.(?:bashrc|zshrc|bash_profile|profile|zprofile|zshenv)\b|Launch(?:Agents|Daemons)\/[^\s"']+\.plist|CurrentVersion\\Run\b|schtasks\s+\/create|\.config\/autostart\/|Start Menu\\Programs\\Startup/i,
    },
    {
      id: 'claude-config-tampering',
      scope: 'code',
      skillMd: 'block',
      message: "Changes Claude's own settings or permissions",
      pattern: /(?:>>?|\btee\b|writeFile(?:Sync)?|write_text|open\([^)\n]*["'][wa]|Set-Content|Add-Content|Out-File|json\.dump)[^\n]{0,120}\.claude[/\\](?:settings(?:\.local)?\.json|CLAUDE\.md)|"allow"\s*:\s*\[[^\]]*"Bash\(\*\)"|--dangerously-skip-permissions/i,
    },
    {
      id: 'security-tampering',
      scope: 'code',
      skillMd: 'block',
      message: 'Turns off security tools or hides what it did',
      pattern: /Set-MpPreference\s+[^\n]*-Disable|Add-MpPreference\s+-ExclusionPath|setenforce\s+0|spctl\s+--master-disable|unset\s+HISTFILE|HISTFILE=\/dev\/null|export\s+HISTSIZE=0|chmod\s+(?:-R\s+)?777\s+\/(?:\s|$)/i,
    },
    {
      id: 'crypto-miner',
      scope: 'code',
      skillMd: 'block',
      message: 'Crypto-mining software or pool',
      pattern: /\b(?:xmrig|minerd|cpuminer|stratum\+tcp|nicehash|coinhive|cryptonight)\b/i,
    },
    {
      id: 'setup-commands',
      scope: 'mild',
      message: 'Sets up services, schedules or credentials (common in setup scripts; check it is expected)',
      pattern: /systemctl\s+enable|crontab\s+-e\b|history\s+-c\b|\.npmrc\b|\.kube\/config\b|\.docker\/config\.json|hooks\.slack\.com\/services|api\.telegram\.org\/bot/i,
    },
    {
      id: 'env-harvesting',
      scope: 'mild',
      message: 'Saves every environment variable, which often include secrets',
      pattern: /\b(?:printenv|env)\s*>{1,2}\s*["']?[\w~$./\\-]|\bjson\.dumps?\(\s*(?:dict\(\s*)?os\.environ\b|\b(?:Get-ChildItem|gci|ls|dir)\s+(?:-Path\s+)?env:\\?[^\n]*\|\s*(?:ConvertTo-Json|Out-File|Export-Csv|Set-Content)/i,
    },
    {
      id: 'raw-ip-endpoint',
      scope: 'mild',
      message: 'Connects to a raw IP address instead of a named website',
      pattern: /\b(?:https?|wss?|ftp):\/\/(?!(?:127|10|0)\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/i,
    },
    {
      id: 'network-access',
      scope: 'info',
      codeOnly: true,
      message: 'Makes network requests',
      pattern: NETWORK_SEND,
    },
    {
      id: 'prompt-injection',
      scope: 'all',
      message: 'Text aimed at overriding Claude or hiding actions from the user',
      pattern: /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+)?(?:of\s+)?(?:the\s+|your\s+|my\s+|these\s+|those\s+)?(?:previous|prior|above|earlier|preceding|system)\s+(?:instructions?|prompts?|rules|directions|guidelines|messages)\b|\b(?:do\s+not|don['\u2019]t|never)\s+(?:tell|inform|show|alert|notify|mention|reveal|disclose)(?:\s+(?:this|it|that|anything|these|any))?(?:\s+(?:step|steps|action|actions|command|commands))?\s+(?:to\s+)?the\s+user\b|\bwithout\s+(?:telling|informing|notifying|asking|alerting)\s+the\s+user\b|\bhide\s+(?:this|these|it)\s+(?:steps?|actions?|commands?\s+)?from\s+the\s+user\b|\byou\s+are\s+now\s+(?:in\s+)?(?:developer|DAN|jailbreak|god)\s+mode\b/i,
    },
  ];

  // Look-alike letters (Cyrillic/Greek) mapped to Latin before matching, one for one.
  const CONFUSABLES = {
    '\u0430': 'a', '\u0435': 'e', '\u0456': 'i', '\u043e': 'o', '\u0440': 'p', '\u0441': 'c', '\u0443': 'y',
    '\u0445': 'x', '\u0455': 's', '\u0458': 'j', '\u04bb': 'h', '\u0501': 'd', '\u0410': 'A', '\u0415': 'E',
    '\u0406': 'I', '\u041e': 'O', '\u0420': 'P', '\u0421': 'C', '\u0425': 'X', '\u03bf': 'o', '\u03b1': 'a',
    '\u03b5': 'e', '\u03b9': 'i', '\u03c1': 'p', '\u03c5': 'u', '\u039f': 'O',
  };
  const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLES).join('')}]`, 'g');

  /** Same-length normalised copy for matching: look-alikes to Latin, `\`-newline joined. */
  function normalizeForMatch(text) {
    return text.replace(CONFUSABLE_RE, (c) => CONFUSABLES[c]).replace(/\\\r?\n/g, (m) => ' '.repeat(m.length));
  }

  // Characters that can hide text. Some are fine in context (see hiddenFindings).
  // eslint-disable-next-line no-misleading-character-class -- variation selectors are listed on purpose, one by one
  const HIDDEN_CANDIDATES = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFE00-\uFE0F\uFEFF]|[\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;
  const JOINABLE = /(?:\p{L}|\p{M}|\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u20E3|\uFE0F)/u;
  const SELECTABLE = /(?:\p{Extended_Pictographic}|\p{S}|\p{N}|[#*]|\p{Script=Han}|\u200D)/u;

  function codePointBefore(text, index) {
    if (index <= 0) return '';
    const low = text.charCodeAt(index - 1);
    if (low >= 0xdc00 && low <= 0xdfff && index >= 2) return text.slice(index - 2, index);
    return text[index - 1];
  }

  function codePointAfter(text, index) {
    const cp = text.codePointAt(index);
    return cp === undefined ? '' : String.fromCodePoint(cp);
  }

  /** Hidden-character findings, allowing emoji joiners, variation selectors and direction marks in context. */
  function hiddenFindings(relPath, text) {
    let block = null;
    let warn = null;
    for (const m of text.matchAll(HIDDEN_CANDIDATES)) {
      const ch = m[0];
      const cp = ch.codePointAt(0);
      const before = codePointBefore(text, m.index);
      const after = codePointAfter(text, m.index + ch.length);
      let ok = false;
      if (cp === 0xfeff && m.index === 0) ok = true;
      else if (cp === 0x200e || cp === 0x200f) ok = true; // direction marks in right-to-left text
      else if (cp === 0x200c || cp === 0x200d) ok = JOINABLE.test(before) && JOINABLE.test(after);
      else if (cp >= 0xfe00 && cp <= 0xfe0f) ok = SELECTABLE.test(before);
      if (ok) continue;
      if (cp === 0x00ad) {
        warn = warn || m.index;
      } else {
        block = m.index;
        break;
      }
    }
    const out = [];
    if (block !== null) {
      out.push({ severity: 'block', rule: 'hidden-unicode', file: relPath, line: lineOf(text, block), message: 'Invisible or direction-changing characters that can hide instructions' });
    } else if (warn !== null) {
      out.push({ severity: 'warn', rule: 'soft-hyphen', file: relPath, line: lineOf(text, warn), message: 'Contains invisible soft hyphens' });
    }
    return out;
  }

  // A long unbroken base64-looking run, or many lines of it, usually means an embedded payload.
  const LONG_BASE64 = /[A-Za-z0-9+/]{400,}={0,2}/g;
  const WRAPPED_BASE64 = /(?:^[ \t]*[A-Za-z0-9+/]{60,}={0,2}[ \t]*\r?\n){10,}/m;

  function payloadIndex(text) {
    for (const m of text.matchAll(LONG_BASE64)) {
      if (!/base64,\s*$/i.test(text.slice(Math.max(0, m.index - 12), m.index))) return m.index; // data: URIs are fine
    }
    const wrapped = WRAPPED_BASE64.exec(text);
    return wrapped ? wrapped.index : -1;
  }

  function extname(relPath) {
    const base = relPath.split(/[\\/]/).pop() || '';
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(dot).toLowerCase() : '';
  }

  function lineOf(text, index) {
    let line = 1;
    for (let i = 0; i < index && i < text.length; i++) {
      if (text.charCodeAt(i) === 10) line++;
    }
    return line;
  }

  function isSkillMd(relPath) {
    return /(^|[\\/])skill\.md$/i.test(relPath);
  }

  /**
   * True when the bytes start with a native executable header.
   * @param {Uint8Array} bytes
   */
  function hasBinaryMagic(bytes) {
    if (!bytes || bytes.length < 4) return false;
    // Windows PE (MZ), ELF, Mach-O (32/64, both endians), Java class
    if (bytes[0] === 0x4d && bytes[1] === 0x5a) return true;
    if (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) return true;
    const magic = ((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3];
    return [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(magic);
  }

  function matchesSignature(ext, bytes) {
    return (SIGNATURES[ext] || []).some((sig) => sig.every((b, i) => bytes[i] === b));
  }

  /**
   * Decode bytes as text when they are text: UTF-8, or UTF-16 with a byte-order
   * mark (or the tell-tale every-other-byte-zero pattern). Returns null for binary.
   * @param {Uint8Array} bytes
   */
  function decodeText(bytes) {
    if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
      return new TextDecoder(bytes[0] === 0xff ? 'utf-16le' : 'utf-16be').decode(bytes);
    }
    const head = bytes.subarray(0, 8192);
    let nul = 0;
    let oddNul = 0;
    for (let i = 0; i < head.length; i++) {
      if (head[i] === 0) {
        nul++;
        if (i % 2 === 1) oddNul++;
      }
    }
    if (nul && head.length >= 8 && oddNul >= head.length / 2 - 2) return new TextDecoder('utf-16le').decode(bytes);
    if (nul) return null;
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return null;
    }
  }

  /** True when bytes look like text (UTF-8 or UTF-16). */
  function looksLikeText(bytes) {
    return decodeText(bytes) !== null;
  }

  /**
   * Decide, from the name and size alone, whether a file is worth downloading
   * to inspect. Used by the browser before fetching from GitHub.
   *
   * @param {string} relPath
   * @param {number} size - Size in bytes
   * @returns {{ action: 'inspect'|'finding', finding?: object }}
   */
  function classifyFile(relPath, size) {
    if (size > MAX_FILE_BYTES) {
      return {
        action: 'finding',
        finding: { severity: 'unverified', rule: 'oversized-file', file: relPath, line: 0, message: `Too large to check (over ${MAX_FILE_BYTES / 1024 / 1024} MB)` },
      };
    }
    return { action: 'inspect' };
  }

  // Characters Windows refuses in file names, and reserved device names.
  // eslint-disable-next-line no-control-regex -- control characters are exactly what Windows refuses
  const WINDOWS_BAD_NAME = /[<>:"|?*\\\u0000-\u001F]|(?:^|\/)(?:con|prn|aux|nul|com\d|lpt\d)(?:\.[^/]*)?(?:\/|$)|[. ]$|[. ]\//i;

  /**
   * Check a file's path (not its contents): hidden characters in names block,
   * names Windows cannot create make the skill uninstallable.
   */
  function inspectPath(relPath) {
    const out = [];
    const hidden = hiddenFindings(relPath, relPath).find((f) => f.severity === 'block');
    if (hidden) out.push({ ...hidden, rule: 'hidden-file-name', line: 0, message: 'File name contains invisible or direction-changing characters' });
    if (WINDOWS_BAD_NAME.test(relPath)) out.push({ severity: 'invalid', rule: 'bad-file-name', file: relPath, line: 0, message: 'File name is not allowed on Windows' });
    return out;
  }

  /**
   * Inspect one file's bytes and return its findings.
   *
   * @param {string} relPath - Path shown in findings
   * @param {Uint8Array} bytes - File contents
   * @returns {Array<{ severity: string, rule: string, file: string, line: number, message: string }>}
   */
  function inspectFile(relPath, bytes) {
    const ext = extname(relPath);
    const one = (severity, rule, message) => [{ severity, rule, file: relPath, line: 0, message }];

    if (hasBinaryMagic(bytes)) {
      // A program is only expected where the name says so; anything else is disguised.
      return EXECUTABLE_EXTENSIONS.has(ext)
        ? one('unverified', 'executable-binary', `Contains a program file (${ext}) that can't be checked`)
        : one('block', 'disguised-executable', 'A program disguised as a different kind of file');
    }
    if (EXECUTABLE_EXTENSIONS.has(ext)) return one('unverified', 'executable-binary', `Contains a program file (${ext}) that can't be checked`);
    if (ARCHIVE_EXTENSIONS.has(ext)) return one('unverified', 'archive', `Contains an archive (${ext}) that can't be opened to check`);
    if (bytes.length > MAX_FILE_BYTES) return one('unverified', 'oversized-file', `Too large to check (over ${MAX_FILE_BYTES / 1024 / 1024} MB)`);
    if (SAFE_BINARY_EXTENSIONS.has(ext) && matchesSignature(ext, bytes)) return [];

    const text = decodeText(bytes);
    if (text !== null) return scanText(relPath, text);
    if (SAFE_BINARY_EXTENSIONS.has(ext)) return one('unverified', 'mismatched-file-type', `Its contents don't match its ${ext} extension`);
    if (TEXT_EXTENSIONS.has(ext)) return one('unverified', 'binary-file', `Has binary content despite its ${ext} extension`);
    return one('unverified', 'binary-file', "Binary file that can't be inspected");
  }

  /**
   * Scan one file's text content.
   *
   * @param {string} relPath - Path shown in findings
   * @param {string} text - File contents
   * @returns {Array<{ severity: string, rule: string, file: string, line: number, message: string }>}
   */
  function scanText(relPath, text) {
    const ext = extname(relPath);
    const docs = DOC_EXTENSIONS.has(ext);
    const skillMd = isSkillMd(relPath);
    const subject = normalizeForMatch(text);
    const findings = [];
    const severityFor = (rule) => {
      if (rule.scope === 'all') return 'block';
      if (rule.scope === 'mild') return 'warn';
      if (rule.scope === 'info') return 'info';
      if (!docs) return 'block';
      return skillMd && rule.skillMd === 'block' ? 'block' : 'warn';
    };

    for (const rule of RULES) {
      if (rule.codeOnly && docs) continue;
      const match = rule.pattern.exec(subject);
      if (!match || (rule.allow && rule.allow(match[0]))) continue;
      findings.push({ severity: severityFor(rule), rule: rule.id, file: relPath, line: lineOf(text, match.index), message: rule.message });
    }

    // A secret path plus a network send in the same file is a likely exfiltration.
    if (!findings.some((f) => f.rule === 'credential-access') && CRED_RE.test(subject) && NETWORK_SEND.test(subject)) {
      const at = subject.search(CRED_RE);
      findings.push({
        severity: severityFor({ scope: 'code', skillMd: 'block' }),
        rule: 'credential-exfiltration',
        file: relPath,
        line: lineOf(text, at),
        message: 'Mentions passwords or keys and also sends data over the network',
      });
    }

    findings.push(...hiddenFindings(relPath, text));

    const payload = payloadIndex(text);
    if (payload >= 0) {
      const dataLike = ext === '.svg' || ext === '.json' || ext === '.csv' || ext === '.ipynb' || ext === '.jsonl';
      findings.push({
        severity: docs || dataLike ? 'warn' : 'block',
        rule: 'embedded-payload',
        file: relPath,
        line: lineOf(text, payload),
        message: 'Long encoded blob that may hide a payload',
      });
    }

    return findings;
  }

  // -------------------------------------------------------------- categories

  /**
   * Library categories, assigned only when the skill's own name or description
   * uses one of the category's words. A skill can be in several, or none.
   */
  const CATEGORIES = [
    ['Frontend', /\b(?:front-?end|react|next\.?js|vue|svelte|angular|tailwind|css|html|web ?ui|ui components?|dom|browser extensions?|accessibility|a11y)\b/],
    ['Backend', /\b(?:back-?end|server-side|rest(?:ful)? apis?|graphql|grpc|databases?|sql|postgres(?:ql)?|mysql|sqlite|mongodb|redis|django|flask|fastapi|express(?:\.js)?|spring boot|laravel|rails|microservices?|orm)\b/],
    ['Debugging', /\b(?:debug(?:ging|ger)?|bugs?|troubleshoot(?:ing)?|root cause|stack traces?|crash(?:es)?|diagnos(?:e|is|ing))\b/],
    ['Testing', /\b(?:tests?|testing|tdd|unit tests?|e2e|end-to-end|integration tests?|playwright|jest|vitest|pytest|cypress|test coverage|qa)\b/],
    ['Security', /\b(?:security|secure|vulnerabilit(?:y|ies)|owasp|threat model(?:ing)?|pen(?:etration)? ?test(?:ing)?|authentication|authorization|secrets?|encryption|xss|csrf|cve)\b/],
    ['DevOps', /\b(?:devops|docker|containers?|kubernetes|k8s|helm|terraform|ansible|ci\/cd|ci|cd|pipelines?|deploy(?:ment|ments|ing)?|github actions|infrastructure|aws|azure|gcp|cloud|monitoring|observability|homelab|nginx|linux servers?)\b/],
    ['Design', /\b(?:ui design|ux|user experience|user interfaces?|visual design|graphic design|figma|typography|colou?r palettes?|branding|brand guidelines|illustrations?|icons?|design systems?|mockups?|wireframes?|animations?|canvas|artwork)\b/],
    ['Documentation', /\b(?:documentation|docs|readme|technical writing|changelogs?|api reference|docstrings?|write-?ups?)\b/],
    ['Productivity', /\b(?:productivity|time management|note-?taking|to-?do lists?|emails?|calendars?|meetings?|checklists?|task management|brainstorm(?:s|ing)?|scheduling|spreadsheets?|slide decks?|presentations?)\b/],
    ['Research', /\b(?:research|literature|papers?|academic|scientific|citations?|surveys?)\b/],
    ['Data', /\b(?:data analysis|data science|datasets?|dataframes?|pandas|numpy|machine learning|ml|deep learning|etl|analytics|statistics|notebooks?|visuali[sz]ations?|llms?|embeddings?)\b/],
    ['Games', /\b(?:games?|gameplay|game dev(?:elopment)?|roblox|luau|unity|godot|unreal|sprites?)\b/],
    ['Development', /\b(?:code|coding|programming|refactor(?:ing)?|software|developers?|typescript|javascript|python|rust|golang|java|kotlin|swift|c\+\+|c#|git|code reviews?|apis?|sdks?|cli)\b/],
  ];
  const CATEGORY_NAMES = CATEGORIES.map(([name]) => name);

  /** Categories a skill belongs to, from words in its name and description. */
  function categorize(name, description) {
    const text = `${String(name || '').replace(/[-_]+/g, ' ')} ${description || ''}`.toLowerCase();
    return CATEGORIES.filter(([, re]) => re.test(text)).map(([cat]) => cat);
  }

  // ------------------------------------------------------------ security report

  /**
   * Plain-language details for every finding id. `risk` is the tier used when the
   * finding blocks (critical or high); notes are always 'warning', informational
   * findings 'info'. `kind`: threat (behaviour that is dangerous on its own),
   * suspicious (often legitimate, worth a look), unverified (could not be checked),
   * compat (Claude may not load it).
   */
  const RULE_INFO = {
    'remote-pipe-to-shell': { title: 'Runs code downloaded from the internet', kind: 'threat', risk: 'critical', why: 'Whatever the server sends is executed straight away, without you seeing it. The server can change it at any time.', action: 'Do not install unless you trust the source and the exact URL. Prefer a pinned, reviewed script.' },
    'powershell-download-exec': { title: 'PowerShell download-and-run', kind: 'threat', risk: 'critical', why: 'Downloads PowerShell code and executes it in memory, a common way to deliver malware on Windows.', action: 'Do not install unless you can read and trust what is downloaded.' },
    'encoded-exec': { title: 'Runs a hidden, encoded payload', kind: 'threat', risk: 'critical', why: 'Encoding hides what the code does from reviewers and scanners, then runs it.', action: 'Treat as malicious unless the author explains it. Decode it and review before installing.' },
    'reverse-shell': { title: 'Opens remote access to this computer', kind: 'threat', risk: 'critical', why: 'Connects a shell on this computer to a remote machine, giving someone else control.', action: 'Do not install.' },
    'credential-access': { title: 'Reads passwords, keys or tokens', kind: 'threat', risk: 'critical', why: 'Reads SSH keys, cloud credentials, password stores or saved Windows credentials that a skill should never need.', action: 'Do not install unless reading that credential is the stated purpose of the skill.' },
    'credential-exfiltration': { title: 'Credentials plus network access', kind: 'threat', risk: 'critical', why: 'The same file touches secret files and sends data over the network, the shape of credential theft.', action: 'Review exactly what is sent where before installing.' },
    'browser-credential-access': { title: 'Reads browser passwords or cookies', kind: 'threat', risk: 'critical', why: 'Browser password and cookie stores give access to your accounts.', action: 'Do not install.' },
    'secret-exfiltration': { title: 'Sends secrets to a remote server', kind: 'threat', risk: 'critical', why: 'Environment variables and API keys are sent off this computer.', action: 'Do not install.' },
    'exfil-webhook': { title: 'Sends data to a capture or tunnel service', kind: 'threat', risk: 'critical', why: 'Webhook capture sites and tunnels are commonly used to collect stolen data.', action: 'Do not install unless the endpoint is clearly yours.' },
    'destructive-command': { title: 'Deletes large parts of the system', kind: 'threat', risk: 'critical', why: 'Removes the home folder, a whole drive or similar, which cannot be undone.', action: 'Do not install.' },
    'crypto-miner': { title: 'Crypto-mining', kind: 'threat', risk: 'critical', why: 'Uses your computer to mine cryptocurrency for someone else.', action: 'Do not install.' },
    'disguised-executable': { title: 'Program disguised as another file type', kind: 'threat', risk: 'critical', why: 'A real program hidden behind a harmless-looking extension is a classic malware trick.', action: 'Do not install.' },
    'lolbin-exec': { title: 'Windows tool used to fetch or run code', kind: 'threat', risk: 'high', why: 'certutil, bitsadmin, mshta, regsvr32 and rundll32 are abused to download and run code while looking like normal Windows activity.', action: 'Review the command. Legitimate skills rarely need these tools.' },
    'persistence': { title: 'Starts automatically', kind: 'threat', risk: 'high', why: 'Adds itself to login items, shell profiles or scheduled tasks so it keeps running after the skill is done.', action: 'Only install if staying resident is the stated purpose.' },
    'claude-config-tampering': { title: "Changes Claude's own settings", kind: 'threat', risk: 'high', why: "Editing Claude's settings or permissions can let later commands run without asking you.", action: 'Do not install unless you want those settings changed.' },
    'security-tampering': { title: 'Disables security tools or hides activity', kind: 'threat', risk: 'high', why: 'Turning off antivirus, SELinux or shell history is used to avoid detection.', action: 'Do not install.' },
    'prompt-injection': { title: 'Tries to override Claude or hide actions', kind: 'threat', risk: 'high', why: 'Text that tells Claude to ignore its instructions or keep things from you can make Claude act against you.', action: 'Read the flagged text. Do not install if it hides actions from you.' },
    'hidden-unicode': { title: 'Invisible characters', kind: 'threat', risk: 'high', why: 'Invisible or direction-changing characters can hide instructions that Claude reads but you do not see.', action: 'Do not install until the characters are explained or removed by the author.' },
    'hidden-file-name': { title: 'Invisible characters in a file name', kind: 'threat', risk: 'high', why: 'Hidden characters make a file look like something it is not.', action: 'Do not install.' },
    'embedded-payload': { title: 'Long encoded blob', kind: 'suspicious', risk: 'high', why: 'A long base64 block in a script often hides code or data that cannot be reviewed.', action: 'Find out what the blob contains before installing.' },
    'obfuscated-code': { title: 'Obfuscated code', kind: 'suspicious', risk: 'high', why: 'Building commands from character codes hides what they do. Honest code rarely needs it.', action: 'Decode the flagged line and review it before installing.' },
    'setup-commands': { title: 'System setup commands', kind: 'suspicious', risk: 'high', why: 'Enables services, edits schedules or touches credential files. Common in setup scripts, but worth confirming.', action: 'Check the command matches what the skill says it does.' },
    'env-harvesting': { title: 'Saves all environment variables', kind: 'suspicious', risk: 'high', why: 'Environment variables often hold API keys and tokens. Dumping them all is a first step in stealing them.', action: 'Check where the saved copy goes and whether it is needed.' },
    'raw-ip-endpoint': { title: 'Connects to a raw IP address', kind: 'suspicious', risk: 'high', why: 'Legitimate services usually have a domain name. A bare public IP can point at an attacker-controlled server.', action: 'Check who owns that address before installing.' },
    'network-access': { title: 'Makes network requests', kind: 'info', risk: 'info', why: 'Scripts in this skill can send or receive data over the internet. That is normal for many skills.', action: 'Make sure network use fits what the skill is for.' },
    'soft-hyphen': { title: 'Invisible soft hyphens', kind: 'suspicious', risk: 'high', why: 'Usually harmless copy-paste residue, but invisible characters can hide text.', action: 'Usually safe to ignore.' },
    'executable-binary': { title: 'Contains a program', kind: 'unverified', risk: 'high', why: 'Compiled programs cannot be read or scanned, so their behaviour is unknown.', action: 'Only install if you trust the author and need the program.' },
    'archive': { title: 'Contains an archive', kind: 'unverified', risk: 'high', why: 'Archives are not opened by the scanner, so their contents are unknown.', action: 'Only install if you trust the author.' },
    'oversized-file': { title: 'File too large to check', kind: 'unverified', risk: 'high', why: 'Files over the size limit are not scanned.', action: 'Only install if you trust the author.' },
    'oversized-skill': { title: 'Skill too large to check', kind: 'unverified', risk: 'high', why: 'The skill is over the total size limit, so it was not fully scanned.', action: 'Only install if you trust the author.' },
    'mismatched-file-type': { title: 'File content does not match its type', kind: 'unverified', risk: 'high', why: 'The file is not what its extension says, so it could not be checked as that type.', action: 'Only install if you trust the author.' },
    'binary-file': { title: 'Binary file', kind: 'unverified', risk: 'high', why: 'Binary content cannot be read by the scanner.', action: 'Only install if you trust the author.' },
    'submodule': { title: 'Links to another repository', kind: 'unverified', risk: 'high', why: 'Git submodules point at other code that was not downloaded or checked.', action: 'The linked code is not installed. Check the skill still works without it.' },
    'symlink': { title: 'Symbolic link', kind: 'unverified', risk: 'high', why: 'The link target could not be followed, so it is installed as a plain file.', action: 'Check the skill still works.' },
    'vendored-directory': { title: 'Bundled dependencies skipped', kind: 'unverified', risk: 'high', why: 'Folders such as node_modules are not checked and not installed.', action: 'The skill may need you to install its dependencies yourself.' },
    'too-many-files': { title: 'Too many files to check', kind: 'unverified', risk: 'high', why: 'Only the first files were checked, and the rest are not installed.', action: 'Import a folder link that points at the skill itself.' },
    'scan-budget': { title: 'Skipped to stay within the size budget', kind: 'unverified', risk: 'high', why: 'The skill is too large to check in one go; this file is not installed.', action: 'Import a smaller folder, or review the file yourself.' },
    'download-failed': { title: 'File could not be downloaded', kind: 'unverified', risk: 'high', why: 'The file was not checked and will not be installed.', action: 'Try the import again later.' },
    'skill-md-unavailable': { title: 'SKILL.md could not be read', kind: 'unverified', risk: 'high', why: 'Without SKILL.md the skill cannot be checked or loaded.', action: 'Try the import again later.' },
    'tree-truncated': { title: 'Repository too large to list', kind: 'unverified', risk: 'high', why: 'GitHub cut the file list short, so some files may be missing.', action: 'Import a folder link that points at the skill itself.' },
    'missing-skill-md': { title: 'No SKILL.md', kind: 'compat', risk: 'high', why: 'Claude Code only loads folders that contain a SKILL.md file.', action: 'Add a SKILL.md with a name and description.' },
    'claude-compat': { title: 'Claude Code cannot load it', kind: 'compat', risk: 'high', why: 'The SKILL.md frontmatter has a problem that stops Claude Code from loading the skill.', action: 'Fix the frontmatter (name and description).' },
    'bad-file-name': { title: 'File name not allowed on Windows', kind: 'compat', risk: 'high', why: 'Windows cannot create this file, so the skill cannot be installed there.', action: 'Rename the file.' },
  };

  const RISK_ORDER = { critical: 0, high: 1, warning: 2, info: 3 };

  /**
   * A finding with its report details: `risk` (critical | high | warning | info),
   * `kind`, `title`, `why` and `action`. Notes found in documentation keep the
   * rule's explanation but are rated 'warning', because instructions for a human
   * are not executed by the skill.
   */
  function describeFinding(finding) {
    const info = RULE_INFO[finding.rule] || { title: finding.message, kind: 'suspicious', risk: 'high', why: '', action: 'Review the flagged file.' };
    let risk;
    if (finding.severity === 'block') risk = info.risk === 'info' ? 'high' : info.risk;
    else if (finding.severity === 'info' || finding.severity === 'allowed') risk = 'info';
    else risk = 'warning';
    const kind = finding.severity === 'allowed' ? 'reviewed' : finding.severity === 'unverified' ? 'unverified' : finding.severity === 'invalid' ? 'compat' : info.kind;
    let why = info.why;
    if (finding.severity === 'warn' && info.kind === 'threat') why = `${why} Here it appears in documentation or a mild form, so it is reported as a note rather than blocked.`;
    if (finding.severity === 'allowed') why = 'This exact file was reviewed and accepted as safe by the library maintainers.';
    return { ...finding, risk, kind, title: info.title, why, action: finding.severity === 'allowed' ? 'No action needed.' : info.action };
  }

  /**
   * Overall result for a list of findings: `level` is the worst risk present, or
   * 'clean' when nothing was found. Counts are per risk tier. A clean result
   * means no known pattern matched; it is not a guarantee of safety.
   */
  function summarizeFindings(findings) {
    const counts = { critical: 0, high: 0, warning: 0, info: 0 };
    const described = (findings || []).map(describeFinding).sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk]);
    for (const f of described) counts[f.risk]++;
    const level = counts.critical ? 'critical' : counts.high ? 'high' : counts.warning ? 'warning' : counts.info ? 'info' : 'clean';
    return { level, counts, findings: described };
  }

  /** Read one inline YAML scalar: quoted strings unescaped, plain ones without a trailing comment. */
  function yamlScalar(raw) {
    if (/^"[\s\S]*"$/.test(raw)) {
      try {
        return JSON.parse(raw.replace(/\\([0abtnvfre /N_LP])/g, (m, c) => ({ 0: '\\u0000', a: '\\u0007', v: '\\u000b', e: '\\u001b', ' ': ' ', '/': '/', N: '\\u0085', _: '\\u00a0', L: '\\u2028', P: '\\u2029' }[c] || m)));
      } catch {
        return raw.slice(1, -1);
      }
    }
    if (/^'[\s\S]*'$/.test(raw)) return raw.slice(1, -1).replace(/''/g, "'");
    return raw.replace(/\s+#.*$/, '');
  }

  /**
   * Parse SKILL.md frontmatter: top-level `key: value` pairs, including literal
   * (`|`) and folded (`>`) block scalars.
   *
   * @param {string} text
   * @returns {{ present: boolean, attributes: Record<string, string>, body: string }}
   */
  function parseFrontmatter(text) {
    const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) return { present: false, attributes: {}, body: normalized.trim() };

    const attributes = {};
    const lines = match[1].split('\n');
    for (let i = 0; i < lines.length; i++) {
      const pair = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!pair) continue;
      const value = pair[2].trim();
      if (/^[|>][+-]?\d*$/.test(value)) {
        const block = [];
        while (i + 1 < lines.length && (lines[i + 1].trim() === '' || /^\s/.test(lines[i + 1]))) block.push(lines[++i].trim());
        attributes[pair[1]] = value[0] === '>' ? block.filter(Boolean).join(' ') : block.join('\n').trim();
        continue;
      }
      // Plain or quoted values may continue on indented lines (YAML folds them with spaces).
      let joined = value;
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) joined += ` ${lines[++i].trim()}`;
      attributes[pair[1]] = yamlScalar(joined);
    }
    return { present: true, attributes, body: normalized.slice(match[0].length).trim() };
  }

  /** Short stable hash (FNV-1a, 32-bit) used to compare skill versions. Not for security. */
  function hashText(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  // Files that operating systems or tools drop into folders; never part of a skill version.
  const IGNORED_FILE_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
  const IGNORED_DIR_NAMES = new Set(['__pycache__', '.pytest_cache', '.mypy_cache', 'node_modules', '.git']);

  /**
   * Fingerprint of one skill version: its SKILL.md (BOM and line endings
   * normalised) plus every other file's path and size. Library, installed and
   * GitHub copies are compared with this.
   *
   * @param {string|null} skillMd
   * @param {Array<{ path: string, size: number }>} files - all files, SKILL.md included or not
   */
  function skillFingerprint(skillMd, files) {
    const md = (skillMd || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    const list = files
      .filter((f) => f.path !== 'SKILL.md' && !IGNORED_FILE_NAMES.has(f.path.split('/').pop()))
      .map((f) => `${f.path}:${f.size}`)
      .sort()
      .join(',');
    return `${hashText(md)}-${hashText(list)}`;
  }

  // Folder names the app installs into: safe on every OS and valid for the Claude app.
  const INSTALL_DIR_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
  // Characters Claude Code refuses in skill names (docs: code.claude.com/docs/en/skills).
  // eslint-disable-next-line no-control-regex -- control characters are exactly what this rejects
  const REFUSED_NAME_RE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\uE000-\uF8FF<>]|\s{2}|^\s|\s$/;
  const DESCRIPTION_LISTING_LIMIT = 1536;
  const APP_NAME_LIMIT = 64;
  const APP_DESCRIPTION_LIMIT = 200;

  /**
   * Will Claude recognise this skill once installed?
   *
   * `code` is Claude Code (~/.claude/skills); `app` is uploading a zip to the
   * Claude desktop/web app. Each is 'ready', 'warn' (works, with caveats) or
   * 'error' (will not load or will be rejected).
   *
   * @param {string|null} skillMd - SKILL.md text, or null when missing
   * @param {string} folder - The folder the skill came from
   */
  function checkClaudeCompat(skillMd, folder) {
    const issues = [];
    const issue = (target, level, message) => issues.push({ target, level, message });

    if (skillMd === null || skillMd === undefined) {
      issue('code', 'error', 'No SKILL.md file, so Claude will not find this skill');
      issue('app', 'error', 'No SKILL.md file');
      return { name: folder, installDir: folder, description: '', code: 'error', app: 'error', issues };
    }

    const parsed = parseFrontmatter(skillMd);
    const name = parsed.attributes.name || '';
    const description = parsed.attributes.description || '';
    const installDir = INSTALL_DIR_RE.test(name) ? name : folder;

    if (/^\uFEFF/.test(skillMd)) issue('code', 'info', 'Invisible byte-order mark before the frontmatter; removed when installing');
    if (!parsed.present) {
      issue('code', 'warn', 'No frontmatter: Claude Code will use the folder name and the first line as the description');
      issue('app', 'error', 'No frontmatter with a name and description');
    }
    if (name && REFUSED_NAME_RE.test(name)) issue('code', 'error', 'The name contains characters Claude Code refuses');
    if (name && !INSTALL_DIR_RE.test(name)) issue('app', 'error', 'The name must be lowercase letters, numbers and hyphens (max 64)');
    if (name.length > APP_NAME_LIMIT) issue('app', 'error', `The name is longer than ${APP_NAME_LIMIT} characters`);
    if (/claude|anthropic/i.test(installDir)) issue('app', 'warn', 'Names containing "claude" or "anthropic" may be rejected by the Claude app');
    if (!INSTALL_DIR_RE.test(installDir)) issue('code', 'error', 'No usable folder name for this skill');
    if (/^synced$/i.test(installDir) || /^anthropic-skills(:|$)/.test(name)) issue('code', 'error', 'Uses a name Claude reserves');
    if (!description) {
      issue('code', 'warn', 'No description, so Claude has less to go on when deciding to use it');
      issue('app', 'error', 'No description');
    } else {
      if (description.length > DESCRIPTION_LISTING_LIMIT) issue('code', 'info', `Description is cut to ${DESCRIPTION_LISTING_LIMIT} characters in Claude Code's skill list`);
      if (description.length > APP_DESCRIPTION_LIMIT) issue('app', 'warn', `Description is ${description.length} characters; the Claude app may reject descriptions over ${APP_DESCRIPTION_LIMIT}`);
    }

    const level = (target) => {
      const mine = issues.filter((i) => i.target === target);
      if (mine.some((i) => i.level === 'error')) return 'error';
      if (mine.some((i) => i.level === 'warn')) return 'warn';
      return 'ready';
    };
    return { name: name || installDir, installDir, description, code: level('code'), app: level('app'), issues };
  }

  return {
    MAX_FILE_BYTES,
    MAX_SKILL_BYTES,
    RULES,
    RULE_INFO,
    CATEGORY_NAMES,
    categorize,
    checkClaudeCompat,
    classifyFile,
    describeFinding,
    summarizeFindings,
    IGNORED_DIR_NAMES,
    IGNORED_FILE_NAMES,
    decodeText,
    hasBinaryMagic,
    hashText,
    inspectFile,
    inspectPath,
    looksLikeText,
    parseFrontmatter,
    scanText,
    skillFingerprint,
  };
});
