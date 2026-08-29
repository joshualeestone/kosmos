'use strict';
/**
 * A temp directory that removes itself when the test process exits.
 *
 * 🛑 WHY THIS EXISTS (#1402). Test fixtures create temp directories and most do
 * not remove them. Measured on this machine: 215 `mkdtempSync` sites across the
 * suite, and seven families sitting on disk right now with nobody's name on
 * them, including 12 `aw-srv-launch-*` from roughly fifteen suite runs today.
 *
 * ⭐ AND THE SIZE IS NOT THE POINT. Renet's framing on the card is the better
 * one: *"it is the kind of litter that makes somebody think agents exist."*
 * These fixtures hold plists and look like real agent state, so a person or a
 * script auditing the machine draws a wrong conclusion. **That is the same class
 * as the phantom-agent confusion the fixtures were built to test.**
 *
 * 🔑 A SWEEP REMOVES TODAY'S LITTER. A FIXTURE THAT CLEANS UP REMOVES EVERY
 * FUTURE DAY'S. That is why this is the fix and the sweep is not: it removes the
 * dependency rather than policing it.
 *
 * ⚠️ AND A PATTERN SWEEP IS ACTIVELY UNSAFE, which is the other half of the
 * card: `server.test.js` creates one `aw-srv-launch-*` per run and several
 * agents run that file, so deleting by pattern would take out a run that is
 * currently in flight. **Cleanup belongs to the process that made the
 * directory**, which is the only thing that knows when it is finished.
 *
 * ## Why `process.on('exit')` rather than `test.after`
 *
 * Node's test runner gives each FILE its own process, so one exit handler covers
 * everything that file made, including dirs created at MODULE SCOPE before any
 * test runs. **Module-scope is exactly where the leaks are**: `server.test.js`
 * line 125 assigns one to `process.env.AGENT_WORKFORCE_LAUNCH` before the first
 * `test()`, and a `test.after` in that file has never removed it.
 *
 * ⚠️ AND IT MUST NEVER THROW. A cleanup failure at exit would turn a green suite
 * red for a reason that has nothing to do with the code under test, so every
 * removal is wrapped and the handler is registered once.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const made = [];
let armed = false;

function sweep() {
  for (const d of made.splice(0)) {
    /* Individually wrapped: one undeletable directory must not strand the rest. */
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* exiting anyway */ }
  }
}

/**
 * Make a temp directory that will be removed when this process exits.
 *
 * Same signature and same return as `fs.mkdtempSync(path.join(os.tmpdir(), p))`,
 * so a call site converts by swapping the expression and nothing else.
 */
function mkTemp(prefix) {
  if (!armed) {
    armed = true;
    /* `exit` only: it is the one event guaranteed for a normal finish, and its
       handler must be synchronous, which `rmSync` is. */
    process.on('exit', sweep);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
}

/** What is currently registered, so a test can assert the registration itself. */
function registered() { return made.slice(); }

module.exports = { mkTemp, registered, sweep };
