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
function run(baked, known) {
  const script = `say() { :; }\nSESSION=a\nTMUX_BIN=${JSON.stringify(baked)}\n${fn()}\n_kosmos_supervisor_tmux\nprintf '%s\\n%s' "$TMUX_BIN" "$PATH"`;
  const out = execFileSync('/bin/bash', ['-c', script], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', KOSMOS_TMUX_KNOWN: known.join(' ') } });
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
