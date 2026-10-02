'use strict';
/**
 * #2955: an agent's supervisor reads through the tmux that can read the live server.
 *
 * Measured on Agent1s, 2026-10-01 13:42: the fleet's Homebrew tmux 3.6a owned the socket and Kosmos's bundled 3.5a
 * could read nothing ("server exited unexpectedly"). Each agent's launchd job carries the tmux path it was made with,
 * and plists are never rewritten, so the supervisor asks at start: if its tmux meets the version wall, the first other
 * tmux that can LIST the server wins (and goes first on PATH). The board does the same (engine/status.js tmuxRepick).
 * With no server, or any other answer, the baked path stays. Runs the shipped function, lifted out of the script.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const SUP = fs.readFileSync(nodePath.join(__dirname, 'bin', 'agent-supervisor.sh'), 'utf8');

function fn() {
  const at = SUP.indexOf('_kosmos_supervisor_tmux() {');
  assert.notEqual(at, -1, 'the supervisor\'s tmux reader moved or was renamed; re-point this test');
  const end = SUP.indexOf('\n}\n', at);
  const call = SUP.indexOf('\n_kosmos_supervisor_tmux ', end);
  const firstLook = SUP.indexOf('while "$TMUX_BIN" has-session', end);
  assert.ok(call !== -1 && call < firstLook, 'the reader is not called before the supervisor\'s first look');
  return SUP.slice(at, end + 3);
}
function sandbox() {
  const sb = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'supreader-'));
  const fake = (name, body) => { const d = nodePath.join(sb, name); fs.mkdirSync(d); const f = nodePath.join(d, 'tmux'); fs.writeFileSync(f, '#!/bin/sh\n' + body + '\n'); fs.chmodSync(f, 0o755); return f; };
  return {
    sb,
    wall: fake('wall', 'echo "server exited unexpectedly" >&2; exit 1'),
    mismatch: fake('mismatch', 'echo "protocol version mismatch (client 8, server 7)" >&2; exit 1'),
    perm: fake('perm', 'echo "error connecting to /tmp/tmux-501/default (Permission denied)" >&2; exit 1'),
    none: fake('none', 'echo "no server running on /tmp/tmux-501/default" >&2; exit 1'),
    lists: fake('lists', 'exit 0'),
  };
}
/** TMUX_BIN and PATH after the reader, from a baked tmux and a list of known places. */
function run(baked, known, own, noSocket, scriptPath, pathTmux) {
  const script = `say() { :; }\nSESSION=a\nTMUX_BIN=${JSON.stringify(baked)}\n${fn()}\n_kosmos_supervisor_tmux\nprintf '%s\\n%s' "$TMUX_BIN" "$PATH"`;
  // Hermetic: an empty directory first and /bin (no tmux on any runner), so `command -v tmux` finds nothing real.
  const empty = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'supreader-path-'));
  // A socket on disk, as on Agent1s: 3.5a's wall words mean the wall only with one (with none they are its serverless voice).
  const sock = nodePath.join(empty, 'sock');
  if (!noSocket) { fs.mkdirSync(nodePath.join(sock, 'tmux-' + process.getuid()), { recursive: true }); fs.writeFileSync(nodePath.join(sock, 'tmux-' + process.getuid(), 'default'), ''); }
  if (pathTmux) { fs.copyFileSync(pathTmux, nodePath.join(empty, 'tmux')); fs.chmodSync(nodePath.join(empty, 'tmux'), 0o755); }
  const env = { PATH: `${empty}:/bin:/usr/bin`, TMUX_TMPDIR: sock, KOSMOS_TMUX_KNOWN: known.join(' ') };
  if (own !== 'real') env.KOSMOS_TMUX_OWN = own || nodePath.join(empty, 'no-own-tmux');
  // $0 is the script's path, as under launchd (bash -c script NAME sets it).
  const out = execFileSync('/bin/bash', ['-c', script, scriptPath || nodePath.join(empty, 'agent-supervisor.sh')], { encoding: 'utf8', env });
  fs.rmSync(empty, { recursive: true, force: true });
  const [bin, p] = out.split('\n');
  return { bin, path: p };
}

