'use strict';
/**
 * #5346: read an org chart PICTURE with the person's ChatGPT subscription, through Codex, held to #4559's promise:
 * nothing in the chart can trigger an action on this computer, its files or the network.
 *
 * Codex cannot be run with zero tools (measured on #5346, codex-cli 0.149.1): with every switch below it still offers
 * the model `update_plan` (a plan list) and `request_user_input` (a question to the user). Neither can act. Splinter's
 * ruling (#5346, 2026-10-05 17:41) is that "nothing can act" is the promise, so this read ships with exactly those two.
 * engine/orgchartcodex.capture.test.js checks the request these flags produce, signed in with a key against a local
 * server; tools Codex fetches from OpenAI for a ChatGPT sign-in cannot reach that server (see the plan).
 *
 * 🛑 THE FLAGS ARE THE SECURITY OF THIS PATH, as claudeArgs is for #4559. Each `--disable` and `-c` below removed a
 * tool or a block of the person's own context in a captured request (#5346). `--sandbox read-only` is NOT the
 * guarantee: in the card's control a read-only sandbox still ran `ls ~` and read ~/.zshrc. It stays as a second
 * wall, under the flags that leave no shell to sandbox.
 *
 * 🔑 THE CATALOG IS DERIVED, NOT SHIPPED. `apply_patch` and the code-mode tool have no switch: they are per-model
 * fields of Codex's model catalog. `model_catalog_json` REPLACES that catalog, so each read copies the account's own
 * `models_cache.json` (what this Codex fetched) and hardens it: see deriveCatalog. A checked-in copy would drift.
 *
 * The picture goes in the request (`-i`, sent as base64), the answer is schema JSON (`--output-schema`), nothing is
 * saved (`--ephemeral`, measured: no session or thread file, the prompt in no file under the account's folder), and
 * the person's own config file, rules, hooks, memories and apps are switched off by the flags. Their own instructions
 * file is NOT (no flag stops Codex sending it), so an account that has one is not used at all: see personalInstructions.
 * A PDF is not read here: `-i` takes pictures.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const NAME = 'OpenAI';
/* What `-i` reads. A PDF is refused before the consent (cannotRead), like Grok's. */
// PNG and JPEG only: the two formats measured (an animated GIF, which OpenAI's image input refuses, is not read).
const READS = { 'image/png': true, 'image/jpeg': true };
/* The only tools a run with codexArgs may offer (#5346 ruling). Anything else is a regression the capture test reds. */
const ALLOWED_TOOLS = ['update_plan', 'request_user_input'];
/* As the Claude and key reads (orgchartfile MODEL_TIMEOUT_MS), under the Kosmos+ relay's 120 s wait. */
const TIMEOUT_MS = 110 * 1000;
let timeoutMs = TIMEOUT_MS;
/** Tests only: a shorter timeout; null restores the real one. */
function setTimeoutMs(ms) { timeoutMs = Number.isFinite(ms) && ms > 0 ? ms : TIMEOUT_MS; }

/* Every feature that put a tool or the person's own context into the request, switched off (#5346 capture). */
const DISABLED_FEATURES = [
  'shell_tool', 'unified_exec', 'apps', 'browser_use', 'browser_use_external', 'browser_use_full_cdp_access',
  'computer_use', 'image_generation', 'multi_agent', 'multi_agent_v2', 'hooks', 'memories', 'plugins',
  'remote_plugin', 'view_image', 'in_app_browser', 'code_mode_host', 'tool_suggest', 'skill_search', 'goals',
  'shell_snapshot', 'skill_mcp_dependency_install', 'workspace_dependencies', 'enable_request_compression',
  'recommended_plugins',
];
const CONFIG = [
  'web_search="disabled"', 'tools.view_image=false', 'agents.enabled=false', 'history.persistence="none"',
  'skills.bundled.enabled=false', 'skills.include_instructions=false', 'include_permissions_instructions=false',
  'include_environment_context=false', 'include_apps_instructions=false',
  'include_collaboration_mode_instructions=false', 'project_doc_max_bytes=0',
];

