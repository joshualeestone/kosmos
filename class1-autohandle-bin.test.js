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

test('#4169 bin: says it reads self-reports only, and a would-restart line says the board acts only on the trust dialog on screen', () => {
  // A real by:auto tool-permission self-report in the sandbox store (<data>/Kosmos/selfreports, the shape the hook writes), so the dry-run
  // plans trust-and-restart for it from the report alone, and must say the board would not.
  const name = 'toolprompt-' + process.pid;
  fs.mkdirSync(nodePath.join(SANDBOX, 'Kosmos', 'selfreports'), { recursive: true });
  fs.writeFileSync(nodePath.join(SANDBOX, 'Kosmos', 'selfreports', name + '.jsonl'), JSON.stringify({
    v: 1, state: 'needs_you', because: 'asking permission to use Bash', on: null, owner: null, until: null, project: null,
    by: 'auto', at: new Date().toISOString() }) + '\n');
  const r = run([name]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /note: from self-reports only; the board restarts only for the folder-trust dialog it sees on screen/);
  assert.match(r.stdout, new RegExp(name + ': trust-and-restart \\(the board does this ONLY if its screen shows the folder-trust dialog; a tool prompt is left for a person\\)'),
    'the would-restart line lost its caveat: ' + r.stdout);
});
