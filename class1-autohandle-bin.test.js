'use strict';

/*
 * #2808 class-1 (c): the DRY-RUN bin (bin/class1-autohandle.js). It reads each named
 * agent's standing self-report and prints what the auto-handle WOULD do, taking no
 * action. This exercises main()'s argv filtering, the usage path, and the print
 * formatting - the decision logic itself is covered in engine/class1-autohandle.test.js.
 *
 * Driven the way run-tests.sh drives a bin: a child process. Lives at repo ROOT
 * (dot-/hyphen-namespaced) because tools/run-tests.sh globs `engine/*.test.js` and root
 * `*.test.js` - a test placed under bin/ would silently never run (the codex-report-bridge
 * bin test uses the same root placement for the same reason).
 *
 * Hermetic: it names agents that do not exist (a unique nonce), so selfreport.read finds
 * no file and the plan is always `none`, independent of whatever real agents are on the
 * live board. It also points AGENT_WORKFORCE_DATA at a throwaway dir and strips
 * CLAUDE_CONFIG_DIR/CODEX_HOME so it can never read or touch the operator's real state.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = nodePath.join(__dirname, 'bin', 'class1-autohandle.js');
const SANDBOX = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'c1-bin-test-')));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

function run(args) {
  const env = { ...process.env, AGENT_WORKFORCE_DATA: SANDBOX };
  delete env.CLAUDE_CONFIG_DIR;
  delete env.CODEX_HOME;
  const r = spawnSync(process.execPath, [BIN, ...args], { env, encoding: 'utf8' });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
}

test('bin: no args prints usage to stderr and takes no action (exit 0)', () => {
  const r = run([]);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /usage: class1-autohandle\.js/);
  assert.doesNotMatch(r.stdout, /DRY-RUN/); // nothing swept, nothing printed
});

test('bin: flag-only args are filtered out, leaving no names -> usage', () => {
  const r = run(['--foo', '-x']);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /usage: class1-autohandle\.js/);
});

test('bin: a nonexistent agent name -> DRY-RUN header + "none" (never an action)', () => {
  const nonce = 'no-such-agent-' + process.pid + '-' + Date.now();
  const r = run([nonce]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /class1-autohandle DRY-RUN \(no action taken\)/);
  assert.match(r.stdout, new RegExp(nonce + ': none'));
});

test('bin: multiple names each get a line; a leading flag among them is dropped', () => {
  const a = 'ghost-a-' + process.pid;
  const b = 'ghost-b-' + process.pid;
  const r = run([a, '--dry', b]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, new RegExp(a + ': none'));
  assert.match(r.stdout, new RegExp(b + ': none'));
});