/** The argv for one read. `extra` is test-only (the capture test points the provider at a local server). */
function codexArgs({ dir, catalog, schema, image, prompt, extra = [] }) {
  const a = ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules',
    '--sandbox', 'read-only', '-C', dir];
  for (const f of DISABLED_FEATURES) a.push('--disable', f);
  for (const c of CONFIG) a.push('-c', c);
  // A PATH to the catalog file (measured: the key takes a file), as a TOML string.
  a.push('-c', 'model_catalog_json=' + JSON.stringify(catalog));
  for (const e of extra) a.push('-c', e);
  a.push('--output-schema', schema, '-i', image, '--', prompt);
  return a;
}

/* The catalog is written by OpenAI's servers and refreshed whenever the person's Codex runs, so it is not trusted:
   every field that can switch on a tool is FORCED to its off value, and a catalog with a field this version's
   catalog does not have, or written by another Codex version, is not used at all (fails closed). The fields are the
   ones codex-cli 0.149.1's own catalog carries (read 2026-10-05). */
const MODEL_FIELDS = new Set(['slug', 'display_name', 'description', 'default_reasoning_level', 'supported_reasoning_levels',
  'shell_type', 'visibility', 'supported_in_api', 'priority', 'additional_speed_tiers', 'service_tiers', 'availability_nux',
  'upgrade', 'model_messages', 'include_skills_usage_instructions', 'include_plugin_usage_instructions',
  'include_apps_usage_instructions', 'default_reasoning_summary', 'support_verbosity', 'default_verbosity',
  'apply_patch_tool_type', 'web_search_tool_type', 'truncation_policy', 'supports_image_detail_original', 'context_window',
  'max_context_window', 'comp_hash', 'effective_context_window_percent', 'experimental_supported_tools', 'input_modalities',
  'supports_search_tool', 'use_responses_lite', 'node_repl_auto_review_required', 'node_repl_disabled', 'tool_mode',
  'multi_agent_version']);
/* Not forced: shell_type and web_search_tool_type, whose off values are not known and could make Codex refuse the
   catalog. The tools they shape are switched off by `--disable shell_tool`/`unified_exec` and `web_search="disabled"`
   instead; the capture test reds if either comes back (a mutation re-enabling the shell does). */
const MAX_CATALOG_BYTES = 4 << 20;
const FORCED = { apply_patch_tool_type: null, tool_mode: null, experimental_supported_tools: [], node_repl_disabled: true,
  supports_search_tool: false, include_apps_usage_instructions: false, include_plugin_usage_instructions: false,
  include_skills_usage_instructions: false };
/* The account's catalog made safe as { catalog }, or { why } saying which of the three reasons it cannot be used. */
function catalogFor(accountDir) {
  let cache;
  const file = path.join(accountDir, 'models_cache.json');
  // OpenAI writes this file and it is read on every reader choice: one far past a real catalog (about 160 KB
  // today) is refused rather than parsed, so its size cannot stall the board.
  try { if (fs.statSync(file).size > MAX_CATALOG_BYTES) return { why: WHY_CATALOG_UNKNOWN }; } catch { /* missing: below */ }
  try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { cache = null; }
  if (!cache || !Array.isArray(cache.models) || !cache.models.length) return { why: WHY_CATALOG };
  if (cache.client_version !== pinnedVersion()) return { why: WHY_CATALOG_VERSION };
  if (cache.models.some((m) => !m || typeof m !== 'object' || Object.keys(m).some((k) => !MODEL_FIELDS.has(k)))) return { why: WHY_CATALOG_UNKNOWN };
  return { catalog: { models: cache.models.map((m) => {
    const out = { ...m, ...FORCED };
    delete out.multi_agent_version;   // absent is a value Codex accepts (gpt-5.5 has none)
    return out;
  }) } };
}
/* The catalog alone, or null. */
function deriveCatalog(accountDir) { return catalogFor(accountDir).catalog || null; }

