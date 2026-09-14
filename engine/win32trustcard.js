'use strict';
/**
 * #3013: the board-card surface for a Windows agent stuck at Claude Code's
 * invisible workspace-trust prompt.
 *
 * 🛑 WHY THIS EXISTS. #2281 built the two halves the diagnostic needs and wired
 * them into the SUPERVISOR's task log, but the BOARD could not show such an agent
 * at all:
 *   - the DETECTOR (engine/win32trustwait): a lone `<pid>.<hash>.key` with no
 *     `<pid>.json`, older than a grace, is a session that started and never
 *     registered;
 *   - the CLASSIFICATION (engine/trust.folderTrusted): is the agent's folder
 *     recorded trusted in the config it actually reads? -- the positive signal that
 *     separates a trust-dialog hang from a slow-but-healthy start.
 * The win32 roster (engine/win32roster) emits a board pane ONLY for a session that
 * is LIVE in `claude agents --json` AND recorded in win32sessions. A stuck agent
 * never registers, so it has no live row and no ownership record (the record is
 * keyed on the sessionId `claude agents --json` reports). It therefore showed as a
 * SILENT EMPTY FLEET -- the exact complaint of #3013. This module is the third
 * win32 roster fact the board needed: a KNOWN-OWNED agent (a registered, enabled
 * Scheduled Task) that is NOT live and whose folder is not trusted, so the card can
 * say "waiting at a workspace-trust prompt" instead of nothing.
 *
 * 🔑 IT RE-DETECTS NOTHING (the #3013 scope's hard rule). The stuck-session
 * detector is win32trustwait; the trust classification is trust.folderTrusted --
 * the exact two the supervisor composes (engine/win32supervisor.js:704-728). This
 * module only asks them about the board's own agents and shapes the answer for the
 * card. The per-agent discriminator is trust.folderTrusted (keyed on the agent's
 * OWN cwd, so it attributes correctly even when several agents share one account's
 * sessions dir); win32trustwait is the account-level corroboration that a
 * started-but-unregistered session is actually sitting there -- the same
 * corroboration-not-discriminator role it plays in the supervisor.
 *
 * 🛑 FAIL-CLOSED, because a false positive here tells a person an agent is broken
 * when it is fine:
 *   1. COULD-NOT-ENUMERATE IS NOT "STUCK". A failed job list (schtasks refused /
 *      unreadable) returns [] -- we make no claim rather than a wrong one.
 *   2. COULD-NOT-SEE-LIVE IS NOT "STUCK". A null `claude agents --json` look
 *      returns [] -- an agent we cannot confirm is live might BE live.
 *   3. ONLY AN ENABLED, REGISTERED TASK. A disabled/stopped agent that is not live
 *      is intentionally off, not stuck.
 *   4. TRUSTED IS NOT STUCK. trust.folderTrusted === true is a healthy slow start;
 *      only an explicit false (untrusted) gets the strong wording, and an unknown
 *      (null) still requires the detector before any claim.
 *   5. NO DETECTOR, NO CLAIM. Without a lone unregistered `.key` in the account's
 *      sessions dir, we say nothing -- the false-zero this whole family refuses.
 */

/* How long a lone `.key` must sit unregistered before the board treats it as
   stuck rather than still-starting. Set to match the supervisor's own
   registration grace (engine/win32supervisor.js REGISTRATION_GRACE_MS, 90s) so the
   two surfaces agree on when "not yet registered" becomes "stuck"; kept as this
   module's own constant rather than imported so a board poll never pulls the
   supervisor's whole module tree. A board caller scans the dir on its own
   schedule, so it owns this grace -- exactly the non-supervisor caller
   win32trustwait's age gate was documented for. */
const REGISTRATION_GRACE_MS = 90 * 1000;

