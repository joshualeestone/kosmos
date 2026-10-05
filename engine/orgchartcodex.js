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
 * `models_cache.json` (what this Codex fetched) and clears only those two fields. A checked-in copy would drift.
 *
 * The picture goes in the request (`-i`, sent as base64), the answer is schema JSON (`--output-schema`), nothing is
 * saved (`--ephemeral`, measured: no session or thread file, the prompt in no file under the account's folder), and
 * the person's own config, rules, skills, hooks, memories and apps do not load. A PDF is not read here: `-i` takes
 * pictures.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const NAME = 'OpenAI';
/* What `-i` reads. A PDF is refused before the consent (cannotRead), like Grok's. */
const READS = { 'image/png': true, 'image/jpeg': true, 'image/webp': true, 'image/gif': true };
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

/* The account's catalog with the two tool fields cleared, or null (Codex has never fetched one in this account). */
function deriveCatalog(accountDir) {
  let cache;
  try { cache = JSON.parse(fs.readFileSync(path.join(accountDir, 'models_cache.json'), 'utf8')); } catch { return null; }
  if (!cache || !Array.isArray(cache.models) || !cache.models.length) return null;
  return { models: cache.models.map((m) => ({ ...m, apply_patch_tool_type: null, tool_mode: null })) };
}

/* The Responses API's built-in tool types: each is a tool by its type alone, with no name. */
const BUILTIN_TOOL_TYPES = new Set(['local_shell', 'shell', 'web_search', 'web_search_preview', 'computer_use_preview',
  'computer_use', 'image_generation', 'mcp', 'file_search', 'code_interpreter', 'apply_patch']);
/* Every tool a request offers the model, wherever it sits: Codex nests its tools in a developer message as a
   namespace, not in a top-level `tools`, so a look at `body.tools` alone reads empty (#5346). A named function or
   custom tool counts by its name, a built-in by its type. */
function offeredTools(body) {
  const names = [];
  const walk = (o) => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!o || typeof o !== 'object') return;
    if ((o.type === 'function' || o.type === 'custom') && typeof o.name === 'string') names.push(o.name);
    else if (BUILTIN_TOOL_TYPES.has(o.type)) names.push(o.type);
    for (const k of Object.keys(o)) walk(o[k]);
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
function pick() {
  if (!binFn()) return null;
  let rows = [];
  try { rows = accountsFn() || []; } catch { rows = []; }
  const subs = rows.filter((r) => r && r.authMode === 'chatgpt' && r.dir)
    .sort((a, b) => Number(b.isDefault === true) - Number(a.isDefault === true));
  const r = subs[0];
  return r ? { kind: 'codex', provider: 'openai', dir: r.dir, account: r.email || r.name || null } : null;
}

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

const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
/* The event items a read may produce. Anything else (a command, a file change, an MCP or tool call, a web search)
   means a tool ran: the run is killed and its answer refused. A tripwire, not the guarantee (the flags are). */
// todo_list is what update_plan produces. request_user_input's item type is not listed on purpose: if it ever emits
// one, the read is refused, which fails safe. Do not add a type here without a capture showing what it is.
const QUIET_ITEMS = new Set(['agent_message', 'reasoning', 'todo_list', 'error']);

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
  const schemaObj = require('./orgchartkeys').STRICT_SCHEMA;
  const bin = binFn();
  if (!bin) return Promise.resolve({ ok: false, unavailable: true, because: 'no ChatGPT connection on this computer' });
  if (!READS[media]) return Promise.resolve({ ok: false, because: cannotRead(media) });
  const catalog = deriveCatalog(reader.dir);
  if (!catalog) return Promise.resolve({ ok: false, because: 'Codex has not finished setting up this ChatGPT account. Start an OpenAI agent once, then try again' });
  let dir;
  try { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-orgchart-codex-')); fs.chmodSync(dir, 0o700); } catch { return Promise.resolve({ ok: false, because: 'the read failed' }); }
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
  /* The account the consent named, and only it: an OPENAI_* or CODEX_* variable the board inherited (a key, another
     base URL, another home) could bill a key or send the chart elsewhere while the box says "using your plan". */
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(OPENAI_|CODEX_)/.test(k)) env[k] = v;
  env.CODEX_HOME = reader.dir;
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
    try {
      child = spawnFn(bin, codexArgs({ dir: work, catalog: catalogFile, schema, image, prompt }), { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'], detached: GROUPS });
    } catch { finish({ ok: false, because: 'ChatGPT did not answer' }); return; }
    if (signal) { if (signal.aborted) { onAbort(); return; } signal.addEventListener('abort', onAbort); }
    timer = setTimeout(() => finish({ ok: false, because: 'reading the file took too long' }), timeoutMs);
    let out = '';
    let last = null;
    let failed = null;
    let stderr = '';
    const onLine = (l) => {
      let ev;
      try { ev = JSON.parse(l); } catch { return; }
      const item = ev && ev.item;
      if (item && typeof item.type === 'string' && !QUIET_ITEMS.has(item.type)) {
        console.warn('[orgchart] codex used a tool (' + String(item.type).slice(0, 40) + '); the read is refused');
        finish({ ok: false, because: 'ChatGPT tried to use a tool, so the answer was not used' });
        return;
      }
      if (ev && ev.type === 'item.completed' && item && item.type === 'agent_message' && typeof item.text === 'string') last = item.text;
      if (ev && (ev.type === 'turn.failed' || ev.type === 'error')) failed = (ev.error && ev.error.message) || ev.message || 'error';
    };
    // Decoded as a stream, so a name whose UTF-8 bytes straddle two chunks is not garbled.
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      out += d;
      if (out.length > (8 << 20)) { finish({ ok: false, because: 'ChatGPT\'s answer was too large to read' }); return; }
      let i;
      while ((i = out.indexOf('\n')) >= 0) { const l = out.slice(0, i); out = out.slice(i + 1); onLine(l); if (done) return; }
    });
    child.stderr.on('data', (d) => { if (stderr.length < 4096) stderr += d; });
    child.on('error', () => finish({ ok: false, because: 'ChatGPT did not answer' }));
    child.on('close', () => {
      if (done) return;
      if (out) onLine(out);
      if (done) return;
      if (last === null) {
        const said = (failed || String(stderr).split('\n').map((s) => s.trim()).find(Boolean) || '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200);
        if (said) console.warn('[orgchart] codex ended without an answer: ' + said);
        finish({ ok: false, because: /log(?:ged)? ?in|sign(?:ed)? ?in|auth|401|unauthori[sz]ed/i.test(said) ? 'the ChatGPT sign-in on this computer has ended. Sign in again in Settings, AI Models, then try again' : 'ChatGPT did not answer' });
        return;
      }
      let structured;
      try { structured = JSON.parse(last); } catch { finish({ ok: false, because: 'ChatGPT\'s answer was not the list asked for' }); return; }
      finish({ ok: true, structured });
    });
  });
}

module.exports = { KEEPS, NAME, READS, ALLOWED_TOOLS, TIMEOUT_MS, DISABLED_FEATURES, CONFIG, codexArgs, deriveCatalog, offeredTools, pick, label, cannotRead, read, setAccounts, setBin, setSpawn, setTimeoutMs };