/* The Responses API's built-in tool types: each is a tool by its type alone, with no name. */
const BUILTIN_TOOL_TYPES = new Set(['local_shell', 'shell', 'web_search', 'web_search_preview', 'computer_use_preview',
  'computer_use', 'image_generation', 'mcp', 'file_search', 'code_interpreter', 'apply_patch']);
/* Every tool a request offers the model, wherever it sits: Codex nests its tools in a developer message as a
   namespace, not in a top-level `tools`, so a look at `body.tools` alone reads empty (#5346). FAILS CLOSED: every
   entry of any `tools` array counts (by name, else by type, else as 'unknown'), with a namespace opened rather than
   counted, so a tool of a kind this list has never seen still shows up. A known built-in type counts wherever it is. */
function offeredTools(body) {
  const names = [];
  const listed = (arr) => {
    for (const e of arr) {
      if (e && e.type === 'namespace' && Array.isArray(e.tools)) { listed(e.tools); continue; }
      names.push((e && typeof e.name === 'string' && e.name) || (e && typeof e.type === 'string' && e.type) || 'unknown');
    }
  };
  const walk = (o) => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!o || typeof o !== 'object') return;
    if (BUILTIN_TOOL_TYPES.has(o.type)) names.push(o.type);
    for (const k of Object.keys(o)) {
      if (k === 'tools' && Array.isArray(o[k])) listed(o[k]);
      else walk(o[k]);
    }
  };
  walk(body);
  return names;
}

/* The ChatGPT-subscription OpenAI accounts, default first (openaiaccounts rows, authMode 'chatgpt'). */
let accountsFn = () => require('./openaiaccounts').list();
/** Tests only: replace the account rows; null restores the real list. */
function setAccounts(fn) { accountsFn = typeof fn === 'function' ? fn : () => require('./openaiaccounts').list(); }
/* The reader, or null. Needs a Codex this board can run. */
const realBin = () => { try { const r = require('./runners').resolveBin('openai'); return r && r.present ? r.bin : null; } catch { return null; } };
let binFn = realBin;
/** Tests only: the Codex binary to use (a function returning a path or null); null restores the real one. */
function setBin(fn) { binFn = typeof fn === 'function' ? fn : realBin; }
/* The Codex version Kosmos pins (engine/runners.js), the only one these flags were measured on. A newer Codex can add a
   tool that is on by default, so any other version is not used for this read: it fails closed, not open. */
const pinnedVersion = () => { try { return require('./runners').MANIFEST.openai.version || null; } catch { return null; } };
/* bin + mtime -> { version, when }, so --version runs about once per binary and not per page load. Expires, because a
   launcher's own mtime need not change when the program it starts is upgraded. */
const versionCache = new Map();
const VERSION_TTL_MS = 10 * 60 * 1000;
const VERSION_FAIL_TTL_MS = 60 * 1000;
/* The cache key names the program itself (its real path, inode and size, as well as mtime): an npm install keeps a
   fixed 1985 mtime, so an upgrade under the same path would not change an mtime-only key (#5346 review). */
const versionKey = (bin) => {
  try { const real = fs.realpathSync(bin); const st = fs.statSync(real); return [real, st.ino, st.size, st.mtimeMs].join('\u0000'); } catch { return bin; }
};
const parseVersion = (out) => { const m = /(\d+\.\d+\.\d+)/.exec(String(out || '')); return m ? m[1] : null; };
const versionOpts = () => ({ encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], env: childEnv(process.env, os.tmpdir()) });
let versionFn = (bin) => {
  const key = versionKey(bin);
  const hit = versionCache.get(key);
  if (hit && Date.now() - hit.at < (hit.v ? VERSION_TTL_MS : VERSION_FAIL_TTL_MS)) return hit.v;
  let v = null;
  try {
    v = parseVersion(require('node:child_process').execFileSync(bin, ['--version'], versionOpts()));
  } catch { v = null; }
  // A version that could not be read is kept only a minute: long enough that a broken Codex does not stall every
  // request on a 5 s run, short enough that a busy moment does not switch the reader off for good.
  versionCache.set(key, { v, at: Date.now() });
  return v;
};
const versionFnReal = versionFn;
/* At the read: asked fresh (no cache) and without blocking the board, so a Codex upgraded while the consent box was
   open is the one checked. */
