'use strict';
/**
 * #7206: providers whose own endpoint speaks Claude Code's API (DeepSeek first; GLM and MiniMax are later rows of the
 * same table). An agent on one runs on the claude runner, pointed at the vendor's address with the person's key,
 * the way a Qwen agent (#5977, engine/qwenaccounts.js) runs on the codex runner pointed at its endpoint.
 *
 * An account is NOT a Claude account. It is a folder in the person's home, ~/.kosmos-<vendor>-<label>, holding
 * kosmos-vendor.json (mode 600): { "vendor": "deepseek", "model": "deepseek-chat", "key": "..." }. The folder is the
 * agent's CLAUDE_CONFIG_DIR, and it holds no Claude sign-in. Every path that judges a Claude account (the key check
 * against api.anthropic.com, the sign-in and usage readers, the machine banner) walks ~/.claude-* folders and never
 * sees this one, by construction. A Claude KEY account pointed at another address was rejected: adding its key asks
 * api.anthropic.com, which would refuse a DeepSeek key and receive it (#7206 survey, 22 such paths).
 *
 * The vendor's address is the table's, never the account file's: a person picks a vendor, not an address, so a
 * hand-edited ACCOUNT file cannot point an agent's key somewhere else. (The agent's own work-folder settings can set
 * Claude Code's environment, as they can for any agent; the agent already holds its key, so that is no new exposure.)
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const subscription = require('./subscription');
const inflight = require('./inflight');
const securewrite = require('./securewrite');

const STATE = subscription.STATE; // CONNECTED | NONE | UNKNOWN -- one vocabulary

/* One row per vendor. baseUrl is what Claude Code is pointed at (ANTHROPIC_BASE_URL). checkUrl is where the key is
   checked: the vendor's own model list, which answers a refused key with 401 and costs nothing (a message would
   cost the person a request). models[0] is the default. From the vendor's own documentation, checked by Kitty on
   2026-10-26 (#7206); a live run with a real key is still to be measured. */
const VENDORS = Object.freeze({
  deepseek: Object.freeze({
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/anthropic',
    checkUrl: 'https://api.deepseek.com/models',
    models: Object.freeze(['deepseek-chat', 'deepseek-reasoner']),
    keyPage: 'https://platform.deepseek.com/api_keys',
  }),
});

/* Review 2: the vendor for an id, from the table's OWN keys only. A plain lookup also finds inherited names
   ("constructor", "toString"), so a hand-edited file naming one would have thrown inside list() and taken the whole
   account list down. */
function vendorOf(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(VENDORS, id) ? VENDORS[id] : null;
}

/* A function, not a const (the #1337 rule): a caller may set AGENT_WORKFORCE_HOME after requiring this module. */
function homeDir() { return process.env.AGENT_WORKFORCE_HOME || os.homedir(); }

/* Review (slice 1b): NOT kosmos-endpoint.json, which marks a Qwen home (qwenaccounts.isEndpointHome reads any folder
   holding it as Qwen's), so a vendor folder could never be mistaken for one. */
const ENDPOINT_BASENAME = 'kosmos-vendor.json';
function dirPrefix(vendor) { return '.kosmos-' + vendor + '-'; }
function forgottenPrefix(vendor) { return '.removed-kosmos-' + vendor + '-'; }
function endpointFile(dir) { return path.join(path.resolve(String(dir || '')), ENDPOINT_BASENAME); }

/** The vendor a folder's NAME says it belongs to, or null. */
function vendorOfName(dir) {
  if (!dir) return null;
  const base = path.basename(path.resolve(String(dir)));
  for (const id of Object.keys(VENDORS)) {
    if (base.startsWith(dirPrefix(id)) && base.length > dirPrefix(id).length) return id;
  }
  return null;
}

/**
 * Why a stored account cannot be used, in words a person can act on, or null when it can. The same check guards what
 * is stored and what is read back, so a hand-edited file is refused before the launch line too.
 */
function accountProblem(ep) {
  const e = ep && typeof ep === 'object' ? ep : {};
  const v = vendorOf(e.vendor);
  if (!v) return 'it names no provider Kosmos knows';
  if (!v.models.includes(e.model)) return `${v.name} has no model called ${String(e.model || '').slice(0, 60) || '(none)'}`;
  const k = String(e.key == null ? '' : e.key);
  if (!k) return `it has no ${v.name} key`;
  if (/[\s\u0000-\u001f\u007f]/.test(k)) return 'that does not look like a key: a key has no spaces, line breaks or control characters in it';
  /* Review 1: printable ASCII only. Any other character cannot be sent in a header at all, so the check would read it
     as "could not reach" and store it, and the agent would fail later inside Claude Code. */
  if (!/^[\x21-\x7e]+$/.test(k)) return 'that does not look like a key: a key is plain letters, digits and symbols';
  if (k.length > 4096) return 'that key is too long';
  return null;
}

