'use strict';

/**
 * Codex's update notice, and stopping it from BLOCKING an agent (#1315).
 *
 * 🛑 THE DEFECT. A codex agent reaches this and stops, before doing anything:
 *
 *     ✨ Update available! 0.149.1 -> 0.150.1
 *     › 1. Update now   2. Skip   3. Skip until next version
 *       Press enter to continue
 *
 * Nothing presses a key for it. And the board cannot see the blocked state:
 * `classify()` reads that pane as `unknown`, the same word it uses for an agent
 * that is merely quiet, because the codex markers are question-shaped and this
 * prompt is not a question.
 *
 * 🔑 ITS OWN MODULE, WITH NO DEPENDENCIES, FOR ONE REASON: it is called from
 * BOTH creation and the LAUNCH path. The launch caller is a shell script shim,
 * and pulling `create.js` or `codexsession.js` (which requires `status.js`) into
 * every agent start would put a large module in a path that has to be cheap and
 * cannot fail. A second copy of the function was the alternative, and two
 * definitions of one fact is where this codebase's worst defects came from.
 *
 * ⚠️ WHY LAUNCH AND NOT ONLY CREATION. #1332 dismissed at creation, which
 * unblocked new agents and left the class open: when OpenAI ships the next
 * release `latest_version` moves, the dismissal stops matching, and every
 * EXISTING agent meets the prompt again on its next restart. Answering it at
 * every launch closes that.
 *
 * kosmos#8597: it also answers Codex's model-migration menu (pinModelMigration, below). That one reads the catalog
 * the binary ships when the fetched cache does not answer, so a launch can spawn `codex debug models --bundled`,
 * bounded at BUNDLED_MS, and it takes engine/filelock.js and engine/securewrite.js for its config.toml write. The
 * update dismissal above still needs nothing; the migration pin is the part that can cost a launch time (at most
 * BUNDLED_MS plus the lock's wait), and it still never stops one.
 *
 * ⚠️ AND IT NEVER INVENTS A VERSION. Absent, unparseable, or no `latest_version`
 * all decline: dismissing a version codex has not told us about would be writing
 * a guess into somebody's config.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * The codex home a process is running against.
 *
 * ⚠️ `CODEX_HOME` is what codex itself reads, and it is what the supervisor puts
 * in a codex agent's environment. The test seam is separate so a suite can point
 * this somewhere harmless without touching the variable codex obeys.
 */
function defaultHome() {
  return process.env.AGENT_WORKFORCE_CODEX_HOME
    || process.env.CODEX_HOME
    || path.join(process.env.AGENT_WORKFORCE_HOME || os.homedir(), '.codex');
}

/**
 * Whether an operator has NAMED a codex home, which collapses every OpenAI account
 * to that one home.
 *
 * 🛑 ONE DERIVATION, CALLED RATHER THAN RESTATED, for the same reason `defaultHome()`
 * is (#1337): a second copy of this rule can disagree with the first, and #1488 is
 * exactly that disagreement - `engine/create.js` collapsed to the override while the
 * page built its picker from the unfiltered list, so every other row was an offer the
 * engine could only refuse.
 *
 * ⚠️ NOT the same question as `defaultHome()`. That one always answers; this one asks
 * whether the answer came from AGENT_WORKFORCE_CODEX_HOME specifically. Plain
 * `CODEX_HOME` does NOT collapse the list, which is why this cannot be written as
 * "did defaultHome differ from the fallback".
 */
function homeIsNamed() {
  return typeof process.env.AGENT_WORKFORCE_CODEX_HOME === 'string'
    && process.env.AGENT_WORKFORCE_CODEX_HOME !== '';
}

/**
 * Mark the current version as dismissed, so the notice renders as a banner
 * rather than a prompt. Returns whether anything changed.
 */