const freshVersionReal = (bin) => new Promise((resolve) => {
  require('node:child_process').execFile(bin, ['--version'], { ...versionOpts(), stdio: undefined }, (err, out) => resolve(err ? null : parseVersion(out)));
});
let freshVersion = freshVersionReal;
/** Tests only: the version lookup (bin -> version or null), for the choice and the read; null restores the real ones. */
function setVersion(fn) {
  versionFn = typeof fn === 'function' ? fn : versionFnReal;
  freshVersion = typeof fn === 'function' ? (bin) => Promise.resolve(fn(bin)) : freshVersionReal;
}

/* The person's own instructions, which Codex sends with every request from the account's folder and which no flag
   switches off (measured in review: AGENTS.override.md, else AGENTS.md, reached the request under every flag,
   model_instructions_file included). They are private and could steer the read, so an account that has either is
   not used for this read. The same two files engine/personalinstr.js reports for a Codex agent. */
const INSTRUCTION_FILES = ['AGENTS.override.md', 'AGENTS.md'];
function personalInstructions(dir) {
  return INSTRUCTION_FILES.some((f) => { try { fs.lstatSync(path.join(dir, f)); return true; } catch { return false; } });
}
/* Codex settings an administrator manages (a system config layer or a managed-preferences profile). The person's own
   config is switched off by --ignore-user-config; these layers may not be, and could add a tool, so a computer that
   has one is not used. Windows: no such layer is known to us, so none is checked (a stated gap, on the plan). */
const userName = () => { try { return os.userInfo().username || ''; } catch { return ''; } };
let systemConfigPaths = () => (process.platform === 'win32' ? [] : ['/etc/codex',
  '/Library/Managed Preferences/com.openai.codex.plist',
  path.join('/Library/Managed Preferences', userName(), 'com.openai.codex.plist')]);
/** Tests only: the system-config paths to look for; null restores the real ones. */
function setSystemConfigPaths(fn) { systemConfigPaths = typeof fn === 'function' ? fn : systemConfigPathsReal; }
const systemConfigPathsReal = systemConfigPaths;
function managedConfig() {
  return systemConfigPaths().some((p) => { try { fs.lstatSync(p); return true; } catch { return false; } });
}
/* The sentence every refusal here ends with; orgchartfile takes it off when it adds what else reads (#5346). */
const ANY_PROVIDER = 'A CSV or Excel export works with any provider, and so does typing the list.';
const WHY_MANAGED = 'ChatGPT does not read org charts on this computer: it has Codex settings an administrator manages, which Kosmos cannot switch off. ' + ANY_PROVIDER;
/* Windows: the flags, the catalog and the capture were measured on a Mac only, and no administrator-managed layer is
   known there to check. Off until measured, as an unknown is everywhere else in this file. */
