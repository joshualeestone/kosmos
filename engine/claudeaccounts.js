'use strict';
/**
 * kosmos#2420 -- connect a Claude account by a pasted ANTHROPIC_API_KEY.
 *
 * Why this exists, and why it is a NEW module rather than a branch in connect.js:
 * Claude Code's interactive login chooser has NO paste-a-raw-key option -- its two
 * choices are both OAuth account logins ("Claude account with subscription" and
 * "Anthropic Console account"). Per `claude --help`, the raw-key path is "strictly
 * ANTHROPIC_API_KEY or apiKeyHelper via --settings" -- a settings/env config, not a
 * chooser step. So a Claude API-key account is configured, not driven through the TUI,
 * and that is what this module does.
 *
 * 🔑 THE SAME DISCIPLINE AS engine/openaiaccounts.js, applied to Anthropic:
 *  - VALIDATE LIVE before an add stands (#1315): a fabricated/typo'd key must be
 *    refused at ENTRY, not accepted and shown not-connected later on the badge.
 *  - THE ASYMMETRY: only a POSITIVE rejection (Anthropic's own authentication_error
 *    on a 401) is NONE; unreachable / a non-confirming refusal is UNKNOWN, never a
 *    guessed NONE that blocks a good key. Mirrors openaiaccounts.checkLive exactly.
 *  - OWN FETCHER SEAM (setFetcher), per the per-module convention this codebase keeps
 *    for every external-I/O boundary (tokendoor.js, subscription.js, openaiaccounts.js).
 *  - NEVER RETURN THE KEY. addWithKeyLive returns a row; the raw key is written only
 *    to a mode-600 file the account's Claude Code reads via apiKeyHelper.
 *
 * 🛑 WHERE THE KEY LIVES, and why NOT the agent secrets map. OpenAI's user key lands
 * in codex's OWN per-account store (~/.codex/auth.json), never the ~/.config/secrets
 * agent-operating-credential map. This mirrors that: the raw key is a mode-600 file
 * inside the account's own config dir, and settings.json carries only the apiKeyHelper
 * COMMAND that reads it -- so the key is never in settings.json and never in git, but it
 * is also not conflated with the agent secrets map (which is agent-scoped, not
 * per-Kosmos-account). "Keep the raw key out of any committed/settings file" (Splinter)
 * is satisfied by the pointer-not-the-key split.
 */

const fs = require('node:fs');
const path = require('node:path');
const subscription = require('./subscription'); // the shared STATE enum the badge speaks

const STATE = subscription.STATE; // CONNECTED | NONE | UNKNOWN -- one vocabulary, never a second

// The mode-600 file, inside the account's own config dir, that holds the raw key.
// A dotfile so it does not read as project content; 0600 so only the owner can read it.
const KEY_BASENAME = '.kosmos-claude-apikey';
function keyFile(dir) { return path.join(String(dir || ''), KEY_BASENAME); }

/**
 * A shape complaint about a pasted key, or null if it looks usable. Mirrors
 * openaiaccounts.keyProblem, plus the Anthropic-specific `sk-ant-` prefix as a
 * SOFT hint (a warning-shaped refusal only when it is clearly not a key), because
 * the LIVE check is the real gate -- a shape check must never be the thing that
 * blocks a valid key whose prefix Anthropic later changes.
 */
function keyProblem(key) {
  const k = String(key == null ? '' : key).trim();
  if (!k) return 'paste the key first';
  if (/\s/.test(k)) return 'that does not look like a key: a key has no spaces or line breaks in it';
  if (k.length < 20) return 'that is too short to be a key';
  return null;
}

/* Own fetcher seam (tests), per the per-module convention. */
let fetcher = null;
function setFetcher(fn) { fetcher = typeof fn === 'function' ? fn : null; }

/**
 * Ask Anthropic whether this key works: GET /v1/models, the cheap verification call.
 * 200 = works; 401 authentication_error = positively rejected; anything else /
 * unreachable = we could not confirm. `anthropic-version` is REQUIRED by the API
 * (a call without it is a 400, which is NOT a key verdict), so it is always sent.
 * The URL is overridable for the browser-check harness (a real server process the
 * setFetcher seam cannot reach), exactly like openaiaccounts' models URL.
 */
async function askModels(key) {
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
  const url = process.env.AGENT_WORKFORCE_ANTHROPIC_MODELS_URL || 'https://api.anthropic.com/v1/models';
  try {
    return await f(url, {
      method: 'GET',
      headers: { 'x-api-key': String(key || ''), 'anthropic-version': '2023-06-01' },
    });
  } catch {
    // NO raw err.message: same rule as subscription.js/openaiaccounts -- a network
    // error can carry anything, and this module's job is sentences a person can read.
    return { status: 0, body: null, unreachable: true, because: 'we could not reach Anthropic to check whether this key still works' };
  }
}

