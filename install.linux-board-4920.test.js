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
const snippets = [...SETUP.matchAll(/<<'BOARDEOF' 2>\/dev\/null\n([\s\S]*?)\nBOARDEOF\n/g)].map((m) => m[1]);
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
  const lb = standIn(`exports.boardUnitPath = (home) => home + '/unit'; exports.loadedBoardJob = (home) => ({ ok: true, active: require('fs').existsSync(home + '/active') }); exports.installBoard = (home, port) => { require('fs').writeFileSync(${JSON.stringify(path.join(WORK, 'args'))}, JSON.stringify([home, port])); if (require('fs').existsSync(home + '/unit')) require('fs').writeFileSync(home + '/unit', 'new text'); return { ok: true, lingering: home.endsWith('L') }; };`);
  let r = run(installSnippet, [lb, '/home/u/kosmosL', '16180']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'loose lingering', 'systemd not running it: loose');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(WORK, 'args'), 'utf8')), ['/home/u/kosmosL', 16180], 'port arrives as a number');
  r = run(installSnippet, [lb, '/home/u/kosmos', '16180']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'loose not lingering');
  const held = fs.mkdtempSync(path.join(WORK, 'held-'));
  fs.writeFileSync(path.join(held, 'active'), '');
  r = run(installSnippet, [lb, held, '16180']);
  assert.equal(r.stdout, 'held not lingering', 'systemd already running it, no unit before: held');
  fs.writeFileSync(path.join(held, 'unit'), 'old text');
  r = run(installSnippet, [lb, held, '16180']);
  assert.equal(r.stdout, 'held-changed not lingering', 'systemd running it and the update rewrote its unit: held-changed');
});

test('#4920 the install snippet exits non-zero with systemd\'s reason, for a refusal and for a throw', () => {
  let r = run(installSnippet, [standIn(`exports.installBoard = () => ({ ok: false, because: 'systemd did not enable the board: no bus' });`), '/h', '1']);
  assert.equal(r.status, 3);
  assert.equal(r.stdout, 'refused: systemd did not enable the board: no bus');
  r = run(installSnippet, [standIn(`exports.installBoard = () => { throw new Error('the board port is not a port number\\n    at somewhere'); };`), '/h', 'x']);
  assert.equal(r.status, 3);
  assert.equal(r.stdout, 'refused: the board port is not a port number', 'one line of the error, never a stack');
});

