'use strict';
/**
 * #5948 step 2: an account an agent is set up to use stays listed when its sign-in or key is gone.
 *
 * The keyed account lists (openaiaccounts, geminiaccounts, grokaccounts) list a folder only when it holds a credential
 * (a key file, or a sign-in file), so an account whose sign-in lapsed and took its file with it was not shown as signed
 * out: it vanished, from Settings > AI Models and from `kosmos accounts`. This adds one row per such folder, built from
 * the agents' own jobs: a NAMED account folder (job.configDir) that an agent of that provider uses and that no listed
 * row of that provider names. The provider's DEFAULT folder is not looked at, whether a job names it or names none: a
 * default account can run on this computer's own key from the environment, so a missing file there proves nothing.
 *
 * Pure: the cards, the listed rows, and the two readers are passed in.
 */

const path = require('node:path');

/* `files`: the credential files each provider's list reads in an account folder. One of them still there means the
   list left the folder out because it could not read or recognise it, not because the credential is gone. */
const PROVIDER_OF_RUNNER = Object.freeze({
  // `sharedKey`: the variable a launch falls back to when the folder's own key is missing (the secrets/env door).
  codex: { provider: 'openai', providerName: 'OpenAI', prefix: '.codex-', files: ['auth.json'], sharedKey: null },
  gemini: { provider: 'google', providerName: 'Gemini', prefix: '.gemini-', files: ['.kosmos-gemini-apikey'], sharedKey: 'GEMINI_API_KEY' },
  grok: { provider: 'xai', providerName: 'Grok', prefix: '.grok-', files: ['.kosmos-grok-apikey', 'auth.json'], sharedKey: 'XAI_API_KEY' },
});
const SHOWN_AGENTS = 3;   // a folder many agents share names the first few, then a count

/* Whether a credential file with something in it is there (empty or whitespace-only holds no credential). ENOENT and
   ENOTDIR are "not there"; any other fault (EACCES on a locked folder) throws, so the row reads "not checked", never
   "gone". fs.existsSync would answer false for both. */
function fileThere(file) {
  // Content, not size: a key file holding only whitespace is no key (the launch reads its first line; readKey trims).
  try { return require('node:fs').readFileSync(file, 'utf8').trim() !== ''; } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return false;
    throw e;
  }
}

/* One folder, however it is spelled: a symlinked or differently-cased home names the same folder (best effort). */
function samePlace(d) {
  try { return require('node:fs').realpathSync.native(d); } catch { return path.resolve(d); }
}

/**
 * @param {Array} cards the board's cards ({ sessionName, name, runner })
 * @param {{ openai: Array, google: Array, xai: Array }} listed the rows each provider's list already gives
 * @param {(sessionName: string) => ({ configDir?: string|null } | null)} readJob
 * @param {(provider: string, dir: string) => (string|null)} readName the folder's chosen name, or null
 * @param {(file: string) => boolean} [exists] whether a file is there; throws when that cannot be told
 * @param {(provider: string) => (string|null)} [defaultDirOf] the provider's default folder, which is skipped
 * @param {(envVar: string) => boolean} [hasSharedKey] whether this computer's shared key door holds that variable
 * @returns {Array} rows, one per missing folder: badge 'signed_out' when no credential file is there and no shared key
 *   can stand in, else badge 'unlisted' (a file it could not read, or a shared key it may be running on)
 */
