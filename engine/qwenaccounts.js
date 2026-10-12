'use strict';
/**
 * #5977: Qwen accounts. A Qwen agent runs on the codex runner, pointed at an OpenAI-compatible endpoint instead of
 * OpenAI: Qwen on this computer through Ollama, or any endpoint a person names (a company's own server, its own
 * fine-tuned model).
 *
 * An account is a folder in the person's home, ~/.kosmos-qwen-<label>, holding kosmos-endpoint.json (mode 600):
 *   { "baseUrl": "http://localhost:11434/v1", "model": "...", "contextWindow": 16384, "key": "..." (optional) }
 * The folder is the agent's account home (the plist's CODEX_HOME), so bin/agent-supervisor.sh finds the endpoint
 * there and launches codex against it. There is no auth.json: nothing here is an OpenAI sign-in.
 *
 * Two settings are required for codex to drive a local Qwen (measured on #5977, 2026-10-12): a context of at least
 * 16k (at Ollama's default 4096 the person's request is pushed out of the window), and codex's web search off
 * (Ollama 0.20 returns every function call with an empty name when a non-function tool is in the list). The
 * context is the model's own (a Modelfile alias with num_ctx), and contextWindow tells codex the same number; the
 * supervisor turns web search off for every endpoint account.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const subscription = require('./subscription');
const inflight = require('./inflight');
const securewrite = require('./securewrite');

const STATE = subscription.STATE; // CONNECTED | NONE | UNKNOWN -- one vocabulary
const PROVIDER = 'alibaba';
const PROVIDER_NAME = 'Qwen';

/* The tested default: Qwen 2.5 7B on this computer, through a Modelfile alias with a 16k context (slice 3 makes
   it). A bigger model is a settings choice for later and is not measured yet. */
const LOCAL = Object.freeze({
  baseUrl: 'http://localhost:11434/v1',
  baseModel: 'qwen2.5:7b',
  model: 'kosmos-qwen2.5-7b-16k:latest',
  contextWindow: 16384,
});
const MIN_CONTEXT = 16384;
const MAX_CONTEXT = 1048576;

/* A function, not a const (the #1337 rule): a caller may set AGENT_WORKFORCE_HOME after requiring this module. */
function homeDir() { return process.env.AGENT_WORKFORCE_HOME || os.homedir(); }

const DIR_PREFIX = '.kosmos-qwen-';
/* The prefix a forgotten account's folder is renamed to. It REPLACES DIR_PREFIX, so list() no longer finds it. */
const FORGOTTEN_PREFIX = '.removed-kosmos-qwen-';
const ENDPOINT_BASENAME = 'kosmos-endpoint.json';
function endpointFile(dir) { return path.join(path.resolve(String(dir || '')), ENDPOINT_BASENAME); }

const NAME_MAX = 120;
function nameFile(dir) { return path.join(path.resolve(String(dir || '')), '.kosmos-name'); }
function readName(dir) {
  try {
    const n = [...fs.readFileSync(nameFile(dir), 'utf8').trim()].slice(0, NAME_MAX).join('').trimEnd();
    return n || null;
  } catch { return null; }
}
function writeName(dir, name) {
  const n = [...String(name == null ? '' : name).trim()].slice(0, NAME_MAX).join('').trimEnd();
  if (!n) return false;
  try { fs.writeFileSync(nameFile(dir), n); return true; } catch { return false; }
}

/**
 * Why an endpoint cannot be used, in words a person can act on, or null when it can. The same checks guard what
 * is stored and what is read back (readEndpoint), so a hand-edited file is refused before the launch line too.
 */
