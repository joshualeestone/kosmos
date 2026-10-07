'use strict';
/*
 * #4920: on Linux, setup.sh installs and removes the board's systemd unit through piece B's engine/linuxboard.js
 * (installBoard / removeBoard), never a unit written in shell. These tests run setup.sh's own two node snippets
 * (cut from the file, so the test is of the shipped text) against a stand-in linuxboard, and pin that no unit text
 * is left in setup.sh.
 *
 *   node --test install.linux-board-4920.test.js
 */
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SETUP = fs.readFileSync(path.join(__dirname, 'install', 'setup.sh'), 'utf8');
const snippets = [...SETUP.matchAll(/<<'BOARDEOF' 2>&1\n([\s\S]*?)\nBOARDEOF\n/g)].map((m) => m[1]);
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-linuxboard-4920-'));

function standIn(body) {
  const f = path.join(WORK, 'lb-' + Math.random().toString(36).slice(2) + '.js');
  fs.writeFileSync(f, body);
  return f;
}
function run(snippet, args) {
  return spawnSync(process.execPath, ['-', ...args], { input: snippet, encoding: 'utf8' });
}
const [installSnippet, removeSnippet] = (() => {
  const i = snippets.find((s) => s.includes('installBoard'));
  const r = snippets.find((s) => s.includes('removeBoard'));
  return [i, r];
})();

test('#4920 setup.sh has exactly two board snippets: one installs, one removes', () => {
  assert.equal(snippets.length, 2, 'expected the install and the uninstall snippet');
  assert.ok(installSnippet && removeSnippet);
});

test('#4920 setup.sh writes no systemd unit of its own (one unit: piece B\'s)', () => {
  const code = SETUP.replace(/^\s*#.*$/gm, '');   // comments may name the old directives; code may not
  for (const line of ['[Service]', 'Restart=always', 'Restart=on-failure', 'ExecStart=', 'WantedBy=default.target']) {
    assert.ok(!code.includes(line), 'setup.sh still carries unit text: ' + line);
  }
  assert.ok(!/loginctl enable-linger/.test(SETUP.replace(/^\s*#.*$/gm, '').replace(/"[^"\n]*loginctl enable-linger[^"\n]*"/g, '')),
    'linger is turned on by installBoard (read back), not by a separate loginctl call');
});

test('#4920 the install snippet passes KOSMOS_HOME and the port, and says lingering or not', () => {
  const lb = standIn(`exports.installBoard = (home, port) => { require('fs').writeFileSync(${JSON.stringify(path.join(WORK, 'args'))}, JSON.stringify([home, port])); return { ok: true, lingering: home.endsWith('L') }; };`);
  let r = run(installSnippet, [lb, '/home/u/kosmosL', '16180']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'lingering');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(WORK, 'args'), 'utf8')), ['/home/u/kosmosL', 16180], 'port arrives as a number');
  r = run(installSnippet, [lb, '/home/u/kosmos', '16180']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'not lingering');
});

test('#4920 the install snippet exits non-zero with systemd\'s reason, for a refusal and for a throw', () => {
  let r = run(installSnippet, [standIn(`exports.installBoard = () => ({ ok: false, because: 'systemd did not enable the board: no bus' });`), '/h', '1']);
  assert.equal(r.status, 3);
  assert.equal(r.stdout, 'refused: systemd did not enable the board: no bus');
  r = run(installSnippet, [standIn(`exports.installBoard = () => { throw new Error('the board port is not a port number'); };`), '/h', 'x']);
  assert.equal(r.status, 3);
  assert.equal(r.stdout, 'refused: the board port is not a port number');
});

test('#4920 the remove snippet passes KOSMOS_HOME and exits non-zero with the reason when a step failed', () => {
  let r = run(removeSnippet, [standIn(`exports.removeBoard = (home) => (home === '/h' ? { ok: true } : { ok: false, because: 'wrong home ' + home });`), '/h']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  r = run(removeSnippet, [standIn(`exports.removeBoard = () => ({ ok: false, because: 'systemd could not stop the board: x' });`), '/h']);
  assert.equal(r.status, 3);
  assert.equal(r.stdout, 'systemd could not stop the board: x');
});

test('#4920 CONTROL: the real linuxboard exports what the snippets call', () => {
  const real = require('./engine/linuxboard');
  assert.equal(typeof real.installBoard, 'function');
  assert.equal(typeof real.removeBoard, 'function');
});