test('#4920 the remove snippet passes KOSMOS_HOME and exits non-zero with the reason when a step failed', () => {
  let r = run(removeSnippet, [standIn(`exports.removeBoard = (home) => (home === '/h' ? { ok: true } : { ok: false, because: 'wrong home ' + home });`), '/h']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  const left = fs.mkdtempSync(path.join(WORK, 'left-'));
  fs.mkdirSync(path.join(left, 'default.target.wants'));
  fs.writeFileSync(path.join(left, 'kosmos-board.service'), '[Unit]');
  fs.symlinkSync(path.join(left, 'kosmos-board.service'), path.join(left, 'default.target.wants', 'kosmos-board.service'));
  r = run(removeSnippet, [standIn(`exports.boardUnitPath = () => ${JSON.stringify(path.join(left, 'kosmos-board.service'))}; exports.removeBoard = () => ({ ok: false, because: 'systemd could not stop the board: Failed to connect to bus\\nmore' });`), '/h']);
  assert.equal(r.status, 3);
  assert.equal(r.stdout, 'systemd could not stop the board: Failed to connect to bus; its unit file was deleted, so it will not start again, though it may keep running until you log out or restart');
  assert.ok(!fs.existsSync(path.join(left, 'kosmos-board.service')), 'a unit left enabled would retry a deleted folder at every login');
  assert.ok(!fs.existsSync(path.join(left, 'default.target.wants', 'kosmos-board.service')) && !fs.lstatSync(path.join(left, 'default.target.wants')).isFile(), 'the enable link is gone too');
  let gone = false; try { fs.lstatSync(path.join(left, 'default.target.wants', 'kosmos-board.service')); } catch { gone = true; }
  assert.ok(gone, 'the enable link (a symlink) is gone');
});

test('#4920 CONTROL: the real linuxboard exports what the snippets call', () => {
  const real = require('./engine/linuxboard');
  assert.equal(typeof real.installBoard, 'function');
  assert.equal(typeof real.removeBoard, 'function');
});

/* The shell around the snippets: which sentence the person reads, and whether the board is handed to systemd. The two
   blocks are cut from setup.sh and run under its own option line with stand-ins: a fake node that answers as told,
   a fake kosmos that records a restart, and a PATH holding only what the test puts there (so a Linux runner's real
   systemctl is never found). */
const OPTS = (SETUP.match(/^set -eu\n\[ -n "\$\{BASH_VERSION:-\}" \] && set -o pipefail \|\| true\n/m) || [null])[0];
assert.ok(OPTS, 'setup.sh option line not found: update this test with it');
function cut(start, end) {
  const i = SETUP.indexOf(start);
  assert.ok(i >= 0, 'block start not found: ' + start.slice(0, 60));
  const j = SETUP.indexOf(end, i);
  assert.ok(j > i, 'block end not found');
  return SETUP.slice(i, j + end.length);
}
const INSTALL_BLOCK = cut('  if ! command -v systemctl >/dev/null 2>&1; then\n    if [ "$_kosmos_board_off" = yes ]; then\n      info "note: systemctl not available', '\n  fi\n  ok\nelse\n').replace(/\n  ok\nelse\n$/, '\n');
const UNINSTALL_BLOCK = cut('    if [ -n "${AGENT_WORKFORCE_LAUNCH:-}" ] && [ -z "${AGENT_WORKFORCE_SYSTEMD_DIR:-}" ]; then', '\n      done\n    fi\n');

function world({ systemctl = true, app = true, legacy = false, nodeOut = '', nodeRc = 0, units = [], restartRc = 0 } = {}) {
  const root = fs.mkdtempSync(path.join(WORK, 'w-'));
  const home = path.join(root, 'kosmos');
  const bin = path.join(root, 'stubs');
  fs.mkdirSync(bin, { recursive: true });
  fs.symlinkSync('/usr/bin/id', path.join(bin, 'id'));
  fs.symlinkSync('/bin/cat', path.join(bin, 'cat'));   // the fake node reads its heredoc
  if (systemctl) { fs.writeFileSync(path.join(bin, 'systemctl'), '#!/bin/sh\necho "$@" >> "' + path.join(root, 'systemctl.log') + '"\nexit 0\n'); fs.chmodSync(path.join(bin, 'systemctl'), 0o755); }
  for (const tool of ['rm', 'cut', 'sha256sum', 'shasum']) { const src = ['/bin/' + tool, '/usr/bin/' + tool].find((f) => fs.existsSync(f)); if (src) fs.symlinkSync(src, path.join(bin, tool)); }
  if (legacy) { fs.mkdirSync(path.join(home, 'app'), { recursive: true }); fs.writeFileSync(path.join(home, 'app', 'server.js'), ''); }
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, 'bin', 'kosmos'), '#!/bin/sh\necho "$@" >> "' + path.join(root, 'kosmos.log') + '"\nexit ' + restartRc + '\n');
  fs.chmodSync(path.join(home, 'bin', 'kosmos'), 0o755);
  if (app) {
    fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
    fs.mkdirSync(path.join(home, 'app', 'engine'), { recursive: true });
    fs.writeFileSync(path.join(home, 'app', 'engine', 'linuxboard.js'), '');
    fs.writeFileSync(path.join(home, 'runtime', 'bin', 'node'), '#!/bin/sh\ncat >/dev/null\nprintf "%s" ' + JSON.stringify(nodeOut) + '\nexit ' + nodeRc + '\n');
    fs.chmodSync(path.join(home, 'runtime', 'bin', 'node'), 0o755);
  }
  const unitDir = path.join(root, 'units');
  fs.mkdirSync(unitDir, { recursive: true });
  for (const u of units) fs.writeFileSync(path.join(unitDir, u), '');
  return { root, home, bin, unitDir, systemctlLog: () => { try { return fs.readFileSync(path.join(root, 'systemctl.log'), 'utf8'); } catch { return ''; } }, restarts: () => { try { return fs.readFileSync(path.join(root, 'kosmos.log'), 'utf8'); } catch { return ''; } } };
}
function runBlock(block, w, { off = 'no', shell = '/bin/sh', env = {} } = {}) {
  const script = OPTS + 'info() { printf "INFO %s\\n" "$*"; }\n_kosmos_off_why() { printf "(set off)"; }\n'
    + '_kosmos_board_decide() { :; }\n_kosmos_board_off=' + off + '\nPORT=16180\n_kosmos_home_default=/nowhere/default\n' + block;
  return spawnSync(shell, ['-c', script], { encoding: 'utf8', env: { PATH: w.bin, HOME: w.root, KOSMOS_HOME: w.home, AGENT_WORKFORCE_SYSTEMD_DIR: w.unitDir, ...env } });
}