function endpointProblem(ep) {
  const e = ep && typeof ep === 'object' ? ep : {};
  const raw = String(e.baseUrl == null ? '' : e.baseUrl);
  /* Checked on the text as written, not only on what URL makes of it: URL quietly percent-encodes or drops a quote,
     a backslash or a tab, and the text as written is what is stored and handed to codex (review 1). */
  if (raw !== raw.trim() || /[\s"'\\<>`\u0000-\u001f\u007f]/.test(raw)) return 'the address has a space, quote, backslash or control character in it';
  let url;
  try { url = new URL(raw); } catch { return 'give the address of an OpenAI-compatible endpoint, such as ' + LOCAL.baseUrl; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'the address must start with http:// or https://';
  if (url.username || url.password) return 'put the key in the key box, not in the address';
  if (url.search || url.hash) return 'the address must not have a ? or # part';
  /* Review 2: a link-local host (169.254.x.x, fe80::) is a cloud's metadata service or a cable between two machines,
     never a model endpoint, and the add route would otherwise ask it for /models. */
  if (isLinkLocal(url.hostname)) return 'that is a link-local address, not a model endpoint';
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(String(e.model || ''))) return 'give the model name the endpoint uses, such as ' + LOCAL.model;
  const ctx = e.contextWindow;
  if (typeof ctx !== 'number' || !Number.isInteger(ctx) || ctx < MIN_CONTEXT || ctx > MAX_CONTEXT) {
    return `the context must be a whole number of tokens from ${MIN_CONTEXT} up (below that, Qwen loses the request)`;
  }
  if (e.key != null && e.key !== '') {
    const k = String(e.key);
    if (/[\s\u0000-\u001f\u007f]/.test(k)) return 'that does not look like a key: a key has no spaces, line breaks or control characters in it';   // review 3: control characters too
    if (k.length > 4096) return 'that key is too long';
    /* Review 2: the key travels with every check and every turn. Over plain http to another machine anyone on the
       way can read it, so a key needs https, unless the endpoint is on this computer. */
    if (url.protocol === 'http:' && !isLocal(raw)) return 'a key is sent with every request, so an address on another computer needs https:// to carry one';
  }
  return null;
}

/* Review 3: an IPv4 address written inside IPv6 (::ffff:a9fe:a9fe, the NAT64 64:ff9b::a9fe:a9fe) is that IPv4 address;
   URL rewrites the dotted form to hex, so both are decoded before the link-local test. A name that resolves to a
   link-local address is not caught here (no DNS lookup); the live check refuses to follow redirects (askModels). */
function isLinkLocal(hostname) {
  let host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  const mapped = host.match(/^(?:::ffff:|64:ff9b::)(?:([0-9a-f]{1,4}):([0-9a-f]{1,4})|(\d+\.\d+\.\d+\.\d+))$/);
  if (mapped) {
    if (mapped[3]) host = mapped[3];
    else {
      const a = parseInt(mapped[1], 16); const b = parseInt(mapped[2], 16);
      host = [a >> 8, a & 255, b >> 8, b & 255].join('.');
    }
  }
  return /^169\.254\./.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
}

/** The endpoint as stored, normalized: baseUrl without a trailing slash, key only when non-empty. */
function normalize(ep) {
  const out = {
    baseUrl: String(ep.baseUrl).replace(/\/+$/, ''),
    model: String(ep.model),
    contextWindow: Number(ep.contextWindow),
  };
  if (ep.key != null && String(ep.key) !== '') out.key = String(ep.key);
  return out;
}

/**
 * Read an account's endpoint. Four outcomes kept distinct: absent (no file), unreadable (a file that cannot be
 * read or parsed), invalid (it parses but endpointProblem refuses it, with the reason), ok (the endpoint).
 */
function readEndpoint(dir) {
  const file = endpointFile(dir);
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) {
    return e && e.code === 'ENOENT' ? { kind: 'absent' } : { kind: 'unreadable' };
  }
  let ep;
  try { ep = JSON.parse(raw); } catch { return { kind: 'unreadable' }; }
  const problem = endpointProblem(ep);
  if (problem) return { kind: 'invalid', because: problem };
  return { kind: 'ok', endpoint: normalize(ep) };
}

/** True when an account home holds a regular endpoint file (lstat: a symlink there is not one, as the supervisor
    also refuses it). */
function isEndpointHome(dir) {
  if (!dir) return false;
  try { return fs.lstatSync(endpointFile(dir)).isFile(); } catch { return false; }
}

/** True when an account home is a Qwen account: named like one, or holding an endpoint file. Used wherever the
    question is "is this agent on Qwen" (jobProvider, the status exemptions), so a Qwen folder whose endpoint file
    went missing or became a link is still Qwen (and fails closed at launch), never judged as an OpenAI home. */
function isQwenHome(dir) {
  if (!dir) return false;
  if (path.basename(path.resolve(String(dir))).startsWith(DIR_PREFIX)) return true;
  return isEndpointHome(dir);
}

/* There is no default Qwen account (every one is a named folder). Present for callers written for every keyed
   provider, such as the server's account delete, which compare a folder with the provider's default. */
function defaultDir() { return null; }

/* What kind of credential an account holds, in the shape the other providers' identityOf answers. */
function identityOf(dir) { return readEndpoint(dir).kind === 'absent' ? null : { authMode: 'endpoint' }; }

function isLocal(baseUrl) {
  try {
    const h = new URL(baseUrl).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
  } catch { return false; }
}

function rowFor(dir) {
  const got = readEndpoint(dir);
  if (got.kind === 'absent') return null;
  const ep = got.kind === 'ok' ? got.endpoint : null;
  return {
    provider: PROVIDER,
    providerName: PROVIDER_NAME,
    dir,
    label: path.basename(dir).slice(DIR_PREFIX.length),
    name: readName(dir),
    isDefault: false,
    email: null,
    authMode: 'endpoint',
    keyTail: ep && ep.key && ep.key.length >= 16 ? ep.key.slice(-4) : null,   // review 2: never a large share of a short key
    baseUrl: ep ? ep.baseUrl : null,
    model: ep ? ep.model : null,
    local: ep ? isLocal(ep.baseUrl) : false,
    endpointProblem: got.kind === 'ok' ? null : (got.because || 'we could not read this account\'s endpoint'),
  };
}

/** Every Qwen account on this computer. READ, never asserted. There is no default home: every account is named. */
function list() {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(homeDir()); } catch { entries = []; }
  for (const name of entries.sort()) {
    if (!name.startsWith(DIR_PREFIX)) continue;
    const dir = path.join(homeDir(), name);
    let st = null;
    try { st = fs.lstatSync(dir); } catch { st = null; }
    if (!st || !st.isDirectory()) continue; // a symlink or a file named like an account is not one
    const row = rowFor(dir);
    if (row) out.push(row);
  }
  return out;
}