/**
 * The live verdict for a raw key. Same asymmetry as openaiaccounts.checkLive:
 * only Anthropic's own authentication_error (a 401 the API positively attributes
 * to a bad key) is NONE; a 200 is CONNECTED; unreachable or any other refusal is
 * UNKNOWN -- we asked and could not confirm the key is bad, so we never guess NONE.
 */
async function validateLive(key) {
  const r = await askModels(key);
  if (r.unreachable) return { state: STATE.UNKNOWN, because: r.because };
  if (r.status === 200) return { state: STATE.CONNECTED, because: 'Anthropic confirmed this key works' };
  if (r.status === 401 || r.status === 403) {
    const type = r.body && r.body.error && typeof r.body.error.type === 'string' ? r.body.error.type : null;
    if (type === 'authentication_error') return { state: STATE.NONE, because: 'Anthropic did not accept this key' };
    return { state: STATE.UNKNOWN, because: 'Anthropic refused to check this key in a way that does not confirm the key itself is bad' };
  }
  return { state: STATE.UNKNOWN, because: 'we asked Anthropic whether this key still works and it answered ' + (r.status || 'nothing usable') };
}

/**
 * checkLive for a stored api-key Claude account: read the key file and verify it.
 * ABSENT vs UNREADABLE are two different facts, the same split openaiaccounts.checkLive
 * keeps: no key file is a positive NONE (nobody configured a key here); a file that
 * cannot be read is UNKNOWN (we genuinely cannot tell), never a guessed NONE.
 */
async function checkLive(dir) {
  let key;
  try { key = fs.readFileSync(keyFile(dir), 'utf8'); }
  catch (e) {
    if (e && e.code === 'ENOENT') return { state: STATE.NONE, checkedLive: true, because: 'no API key is stored for this account' };
    return { state: STATE.UNKNOWN, checkedLive: true, because: 'we could not read this account\'s stored key to check it' };
  }
  const trimmed = String(key).trim();
  if (!trimmed) return { state: STATE.UNKNOWN, checkedLive: true, because: 'this account\'s stored key is empty' };
  const live = await validateLive(trimmed);
  return { ...live, checkedLive: true };
}

/**
 * Write the raw key to the account's mode-600 file. Atomic (temp + rename) and
 * WITHOUT a trailing newline, so `apiKeyHelper` (which cats it) hands Claude Code
 * exactly the key. 0600 at create, and re-chmod'd on an overwrite in case an
 * earlier write left it looser.
 */
function storeKey(dir, key) {
  const file = keyFile(dir);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, String(key || '').trim(), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* best effort; create mode already set */ }
}

function readKey(dir) {
  try { return fs.readFileSync(keyFile(dir), 'utf8').trim() || null; } catch { return null; }
}

function forgetKey(dir) {
  try { fs.rmSync(keyFile(dir), { force: true }); return true; } catch { return false; }
}

/**
 * The apiKeyHelper command string for an account's settings.json. It cats the
 * mode-600 key file, so settings.json carries this POINTER and never the key.
 * The path is quoted so a space in a config dir cannot split the command.
 */
function apiKeyHelperCommand(dir) {
  return 'cat "' + keyFile(dir) + '"';
}

/**
 * Merge `apiKeyHelper` into the account's settings.json, never clobbering the
 * other settings (the same read-merge-write, atomic, mode-preserving discipline
 * engine/reporthook.js's ensureWired keeps). Returns {wired:true} on success.
 * A settings.json that is not a JSON object is replaced with a fresh one carrying
 * only apiKeyHelper -- the file was unusable to Claude Code anyway.
 */
function wireApiKeyHelper(settingsPath, dir) {
  let obj = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) obj = parsed;
  } catch { /* absent or unusable: start from {} */ }
  obj.apiKeyHelper = apiKeyHelperCommand(dir);
  const tmp = settingsPath + '.tmp';
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, settingsPath);
  return { wired: true };
}

/**
 * Remove the apiKeyHelper entry from settings.json (leaving every other setting).
 * The inverse half of wireApiKeyHelper, so forget() takes back exactly what add wrote.
 */
function unwireApiKeyHelper(settingsPath) {
  let obj;
  try { obj = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); }
  catch { return { unwired: false }; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || !('apiKeyHelper' in obj)) return { unwired: false };
  delete obj.apiKeyHelper;
  const tmp = settingsPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, settingsPath);
  return { unwired: true };
}

module.exports = {
  STATE, KEY_BASENAME, keyFile, keyProblem, setFetcher, askModels, validateLive,
  checkLive, storeKey, readKey, forgetKey, apiKeyHelperCommand, wireApiKeyHelper, unwireApiKeyHelper,
};
