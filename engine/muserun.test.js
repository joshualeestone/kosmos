'use strict';
/*
 * #3939 slice 2: engine/muserun.js. A fake `muse` in a sandboxed home prints events in the shape
 * Homer captured on card #3939; the real Muse Code is never run here.
 *
 *   node --test engine/muserun.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'muse-run-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
delete process.env.AGENT_WORKFORCE_MUSE_BIN;
const run = require('./muserun');
const gate = require('./live-execution');
test.after(() => { gate.resetForTests(); run.resetForTests(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const BIN = path.join(SANDBOX, '.local', 'bin', 'muse');
const WORK = path.join(SANDBOX, 'agent-folder');
fs.mkdirSync(WORK, { recursive: true });
const SID = '60c4a188-6411-4e4d-8863-b8f7e94d27f8';
const ev = (seq, type, payload) => JSON.stringify({ schema_version: 1, stream: { kind: 'session', id: SID }, sequence: seq, payload_type: type, payload });
const TURN = [
  ev(1, 'runtime.command.accepted', { kind: 'command_accepted' }),
  ev(3, 'run.model.configured', { kind: 'run_model_configured', provider_id: 'meta', model_id: 'muse-spark-1.3-contributor' }),
  ev(81, 'run.output.delta', { kind: 'run_output_delta', text: 'Appended' }),
  ev(82, 'run.output.delta', { kind: 'run_output_delta', text: ' the line.' }),
  ev(90, 'run.terminal.completed', { kind: 'run_terminal_completed', text: 'DONE', terminal: 'completed' }),
].join('\n') + '\n';

function fakeMuse(body) {
  fs.mkdirSync(path.dirname(BIN), { recursive: true });
  fs.writeFileSync(BIN, '#!/bin/sh\n' + body + '\n', { mode: 0o755 });
}

test('#3939: turnArgs passes the workspace (real path) on every turn, the session, and the prompt last', () => {
  const link = path.join(SANDBOX, 'via-link');
  try { fs.symlinkSync(WORK, link); } catch { /* exists */ }
  const t = run.turnArgs({ workspace: link, sessionId: SID, prompt: '-x looks like a flag' });
  assert.equal(t.error, undefined, JSON.stringify(t));
  assert.equal(t.workspace, fs.realpathSync(WORK), 'the workspace was not resolved through the symlink (Muse refuses one)');
  const a = t.args;
  assert.deepEqual(a.slice(0, 2), ['exec', '--json']);
  assert.equal(a[a.indexOf('--workspace') + 1], t.workspace);
  assert.equal(a[a.indexOf('--session-id') + 1], SID);
  assert.equal(a[a.indexOf('--approval-mode') + 1], 'on-request', 'the default approval mode is not on-request');
  assert.ok(a.includes('--user-input-auto-resolve') && a.includes('--trust-workspace') && a.includes('--no-foreign-personal-context'));
  assert.deepEqual(a.slice(-2), ['--', '-x looks like a flag'], 'the prompt is not last, after --');
});

test('#3939: turnArgs refuses what Kosmos will not hand Muse', () => {
  assert.match(run.turnArgs({ workspace: WORK, sessionId: SID, prompt: '  ' }).error, /nothing to send/);
  assert.match(run.turnArgs({ workspace: WORK, sessionId: 'not-a-uuid', prompt: 'hi' }).error, /session id/);
  assert.match(run.turnArgs({ workspace: WORK, sessionId: SID, prompt: 'hi', approvalMode: 'yolo' }).error, /approval mode/);
  assert.match(run.turnArgs({ workspace: path.join(SANDBOX, 'nowhere'), sessionId: SID, prompt: 'hi' }).error, /not there/);
  const file = path.join(SANDBOX, 'a-file'); fs.writeFileSync(file, 'x');
  assert.match(run.turnArgs({ workspace: file, sessionId: SID, prompt: 'hi' }).error, /not a folder/);
});