const WHY_NO_CODEX = 'ChatGPT reads org charts through Codex, and Kosmos cannot find a Codex it can run on this computer: connecting OpenAI again in Settings, AI Models installs it. ' + ANY_PROVIDER;
const WHY_WINDOWS = 'ChatGPT does not read org charts on Windows yet. ' + ANY_PROVIDER;
const WHY_CATALOG = 'ChatGPT cannot read org charts on this computer yet: Codex has not set up its model list for this account. Start an OpenAI agent once, then try again. ' + ANY_PROVIDER;
const WHY_CATALOG_VERSION = 'ChatGPT does not read org charts with this account: its model list was written by a Codex other than the version Kosmos has checked. ' + ANY_PROVIDER;
const WHY_CATALOG_UNKNOWN = 'ChatGPT does not read org charts with this account: its model list has settings Kosmos has not checked, so it is not used. ' + ANY_PROVIDER;
const WHY_INSTRUCTIONS = 'ChatGPT does not read org charts on this computer: Codex would send your own instructions file (AGENTS.md) along with the chart, and Kosmos cannot switch that off. ' + ANY_PROVIDER;
const whyVersion = (have, want) => 'ChatGPT does not read org charts with the Codex on this computer (' + (have ? 'version ' + have : 'its version could not be read') + '): Kosmos has checked only version ' + want + '. ' + ANY_PROVIDER;

/* The reader and, when a ChatGPT account is here but cannot be used, why, from one look. */
function pickWithWhy() {
  const bin = binFn();
  let rows = [];
  try { rows = accountsFn() || []; } catch { rows = []; }
  // Only the default ChatGPT account (else the first) is considered: the one an agent on this computer uses. A second
  // account is not tried when the first cannot be used, so the reason given is about the account the person uses.
  const subs = rows.filter((r) => r && r.authMode === 'chatgpt' && r.dir)
    .sort((a, b) => Number(b.isDefault === true) - Number(a.isDefault === true));
  const r = subs[0];
  if (!r) return { reader: null, offWhy: null };
  if (process.platform === 'win32') return { reader: null, offWhy: WHY_WINDOWS };
  // #5346 step 2: a ChatGPT account with no Codex to run is a reason, not silence (the no-reader sentence says ChatGPT reads).
  if (!bin) return { reader: null, offWhy: WHY_NO_CODEX };
  const want = pinnedVersion();
  const have = versionFn(bin);
  if (!want || have !== want) return { reader: null, offWhy: whyVersion(have, want || 'unknown') };
  if (personalInstructions(r.dir)) return { reader: null, offWhy: WHY_INSTRUCTIONS };
  if (managedConfig()) return { reader: null, offWhy: WHY_MANAGED };
  // Before the consent box, not after it: a model list Codex cannot use here is a reason, not a failed read.
  const cat = catalogFor(r.dir);
  if (!cat.catalog) return { reader: null, offWhy: cat.why };
  return { reader: { kind: 'codex', provider: 'openai', dir: r.dir, account: r.email || r.name || null }, offWhy: null };
}
function pick() { return pickWithWhy().reader; }

/* The consent line's words: the provider and the account, as #4559 names Claude's. */
function label(reader) {
  return reader && reader.account ? NAME + ' (ChatGPT, ' + reader.account + ')' : NAME + ' (ChatGPT)';
}
/* What OpenAI does with a ChatGPT-plan request, for the consent (as orgchartkeys.KEEPS is for a key). From OpenAI's
   Data Controls FAQ (help.openai.com/en/articles/8983082, read through search 2026-10-05; a direct fetch was refused):
   on a personal plan the "Improve the model for everyone" setting applies to Codex tasks, and business plans are not
   used for training by default. Codex sends store: false (captured, #5346). How long OpenAI keeps it is not stated
   there, so it is not claimed here. */
const KEEPS = 'On a personal ChatGPT plan, OpenAI may use what you send to improve its models unless "Improve the model for everyone" is off in ChatGPT\'s Data Controls. Business and Enterprise plans are not used for training by default.';
function cannotRead(media) {
  if (READS[media]) return null;
  if (media === 'application/pdf') return 'ChatGPT cannot read a PDF sent this way. Export the chart as a PNG or JPG picture, or use a CSV or Excel export.';
  return 'ChatGPT cannot read this kind of picture. Save it as a PNG or JPG, or use a CSV or Excel export.';
}

const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg' };
const TMP_PREFIX = 'kosmos-orgchart-codex-';
/* A read's folder holds the chart (real names) until the read ends. If the board died mid-read, the next read removes
   any such folder older than 15 minutes: far past the read timeout, so never one still in use. */
