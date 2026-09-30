'use strict';

/**
 * #4796: a CLI test that runs `install/kosmos` against a stub board must give the CLI a temporary data root
 * (AGENT_WORKFORCE_DATA). Without one the CLI reads the real board token from this computer's Kosmos data
 * and sends it to the test's stub (measured on cli.community-read-4373: the token arrived; with a temp root
 * it did not). A test should never hold the person's credential, and #4491 keeps the board token away from
 * agents, who run these suites. This guard is the durable half: a new CLI test that forgets the temp root
 * fails here, by name, instead of quietly sending the token.
 *
 *   node --test cli.sandbox-data-4796.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/** The CLI test files that run the CLI against a stub board of their own. */
function stubBoardCliTests(dir) {
  return fs.readdirSync(dir)
    .filter((f) => /^cli\..*\.test\.js$/.test(f) && f !== path.basename(__filename))
    .filter((f) => {
      const s = fs.readFileSync(path.join(dir, f), 'utf8');
      return /install['"], *['"]kosmos['"]|install\/kosmos/.test(s) && /createServer\(/.test(s);
    });
}

/** Ways a test hands the CLI this computer's own environment (and with it, its data root). */
const INHERIT_RE = /\.\.\.process\.env\b|Object\.assign\(\s*\{\s*\}\s*,\s*process\.env\b|env:\s*process\.env\b/g;
/** A data root of its own, named with a value (an empty one means "unset" to engine/store.js). */
const DATA_RE = /AGENT_WORKFORCE_DATA\s*[:=](?!\s*['"`]{2})/g;   // the space goes inside the lookahead, or backtracking lets '' through
/** A file that sandboxes another way (a fake KOSMOS_HOME store, say) says so, with its reason. */
const MARKER_RE = /#4796-sandbox:\s*\S/;

/** Why a test file could let the CLI read the live board token, or null.
 *  Every place it inherits the parent environment must be matched by a data root of its own; a file that
 *  inherits nothing must build the CLI's environment itself (no env at all means the parent's, by default). */
function leakIn(text) {
  if (MARKER_RE.test(text)) return null;
  const inherits = (text.match(INHERIT_RE) || []).length;
  const roots = (text.match(DATA_RE) || []).length;
  if (inherits > 0) return roots >= inherits ? null : `inherits the parent environment ${inherits} times and names a data root ${roots}`;
  if (!/\benv\s*[:=]/.test(text)) return 'runs the CLI with no environment of its own, so it inherits the parent\'s';
  return null;
}
/** Kept for the control below: whether a file hands the CLI a data root of its own. */
function setsDataRoot(text) { return leakIn(text) === null; }

test('#4796 every CLI test with a stub board gives the CLI its own data root', () => {
  const files = stubBoardCliTests(__dirname);
  assert.ok(files.length >= 10, `premise: the sweep found the stub-board CLI tests (${files.length})`);
  const missing = files.map((f) => [f, leakIn(fs.readFileSync(path.join(__dirname, f), 'utf8'))]).filter(([, why]) => why).map(([f, why]) => `${f}: ${why}`);
  assert.deepEqual(missing, [], 'these CLI tests would send the live board token to their stub board');
});

test('#4796 control: the check can see a file without a data root, in each shape', () => {
  const cli = "http.createServer(() => {});\nexecFile(path.join(__dirname, 'install', 'kosmos'));\n";
  const inh = 'const env = { ...process.env, KOSMOS_PORT: String(port) };\n';
  const ok = 'const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port) };\n';
  assert.notEqual(leakIn(cli + inh), null, 'an inherited env with no data root');
  assert.equal(leakIn(cli + ok), null, 'an inherited env with a data root');
  assert.notEqual(leakIn(cli + ok + inh), null, 'two envs, only one with a data root (review round 1: cli.task-2662)');
  assert.notEqual(leakIn(cli + inh.replace('KOSMOS_PORT', "AGENT_WORKFORCE_DATA: '', KOSMOS_PORT")), null, 'an empty data root is no data root');
  assert.notEqual(leakIn(cli + 'const env = Object.assign({}, process.env, { KOSMOS_PORT: p });\n'), null, 'Object.assign inherits too');
  assert.notEqual(leakIn(cli), null, 'no env at all inherits the parent\'s');
  assert.equal(leakIn(cli + "const env = { PATH: '/usr/bin', HOME: tmp };\n"), null, 'an env built from scratch');
  assert.equal(leakIn(cli + inh + '// #4796-sandbox: KOSMOS_HOME points at a fake store with its own board token\n'), null, 'a stated other sandbox');
});
