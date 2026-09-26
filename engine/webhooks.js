'use strict';
/**
 * #1307 (Josh, 2026-08-28): a project's webhooks. A webhook is a link another program can call to
 * add a task to one project. Made, named and deleted in the project's settings.
 *
 * 🔑 THE SECRET IS MINTED AND HELD BY THE MAC, NEVER BY THE COORDINATOR (Ice Cream Kitty's
 * measurement on #1307): admission is the Mac's own decision, so a credential the coordinator
 * minted and the Mac honoured would let a stolen coordinator admit callers. This store lives in
 * the board's data directory and nothing here is sent anywhere.
 *
 * 🔑 ONLY A HASH OF THE SECRET IS KEPT, so the full URL can be shown once, when the webhook is
 * made, and never again. A webhook is keyed by a random id; its NAME is only a label, so renaming
 * never changes the URL and a URL never reveals the name.
 *
 * Its own file, not a field on the project record: project records are sent to the page whole,
 * and a hash has no business on the page.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const securewrite = require('./securewrite');
const { withFileLock } = require('./filelock');

const DIR = path.join(store.ROOT, 'webhooks');
const FILE = path.join(DIR, 'webhooks.json');
const FILE_MODE = 0o600;
const ID_BYTES = 8;        // 16 hex characters: an address, not a secret
const SECRET_BYTES = 32;   // 43 base64url characters: the secret
const NAME_MAX = 60;
const MAX_PER_PROJECT = 20;

const ID_RE = /^[0-9a-f]{16}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

function hashOf(secret) {
  return crypto.createHash('sha256').update(String(secret), 'utf8').digest('hex');
}

function readAll() {
  let raw;
  try { raw = fs.readFileSync(FILE, 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return [];
    const err = new Error('we could not read the webhooks just now');
    err.code = 'UNREADABLE';
    throw err;
  }
  let kept;
  try { kept = JSON.parse(raw); } catch {
    const err = new Error('the webhooks file could not be read');
    err.code = 'UNREADABLE';
    throw err;
  }
  return Array.isArray(kept && kept.hooks)
    ? kept.hooks.filter((h) => h && ID_RE.test(String(h.id)) && typeof h.hash === 'string' && typeof h.projectId === 'string')
    : [];
}

function writeAll(hooks) {
  securewrite.secureDir(DIR, 0o700);
  securewrite.writeSecret(FILE, JSON.stringify({ hooks }), FILE_MODE);
}

function locked(fn) {
  securewrite.secureDir(DIR, 0o700);
  const held = withFileLock(FILE, fn, {
    busy: 'the webhooks store is busy (ELOCKBUSY)',
    cannotAccess: 'we could not get exclusive access to the webhooks',
  });
  if (!held.ok) throw new Error(held.because);
  return held.value;
}

/** What the page may see: never the hash. */
function view(h) {
  return { id: h.id, name: h.name, createdAt: h.createdAt || null, lastUsedAt: h.lastUsedAt || null };
}

function nameProblem(name) {
  if (typeof name !== 'string' || !name.trim()) return 'give the webhook a name';
  if (name.trim().length > NAME_MAX) return 'a webhook name can be up to ' + NAME_MAX + ' characters';
  return null;
}

/** "Webhook 1", "Webhook 2"...: the lowest number this project is not using yet. */
function nextName(hooks, projectId) {
  const used = new Set(hooks.filter((h) => h.projectId === projectId)
    .map((h) => /^Webhook (\d+)$/.exec(String(h.name || '').trim())).filter(Boolean).map((m) => Number(m[1])));
  let n = 1;
  while (used.has(n)) n += 1;
  return 'Webhook ' + n;
}

/** The project's webhooks, oldest first, without their hashes. */
function list(projectId) {
  return readAll().filter((h) => h.projectId === String(projectId))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .map(view);
}

/**
 * Make a webhook on a project. Returns `{ hook, secret }`: the secret exists only in this return
 * value (the store keeps its hash), so the caller shows it once.
 */
function create(projectId, name) {
  const pid = String(projectId);
  const secret = crypto.randomBytes(SECRET_BYTES).toString('base64url');
  const id = crypto.randomBytes(ID_BYTES).toString('hex');
  const made = locked(() => {
    const hooks = readAll();
    if (hooks.filter((h) => h.projectId === pid).length >= MAX_PER_PROJECT) {
      throw new Error('a project can have up to ' + MAX_PER_PROJECT + ' webhooks; delete one first');
    }
    const label = name === undefined || name === null || name === '' ? nextName(hooks, pid) : name;
    const problem = nameProblem(label);
    if (problem) throw new Error(problem);
    const h = { id, projectId: pid, name: label.trim(), hash: hashOf(secret), createdAt: new Date().toISOString(), lastUsedAt: null };
    writeAll(hooks.concat([h]));
    return h;
  });
  return { hook: view(made), secret };
}

/** Rename one of a project's webhooks. The URL does not change. */
function rename(projectId, id, name) {
  const problem = nameProblem(name);
  if (problem) throw new Error(problem);
  return locked(() => {
    const hooks = readAll();
    const h = hooks.find((x) => x.id === String(id) && x.projectId === String(projectId));
    if (!h) throw new Error('there is no webhook by that id on this project');
    h.name = name.trim();
    writeAll(hooks);
    return view(h);
  });
}

/** Delete one of a project's webhooks. Anything still calling its URL is refused from now on. */
function remove(projectId, id) {
  return locked(() => {
    const hooks = readAll();
    const kept = hooks.filter((x) => !(x.id === String(id) && x.projectId === String(projectId)));
    if (kept.length === hooks.length) throw new Error('there is no webhook by that id on this project');
    writeAll(kept);
    return true;
  });
}

/* Constant-time: a caller cannot learn a hash a byte at a time. Both sides are sha256 hex, so the
   lengths always match. */
function sameHash(a, b) {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  if (x.length !== y.length || x.length === 0) return false;
  return crypto.timingSafeEqual(x, y);
}

/**
 * Is this id and secret a live webhook? Returns the stored record's view plus its project, or null.
 * A malformed id or secret, an unknown id and a wrong secret all return null, so a caller learns
 * nothing about which webhooks exist. An unknown id still spends one comparison.
 */
function verify(id, secret) {
  if (!ID_RE.test(String(id)) || !SECRET_RE.test(String(secret))) return null;
  let hooks;
  try { hooks = readAll(); } catch { return null; }
  const h = hooks.find((x) => x.id === String(id));
  const ok = sameHash(h ? h.hash : hashOf('unknown webhook'), hashOf(secret));
  return h && ok ? { ...view(h), projectId: h.projectId } : null;
}

/** Record that a webhook was just used (shown as "last used" in settings). Never throws. */
function touch(id) {
  try {
    locked(() => {
      const hooks = readAll();
      const h = hooks.find((x) => x.id === String(id));
      if (!h) return;
      h.lastUsedAt = new Date().toISOString();
      writeAll(hooks);
    });
  } catch { /* a missed "last used" is not worth failing the call over */ }
}

module.exports = { list, create, rename, remove, verify, touch, nextName, ID_RE, SECRET_RE, NAME_MAX, MAX_PER_PROJECT };