function cleanLabel(label) {
  return String(label == null ? '' : label).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

/** The account folder for a label, or a refusal. */
function dirForLabel(label) {
  const slug = cleanLabel(label);
  if (!slug) return { ok: false, because: 'give this account a name using letters, numbers or dashes' };
  return { ok: true, label: slug, dir: path.join(homeDir(), DIR_PREFIX + slug) };
}

/**
 * Write an account's endpoint (creating the folder). Refuses a symlinked account folder, so the file can never land
 * through a planted link. Through securewrite.writeSecret: mode 600, flushed before the rename.
 */
function storeEndpoint(dir, ep) {
  const problem = endpointProblem(ep);
  if (problem) throw new Error(problem);
  const d = path.resolve(String(dir || ''));
  let st = null;
  try { st = fs.lstatSync(d); } catch { st = null; }
  if (st && st.isSymbolicLink()) throw new Error('an account directory must not be a symlink');
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  securewrite.writeSecret(endpointFile(d), JSON.stringify(normalize(ep), null, 2) + '\n', 0o600);
}

/* ---- live check ------------------------------------------------------------ */

let fetcher = null;
function setFetcher(fn) { fetcher = typeof fn === 'function' ? fn : null; }

/** GET <baseUrl>/models, with the key when there is one. Never returns a raw error message. */
async function askModels(ep, timeoutMs) {
  const f = fetcher || (async (url, init) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs || 5000);
    try {
      // Review 3: never follow a redirect (an endpoint could send the check to a link-local address); a 3xx is UNKNOWN.
      const res = await fetch(url, { ...init, redirect: 'manual', signal: ctl.signal });
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      return { status: res.status, body };
    } finally { clearTimeout(t); }
  });
  const headers = ep.key ? { authorization: 'Bearer ' + ep.key } : {};
  try {
    return await f(ep.baseUrl + '/models', { method: 'GET', headers }, timeoutMs);
  } catch {
    return { status: 0, body: null, unreachable: true };
  }
}

