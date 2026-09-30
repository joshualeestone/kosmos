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

/** Whether a test file hands the CLI a data root of its own: it names one, or it builds the CLI's
 *  environment from scratch (no `...process.env`, so nothing of this computer's data root is inherited;
 *  cli.agent-create-3734 does this with a temporary HOME). */
function setsDataRoot(text) { return /AGENT_WORKFORCE_DATA\s*:/.test(text) || !/\.\.\.process\.env/.test(text); }

test('#4796 every CLI test with a stub board gives the CLI its own data root', () => {
  const files = stubBoardCliTests(__dirname);
  assert.ok(files.length >= 10, `premise: the sweep found the stub-board CLI tests (${files.length})`);
  const missing = files.filter((f) => !setsDataRoot(fs.readFileSync(path.join(__dirname, f), 'utf8')));
  assert.deepEqual(missing, [], 'these CLI tests would send the live board token to their stub board');
});

test('#4796 control: the check can see a file without a data root', () => {
  const before = "const env = { ...process.env, KOSMOS_PORT: String(port) };\nhttp.createServer(() => {});\nexecFile(path.join(__dirname, 'install', 'kosmos'));";
  const after = before.replace('...process.env,', '...process.env, AGENT_WORKFORCE_DATA: DATA,');
  assert.equal(setsDataRoot(before), false);
  assert.equal(setsDataRoot(after), true);
  // An environment built from scratch inherits no data root.
  assert.equal(setsDataRoot("const env = { PATH: '/usr/bin', HOME: tmp };\nhttp.createServer(() => {});"), true);
});