test('#4920 install: linger on hands the board to systemd and says it starts with the computer', () => {
  const w = world({ nodeOut: 'loose lingering' });
  const r = runBlock(INSTALL_BLOCK, w);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /INFO Kosmos will start itself when this computer starts/);
  assert.match(w.restarts(), /^restart --force$/m, 'the running board was not handed to systemd');
});

test('#4920 install: linger off says it stops at logout and names the loginctl line, and does not hand over', () => {
  const w = world({ nodeOut: 'loose not lingering' });
  const r = runBlock(INSTALL_BLOCK, w);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(w.restarts(), '', 'without linger the hand-off would make the board die at logout');
  assert.match(r.stdout, /running now and will start itself when you log in, but not at boot: linger is off/);
  assert.match(r.stdout, /loginctl enable-linger /);
  assert.doesNotMatch(r.stdout, /starts when this computer starts/);
});

test('#4920 install: a board set to stay off is not restarted and says why', () => {
  const w = world({ nodeOut: 'loose lingering' });
  const r = runBlock(INSTALL_BLOCK, w, { off: 'yes' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /will not start itself at login \(set off\)/);
  assert.equal(w.restarts(), '', 'a board set off was restarted (that clears board.stopped)');
});

test('#4920 install: a refusal gives systemd\'s reason, an empty failure says the step did not run; neither restarts', () => {
  let w = world({ nodeOut: 'refused: systemd did not reload its user units: no bus', nodeRc: 3 });
  let r = runBlock(INSTALL_BLOCK, w);
  assert.equal(r.status, 0, 'a refusal must not stop the install: ' + r.stderr);
  assert.match(r.stdout, /could not set itself to start with systemd: systemd did not reload its user units: no bus/);
  assert.doesNotMatch(r.stdout, /refused:/, 'the internal prefix leaked into the sentence');
  assert.equal(w.restarts(), '');
  w = world({ nodeOut: '', nodeRc: 1 });
  r = runBlock(INSTALL_BLOCK, w);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /its setup step did not run/);
  assert.equal(w.restarts(), '');
});

test('#4920 install: no systemctl says so and does nothing else', () => {
  const w = world({ systemctl: false, nodeOut: 'loose lingering' });
  const r = runBlock(INSTALL_BLOCK, w);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /systemctl not available/);
  assert.equal(w.restarts(), '');
});

test('#4920 uninstall: each case names its real cause', () => {
  let w = world({ nodeOut: '' });
  let r = runBlock(UNINSTALL_BLOCK, w);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /removing the systemd service for the board/);
  assert.doesNotMatch(r.stdout, /not fully removed/);
  w = world({ nodeOut: 'systemd could not stop the board: x', nodeRc: 3 });
  r = runBlock(UNINSTALL_BLOCK, w);
  assert.match(r.stdout, /not fully removed: systemd could not stop the board: x/);
  w = world({ nodeOut: '', nodeRc: 1 });
  r = runBlock(UNINSTALL_BLOCK, w);
  assert.match(r.stdout, /not fully removed: its removal step did not run/);
  w = world({ systemctl: false, units: ['kosmos-board.service'] });
  r = runBlock(UNINSTALL_BLOCK, w);
  assert.match(r.stdout, /systemctl is not available/);
  assert.doesNotMatch(r.stdout, /app code or runtime is missing/, 'blamed a missing app that is there');
  w = world({ app: false, units: ['kosmos-board.service', 'kosmos-board.abcd1234.service'] });
  r = runBlock(UNINSTALL_BLOCK, w);
  assert.equal((r.stdout.match(/app code or runtime is missing/g) || []).length, 2, 'each leftover unit is named: ' + r.stdout);
  assert.match(r.stdout, /may be this install's or another Kosmos's/);
});