test('#2955: at the version wall the supervisor reads through a tmux that can list the server, PATH included', () => {
  const t = sandbox();
  for (const baked of [t.wall, t.mismatch]) {
    const r = run(baked, [t.wall, t.lists]);
    assert.equal(r.bin, t.lists, 'the supervisor stayed on a tmux that cannot read the server: ' + baked);
    assert.ok(r.path.startsWith(nodePath.dirname(t.lists) + ':'), 'a bare tmux in the pane would still find the old one first');
  }
  fs.rmSync(t.sb, { recursive: true, force: true });
});
test('#2955: a working tmux, no server, or any other refusal keeps the baked path (Kosmos keeps its own tmux)', () => {
  const t = sandbox();
  assert.equal(run(t.lists, [t.wall]).bin, t.lists, 'a tmux that reads the server was replaced');
  assert.equal(run(t.none, [t.lists]).bin, t.none, 'with no server, the bundle was swapped for a system tmux (a brew upgrade could then pull it)');
  assert.equal(run(t.perm, [t.lists]).bin, t.perm, 'a permission refusal was taken as the version wall');
  assert.equal(run(t.wall, [t.mismatch, nodePath.join(t.sb, 'missing')]).bin, t.wall, 'a tmux that cannot list was taken');
  fs.rmSync(t.sb, { recursive: true, force: true });
});
test('#2955: Kosmos\'s own tmux is always a candidate, so a job baked with another follows the server back to it', () => {
  const t = sandbox();
  assert.equal(run(t.wall, [], t.lists).bin, t.lists, 'a server Kosmos\'s own tmux can read was left unread');
  fs.rmSync(t.sb, { recursive: true, force: true });
});
test('#2955: with no socket on disk, 3.5a\'s serverless words start no search (a clean Mac at every agent start)', () => {
  const t = sandbox();
  assert.equal(run(t.wall, [t.lists], null, true).bin, t.wall, 'a clean Mac searched for and switched to another tmux');
  assert.equal(run(t.mismatch, [t.lists], null, true).bin, t.lists, 'the explicit protocol-mismatch wording needs no socket check');
  fs.rmSync(t.sb, { recursive: true, force: true });
});
test('#2955: with no seam, the installed supervisor finds Kosmos\'s own tmux through the engine-path pointer', () => {
  /* The layout as installed (measured on Agent1s): the copy that runs is Application Support/Kosmos/bin/agent-
     supervisor.sh with engine-path beside it naming <KOSMOS_HOME>/app/engine; the bundle is <KOSMOS_HOME>/tmux/bin/tmux.
     No KOSMOS_TMUX_OWN: this is the derivation production uses. */
  const t = sandbox();
  const supDir = nodePath.join(t.sb, 'support', 'bin');
  const home = nodePath.join(t.sb, 'kosmos');
  fs.mkdirSync(supDir, { recursive: true });
  fs.mkdirSync(nodePath.join(home, 'app', 'engine'), { recursive: true });
  fs.mkdirSync(nodePath.join(home, 'tmux', 'bin'), { recursive: true });
  const bundled = nodePath.join(home, 'tmux', 'bin', 'tmux');
  fs.writeFileSync(bundled, '#!/bin/sh\nexit 0\n'); fs.chmodSync(bundled, 0o755);
  fs.writeFileSync(nodePath.join(supDir, 'engine-path'), nodePath.join(home, 'app', 'engine') + '\n');
  const r = run(t.wall, [], 'real', false, nodePath.join(supDir, 'agent-supervisor.sh'));
  assert.equal(r.bin, bundled, 'the installed supervisor could not find Kosmos\'s own tmux (or found it by an unnormalized path)');
  fs.rmSync(nodePath.join(supDir, 'engine-path'));
  assert.equal(run(t.wall, [], 'real', false, nodePath.join(supDir, 'agent-supervisor.sh')).bin, t.wall, 'control: with no pointer and nothing beside the script, nothing is found');
  fs.rmSync(t.sb, { recursive: true, force: true });
});
test('#2955: the pointer the supervisor reads is the engine directory (what create.js writes)', () => {
  const create = fs.readFileSync(nodePath.join(__dirname, 'engine', 'create.js'), 'utf8');
  assert.match(create, /const ptrDest = path\.join\(path\.dirname\(dest\), 'engine-path'\);[\s\S]{0,200}fs\.writeFileSync\(ptrStaging, `\$\{__dirname\}\\n`\);/,
    'engine-path no longer names the engine directory, so <it>/../../tmux/bin/tmux is not Kosmos\'s own tmux');
});
test('#2955: a baked tmux that is gone (a removed Homebrew) is replaced: by one that can read the server, else by Kosmos\'s own', () => {
  const t = sandbox();
  const gone = nodePath.join(t.sb, 'removed', 'tmux');
  assert.equal(run(gone, [t.wall, t.lists], t.none).bin, t.lists, 'a tmux that can read the server was not taken for a removed one');
  assert.equal(run(gone, [t.wall], t.none).bin, t.none, 'with no server to list, Kosmos\'s own was not taken for a removed tmux');
  assert.equal(run(gone, [t.wall], nodePath.join(t.sb, 'no-own')).bin, gone, 'control: with nothing runnable, the baked path stays');
  fs.rmSync(t.sb, { recursive: true, force: true });
});
test('#2955: the supervisor tries the board\'s order (known places, Kosmos\'s own, then its PATH tmux), so both take the same one', () => {
  const t = sandbox();
  // A PATH tmux and a known one can both read the server: the known one wins, as on the board.
  const r = run(t.wall, [t.lists], null, false, null, t.lists);
  assert.equal(r.bin, t.lists, 'the supervisor took its PATH tmux over the known place the board takes');
  assert.ok(!r.bin.includes('supreader-path-'), 'the PATH tmux won');
  fs.rmSync(t.sb, { recursive: true, force: true });
});
test('#2955: a bare tmux name is looked up on PATH, not taken for a tmux that is gone', () => {
  const t = sandbox();
  // The PATH tmux works (it says there is no server); Kosmos's own could list. Taken for missing, the name would be
  // swapped for Kosmos's own: it must stay the PATH tmux.
  const r = run('tmux', [], t.lists, false, null, t.none);
  assert.ok(r.bin.endsWith('/tmux') && r.bin.includes('supreader-path-'), 'a bare name was replaced as if missing: ' + r.bin);
  fs.rmSync(t.sb, { recursive: true, force: true });
});