/**
 * The live verdict for an endpoint. CONNECTED: the endpoint answered and lists the model. NONE only on the
 * endpoint's own positive answer: it lists models and this one is not among them, or it refuses the key (401/403).
 * Unreachable or anything else is UNKNOWN, never a guessed NONE (Ollama not running is "we could not check").
 */
async function validateLive(ep, opts) {
  const where = isLocal(ep.baseUrl) ? 'Qwen on this computer (Ollama)' : 'the Qwen endpoint';
  const r = await askModels(ep, opts && opts.timeoutMs);
  if (r.unreachable) {
    return { state: STATE.UNKNOWN, because: isLocal(ep.baseUrl) ? 'we could not reach Ollama on this computer; is it running?' : 'we could not reach the Qwen endpoint' };
  }
  if (r.status === 401 || r.status === 403) return { state: STATE.NONE, because: where + ' did not accept the key' };
  if (r.status !== 200) return { state: STATE.UNKNOWN, because: `we asked ${where} for its models and it answered ${r.status || 'nothing usable'}` };
  const data = r.body && Array.isArray(r.body.data) ? r.body.data : null;
  if (!data) return { state: STATE.UNKNOWN, because: where + ' answered, but not with a list of models' };
  const ids = data.map((m) => (m && typeof m.id === 'string' ? m.id : '')).filter(Boolean);
  const want = ep.model;
  const bare = want.replace(/:latest$/, '');
  if (ids.includes(want) || ids.includes(bare) || ids.includes(bare + ':latest')) {
    return { state: STATE.CONNECTED, because: `${where} has ${want}` };
  }
  return { state: STATE.NONE, because: `${where} does not have the model ${want}` };
}

/* A short-lived cache of each account's last live answer. The account list asks on every read, and one endpoint that
   does not answer would otherwise hold the whole list for the timeout every time (review 1). Only a caller that asks
   for it (opts.cached, as listLive does) is answered from it; a person's own check always asks the endpoint. */
const CACHE_MS = 20000;
const UNREACHABLE_CACHE_MS = 60000;
/* Review 4: the account list waits on every Qwen endpoint alongside the other providers, so it asks with a short
   limit; a person's own check (Check now) keeps the full 5 s. */
const LIST_TIMEOUT_MS = 1500;
const liveCache = new Map();

/** checkLive for a stored account. opts.cached: answer from an answer under CACHE_MS old for the same endpoint. */
async function checkLive(dir, opts) {
  const got = readEndpoint(dir);
  if (got.kind === 'absent') return { state: STATE.NONE, checkedLive: true, because: 'nobody has set up this Qwen account yet' };
  if (got.kind === 'unreadable') return { state: STATE.UNKNOWN, checkedLive: true, because: 'we could not read this account\'s endpoint' };
  if (got.kind === 'invalid') return { state: STATE.NONE, checkedLive: true, because: got.because };
  const key = path.resolve(String(dir)) + '\u0000' + JSON.stringify(got.endpoint);
  const hit = liveCache.get(key);
  /* Review 4: an endpoint that did not answer is kept longer (UNREACHABLE_CACHE_MS), so one dead server costs the
     account list its short wait once a minute, not every 20 s. */
  const ttl = hit && hit.value && hit.value.state === STATE.UNKNOWN ? UNREACHABLE_CACHE_MS : CACHE_MS;
  if (opts && opts.cached && hit && Date.now() - hit.at >= 0 && Date.now() - hit.at < ttl) return hit.value;
  const value = { ...(await validateLive(got.endpoint, { timeoutMs: opts && opts.timeoutMs })), checkedLive: true };
  liveCache.set(key, { at: Date.now(), value });
  return value;
}
function resetLiveCacheForTest() { liveCache.clear(); }