function signedOutRows(cards, listed, readJob, readName, exists = fileThere, defaultDirOf = () => null, hasSharedKey = () => false) {
  const byDir = new Map();
  const listedPlaces = new Map();
  const defaultPlaces = new Map();
  for (const c of Array.isArray(cards) ? cards : []) {
    if (!c || !c.sessionName) continue;
    let job = null;
    try { job = readJob(c.sessionName); } catch { job = null; }
    // The job's runner first: a stopped agent's card has none (status.panelessCard).
    const p = PROVIDER_OF_RUNNER[job ? job.runner : c.runner];   // a job, when there is one, is the authority
    if (!p) continue;
    const dir = job && typeof job.configDir === 'string' && job.configDir ? path.resolve(job.configDir) : null;
    if (!dir) continue;
    if (!defaultPlaces.has(p.provider)) {   // once per provider, like listedPlaces
      let d = null;
      try { d = defaultDirOf(p.provider); } catch { d = null; }
      defaultPlaces.set(p.provider, d ? { dir: path.resolve(d), place: samePlace(d) } : null);
    }
    const dfltRec = defaultPlaces.get(p.provider);
    if (dfltRec && dfltRec.place === samePlace(dir)) continue;
    if (!listedPlaces.has(p.provider)) {   // each provider's listed folders resolved once, not once per card
      const rows = (listed && Array.isArray(listed[p.provider])) ? listed[p.provider] : [];
      listedPlaces.set(p.provider, new Set(rows.filter((r) => r && typeof r.dir === 'string').map((r) => samePlace(r.dir))));
    }
    const here = samePlace(dir);
    if (listedPlaces.get(p.provider).has(here)) continue;
    const key = p.provider + '\u0000' + here;   // one row per folder, however its jobs spell it
    if (!byDir.has(key)) {
      let name = null;
      try { name = readName(p.provider, dir); } catch { name = null; }
      const base = path.basename(dir);
      let unreadable = false;
      // A look that fails counts as "there but unreadable": "could not be checked", never a confident "gone".
      let folderUnsure = false;   // the look itself failed: nobody saw a file, so the words must not say one is there
      try { unreadable = p.files.some((f) => exists(path.join(dir, f))); } catch { unreadable = true; folderUnsure = true; }
      byDir.set(key, {
        provider: p.provider, providerName: p.providerName, dir,
        label: base.startsWith(p.prefix) ? base.slice(p.prefix.length) : base,
        name: name || null, isDefault: false, email: null, authMode: null, keyTail: null,
        signedOut: false, unreadable, folderUnsure, sharedKey: false, sharedKeyUnsure: false, usedBy: [],
      });
      const row = byDir.get(key);
      if (!unreadable && p.sharedKey) {
        // A door that cannot be read is unsure: never "gone", and never said to hold a key nobody saw.
        try { row.sharedKey = hasSharedKey(p.sharedKey) === true; } catch { row.sharedKey = true; row.sharedKeyUnsure = true; }
      }
      row.signedOut = !row.unreadable && !row.sharedKey;
    }
    byDir.get(key).usedBy.push(c.name || c.sessionName);
  }
  return [...byDir.values()].map((r) => {
    const shown = r.usedBy.slice(0, SHOWN_AGENTS).join(', ')
      + (r.usedBy.length > SHOWN_AGENTS ? ' and ' + (r.usedBy.length - SHOWN_AGENTS) + ' more' : '');
    const who = shown + (r.usedBy.length === 1 ? ' uses' : ' use') + ' it';
    const fix = ' To fix it, add the key or sign in again in Settings > AI Models.';
    return {
      ...r,
      connection: r.folderUnsure
        ? { state: 'unknown', badge: 'unlisted', because: 'Kosmos could not look in its folder, and ' + who + '.' }
        : r.unreadable
          ? { state: 'unknown', badge: 'unlisted', because: 'a sign-in or key file is in its folder, but Kosmos could not read it or does not look in that folder, and ' + who + '.' }
          : r.sharedKeyUnsure
            ? { state: 'unknown', badge: 'unlisted', because: 'its own sign-in or key is gone from its folder, Kosmos could not read this computer\'s shared ' + r.providerName + ' key to tell whether one stands in, and ' + who + '.' }
            : r.sharedKey
              ? { state: 'unknown', badge: 'unlisted', because: 'its own sign-in or key is gone from its folder, but this computer\'s shared ' + r.providerName + ' key can stand in for it, and ' + who + '.' + fix }
              : { state: 'none', badge: 'signed_out', because: 'its sign-in or key is no longer on this computer, and ' + who + '.' + fix },
    };
  });
}

module.exports = { signedOutRows, PROVIDER_OF_RUNNER, fileThere };