function sweepStale() {
  let names = [];
  try { names = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(TMP_PREFIX)); } catch { return; }
  for (const n of names) {
    const p = path.join(os.tmpdir(), n);
    try { const st = fs.lstatSync(p); if (st.isDirectory() && Date.now() - st.mtimeMs > 15 * 60 * 1000) fs.rmSync(p, { recursive: true, force: true }); } catch { /* gone, or not ours */ }
  }
}
/* The event items a read may produce. Anything else (a command, a file change, an MCP or tool call, a web search)
   means a tool ran: the run is killed and its answer refused. A tripwire, not the guarantee (the flags are). */
// todo_list is what update_plan produces. request_user_input's item type is not listed on purpose: if it ever emits
// one, the read is refused, which fails safe. Do not add a type here without a capture showing what it is.
const QUIET_ITEMS = new Set(['agent_message', 'reasoning', 'todo_list', 'error']);
/* The top-level events a read may produce (the real reads on #5346 emitted thread.started, turn.started,
   item.completed and turn.completed). Any other kind of event is refused the same way, so a tool call reported
   outside an item cannot pass. */
const KNOWN_EVENTS = new Set(['thread.started', 'turn.started', 'turn.completed', 'turn.failed', 'item.started',
  'item.updated', 'item.completed', 'error']);

/* The environment Codex runs with: an ALLOWLIST, so the board's token, another provider's key, NODE_OPTIONS, or an
   OPENAI_ or CODEX_ variable (a key or base URL that would bill a key or send the chart elsewhere while the box says
   "using your plan") never reaches it. Kept: what a program needs to run, and the person's own proxy and CA settings,
   without which a computer on a company network cannot reach OpenAI at all. Compared without case, as Windows names
   are. CODEX_HOME is the account the consent named. */
const ENV_KEEP = new Set(['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'USER', 'LOGNAME',
  'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'PROGRAMDATA',
  'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS']);
function childEnv(from, accountDir) {
  const env = {};
  for (const [k, v] of Object.entries(from || {})) if (ENV_KEEP.has(k.toUpperCase())) env[k] = v;
  env.CODEX_HOME = accountDir;
  return env;
}

// A process group per read on Mac and Linux; on Windows `detached` would open a console window instead.
const GROUPS = process.platform !== 'win32';
let spawnFn = (bin, args, opts) => require('node:child_process').spawn(bin, args, opts);
/** Tests only: replace spawn (bin, args, opts) -> ChildProcess; null restores the real one. */
function setSpawn(fn) { spawnFn = typeof fn === 'function' ? fn : (bin, args, opts) => require('node:child_process').spawn(bin, args, opts); }

/**
 * One read. Resolves { ok: true, structured } or { ok: false, because } (words for the person), never throws.
 * The schema is the key path's STRICT form (orgchartkeys.STRICT_SCHEMA): Codex sends it in OpenAI's strict mode,
 * which refuses a schema without additionalProperties: false (measured). The picture and schema go to a fresh 0700
 * folder, removed afterwards.
 */
function read(reader, prompt, media, buf, signal) {
  const bin = binFn();
  if (!bin) return Promise.resolve({ ok: false, unavailable: true, because: 'no ChatGPT connection on this computer' });
  if (!READS[media]) return Promise.resolve({ ok: false, because: cannotRead(media) });
  // Asked again at the moment of the read: a file made, or a Codex upgraded, while the consent box was open.
  if (process.platform === 'win32') return Promise.resolve({ ok: false, because: WHY_WINDOWS });
  return freshVersion(bin).then((have) => {
    const want = pinnedVersion();
    if (!want || have !== want) return { ok: false, because: whyVersion(have, want || 'unknown') };
    return readChecked(reader, prompt, media, buf, signal, bin);
  });
}

