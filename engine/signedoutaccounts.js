'use strict';
/**
 * #5948 step 2: an account an agent is set up to use stays listed when its sign-in or key is gone.
 *
 * The keyed account lists (openaiaccounts, geminiaccounts, grokaccounts) list a folder only when it holds a credential
 * (a key file, or a sign-in file), so an account whose sign-in lapsed and took its file with it was not shown as signed
 * out: it vanished, from Settings > AI Models and from `kosmos accounts`. This adds one row per such folder, built from
 * the agents' own jobs: a NAMED account folder (job.configDir) that an agent of that provider uses and that no listed
 * row of that provider names. A default-account agent (no configDir) is not looked at: its default folder is not listed
 * by design for every keyed provider, so its absence says nothing.
 *
 * Pure: the cards, the listed rows, and the two readers are passed in.
 */

const path = require('node:path');

const PROVIDER_OF_RUNNER = Object.freeze({
  codex: { provider: 'openai', providerName: 'OpenAI', prefix: '.codex-' },
  gemini: { provider: 'google', providerName: 'Gemini', prefix: '.gemini-' },
  grok: { provider: 'xai', providerName: 'Grok', prefix: '.grok-' },
});

/**
 * @param {Array} cards the board's cards ({ sessionName, name, runner })
 * @param {{ openai: Array, google: Array, xai: Array }} listed the rows each provider's list already gives
 * @param {(sessionName: string) => ({ configDir?: string|null } | null)} readJob
 * @param {(provider: string, dir: string) => (string|null)} readName the folder's chosen name, or null
 * @returns {Array} rows, one per missing folder, in the account-row shape with connection state 'none'
 */
function signedOutRows(cards, listed, readJob, readName) {
  const byDir = new Map();
  for (const c of Array.isArray(cards) ? cards : []) {
    if (!c || !c.sessionName) continue;
    let job = null;
    try { job = readJob(c.sessionName); } catch { job = null; }
    // The job's runner first: a stopped agent's card has none (status.panelessCard).
    const p = PROVIDER_OF_RUNNER[(job && job.runner) || c.runner];
    if (!p) continue;
    const dir = job && typeof job.configDir === 'string' && job.configDir ? path.resolve(job.configDir) : null;
    if (!dir) continue;
    const rows = (listed && Array.isArray(listed[p.provider])) ? listed[p.provider] : [];
    if (rows.some((r) => r && typeof r.dir === 'string' && path.resolve(r.dir) === dir)) continue;
    const key = p.provider + '\u0000' + dir;
    if (!byDir.has(key)) {
      let name = null;
      try { name = readName(p.provider, dir); } catch { name = null; }
      const base = path.basename(dir);
      byDir.set(key, {
        provider: p.provider, providerName: p.providerName, dir,
        label: base.startsWith(p.prefix) ? base.slice(p.prefix.length) : base,
        name: name || null, isDefault: false, email: null, authMode: null, keyTail: null,
        signedOut: true, usedBy: [],
      });
    }
    byDir.get(key).usedBy.push(c.name || c.sessionName);
  }
  return [...byDir.values()].map((r) => ({
    ...r,
    connection: {
      state: 'none', badge: 'signed_out',
      because: 'its sign-in or key is no longer on this computer, and ' + r.usedBy.join(', ') + (r.usedBy.length === 1 ? ' uses' : ' use') + ' it',
    },
  }));
}

module.exports = { signedOutRows, PROVIDER_OF_RUNNER };