/**
 * The known-owned Windows agents that are waiting at an invisible workspace-trust
 * prompt, for the board card.
 *
 * @param {object} [opts] all seams injectable so a test never shells schtasks,
 *   reads a real sessions dir, or runs `claude agents --json`.
 * @param {object} [opts.job] the win32job module (list / taskEnabled / taskSpec).
 * @param {object} [opts.sessions] the win32sessions ownership record (read / validId).
 * @param {() => (Array|null)} [opts.liveRun] the `claude agents --json` reader
 *   (default win32roster.defaultRun). Ignored when `opts.live` is given.
 * @param {Array|null} [opts.live] an already-fetched live list, so a caller that
 *   already ran `claude agents --json` this poll does not spawn it twice.
 * @param {(cwd: string, configDir: string|null) => (true|false|null)} [opts.trustCheck]
 *   the classification (default trust.folderTrusted with the agent's account).
 * @param {(configDir: string|null) => boolean} [opts.detect] the detector (default
 *   win32trustwait.dirWaiting past the grace).
 * @returns {Array<{name: string, needsTrust: boolean, because: string}>} one per
 *   owned agent judged to be waiting, in job-list order. Never throws.
 */
function waiting(opts) {
  const o = opts || {};
  const job = o.job || require('./win32job');
  const sessions = o.sessions || require('./win32sessions');
  const trustCheck = typeof o.trustCheck === 'function' ? o.trustCheck
    : (cwd, configDir) => require('./trust').folderTrusted(cwd, { configDir: configDir || null, agentDefaultAccount: !configDir });
  const detect = typeof o.detect === 'function' ? o.detect
    : (configDir) => require('./win32trustwait').dirWaiting(configDir, { olderThanMs: REGISTRATION_GRACE_MS });

  // KNOWN-OWNED: every agent with a registered Scheduled Task in THIS Kosmos.
  // Fail closed: a look that could not enumerate makes no claim.
  let jobs;
  try { jobs = job.list(); } catch { return []; }
  if (!jobs || !jobs.known || !jobs.names) return [];

  // LIVE/REGISTERED owned names: the live `claude agents --json` rows whose
  // sessionId is in the ownership record. A null look (could not see what is
  // running) fails closed -- an agent we cannot confirm live might be live.
  let live = Array.isArray(o.live) ? o.live : null;
  if (!live && o.live !== null) {
    const liveRun = typeof o.liveRun === 'function' ? o.liveRun : require('./win32roster').defaultRun;
    try { live = liveRun(); } catch { live = null; }
  }
  if (!Array.isArray(live)) return [];
  let owned;
  try { owned = sessions.read(); } catch { owned = {}; }
  const liveNames = new Set();
  for (const a of live) {
    if (!a || typeof a !== 'object') continue;
    const id = a.sessionId;
    if (!sessions.validId(id)) continue;
    if (!Object.prototype.hasOwnProperty.call(owned, id)) continue;   // not one of ours
    const rec = owned[id] || {};
    if (rec.name) liveNames.add(rec.name);
  }

  const out = [];
  for (const name of jobs.names) {
    if (liveNames.has(name)) continue;   // registered/live -> not stuck

    // Only an ENABLED, registered task is one that is SUPPOSED to be running.
    let en;
    try { en = job.taskEnabled(name); } catch { en = null; }
    if (!en || !en.known || !en.registered || en.enabled !== true) continue;

    // The agent's own cwd + account config dir, from its task definition.
    let read;
    try { read = job.taskSpec(name); } catch { read = null; }
    if (!read || !read.known || !read.registered || !read.spec) continue;
    const cwd = read.spec.cwd;
    const configDir = read.spec.configDir || null;

    // THE CLASSIFICATION (the supervisor's positive signal). Trusted -> a healthy
    // slow start, not a trust hang; skip it. Only false or null continue.
    let trusted;
    try { trusted = trustCheck(cwd, configDir); } catch { trusted = null; }
    if (trusted === true) continue;

    // THE DETECTOR (#2281). No started-but-unregistered session in the account's
    // dir -> no claim, however untrusted the folder looks.
    let detected;
    try { detected = detect(configDir); } catch { detected = false; }
    if (!detected) continue;

    const because = trusted === false
      ? 'it started but never registered -- its folder is not recorded as trusted in the config it runs under, so it is waiting at a workspace-trust prompt no one can see'
      : 'it started but never registered -- it is most likely waiting at a workspace-trust prompt no one can see';
    out.push({ name, needsTrust: trusted === false, because });
  }
  return out;
}

module.exports = { waiting };