function normalize(ep) { return { vendor: String(ep.vendor), model: String(ep.model), key: String(ep.key) }; }

/**
 * Read an account. Four outcomes kept distinct: absent (no file), unreadable (cannot be read or parsed), invalid (it
 * parses but accountProblem refuses it, with the reason), ok. A vendor in the file that disagrees with the folder's
 * name is invalid: the name is what every other reader goes by.
 */
function readAccount(dir) {
  /* Review 4: ONE answer to "is this an account" for every reader (list, check, delete, launch): neither the folder
     nor its file may be a link. The launch refused a linked file while the list followed it, so they disagreed. */
  try { if (fs.lstatSync(path.resolve(String(dir || ''))).isSymbolicLink()) return { kind: 'invalid', because: 'its folder is a link' }; } catch { /* absent: below */ }
  try { if (fs.lstatSync(endpointFile(dir)).isSymbolicLink()) return { kind: 'invalid', because: 'its settings file is a link' }; } catch { /* absent: below */ }
  let raw;
  try { raw = fs.readFileSync(endpointFile(dir), 'utf8'); } catch (e) {
    return e && e.code === 'ENOENT' ? { kind: 'absent' } : { kind: 'unreadable' };
  }
  let ep;
  try { ep = JSON.parse(raw); } catch { return { kind: 'unreadable' }; }
  const problem = accountProblem(ep);
  if (problem) return { kind: 'invalid', because: problem };
  const named = vendorOfName(dir);
  if (named && named !== ep.vendor) return { kind: 'invalid', because: 'its folder and its settings name different providers' };
  return { kind: 'ok', account: normalize(ep) };
}

/** True when an account home is one of these: named like one. Used wherever the question is "is this agent on a
    vendor endpoint" (the status and sign-in exemptions), so a folder whose file went missing is still one and fails
    closed at launch, never judged as a Claude home. */
function isCompatHome(dir) { return vendorOfName(dir) !== null; }

function rowFor(dir) {
  const vendor = vendorOfName(dir);
  if (!vendor) return null;
  const got = readAccount(dir);
  if (got.kind === 'absent') return null;
  const v = vendorOf(vendor);
  const acct = got.kind === 'ok' ? got.account : null;
  return {
    provider: vendor,
    providerName: v.name,
    dir,
    label: path.basename(dir).slice(dirPrefix(vendor).length),
    isDefault: false,
    email: null,
    authMode: 'key',
    keyTail: acct && acct.key.length >= 16 ? acct.key.slice(-4) : null,   // never a large share of a short key
    model: acct ? acct.model : null,
    accountProblem: got.kind === 'ok' ? null : (got.because || 'we could not read this account'),
  };
}

/** Every account of one vendor (or of every vendor, when vendor is omitted) on this computer. READ, never asserted. */
function list(vendor) {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(homeDir()); } catch { entries = []; }
  for (const name of entries.sort()) {
    const dir = path.join(homeDir(), name);
    const v = vendorOfName(dir);
    if (!v || (vendor && v !== vendor)) continue;
    let st = null;
    try { st = fs.lstatSync(dir); } catch { st = null; }
    if (!st || !st.isDirectory()) continue; // a symlink or a file named like an account is not one
    /* Review 2: one folder Kosmos cannot read never takes the list down with it. */
    let row = null;
    try { row = rowFor(dir); } catch { row = null; }
    if (row) out.push(row);
  }
  return out;
}

function cleanLabel(label) {
  return String(label == null ? '' : label).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

/** The account folder for a vendor and label, or a refusal. */
function dirForLabel(vendor, label) {
  if (!vendorOf(vendor)) return { ok: false, because: 'Kosmos does not know that provider' };
  const slug = cleanLabel(label);
  if (!slug) return { ok: false, because: 'give this account a name using letters, numbers or dashes' };
  return { ok: true, label: slug, dir: path.join(homeDir(), dirPrefix(vendor) + slug) };
}

/**
 * Write an account (creating the folder). Refuses a symlinked folder, so the key can never land through a planted
 * link, and a folder whose name names another vendor. Through securewrite.writeSecret: mode 600, flushed before the
 * rename.
 */
function storeAccount(dir, ep) {
  const problem = accountProblem(ep);
  if (problem) throw new Error(problem);
  const d = path.resolve(String(dir || ''));
  if (vendorOfName(d) !== ep.vendor) throw new Error('an account folder must be named for its provider');
  let st = null;
  try { st = fs.lstatSync(d); } catch { st = null; }
  if (st && st.isSymbolicLink()) throw new Error('an account directory must not be a symlink');
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  securewrite.writeSecret(endpointFile(d), JSON.stringify(normalize(ep), null, 2) + '\n', 0o600);
}

/* ---- live check ------------------------------------------------------------ */

let fetcher = null;
function setFetcher(fn) { fetcher = typeof fn === 'function' ? fn : null; }

/** GET the vendor's model list with the key. Never returns a raw error message, never follows a redirect. */
async function askModels(vendor, key, timeoutMs) {
  const f = fetcher || (async (url, init) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs || 5000);
    try {
      const res = await fetch(url, { ...init, redirect: 'manual', signal: ctl.signal });
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      return { status: res.status, body };
    } finally { clearTimeout(t); }
  });
  try {
    return await f(vendorOf(vendor).checkUrl, { method: 'GET', headers: { authorization: 'Bearer ' + key } }, timeoutMs);
  } catch (err) {
    return { status: 0, body: null, unreachable: true, timedOut: !!(err && err.name === 'AbortError') };
  }
}