async function listLiveNow() {
  const rows = list();
  return Promise.all(rows.map(async (row) => {
    try {
      return { ...row, connection: await module.exports.checkLive(row.dir, { cached: true, timeoutMs: LIST_TIMEOUT_MS }) };
    } catch {
      return { ...row, connection: { state: STATE.UNKNOWN, checkedLive: true, because: 'we could not check this account just now' } };
    }
  }));
}
const listLive = inflight.collapse(listLiveNow);

/* ---- forget and remove ------------------------------------------------------ */

/** Shared guards for forget and remove: a real account folder directly in this home, not a symlink, not in use. */
function guard(dir, usedBy) {
  const home = path.resolve(homeDir());
  const clean = path.resolve(String(dir == null ? '' : dir));
  const base = path.basename(clean);
  const notOurs = 'that is not a Qwen account on this computer';
  if (path.dirname(clean) !== home || !base.startsWith(DIR_PREFIX) || base.length === DIR_PREFIX.length) return { because: notOurs };
  let st = null;
  try { st = fs.lstatSync(clean); } catch { st = null; }
  if (st && !st.isDirectory()) return { because: notOurs };
  const agents = (Array.isArray(usedBy) ? usedBy : []).filter((n) => typeof n === 'string' && n);
  if (agents.length) {
    return {
      usedBy: agents,
      because: agents.length === 1
        ? `${agents[0]} is set up to run on this account. Move it to another account or remove it first.`
        : `${agents.length} agents are set up to run on this account: ${agents.join(', ')}. Move them to another account or remove them first.`,
    };
  }
  if (!st) return { gone: true, clean };
  /* The name is not the account: a name-shaped folder with no endpoint file is not ours to move or delete. */
  if (readEndpoint(clean).kind === 'absent') return { because: notOurs };
  return { clean, base };
}

/** Forget an account without deleting it: rename its folder aside so it stops being listed (reversible). */
function forgetAccount(dir, usedBy) {
  const g = guard(dir, usedBy);
  if (g.gone) return { ok: true, forgotten: false, because: 'that account is already gone from this computer' };
  if (!g.clean) return { ok: false, forgotten: false, ...(g.usedBy ? { usedBy: g.usedBy } : {}), because: g.because };
  const home = path.resolve(homeDir());
  const label = g.base.slice(DIR_PREFIX.length);
  let target = path.join(home, FORGOTTEN_PREFIX + label);
  for (let n = 2; fs.existsSync(target) && n < 500; n += 1) target = path.join(home, `${FORGOTTEN_PREFIX}${label}-${n}`);
  if (fs.existsSync(target)) return { ok: false, forgotten: false, because: 'we could not find a free name to move that account to' };
  try { fs.renameSync(g.clean, target); } catch { return { ok: false, forgotten: false, because: 'we could not move that account out of the way' }; }
  return { ok: true, forgotten: true, movedTo: target, wasDefault: false, because: null };
}

/** Delete an account's folder (and its key) from this computer. Irreversible; the UI asks first. */
function removeAccount(dir, usedBy) {
  const g = guard(dir, usedBy);
  if (g.gone) return { ok: true, removed: false, because: 'that account is already gone from this computer' };
  if (!g.clean) return { ok: false, removed: false, ...(g.usedBy ? { usedBy: g.usedBy } : {}), because: g.because };
  try { fs.rmSync(g.clean, { recursive: true, force: true }); } catch { return { ok: false, removed: false, because: 'we could not delete that account from this computer' }; }
  return { ok: true, removed: true, wasDefault: false, because: null };
}

/* ---- launch ----------------------------------------------------------------- */

