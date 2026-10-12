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
 * is stored and what is read back, so a hand-edited file cannot reach the launch line with a bad value.
 */
function endpointProblem(ep) {
  const e = ep && typeof ep === 'object' ? ep : {};
  let url;
  try { url = new URL(String(e.baseUrl || '')); } catch { return 'give the address of an OpenAI-compatible endpoint, such as ' + LOCAL.baseUrl; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'the address must start with http:// or https://';
  if (url.username || url.password) return 'put the key in the key box, not in the address';
  if (url.search || url.hash) return 'the address must not have a ? or # part';
  if (!/^[A-Za-z0-9._:/-]{1,120}$/.test(String(e.model || ''))) return 'give the model name the endpoint uses, such as ' + LOCAL.model;
  const ctx = e.contextWindow;
  if (typeof ctx !== 'number' || !Number.isInteger(ctx) || ctx < MIN_CONTEXT || ctx > MAX_CONTEXT) {
    return `the context must be a whole number of tokens from ${MIN_CONTEXT} up (below that, Qwen loses the request)`;
  }
  if (e.key != null && e.key !== '') {
    const k = String(e.key);
    if (/\s/.test(k)) return 'that does not look like a key: a key has no spaces or line breaks in it';
    if (k.length > 4096) return 'that key is too long';
  }
  return null;
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

/** True when an account home is an endpoint home (the supervisor and the status paths ask this). */
function isEndpointHome(dir) {
  if (!dir) return false;
  try { return fs.statSync(endpointFile(dir)).isFile(); } catch { return false; }
}

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
    keyTail: ep && ep.key ? ep.key.slice(-4) : null,
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
async function askModels(ep) {
  const f = fetcher || (async (url, init) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(url, { ...init, signal: ctl.signal });
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      return { status: res.status, body };
    } finally { clearTimeout(t); }
  });
  const headers = ep.key ? { authorization: 'Bearer ' + ep.key } : {};
  try {
    return await f(ep.baseUrl + '/models', { method: 'GET', headers });
  } catch {
    return { status: 0, body: null, unreachable: true };
  }
}

/**
 * The live verdict for an endpoint. CONNECTED: the endpoint answered and lists the model. NONE only on the
 * endpoint's own positive answer: it lists models and this one is not among them, or it refuses the key (401/403).
 * Unreachable or anything else is UNKNOWN, never a guessed NONE (Ollama not running is "we could not check").
 */
async function validateLive(ep) {
  const where = isLocal(ep.baseUrl) ? 'Qwen on this computer (Ollama)' : 'the Qwen endpoint';
  const r = await askModels(ep);
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

/** checkLive for a stored account. `_opts` is accepted for signature parity with the other providers' checkLive. */
async function checkLive(dir, _opts) {
  const got = readEndpoint(dir);
  if (got.kind === 'absent') return { state: STATE.NONE, checkedLive: true, because: 'nobody has set up this Qwen account yet' };
  if (got.kind === 'unreadable') return { state: STATE.UNKNOWN, checkedLive: true, because: 'we could not read this account\'s endpoint' };
  if (got.kind === 'invalid') return { state: STATE.NONE, checkedLive: true, because: got.because };
  const live = await validateLive(got.endpoint);
  return { ...live, checkedLive: true };
}

async function listLiveNow() {
  const rows = list();
  return Promise.all(rows.map(async (row) => {
    try {
      return { ...row, connection: await module.exports.checkLive(row.dir, { cached: true }) };
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

module.exports = {
  STATE, PROVIDER, PROVIDER_NAME, LOCAL, MIN_CONTEXT, DIR_PREFIX, FORGOTTEN_PREFIX, ENDPOINT_BASENAME,
  homeDir, endpointFile, endpointProblem, readEndpoint, isEndpointHome, isLocal, list,
  cleanLabel, dirForLabel, storeEndpoint,
  setFetcher, askModels, validateLive, checkLive, listLive,
  forgetAccount, removeAccount,
  readName, writeName,
};
