'use strict';
/**
 * #3013: the board-card diagnosis for a Windows agent stuck at Claude Code's
 * invisible workspace-trust prompt.
 *
 * 🛑 WHY THIS EXISTS. #2281 built the two halves the diagnosis needs and wired
 * them into the SUPERVISOR's task log, but the BOARD could not say anything useful
 * about such an agent:
 *   - the DETECTOR (engine/win32trustwait): a lone `<pid>.<hash>.key` with no
 *     `<pid>.json`, older than a grace, is a session that started and never
 *     registered;
 *   - the CLASSIFICATION (engine/trust.folderTrusted): is the agent's folder
 *     recorded trusted in the config it actually reads? -- the positive signal that
 *     separates a trust-dialog hang from a slow-but-healthy start.
 * A stuck agent never registers, so it has no live pane and no `win32sessions`
 * ownership record (that record is keyed on the sessionId `claude agents --json`
 * reports). `register.survey()` still lists it (its Scheduled Task exists), so the
 * board's OFFLINE builder renders it -- but as a misleading generic "Not running" /
 * "Can't tell". This module turns that offline row into the accurate "waiting at a
 * workspace-trust prompt" diagnosis.
 *
 * 🔑 IT RE-DETECTS NOTHING (the #3013 scope's hard rule). The stuck-session
 * detector is win32trustwait; the trust classification is trust.folderTrusted --
 * the exact two the supervisor composes (engine/win32supervisor.js:704-728).
 *
 * 🔑 PER AGENT, AND IT ADDS NO PROCESS SPAWN TO THE 5s POLL (#2717). The CALLER
 * (server.js's offline builder) already owns the fleet-level facts and fetched them
 * once this poll: which agents have a Scheduled Task (register.survey ->
 * win32job.list, one fleet query), which are LIVE (the pane roster it already has),
 * and which are switched off (create.disabledJobs, one fleet query). So this
 * function is handed ONE already-selected candidate -- an owned, enabled agent with
 * no live session -- and only does the per-agent trust classification. Its ONE
 * task read goes through `win32job.cachedTaskSpec` (the #2717 cache the poll path
 * was built around, already warmed for this agent by accountOf/runnerOfCard in the
 * same offline row), NEVER the uncached `taskEnabled` + raw `taskSpec` (two spawns
 * of identical XML per agent per poll -- the regression this shape avoids). It runs
 * no `claude agents --json` of its own: liveness was decided by the caller. The
 * remaining reads are a config-file read (folderTrusted) and a sessions-dir read
 * (win32trustwait) -- no processes.
 *
 * ⚠️ ACCOUNT-LEVEL ATTRIBUTION IS A KNOWN LIMIT (documented, not a bug). The
 * detector (win32trustwait.dirWaiting) scans the ACCOUNT's sessions dir, which
 * several agents can share (especially the default account). So a still-starting
 * agent Y whose folder is untrusted can be flagged off agent X's older lone `.key`,
 * bypassing Y's own grace. It stays DIRECTIONALLY correct -- Y is flagged only when
 * Y's OWN folder is untrusted, i.e. Y would hang too -- but the "started but never
 * registered" wording can overstate a Y that is merely slow. True per-agent
 * attribution needs the child pid, which the board does not have for an agent that
 * never registered (the pid is the supervisor's own child). Called out in the PR's
 * known-limits.
 *
 * 🛑 FAIL-CLOSED: any read it cannot make answers "no diagnosis" (null), never a
 * wrong "stuck" -- a false positive tells a person an agent is broken when it is
 * fine. Trusted (folderTrusted === true) is a healthy slow start; only false or a
 * config we could not read (null) continue, and null still needs the detector.
 */

/* How long a lone `.key` must sit unregistered before the board treats it as
   stuck rather than still-starting. Set to match the supervisor's own
   registration grace (engine/win32supervisor.js REGISTRATION_GRACE_MS, 90s) so the
   two surfaces agree on when "not yet registered" becomes "stuck"; kept as this
   module's own constant rather than imported so a board poll never pulls the
   supervisor's whole module tree. */
const REGISTRATION_GRACE_MS = 90 * 1000;

/* The two wordings, keyed off the POSITIVE signal exactly as the supervisor keys
   its task-log line: the strong claim only on an explicit untrusted folder; the
   hedged one when the config could not be read (null) but a started-but-
   unregistered session is nonetheless sitting in the account's dir. */
const BECAUSE_UNTRUSTED = 'it started but never registered -- its folder is not recorded as trusted in the config it runs under, so it is waiting at a workspace-trust prompt no one can see';
const BECAUSE_HEDGED = 'it started but never registered -- it is most likely waiting at a workspace-trust prompt no one can see';

/**
 * Is this known-owned, enabled, not-live agent waiting at the workspace-trust
 * prompt -- and if so, why?
 *
 * @param {string} name the agent's name. The caller has already established it has
 *   a Scheduled Task, is enabled, and has no live session this poll.
 * @param {object} [opts] all seams injectable so a test never shells schtasks,
 *   reads a real sessions dir, or touches trust config.
 * @param {object} [opts.job] the win32job module (uses cachedTaskSpec ONLY).
 * @param {(cwd: string, configDir: string|null) => (true|false|null)} [opts.trustCheck]
 *   the classification (default trust.folderTrusted with the agent's account).
 * @param {(configDir: string|null) => boolean} [opts.detect] the detector (default
 *   win32trustwait.dirWaiting past the grace).
 * @returns {{because: string} | null} the diagnosis, or null for "not waiting /
 *   cannot tell". Never throws.
 */
function diagnose(name, opts) {
  const o = opts || {};
  const job = o.job || require('./win32job');
  const trustCheck = typeof o.trustCheck === 'function' ? o.trustCheck
    : (cwd, configDir) => require('./trust').folderTrusted(cwd, { configDir: configDir || null, agentDefaultAccount: !configDir });
  const detect = typeof o.detect === 'function' ? o.detect
    : (configDir) => require('./win32trustwait').dirWaiting(configDir, { olderThanMs: REGISTRATION_GRACE_MS });

  // The agent's own cwd + account config dir, from the #2717 CACHE (no per-poll
  // spawn). Its enabled state and live state were decided by the caller.
  let read;
  try { read = job.cachedTaskSpec(name); } catch { return null; }
  if (!read || !read.known || !read.registered || !read.spec) return null;
  const cwd = read.spec.cwd;
  const configDir = read.spec.configDir || null;

  // THE CLASSIFICATION (the supervisor's positive signal). Trusted -> a healthy
  // slow start, not a trust hang.
  let trusted;
  try { trusted = trustCheck(cwd, configDir); } catch { trusted = null; }
  if (trusted === true) return null;

  // THE DETECTOR (#2281). No started-but-unregistered session in the account's
  // dir -> no claim, however untrusted the folder looks.
  let detected;
  try { detected = detect(configDir); } catch { detected = false; }
  if (!detected) return null;

  return { because: trusted === false ? BECAUSE_UNTRUSTED : BECAUSE_HEDGED };
}

module.exports = { diagnose };