/* The read once the version is known to be the pinned one. */
function readChecked(reader, prompt, media, buf, signal, bin) {
  const schemaObj = require('./orgchartkeys').STRICT_SCHEMA;
  if (personalInstructions(reader.dir)) return Promise.resolve({ ok: false, because: WHY_INSTRUCTIONS });
  if (managedConfig()) return Promise.resolve({ ok: false, because: WHY_MANAGED });
  const cat = catalogFor(reader.dir);
  if (!cat.catalog) return Promise.resolve({ ok: false, because: cat.why });
  const catalog = cat.catalog;
  sweepStale();
  let dir;
  try { dir = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX)); fs.chmodSync(dir, 0o700); } catch { return Promise.resolve({ ok: false, because: 'the read failed' }); }
  const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } };
  const work = path.join(dir, 'work');
  const schema = path.join(dir, 'schema.json');
  const catalogFile = path.join(dir, 'catalog.json');
  const image = path.join(dir, 'chart' + EXT[media]);
  try {
    fs.mkdirSync(work, { mode: 0o700 });
    fs.writeFileSync(schema, JSON.stringify(schemaObj), { mode: 0o600 });
    fs.writeFileSync(catalogFile, JSON.stringify(catalog), { mode: 0o600 });
    fs.writeFileSync(image, buf, { mode: 0o600 });
  } catch { cleanup(); return Promise.resolve({ ok: false, because: 'the read failed' }); }
  const env = childEnv(process.env, reader.dir);
  /* An empty home of its own, so nothing under the person's home folder can load (their ~/.agents skills and plugins,
     say). Measured: a ChatGPT read signs in from CODEX_HOME alone, and writes nothing to this folder. */
  const home = path.join(dir, 'home');
  try { fs.mkdirSync(home, { mode: 0o700 }); } catch { cleanup(); return Promise.resolve({ ok: false, because: 'the read failed' }); }
  env.HOME = home;
  if (process.platform === 'win32') env.USERPROFILE = home;
  return new Promise((resolve) => {
    let done = false;
    let child;
    let timer = null;
    /* Codex is often an npm launcher that starts the native program as ITS child, and a SIGKILL to the launcher cannot
       be passed on (measured, #5346 review: the native process outlived it). So Codex runs in its own process group
       (detached) and every ending kills the whole group: a stop, a timeout and the tool tripwire then stop the model
       call too, not only the answer. Only that group's id is signalled, never a pattern. */
    const killGroup = () => {
      if (!child || !Number.isInteger(child.pid) || child.pid <= 1) return;
      // Bounded by the group's own life: if the board itself dies mid-read, Codex runs on until its request ends.
      // Windows has no process groups to signal (and runs codex.exe itself, not a launcher): the child alone.
      if (GROUPS) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } return; }
      try { if (child.exitCode === null) child.kill('SIGKILL'); } catch { /* already gone */ }
    };
    const finish = (v) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      killGroup();
      cleanup();
      resolve(v);
    };
    const onAbort = () => finish({ ok: false, because: 'the read was stopped' });
    if (signal && signal.aborted) { onAbort(); return; }   // stopped before it started: no model call at all
    try {
      child = spawnFn(bin, codexArgs({ dir: work, catalog: catalogFile, schema, image, prompt }), { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'], detached: GROUPS });
    } catch { finish({ ok: false, because: 'ChatGPT did not answer' }); return; }
    if (signal) signal.addEventListener('abort', onAbort);
    timer = setTimeout(() => finish({ ok: false, because: 'reading the file took too long' }), timeoutMs);
    let out = '';
    let last = null;
    let failed = null;
    let errored = null;
    let completed = false;
    let stderr = '';
    const onLine = (l) => {
      let ev;
      try { ev = JSON.parse(l); } catch { return; }
      if (!ev || typeof ev !== 'object') return;
      if (!KNOWN_EVENTS.has(ev.type)) {
        console.warn('[orgchart] codex sent an event of an unknown kind (' + String(ev.type).slice(0, 40) + '); the read is refused');
        finish({ ok: false, because: 'ChatGPT tried to use a tool, so the answer was not used' });
        return;
      }
      const item = ev.item;
      // An item with no readable type is refused too: the tripwire fails closed.
      if (item && (typeof item.type !== 'string' || !QUIET_ITEMS.has(item.type))) {
        console.warn('[orgchart] codex used a tool (' + String(item.type).slice(0, 40) + '); the read is refused');
        finish({ ok: false, because: 'ChatGPT tried to use a tool, so the answer was not used' });
        return;
      }
      if (ev && ev.type === 'item.completed' && item && item.type === 'agent_message' && typeof item.text === 'string') last = item.text;
      // A turn that failed fails the read. A top-level error (Codex reports a reconnect this way) fails it only if no
      // turn.completed follows.
      if (ev && ev.type === 'turn.failed') failed = (ev.error && ev.error.message) || ev.message || 'error';
      if (ev && ev.type === 'error') errored = ev.message || (ev.error && ev.error.message) || 'error';
      if (ev && ev.type === 'turn.completed') completed = true;
    };
    // Decoded as a stream, so a name whose UTF-8 bytes straddle two chunks is not garbled.
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      if (done) return;
      out += d;
      if (out.length > (8 << 20)) { finish({ ok: false, because: 'ChatGPT\'s answer was too large to read' }); return; }
      let i;
      while ((i = out.indexOf('\n')) >= 0) { const l = out.slice(0, i); out = out.slice(i + 1); onLine(l); if (done) return; }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { if (stderr.length < 4096) stderr += d; });
    child.on('error', () => finish({ ok: false, because: 'ChatGPT did not answer' }));
    child.on('close', () => {
      if (done) return;
      if (out) onLine(out);
      if (done) return;
      // A turn that failed is refused even if a message came before the failure: that text may be a partial answer.
      if (failed === null && errored !== null && !completed) failed = errored;
      // An answer counts only from a turn that completed: a message followed by a crash is not one.
      const notDone = failed === null && !completed;
      if (last === null || failed !== null || notDone) {
        /* Codex's own words first: a failure it reported, else its first stderr line (past the banner it prints when
           stdin is not a terminal), so a missing sign-in is named as one rather than "did not answer". */
        const stderrLine = String(stderr).split('\n').map((s) => s.trim()).find((s) => s && !/^Reading additional input from stdin/i.test(s)) || '';
        const said = (failed || stderrLine || (notDone ? 'the turn did not complete' : '')).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200);
        if (said) console.warn('[orgchart] codex ended without an answer: ' + said);
        finish({ ok: false, because: /log(?:ged)? ?in|sign(?:ed)? ?in|\bauth(?:entication|orization)?\b|\b401\b|unauthori[sz]ed/i.test(said) ? 'the ChatGPT sign-in on this computer has ended. Sign in again in Settings, AI Models, then try again' : 'ChatGPT did not answer' });
        return;
      }
      let structured;
      try { structured = JSON.parse(last); } catch { finish({ ok: false, because: 'ChatGPT\'s answer was not the list asked for' }); return; }
      finish({ ok: true, structured });
    });
  });
}

module.exports = { ANY_PROVIDER, WHY_NO_CODEX, MAX_CATALOG_BYTES, KNOWN_EVENTS, WHY_CATALOG_VERSION, WHY_CATALOG_UNKNOWN, TMP_PREFIX, WHY_CATALOG, WHY_WINDOWS, WHY_MANAGED, setSystemConfigPaths, MODEL_FIELDS, FORCED, pickWithWhy, setVersion, INSTRUCTION_FILES, WHY_INSTRUCTIONS, childEnv, ENV_KEEP, KEEPS, NAME, READS, ALLOWED_TOOLS, TIMEOUT_MS, DISABLED_FEATURES, CONFIG, codexArgs, deriveCatalog, offeredTools, pick, label, cannotRead, read, setAccounts, setBin, setSpawn, setTimeoutMs };