test('#4920 install: a board systemd already runs (an update) is not bounced a second time', () => {
  const w = world({ nodeOut: 'held lingering' });
  const r = runBlock(INSTALL_BLOCK, w);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /INFO Kosmos will start itself when this computer starts/, 'the linger sentence reads the second word');
  assert.equal(w.restarts(), '', 'an update restarted a board the start step had already restarted through systemd');
});

test('#4920 install: a launcher tmux pick is not written into the unit', () => {
  const lb = standIn(`exports.boardUnitPath = () => '/nonexistent/u'; exports.loadedBoardJob = () => ({ ok: true, active: true }); exports.installBoard = () => { process.stdout.write('[' + (process.env.AGENT_WORKFORCE_TMUX_BIN || '') + ']'); return { ok: true, lingering: true }; };`);
  let r = spawnSync(process.execPath, ['-', lb, '/h', '16180'], { input: installSnippet, encoding: 'utf8', env: { ...process.env, AGENT_WORKFORCE_TMUX_BIN: '/bundle/tmux', KOSMOS_TMUX_BIN_PICKED: '1' } });
  assert.equal(r.stdout, '[]held lingering', 'a launcher pick reached installBoard');
  r = spawnSync(process.execPath, ['-', lb, '/h', '16180'], { input: installSnippet, encoding: 'utf8', env: { ...process.env, AGENT_WORKFORCE_TMUX_BIN: '/usr/bin/tmux', KOSMOS_TMUX_BIN_PICKED: '' } });
  assert.equal(r.stdout, '[/usr/bin/tmux]held lingering', 'CONTROL: a person choice (no marker) is kept');
});

