'use strict';

/**
 * Refuse to drive a board that is not a fixture (#1156).
 *
 * 🛑 TEN CHECKS IN THIS DIRECTORY POST. ONLY FIVE ARE THE HAZARD, AND THE
 * DIFFERENCE IS WHERE THE BOARD COMES FROM, NOT WHETHER THEY WRITE:
 *
 *   take a board as `argv[2]`   5   they POST to whatever you point them at
 *   self-boot a sandbox         5   they start the server and set no data root
 *                                   in their own environment, so they were never
 *                                   dangerous and guarding them would refuse a
 *                                   check that had nothing wrong with it
 *
 * `render-accounts-openai.js` POSTs `/api/first-run/complete`; `render-projects.js`
 * creates projects; `render-consolidated-layouts.js` changes style. **A command
 * that reads like a test can change a running system**, and the obvious move when
 * a bare invocation fails with `fetch failed` is to hand it your own board's URL.
 *
 * ⚠️ THE HAZARD IS LIVE RATHER THAN THEORETICAL. Guidance circulates that
 * `NODE_PATH=~/work/pw-runtime/node_modules` runs these from an ordinary
 * session. That is true and it is half the picture: it removes the playwright
 * barrier and leaves the board barrier standing, so the failure a person meets
 * first is the one that invites them to point the check somewhere real.
 *
 * 🔑 THE DISCRIMINATOR IS NOT INVENTED HERE. `engine/status.js` already decides
 * "am I a fixture" by asking whether `AGENT_WORKFORCE_DATA` sits under a temp
 * root, and it carries two corrections that cost measurements to find:
 *   - `/tmp` is NOT `os.tmpdir()` on macOS, so both roots count.
 *   - `/var` is a symlink to `/private/var`, so BOTH sides need resolving or the
 *     guard silently stops firing, which looks exactly like nothing to catch.
 * This file reuses that shape rather than reimplementing it, because a second
 * copy would drift and the drift would be invisible.
 *
 * ⭐ IT REFUSES, IT DOES NOT THROW. Angel measured the difference on the same
 * discriminator: the throwing version failed 161 tests while running 137 FEWER,
 * because an error takes a whole file down and the unasked questions vanish from
 * both columns. A refusal prints why and exits non-zero on its own terms.
 */
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

/** Temp roots, both spellings, both sides resolved. Mirrors engine/status.js. */
function tmpRoots() {
  const roots = [];
  for (const d of [os.tmpdir(), '/tmp']) {
    const r = path.resolve(d);
    roots.push(r);
    try {
      const rp = fs.realpathSync(d);
      if (rp !== r) roots.push(rp);
    } catch { /* absent is fine */ }
  }
  return roots;
}

/** Is this path inside a temp root, with the candidate resolved too? */
function underTmp(d) {
  if (!d) return false;
  const roots = tmpRoots();
  const cands = [path.resolve(d)];
  try {
    cands.push(path.join(fs.realpathSync(path.dirname(d)), path.basename(d)));
  } catch { /* the parent may not exist yet */ }
  return cands.some((c) => roots.some((t) => c === t || c.startsWith(t + path.sep)));
}

/**
 * Call this before the first POST in any check that mutates.
 *
 * Returns nothing on success. On refusal it prints the reason and exits 2, which
 * is distinguishable from a check's own `die()` (exit 1) so a runner can tell
 * "declined to run" from "found a defect".
 *
 * @param {string} name  the check's filename, for the message
 */
function requireSandbox(name) {
  const data = process.env.AGENT_WORKFORCE_DATA;
  if (underTmp(data)) return;

  /* 🔑 The message names the THREE things a reader needs: what was refused, why,
     and the one command that fixes it. A refusal that says only "refused" gets
     worked around rather than understood. */
  const where = data ? data : '(unset)';
  process.stderr.write(
    `REFUSED  ${name} sends POST requests and its data root is not a sandbox.\n`
    + `         AGENT_WORKFORCE_DATA = ${where}\n`
    + `         This check creates or completes things on whatever board it is\n`
    + `         pointed at. Run it through tools/browser-checks.sh, which boots a\n`
    + `         sandboxed board, or set AGENT_WORKFORCE_DATA to a fresh temp dir.\n`
    + `         It has NOT been run and nothing was changed.\n`,
  );
  process.exit(2);
}

module.exports = { requireSandbox, underTmp };