test('#3939: parseEvents reads the session, the model, the answer and whether the turn finished', () => {
  const p = run.parseEvents(TURN);
  assert.equal(p.sessionId, SID);
  assert.equal(p.model, 'muse-spark-1.3-contributor');
  assert.equal(p.text, 'DONE', 'the final answer did not win over the deltas');
  assert.equal(p.done, true);
  assert.equal(p.terminal, 'completed');
  assert.equal(p.events, 5);
  const cut = run.parseEvents(TURN.split('\n').slice(0, 4).join('\n') + '\nnot json\n');
  assert.equal(cut.done, false, 'a turn with no terminal event read as finished');
  assert.equal(cut.text, 'Appended the line.', 'the deltas were not joined when there is no final answer');
  assert.equal(cut.unreadable, 1, 'a line that is not JSON was not counted');
  assert.deepEqual(run.parseEvents(''), { sessionId: null, model: null, text: '', done: false, terminal: null, events: 0, unreadable: 0 });
});

test('#3939: runTurn runs the launcher it found, in the agent\'s folder, and reports a finished turn', { skip: process.platform !== 'darwin' && 'the Mac branch' }, async () => {
  const argsFile = path.join(SANDBOX, 'args.txt'); const cwdFile = path.join(SANDBOX, 'cwd.txt');
  fs.writeFileSync(path.join(SANDBOX, 'turn.jsonl'), TURN);
  fakeMuse('printf "%s\\n" "$@" > "' + argsFile + '"\npwd -P > "' + cwdFile + '"\ncat "' + path.join(SANDBOX, 'turn.jsonl') + '"');
  gate.allowLiveExecution();
  try {
    const r = await run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'Append a line' });
    assert.deepEqual({ ok: r.ok, exitCode: r.exitCode, sessionId: r.sessionId, text: r.text, because: r.because },
      { ok: true, exitCode: 0, sessionId: SID, text: 'DONE', because: null });
    assert.equal(fs.readFileSync(cwdFile, 'utf8').trim(), fs.realpathSync(WORK), 'the turn did not run in the agent\'s folder');
    assert.match(fs.readFileSync(argsFile, 'utf8'), /^exec\n--json\n--workspace\n/);
  } finally { gate.resetForTests(); }
});

test('#3939: runTurn says why in words: a busy session, no sign-in, a turn that stopped early', { skip: process.platform !== 'darwin' && 'the Mac branch' }, async () => {
  gate.allowLiveExecution();
  try {
    fakeMuse('echo "session ' + SID + ' is already in use" >&2\nexit 1');
    let r = await run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi' });
    assert.equal(r.ok, false); assert.equal(r.exitCode, 1); assert.match(r.because, /still working/);
    fakeMuse('echo "missing meta credentials: run muse login or set META_API_KEY" >&2\nexit 1');
    r = await run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi' });
    assert.match(r.because, /not signed in/);
    fakeMuse("echo '" + TURN.split('\n')[2] + "'");   // a delta, then exit 0 with no terminal event
    r = await run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi' });
    assert.equal(r.ok, false, 'an exit 0 with no finished turn read as ok');
    assert.match(r.because, /stopped before finishing/);
  } finally { gate.resetForTests(); }
});

test('#3939: a turn that ignores TERM is stopped by SIGKILL at the timeout', { timeout: 8000, skip: process.platform !== 'darwin' && 'the Mac branch' }, async () => {
  fakeMuse("trap '' TERM\nexec sleep 7");
  run.setForTests({ turnTimeoutMs: 300, hardCapMs: 20000 });
  gate.allowLiveExecution();
  try {
    const t0 = Date.now();
    const r = await run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi' });
    assert.ok(Date.now() - t0 < 5000, 'a child ignoring TERM kept the turn waiting');
    assert.match(r.because, /did not finish the turn in time/);
  } finally { gate.resetForTests(); run.resetForTests(); }
});

test('#3939: runTurn never hangs or rejects: no answer at all, a closed gate, nothing installed', { timeout: 5000 }, async () => {
  fakeMuse('exit 0');
  run.setForTests({ runMuse: () => { /* never calls back */ }, hardCapMs: 200 });
  let r = await run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi' });
  assert.match(r.because, /did not finish the turn in time/);
  run.resetForTests();
  gate.resetForTests();
  r = await run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi' });   // gate closed: nothing runs
  assert.equal(r.ok, false);
  fs.rmSync(path.join(SANDBOX, '.local'), { recursive: true, force: true });
  r = await run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi' });
  assert.match(r.because, /not on this computer|not wired up/);
});