function dismissUpdateNotice(home) {
  const file = path.join(home || defaultHome(), 'version.json');
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return false; }
  const latest = parsed && typeof parsed.latest_version === 'string' ? parsed.latest_version : null;
  if (!latest || parsed.dismissed_version === latest) return false;
  parsed.dismissed_version = latest;
  /* ⚠️ Rewritten whole rather than patched, but from the PARSED object, so every
     field codex put there survives. version.json is codex's file, not ours, and
     dropping something it relies on would be a worse bug than the prompt. */
  try { fs.writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`); } catch { return false; }
  return true;
}

/* kosmos#8597: Codex's model-migration menu at launch.
 *
 *     GPT-5.4 is no longer available ... › 1. Try new model   2. Use existing model
 *
 * Codex opens it when the agent's model has an `upgrade` target in the catalog in effect. Nothing answers it, so the
 * first line the board types lands in it and its Enter picks "1. Try new model", switching the agent's model. When a
 * person picks "2. Use existing model", Codex records `[notice.model_migrations] "<model>" = "<target>"` in config.toml
 * and does not ask again. Writing that same entry at launch keeps the agent on the model it was given.
 *
 * Measured on codex-cli 0.149.1 (bundled catalog: gpt-5.4 -> gpt-5.6-terra), update notice dismissed:
 *   no entry -> the menu; an entry naming another target -> the menu; the catalog's own target -> no menu, the
 *   agent stays on gpt-5.4. So the target must be the catalog's, never a guess.
 *
 * The catalog in effect: the account's fetched one (<home>/models_cache.json) when it lists the model, else the one
 * the binary ships (`codex debug models --bundled`, about 0.05 s, read only when the cache does not answer).
 */
const SLUG = /^[A-Za-z0-9._:-]{1,100}$/;   // a model id we will put in a TOML quoted key and string, with nothing to escape

function upgradeIn(catalog, model) {
  const list = catalog && Array.isArray(catalog.models) ? catalog.models : null;
  if (!list) return undefined;
  const m = list.find((x) => x && x.slug === model);
  if (!m) return undefined;   // this catalog does not know the model: ask the next one
  const to = m.upgrade && typeof m.upgrade.model === 'string' ? m.upgrade.model : null;
  return to && SLUG.test(to) && to !== model ? to : null;
}

/* The model the agent runs: the one it is launched with, else config.toml's top-level `model`. */
function configModel(text) {
  for (const line of String(text).split('\n')) {
    if (/^\s*\[/.test(line)) break;   // the first table: top-level keys are above it
    const m = /^\s*model\s*=\s*(?:"([^"\\]*)"|'([^']*)')\s*(#.*)?$/.exec(line);
    if (m) return m[1] !== undefined ? m[1] : m[2];
  }
  return null;
}

const BUNDLED_MS = 3000;
/* The shipped catalog, or null. Its own process group, killed whole at BUNDLED_MS: an npm codex is a node shim that
   spawns the native binary, and a grandchild holding the pipe must not hold the launch. */
function bundledCatalog(home, codexBin, ms = BUNDLED_MS) {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    let child;
    try {
      const env = { ...process.env, CODEX_HOME: home, PATH: [path.dirname(process.execPath), process.env.PATH || ''].join(path.delimiter) };
      child = require('node:child_process').spawn(codexBin, ['debug', 'models', '--bundled'], { env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { resolve(null); return; }
    const timer = setTimeout(() => {
      try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* gone */ }
      finish(null);
    }, ms);
    child.on('error', () => finish(null));
    child.stdout.on('data', (b) => { out += b; if (out.length > 8 * 1024 * 1024) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } finish(null); } });
    child.on('close', (code) => { try { finish(code === 0 ? JSON.parse(out) : null); } catch { finish(null); } });
  });
}

async function migrationTarget(home, model, codexBin, ms) {
  let cached;
  try { cached = upgradeIn(JSON.parse(fs.readFileSync(path.join(home, 'models_cache.json'), 'utf8')), model); } catch { cached = undefined; }
  if (cached !== undefined) return cached;
  if (!codexBin) return null;
  return upgradeIn(await bundledCatalog(home, codexBin, ms), model) || null;
}

/* The config text with `"<model>" = "<to>"` in [notice.model_migrations], or null when it is already there or the file
   is a shape this does not edit (any other mention of model_migrations, e.g. an inline table, where a second
   definition would make the whole file unreadable to Codex). */
function withMigration(text, model, to) {
  if (String(text).includes('\r')) return null;   // CRLF: not a file this edits line by line
  const lines = String(text).split('\n');
  const header = lines.findIndex((l) => /^\s*\[notice\.model_migrations\]\s*(#.*)?$/.test(l));
  const mentions = lines.filter((l) => l.includes('model_migrations')).length;
  if (mentions > (header >= 0 ? 1 : 0)) return null;
  if (lines.some((l) => /^\s*notice\s*=/.test(l))) return null;   // an inline notice table: a [notice.*] heading would redefine it
  const entry = '"' + model + '" = "' + to + '"';
  const keyRe = new RegExp('^\\s*"' + model.replace(/[.]/g, '\\.') + '"\\s*=');
  if (header < 0) {
    const body = String(text);
    return body + (body === '' || body.endsWith('\n') ? '' : '\n') + '\n[notice.model_migrations]\n' + entry + '\n';
  }
  let end = lines.length;
  for (let i = header + 1; i < lines.length; i += 1) if (/^\s*\[/.test(lines[i])) { end = i; break; }
  const otherForm = new RegExp("^\\s*('" + model.replace(/[.]/g, '\\.') + "'|" + model.replace(/[.]/g, '\\.') + ')\\s*=');
  for (let i = header + 1; i < end; i += 1) {
    if (otherForm.test(lines[i])) return null;   // a literal-string or bare (dotted) key: not ours to rewrite
    if (keyRe.test(lines[i])) {
      if (lines[i].trim() === entry) return null;
      lines[i] = entry;
      return lines.join('\n');
    }
  }
  lines.splice(header + 1, 0, entry);
  return lines.join('\n');
}

/**
 * Keep a codex agent on its model by answering the migration menu ahead of time. `model` is the -m it is launched
 * with (empty: config.toml's model). Resolves whether config.toml changed. Never rejects; any doubt declines.
 */
async function pinModelMigration(home, model, codexBin, opts = {}) {
  try {
    const h = home || defaultHome();
    const file = path.join(h, 'config.toml');
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (!e || e.code !== 'ENOENT') return false; }
    const m = model || configModel(text);
    if (!m || !SLUG.test(m)) return false;
    const to = await migrationTarget(h, m, codexBin, opts.bundledMs);
    if (!to) return false;
    /* Under the lock the folder-trust and hook writers take on this file, re-read inside it, and saved the way
       forgetCodexFolder saves it (securewrite, atomic only, own temps only), keeping the file's mode (0600 when new). */
    const locked = require('./filelock').withFileLock(file, () => {
      let now = '';
      let mode = 0o600;
      try { now = fs.readFileSync(file, 'utf8'); mode = fs.statSync(file).mode & 0o777; } catch (e) { if (!e || e.code !== 'ENOENT') return false; }
      const next = withMigration(now, m, to);
      if (next === null) return false;
      require('./securewrite').writeSecret(file, next, mode, { atomicOnly: true, ownTempsOnly: true });
      return true;
    });
    return Boolean(locked && locked.ok && locked.value);
  } catch { return false; }
}

module.exports = { dismissUpdateNotice, defaultHome, homeIsNamed, pinModelMigration, migrationTarget, withMigration, configModel, bundledCatalog };
