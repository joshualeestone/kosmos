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

/** The test files (top level and engine/) that run the CLI or a report bridge (both read the board token)
 *  against a stub board of their own. Review round 2: the bridge tests were outside a cli.*-only sweep. */
function stubBoardCliTests(dir) {
  const out = [];
  for (const sub of ['', 'engine']) {
    const d = path.join(dir, sub);
    for (const f of fs.readdirSync(d)) {
      if (!/\.test\.js$/.test(f) || f === path.basename(__filename)) continue;
      const s = fs.readFileSync(path.join(d, f), 'utf8');
      const runsTokenReader = /install['"], *['"]kosmos['"]|install\/kosmos|report-bridge\.js|BRIDGE_FILE|agy-report-bridge/.test(s);
      if (runsTokenReader && /createServer\(/.test(s)) out.push(path.join(sub, f));
    }
  }
  return out;
}

/** Ways a test hands the CLI this computer's own environment (and with it, its data root). */
const INHERIT_RE = /\.\.\.process\.env\b|Object\.assign\(\s*\{\s*\}\s*,\s*process\.env\b|env:\s*process\.env\b/g;
/** A data root of its own, named with a value (an empty one means "unset" to engine/store.js). */
// AGENT_WORKFORCE_HOME is the next place engine/store.js looks when AGENT_WORKFORCE_DATA is unset or empty.
const DATA_KEY = /AGENT_WORKFORCE_(DATA|HOME)\s*[:=](?!\s*['"`]{2})/;   // the space goes inside the lookahead, or backtracking lets '' through
/** A throwaway KOSMOS_HOME whose store module names the data root: a sandbox for install/kosmos only (the report
 *  bridges resolve their engine beside themselves and ignore it; review round 3). */
const HOME_KEY = /KOSMOS_HOME\s*[:=](?!\s*['"`]{2})/;

/** The text of the object literal (or call) an inherit match sits in: from the nearest unclosed `{` (or, for
 *  Object.assign, the call's `(`) to its matching close. Keys spread in from elsewhere (`...env`) are not in it,
 *  so they cannot stand in for a data root this environment does not name itself. */
function enclosing(text, at, open, close) {
  let depth = 0, from = -1;
  for (let i = at; i >= 0; i -= 1) {
    if (text[i] === close) depth += 1;
    else if (text[i] === open) { if (depth === 0) { from = i; break; } depth -= 1; }
  }
  if (from < 0) return '';
  depth = 0;
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === open) depth += 1;
    else if (text[i] === close) { depth -= 1; if (depth === 0) return text.slice(from, i + 1); }
  }
  return text.slice(from);
}

/** Why a test file could let the CLI or a bridge read the live board token, or null. Each place it inherits the
 *  parent environment must name a data root of its own IN THAT ENVIRONMENT (review round 3: a file-wide count let
 *  one environment's root cover another's gap); a file that inherits nothing must build the environment itself. */
function leakIn(text) {
  // A data root set on this process itself, at the top of the file, sandboxes every child it starts.
  if (/^process\.env\.AGENT_WORKFORCE_DATA\s*=(?!\s*['"`]{2})/m.test(text)) return null;
  const runsCli = /install['"], *['"]kosmos['"]|install\/kosmos/.test(text);
  const bad = [];
  for (const m of text.matchAll(INHERIT_RE)) {
    const line = text.slice(0, m.index).split('\n').length;
    if (/^env:/.test(m[0])) { bad.push(line); continue; }
    const env = m[0].startsWith('Object.assign') ? enclosing(text, m.index + m[0].indexOf('('), '(', ')') : enclosing(text, m.index, '{', '}');
    if (!(DATA_KEY.test(env) || (runsCli && HOME_KEY.test(env)))) bad.push(line);
  }
  if (bad.length) return `inherits the parent environment with no data root of its own at line ${bad.join(', ')}`;
  // Nothing inherited: the file must build the environment itself (a child given no env gets the parent's).
  if (!text.match(INHERIT_RE) && !/\benv\s*[:=]/.test(text)) return 'runs the CLI with no environment of its own, so it inherits the parent\'s';
  return null;
}

test('#4796 every CLI test with a stub board gives the CLI its own data root', () => {
  const files = stubBoardCliTests(__dirname);
  assert.ok(files.length >= 10, `premise: the sweep found the stub-board CLI tests (${files.length})`);
  assert.ok(files.includes('codex-report-bridge.test.js'), 'premise: the sweep reaches the report bridge tests');
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
  assert.equal(leakIn("process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');\n" + cli), null, 'a data root set on the test process itself');
  assert.notEqual(leakIn("  process.env.AGENT_WORKFORCE_DATA = '';\n" + cli), null, 'an indented or empty one is not the file-wide root');
  assert.equal(leakIn(cli + "const env = { PATH: '/usr/bin', HOME: tmp };\n"), null, 'an env built from scratch');
  assert.equal(leakIn(cli + inh.replace('KOSMOS_PORT', 'KOSMOS_HOME: home, KOSMOS_PORT')), null, 'a throwaway KOSMOS_HOME store');
  assert.notEqual(leakIn(cli + inh.replace('KOSMOS_PORT', 'KOSMOS_HOME: home, KOSMOS_PORT') + inh), null, 'one env with a throwaway KOSMOS_HOME and one with nothing');
  // Review round 3: roots elsewhere in the file must not cover an env's gap.
  assert.notEqual(leakIn(cli + 'const env = { ...process.env, KOSMOS_PORT: p, ...extra };\ndrive(T, { AGENT_WORKFORCE_DATA: data });\n'), null, 'a root passed by a caller does not cover the helper\'s own env');
  assert.notEqual(leakIn(cli + inh + 'const other = { KOSMOS_HOME: h, AGENT_WORKFORCE_DATA: d };\n'), null, 'two keys in another object do not cover this one');
  const bridge = "http.createServer(() => {});\nconst BRIDGE_FILE = 'bin/codex-report-bridge.js';\n";
  assert.notEqual(leakIn(bridge + inh.replace('KOSMOS_PORT', 'KOSMOS_HOME: home, KOSMOS_PORT')), null, 'a report bridge ignores KOSMOS_HOME');
});

test('#4796 control: with the #4796 fix taken back out, the guard names each file the leak was measured in', () => {
  for (const f of ['cli.task-2662.test.js', 'cli.react-2255.test.js', 'codex-report-bridge.test.js', 'gemini-report-bridge.test.js', 'grok-report-bridge.test.js', 'cli.community-read-4373.test.js']) {
    const now = fs.readFileSync(path.join(__dirname, f), 'utf8');
    assert.equal(leakIn(now), null, `premise: ${f} passes as it is`);
    const reverted = now.replace(/AGENT_WORKFORCE_DATA: (DATA4796|DATA),\s*/g, '');
    assert.notEqual(reverted, now, `premise: ${f} carries the #4796 fix`);
    assert.notEqual(leakIn(reverted), null, `${f} with its fix removed still passed the guard`);
  }
});