test('#4920 the board snippets avoid the three shapes that broke bash 3.2 here: a space-#, unbalanced parens, an odd apostrophe count', () => {
  /* bash 3.2 parses a heredoc body nested in $( ) as shell text: a space then # starts a comment that eats the rest of
     the line, an apostrophe opens a string, and an unbalanced paren ends the substitution early. Two of these broke
     setup.sh during review (bash -n on the whole file did not catch one; running the block under /bin/sh did). */
  assert.equal(snippets.length, 2);
  for (const body of snippets) {
    assert.equal((body.match(/(^|\s)#/g) || []).length, 0, 'a space-# in a snippet: ' + body.slice(0, 80));
    assert.equal((body.match(/\(/g) || []).length, (body.match(/\)/g) || []).length, 'unbalanced parens in a snippet');
    assert.equal((body.match(/'/g) || []).length % 2, 0, 'an odd number of apostrophes in a snippet');
  }
});

test('#4920 install: a hand-off that does not bring the board back is said, with kosmos start', () => {
  let w = world({ nodeOut: 'loose lingering', restartRc: 1 });
  let r = runBlock(INSTALL_BLOCK, w);
  assert.equal(r.status, 0, 'a failed hand-off must not stop the install: ' + r.stderr);
  assert.match(r.stdout, /did not confirm it is running\. Check with: kosmos status, and if it is not running: kosmos start/);
  assert.doesNotMatch(r.stdout, /will start itself when this computer starts/, 'a success-shaped line followed a failed hand-off');
  w = world({ nodeOut: 'loose lingering' });
  r = runBlock(INSTALL_BLOCK, w);
  assert.doesNotMatch(r.stdout, /did not confirm/, 'CONTROL: a hand-off that worked says nothing extra');
});

test('#4920 install: an update that changed the unit restarts the board systemd runs, once; unchanged, it does not', () => {
  let w = world({ nodeOut: 'held-changed not lingering' });
  let r = runBlock(INSTALL_BLOCK, w);
  assert.equal(r.status, 0, r.stderr);
  assert.match(w.restarts(), /^restart --force$/m, 'a changed unit was not applied to the running board');
  assert.match(r.stdout, /linger is off/, 'the linger sentence reads the second word after held-changed');
  w = world({ nodeOut: 'held not lingering' });
  r = runBlock(INSTALL_BLOCK, w);
  assert.equal(w.restarts(), '', 'CONTROL: an unchanged unit is not bounced');
  assert.match(r.stdout, /linger is off/);
  w = world({ nodeOut: 'held-changed lingering' });
  r = runBlock(INSTALL_BLOCK, w, { off: 'yes' });
  assert.equal(w.restarts(), '', 'a board set off is never restarted, changed unit or not');
});

test('#4920 the install and uninstall blocks behave the same under dash (Ubuntu sh) when it is present', (t) => {
  const dash = ['/usr/bin/dash', '/bin/dash', '/opt/homebrew/bin/dash', '/usr/local/bin/dash'].find((f) => fs.existsSync(f));
  if (!dash) { t.skip('no dash on this host (the Linux runner sh is dash, which runs every test above)'); return; }
  let w = world({ nodeOut: 'loose lingering' });
  let r = runBlock(INSTALL_BLOCK, w, { shell: dash });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /start itself when this computer starts/);
  assert.match(w.restarts(), /^restart --force$/m);
  w = world({ nodeOut: 'held-changed not lingering', restartRc: 1 });
  r = runBlock(INSTALL_BLOCK, w, { shell: dash });
  assert.match(r.stdout, /did not confirm it is running/);
  assert.match(r.stdout, /linger is off/);
  assert.doesNotMatch(r.stdout, /running now/, 'after a failed hand-off the board is not claimed to be running');
  w = world({ app: false, units: ['kosmos-board.service'] });
  r = runBlock(UNINSTALL_BLOCK, w, { shell: dash });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /app code or runtime is missing/);
});

test('#4920 install: a sandboxed run says the systemd step was skipped on purpose, not that it failed', () => {
  const w = world({ nodeOut: 'refused: systemd did not reload its user units: a sandboxed board does not manage real systemd units', nodeRc: 3 });
  const r = runBlock(INSTALL_BLOCK, w);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /sandboxed run: the systemd step was skipped on purpose/);
  assert.doesNotMatch(r.stdout, /could not set itself/);
});

test('#4920 uninstall: an install from a release before linuxboard.js has its shell-written unit removed by that rule', () => {
  const w = world({ app: false, legacy: true });
  const name = 'kosmos-board.' + require('node:crypto').createHash('sha256').update(w.home).digest('hex').slice(0, 8) + '.service';
  fs.mkdirSync(path.join(w.unitDir, 'default.target.wants'), { recursive: true });
  fs.writeFileSync(path.join(w.unitDir, name), '[Service]\nRestart=always\n');
  fs.symlinkSync(path.join(w.unitDir, name), path.join(w.unitDir, 'default.target.wants', name));
  const r = runBlock(UNINSTALL_BLOCK, w);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /removing the systemd service an earlier Kosmos made/);
  assert.ok(!fs.existsSync(path.join(w.unitDir, name)), 'the legacy unit was left behind');
  let gone = false; try { fs.lstatSync(path.join(w.unitDir, 'default.target.wants', name)); } catch { gone = true; }
  assert.ok(gone, 'the legacy enable link was left behind');
  assert.match(w.systemctlLog(), new RegExp('--user stop ' + name.replace(/\./g, '\\.')), 'the running legacy unit was not stopped');
  assert.doesNotMatch(r.stdout, /app code or runtime is missing/, 'blamed a missing app that is there, only older');
});

test('#4920 uninstall: a sandboxed run says the systemd step was skipped on purpose', () => {
  const w = world({ nodeOut: '' });
  const r = runBlock(UNINSTALL_BLOCK, w, { env: { AGENT_WORKFORCE_LAUNCH: '/tmp/sandbox-4920', AGENT_WORKFORCE_SYSTEMD_DIR: '' } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /sandboxed run: the systemd step was skipped on purpose/);
  assert.doesNotMatch(r.stdout, /not fully removed/);
});
