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

module.exports = { dismissUpdateNotice, defaultHome };
