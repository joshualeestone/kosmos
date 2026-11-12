'use strict';
/*
 * kosmos#8373 follow-up (Windows 0.8.03 rolled back on Homer's box): a task-started board whose console is a pipe
 * with no reader. win32boardlog's tee passed each write on to that stdout, the write failed with EPIPE, and the error
 * arrived as an 'error' event nothing listened for, so node killed the board.
 *
 * The other tests fake the dead console with an EventEmitter. This one uses a REAL closed pipe: a child node process
 * routes its log through the real route() (deps: win32, task-started, a log path, so it runs on a Mac), the parent
 * closes its end of the child's stdout, and the child then writes 40 lines over about a second. It must live, exit 0,
 * and the log file must hold every line. Against the win32boardlog.js before the fix, the same child dies (measured
 * when this was written; see the PR).
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const LINES = 40;
const CHILD = `
const fs = require('fs');
const bl = require(process.env.BOARDLOG);
const r = bl.route(process.stdout, process.stderr, { platform: 'win32', taskStarted: () => true, path: process.env.LOG,
  isFile: () => false, inTest: () => false });
if (!r) { fs.writeFileSync(process.env.DONE, 'not routed'); process.exit(3); }
let n = 0;
const iv = setInterval(() => {
  n += 1;
  process.stdout.write('line ' + n + '\\n');
  if (n >= ${LINES}) { clearInterval(iv); setTimeout(() => { fs.writeFileSync(process.env.DONE, 'lived'); process.exit(0); }, 100); }
}, 25);
`;

function runChild() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boardlog-epipe-'));
  const env = { ...process.env, BOARDLOG: path.join(__dirname, 'win32boardlog.js'), LOG: path.join(dir, 'board.log'), DONE: path.join(dir, 'done') };
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', CHILD], { env, stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.destroy();   // the console's reader is gone: every write the tee passes on fails with EPIPE
    const bound = setTimeout(() => { try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ } }, 15000);
    child.on('exit', (code, signal) => {
      clearTimeout(bound);
      const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
      resolve({ code, signal, done: read(env.DONE), log: read(env.LOG) || '' });
    });
  });
}

test('a task-started board whose console pipe has no reader lives on, and its log keeps every line', async () => {
  const r = await runChild();
  assert.equal(r.done, 'lived', 'the child did not finish (exit ' + r.code + ', signal ' + r.signal + '); log tail:\n' + r.log.slice(-800));
  assert.equal(r.code, 0);
  for (let i = 1; i <= LINES; i++) assert.match(r.log, new RegExp('line ' + i + '\\n'), 'line ' + i + ' is not in the log');
  // CONTROL: the console really was broken, so the fix's "stopped" note was written (without it the test proves nothing).
  assert.match(r.log, /the console copy stopped/, 'the console never failed, so this run did not test a broken pipe');
});