/* The codex provider id the launch defines, and the variable the key (if any) reaches codex through. */
const CODEX_PROVIDER_ID = 'kosmos_endpoint';
const KEY_ENV = 'KOSMOS_ENDPOINT_KEY';

/* A TOML basic string. The values are already narrowed (a parsed URL, a [A-Za-z0-9._:/-] model), so JSON's quoting
   of them is valid TOML; anything else is refused rather than escaped. */
function toml(s) {
  const v = String(s);
  if (/["\\\u0000-\u001f\u007f]/.test(v)) throw new Error('a launch value with a quote, backslash or control character');
  return '"' + v + '"';
}

/**
 * The codex arguments that point an agent at its account's endpoint, from bin/agent-supervisor.sh. Both measured
 * requirements are here: the context (model_context_window, matching the model's own num_ctx) and web search off.
 * Returns { ok, args, key } or { ok: false, because } (the supervisor then refuses to start the agent, rather than
 * starting codex against OpenAI with no sign-in).
 */
function launchArgs(dir) {
  const refuse = (because) => ({ ok: false, because: 'this Qwen account cannot be used: ' + because });
  /* A link at the endpoint file is refused, as storeEndpoint refuses a linked folder: the account is what Kosmos
     wrote, never something it points at. */
  try { if (fs.lstatSync(endpointFile(dir)).isSymbolicLink()) return refuse('its endpoint file is a link'); } catch { /* absent: below */ }
  const got = readEndpoint(dir);
  if (got.kind !== 'ok') {
    return refuse(got.kind === 'invalid' ? got.because : (got.kind === 'absent' ? 'it has no endpoint set up' : 'its endpoint file could not be read'));
  }
  const ep = got.endpoint;
  const p = `model_providers.${CODEX_PROVIDER_ID}`;
  try {
    const args = [
      '-c', `model_provider=${toml(CODEX_PROVIDER_ID)}`,
      '-c', `${p}.name=${toml(PROVIDER_NAME)}`,
      '-c', `${p}.base_url=${toml(ep.baseUrl)}`,
      '-c', `${p}.wire_api=${toml('responses')}`,
    ];
    if (ep.key) args.push('-c', `${p}.env_key=${toml(KEY_ENV)}`);
    args.push('-c', `model_context_window=${ep.contextWindow}`, '-c', `web_search=${toml('disabled')}`, '-m', ep.model);
    return { ok: true, args, key: ep.key || null };
  } catch {
    return refuse('its endpoint has a character Kosmos cannot hand to codex');
  }
}

/* The supervisor's entry: `node qwenaccounts.js launch-args <dir>` prints the arguments NUL-separated (exit 0), or
   the refusal sentence (exit 2); `launch-key <dir>` prints the key, if any, with no newline. Any other failure prints
   a sentence too (exit 3), never a stack trace the supervisor would drop, leaving a blank reason (review 1). */
if (require.main === module) {
  try {
    const [verb, dir] = process.argv.slice(2);
    const r = launchArgs(dir);
    if (!r.ok) { process.stdout.write(r.because); process.exit(2); }
    if (verb === 'launch-args') process.stdout.write(r.args.join('\0') + '\0');
    else if (verb === 'launch-key') process.stdout.write(r.key || '');
    else process.exit(64);
  } catch {
    process.stdout.write('Kosmos could not read this Qwen account');
    process.exit(3);
  }
}

module.exports = {
  CODEX_PROVIDER_ID, KEY_ENV, launchArgs,
  STATE, PROVIDER, PROVIDER_NAME, LOCAL, MIN_CONTEXT, DIR_PREFIX, FORGOTTEN_PREFIX, ENDPOINT_BASENAME,
  homeDir, defaultDir, identityOf, endpointFile, endpointProblem, readEndpoint, isEndpointHome, isQwenHome, isLocal, list, resetLiveCacheForTest,
  cleanLabel, dirForLabel, storeEndpoint,
  setFetcher, askModels, validateLive, checkLive, listLive,
  forgetAccount, removeAccount,
  readName, writeName,
};