/**
 * The live verdict for a key. CONNECTED: the vendor answered and lists the model. NONE only on the vendor's own
 * positive answer: it refuses the key (401/403), or lists models and this one is not among them. Anything else is
 * UNKNOWN, never a guessed NONE.
 */
async function validateLive(ep, opts) {
  const v = vendorOf(ep.vendor);
  const r = await askModels(ep.vendor, ep.key, opts && opts.timeoutMs);
  if (r.unreachable && r.timedOut) return { state: STATE.UNKNOWN, because: v.name + ' did not answer in time' };
  if (r.unreachable) return { state: STATE.UNKNOWN, because: 'we could not reach ' + v.name };
  if (r.status === 401 || r.status === 403) return { state: STATE.NONE, because: v.name + ' did not accept this key' };
  if (r.status !== 200) return { state: STATE.UNKNOWN, because: `we asked ${v.name} for its models and it answered ${r.status || 'nothing usable'}` };
  const data = r.body && Array.isArray(r.body.data) ? r.body.data : null;
  if (!data) return { state: STATE.UNKNOWN, because: v.name + ' answered, but not with a list of models' };
  const ids = data.map((m) => (m && typeof m.id === 'string' ? m.id : '')).filter(Boolean);
  if (ids.includes(ep.model)) return { state: STATE.CONNECTED, because: `${v.name} accepted the key and has ${ep.model}` };
  return { state: STATE.NONE, because: `${v.name} accepted the key but does not offer ${ep.model}` };
}

const CACHE_MS = 20000;
const UNREACHABLE_CACHE_MS = 60000;
const LIST_TIMEOUT_MS = 1500;
const liveCache = new Map();

/** checkLive for a stored account. opts.cached: answer from a recent answer for the same account. */
async function checkLive(dir, opts) {
  const got = readAccount(dir);
  if (got.kind === 'absent') return { state: STATE.NONE, checkedLive: true, because: 'nobody has set up this account yet' };
  if (got.kind === 'unreadable') return { state: STATE.UNKNOWN, checkedLive: true, because: 'we could not read this account' };
  if (got.kind === 'invalid') return { state: STATE.NONE, checkedLive: true, because: got.because };
  /* Review 5: a hash, so the cache holds no second copy of the key. */
  const key = path.resolve(String(dir)) + '\u0000' + require('node:crypto').createHash('sha256').update(JSON.stringify(got.account)).digest('hex');
  const hit = liveCache.get(key);
  const ttl = hit && hit.value && hit.value.state === STATE.UNKNOWN ? UNREACHABLE_CACHE_MS : CACHE_MS;
  if (opts && opts.cached && hit && Date.now() - hit.at >= 0 && Date.now() - hit.at < ttl) return hit.value;
  const value = { ...(await validateLive(got.account, { timeoutMs: opts && opts.timeoutMs })), checkedLive: true };
  liveCache.set(key, { at: Date.now(), value });
  return value;
}
function resetLiveCacheForTest() { liveCache.clear(); }

async function listLiveNow(vendor) {
  return Promise.all(list(vendor).map(async (row) => {
    try {
      return { ...row, connection: await module.exports.checkLive(row.dir, { cached: true, timeoutMs: LIST_TIMEOUT_MS }) };
    } catch {
      return { ...row, connection: { state: STATE.UNKNOWN, checkedLive: true, because: 'we could not check this account just now' } };
    }
  }));
}
const listLive = inflight.collapse(listLiveNow);

/* ---- forget and remove ------------------------------------------------------ */

/* There is no default vendor account (every one is a named folder). Present for callers written for every keyed
   provider, such as the server's account delete, which compare a folder with the provider's default. */
function defaultDir() { return null; }

/* What kind of credential an account holds, in the shape the other providers' identityOf answers. */
function identityOf(dir) { return readAccount(dir).kind === 'absent' ? null : { authMode: 'key' }; }

/** Shared guards for forget and remove: a real vendor account folder directly in this home, not a symlink, not in use. */
function guard(dir, usedBy) {
  const home = path.resolve(homeDir());
  const clean = path.resolve(String(dir == null ? '' : dir));
  const vendor = vendorOfName(clean);
  const notOurs = 'that is not a provider account on this computer';
  if (path.dirname(clean) !== home || !vendor) return { because: notOurs };
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
  /* The name is not the account: a name-shaped folder with no account file is not ours to move or delete. */
  if (readAccount(clean).kind === 'absent') return { because: notOurs };
  return { clean, vendor, label: path.basename(clean).slice(dirPrefix(vendor).length) };
}

/** Forget an account without deleting it: rename its folder aside so it stops being listed (reversible). */
function forgetAccount(dir, usedBy) {
  const g = guard(dir, usedBy);
  if (g.gone) return { ok: true, forgotten: false, because: 'that account is already gone from this computer' };
  if (!g.clean) return { ok: false, forgotten: false, ...(g.usedBy ? { usedBy: g.usedBy } : {}), because: g.because };
  const home = path.resolve(homeDir());
  let target = path.join(home, forgottenPrefix(g.vendor) + g.label);
  for (let n = 2; fs.existsSync(target) && n < 500; n += 1) target = path.join(home, `${forgottenPrefix(g.vendor)}${g.label}-${n}`);
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

/* Every ANTHROPIC_* variable the launch owns. The supervisor UNSETS each before setting its own: the tmux server's
   global environment and Windows' whole-environment copy can carry one into every Claude pane (#7206 survey), and an
   inherited ANTHROPIC_API_KEY or base URL would send this agent, and its key, somewhere else. */
const LAUNCH_VARS = Object.freeze([
  'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_CUSTOM_HEADERS', 'ANTHROPIC_BETAS', 'CLAUDE_CODE_SUBAGENT_MODEL',
  /* Review 1: Claude Code's other provider switches (any one makes it ignore the base URL) and its own sign-in token. */
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_OAUTH_TOKEN',
  /* Set, not removed: Claude Code's own background requests (updates, error reports) are not sent to Anthropic. */
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
]);

/**
 * What the supervisor sets to point Claude Code at the vendor: { ok, env, model } or { ok: false, because } (the
 * supervisor then refuses to start the agent, rather than starting Claude Code against Anthropic with no sign-in).
 * The model goes to --model as well, since the supervisor's own --model would otherwise send a claude-* id.
 */
function launchEnv(dir) {
  const named = vendorOfName(dir);
  const refuse = (because) => ({ ok: false, because: `this ${named ? vendorOf(named).name + ' ' : ''}account cannot be used: ${because}` });
  const got = readAccount(dir);   // refuses a linked folder or settings file itself (review 4)
  if (got.kind !== 'ok') {
    return refuse(got.kind === 'invalid' ? got.because : (got.kind === 'absent' ? 'it has no key set up' : 'its settings file could not be read'));
  }
  const a = got.account;
  const v = vendorOf(a.vendor);
  return {
    ok: true,
    model: a.model,
    env: {
      ANTHROPIC_BASE_URL: v.baseUrl,
      ANTHROPIC_AUTH_TOKEN: a.key,
      ANTHROPIC_MODEL: a.model,
      ANTHROPIC_SMALL_FAST_MODEL: a.model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: a.model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: a.model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: a.model,
      CLAUDE_CODE_SUBAGENT_MODEL: a.model,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
  };
}

/* The supervisor's entry: `node anthropiccompat.js launch-env <dir>` prints NAME=VALUE pairs NUL-separated (exit 0),
   the names to unset first being LAUNCH_VARS; or the refusal sentence (exit 2). Any other failure prints a sentence
   too (exit 3), never a stack trace the supervisor would drop. */
if (require.main === module) {
  try {
    const [verb, dir] = process.argv.slice(2);
    if (verb !== 'launch-env') process.exit(64);
    const r = launchEnv(dir);
    if (!r.ok) { process.stdout.write(r.because); process.exit(2); }
    process.stdout.write(Object.entries(r.env).map(([k, val]) => k + '=' + val).join('\0') + '\0');
  } catch {
    process.stdout.write('Kosmos could not read this account');
    process.exit(3);
  }
}

module.exports = {
  STATE, VENDORS, ENDPOINT_BASENAME, LAUNCH_VARS, vendorOf,
  homeDir, dirPrefix, forgottenPrefix, endpointFile, vendorOfName, isCompatHome, accountProblem, readAccount,
  list, cleanLabel, dirForLabel, storeAccount,
  setFetcher, askModels, validateLive, checkLive, listLive, resetLiveCacheForTest,
  defaultDir, identityOf, forgetAccount, removeAccount,
  launchEnv,
};
