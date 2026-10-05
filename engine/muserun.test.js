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
// #3939 3c-1: every turn now reads Muse's own file (fileAtStart), so never the real one (round 7).
process.env.XDG_CONFIG_HOME = path.join(SANDBOX, 'xdg');
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
  assert.equal(t.workspace, fs.realpathSync(WORK), 'the workspace was not resolved through the symlink (a precaution: Muse refused a data folder through one)');
  const a = t.args;
  assert.deepEqual(a.slice(0, 2), ['exec', '--json']);
  assert.equal(a[a.indexOf('--workspace') + 1], t.workspace);
  assert.equal(a[a.indexOf('--session-id') + 1], SID);
  assert.equal(a[a.indexOf('--approval-mode') + 1], 'on-request', 'the default approval mode is not on-request');
  // #4569: Muse's default sandbox blocks 127.0.0.1, so without this the agent's kosmos reply never reaches the board.
  assert.ok(a.includes('--disable-sandbox'), 'Muse is launched with its sandbox on: kosmos reply cannot reach the board (#4569)');
  assert.ok(a.indexOf('--disable-sandbox') < a.indexOf('--'), 'the sandbox flag is after --, so Muse would read it as the prompt');
  assert.ok(a.includes('--user-input-auto-resolve') && a.includes('--trust-workspace') && a.includes('--no-foreign-personal-context'));
  assert.deepEqual(a.slice(-2), ['--', '-x looks like a flag'], 'the prompt is not last, after --');
});

test('#3939: turnArgs refuses what Kosmos will not hand Muse', () => {
  assert.match(run.turnArgs({ workspace: WORK, sessionId: SID, prompt: '  ' }).error, /nothing to send/);
  assert.match(run.turnArgs({ workspace: WORK, sessionId: 'not-a-uuid', prompt: 'hi' }).error, /session id/);
  assert.match(run.turnArgs({ workspace: WORK, sessionId: SID, prompt: 'hi', approvalMode: 'yolo' }).error, /approval mode/);
  assert.match(run.turnArgs({ workspace: path.join(SANDBOX, 'nowhere'), sessionId: SID, prompt: 'hi' }).error, /not there/);
  assert.match(run.turnArgs({ workspace: 'agent-folder', sessionId: SID, prompt: 'hi' }).error, /not there/, 'a relative folder was taken (round 1)');
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
  // Round 1: a terminal event that is not "completed" is not a finished turn.
  const failed = run.parseEvents(TURN.split('\n').slice(0, 4).join('\n') + '\n' + ev(90, 'run.terminal.completed', { kind: 'run_terminal_completed', terminal: 'failed', reason: 'x' }));
  assert.equal(failed.done, false, 'a failed run read as done');
  assert.equal(failed.terminal, 'failed');
});

test('#3939: runTurn runs the launcher it found, in the agent\'s folder, and reports a finished turn', { timeout: 8000, skip: process.platform !== 'darwin' && 'the Mac branch' }, async () => {
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

test('#3939: runTurn says why in words: a busy session, no sign-in, a turn that stopped early', { timeout: 20000, skip: process.platform !== 'darwin' && 'the Mac branch' }, async () => {
  gate.allowLiveExecution();
  run.setForTests({ turnTimeoutMs: 2000, hardCapMs: 4000 });   // round 3: a regression fails here, not after ten minutes
  try {
    fakeMuse('echo "session ' + SID + ' is already in use" >&2\nexit 1');
    let r = await run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi' });
    assert.equal(r.ok, false); assert.equal(r.exitCode, 1); assert.match(r.because, /still working/);
    fakeMuse('echo "missing meta credentials: run muse login or set META_API_KEY" >&2\nexit 1');
    r = await run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi' });
    assert.match(r.because, /not signed in/);
    fakeMuse('echo "missing meta credential in /x/auth.json: run muse login" >&2\nexit 1');   // Homer's singular line
    r = await run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi' });
    assert.match(r.because, /not signed in/, 'the singular credential line was not read as not signed in');
    fakeMuse('kill -SEGV $$');
    r = await run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi' });
    assert.equal(r.because, run.COULD_NOT_RUN, 'a crash was reported as a timeout (round 1)');
    fakeMuse('cat > /dev/null\ncat "' + path.join(SANDBOX, 'turn.jsonl') + '"');   // reads its input to the end
    r = await run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi' });
    assert.equal(r.ok, true, 'a Muse that reads its input waited on it (input must be closed, round 1)');
    fakeMuse("echo '" + TURN.split('\n')[2] + "'");   // a delta, then exit 0 with no terminal event
    r = await run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi' });
    assert.equal(r.ok, false, 'an exit 0 with no finished turn read as ok');
    assert.match(r.because, /stopped before finishing/);
  } finally { gate.resetForTests(); run.resetForTests(); }
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

test('#3939: runTurn never hangs or rejects: no answer at all, a closed gate, nothing installed', { timeout: 5000, skip: process.platform !== 'darwin' && 'the Mac branch' }, async () => {
  const marker = path.join(SANDBOX, 'ran.txt');
  fakeMuse('touch "' + marker + '"\nexit 0');
  run.setForTests({ runMuse: () => { /* never calls back */ }, hardCapMs: 200 });
  let r = await run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi' });
  assert.equal(r.because, run.TIMED_OUT);
  run.resetForTests();
  gate.resetForTests();
  fs.rmSync(marker, { force: true });
  r = await run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi' });   // gate closed
  assert.equal(r.ok, false);
  assert.equal(fs.existsSync(marker), false, 'with the gate closed, muse ran anyway (round 1)');
  fs.rmSync(path.join(SANDBOX, '.local'), { recursive: true, force: true });
  r = await run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi' });
  assert.match(r.because, /not on this computer|not wired up/);
});

test('#3939 round 1: at the timeout, what the launcher started is stopped too (its own process group)', { timeout: 8000, skip: process.platform !== 'darwin' && 'the Mac branch' }, async () => {
  const pidFile = path.join(SANDBOX, 'child.pid');
  fakeMuse('sleep 6 &\necho $! > "' + pidFile + '"\nwait');   // a launcher that does NOT exec its binary
  run.setForTests({ turnTimeoutMs: 300, hardCapMs: 20000 });
  gate.allowLiveExecution();
  try {
    /* #4159: on a loaded machine the 300 ms timeout can stop the launcher before it has started
       its child. Then there is no child and this case has not run, so run the turn again, up to
       TRIES times; the stop itself is checked on a turn where the child did start. The child
       counts as started only when the file holds a real pid: the stop can also land after the
       shell created the file and before echo wrote to it, and Number('') is 0, which
       process.kill reads as this whole process group. No new turn starts after DEADLINE_MS, which
       leaves a slow turn room to finish inside the test's 8 s timeout, so a machine too loaded
       to run this case gets the "did not run" message, not a bare timeout. */
    const TRIES = 5;
    const DEADLINE_MS = 4000;
    const deadline = Date.now() + DEADLINE_MS;
    const isRealPid = (p) => Number.isInteger(p) && p > 1;   // 0 is our own group, 1 is launchd
    const readPid = () => {
      try { return Number(fs.readFileSync(pidFile, 'utf8').trim()); } catch { return NaN; }
    };
    let r;
    let waited = 0;
    let pid = NaN;
    for (let i = 0; i < TRIES && Date.now() < deadline; i += 1) {
      fs.rmSync(pidFile, { force: true });
      const t0 = Date.now();
      r = await run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi' });
      waited = Date.now() - t0;
      pid = readPid();
      if (isRealPid(pid)) break;
    }
    assert.ok(isRealPid(pid), 'the launcher never started its child before the timeout (' + TRIES + ' turns or ' + DEADLINE_MS / 1000 + ' s), so this case did not run (#4159)');
    // Without the group stop, the child holds the output open and the turn waits for it to end on its own.
    assert.ok(waited < 3000, 'the turn waited ' + waited + ' ms on a child the launcher started');
    assert.equal(r.because, run.TIMED_OUT);
    await new Promise((res) => setTimeout(res, 200));
    let alive = true;
    try { process.kill(pid, 0); } catch { alive = false; }
    if (alive) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }   // only the PID this test started
    assert.equal(alive, false, 'the launcher\'s child kept running after the timeout');
  } finally { gate.resetForTests(); run.resetForTests(); }
});

test('#3939 round 2: with the gate closed, the refusal names the command but never the person\'s prompt', { timeout: 8000, skip: process.platform !== 'darwin' && 'the Mac branch' }, async () => {
  fakeMuse('exit 0');
  const seen = [];
  const real = gate.refuseOrWarn;
  gate.refuseOrWarn = (mod, file, args) => { seen.push({ mod, file, args }); };
  gate.resetForTests();
  try {
    await run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'my private plans for Tuesday' });
  } finally { gate.refuseOrWarn = real; }
  assert.equal(seen.length, 1, 'the closed gate was not asked (convention 3)');
  const said = JSON.stringify(seen[0]);
  assert.ok(!said.includes('my private plans'), 'the prompt reached the refusal log: ' + said);
  assert.equal(seen[0].args[seen[0].args.length - 1], '<prompt>');
  assert.equal(seen[0].args[0], 'exec', 'CONTROL: the rest of the command is still named');
});

test('#3939 round 2: the hard cap alone stops a running muse, not only answers for it', { timeout: 8000, skip: process.platform !== 'darwin' && 'the Mac branch' }, async () => {
  const pidFile = path.join(SANDBOX, 'cap.pid');
  fakeMuse('echo $$ > "' + pidFile + '"\nexec sleep 7');
  run.setForTests({ turnTimeoutMs: 60000, hardCapMs: 300 });   // the turn's own timeout would come far later
  gate.allowLiveExecution();
  try {
    const r = await run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi' });
    assert.equal(r.because, run.TIMED_OUT);
    const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    await new Promise((res) => setTimeout(res, 300));
    let alive = true;
    try { process.kill(pid, 0); } catch { alive = false; }
    if (alive) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }   // only the PID this test started
    assert.equal(alive, false, 'the hard cap answered, but muse kept running behind the answer');
  } finally { gate.resetForTests(); run.resetForTests(); }
});

test('#3939 round 3: a turn that says more than Kosmos reads is stopped at once, and says so', { timeout: 8000, skip: process.platform !== 'darwin' && 'the Mac branch' }, async () => {
  const pidFile = path.join(SANDBOX, 'over.pid');
  fakeMuse('echo $$ > "' + pidFile + '"\nhead -c 5000 /dev/zero | tr "\\0" x\nexec sleep 7');
  run.setForTests({ turnTimeoutMs: 60000, hardCapMs: 60000, maxBytes: 1024 });
  gate.allowLiveExecution();
  try {
    const t0 = Date.now();
    const r = await run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi' });
    assert.ok(Date.now() - t0 < 3000, 'the turn kept running past the output cap');
    assert.match(r.because, /said more than Kosmos reads/);
    assert.equal(r.ok, false);
  } finally {
    try { process.kill(Number(fs.readFileSync(pidFile, 'utf8').trim()), 'SIGKILL'); } catch { /* gone: only the PID this test started */ }
    gate.resetForTests(); run.resetForTests();
  }
});

test('#3939 round 3: once the launcher has exited, its group is never signalled (the number may be someone else\'s)', { timeout: 8000, skip: process.platform !== 'darwin' && 'the Mac branch' }, async () => {
  const pidFile = path.join(SANDBOX, 'launcher.pid'); const helperFile = path.join(SANDBOX, 'helper.pid');
  // A helper that leaves the group (a new session) keeps the output open after the launcher exits 0.
  fakeMuse('echo $$ > "' + pidFile + '"\nperl -MPOSIX -e \'setsid(); sleep 5\' &\necho $! > "' + helperFile + '"\nexit 0');
  run.setForTests({ turnTimeoutMs: 500, hardCapMs: 20000 });
  gate.allowLiveExecution();
  const realKill = process.kill; const groupSignals = [];
  process.kill = function (pid, sig) { if (pid < 0 && sig) groupSignals.push(pid); return realKill.apply(process, arguments); };
  try {
    const t0 = Date.now();
    const r = await run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi' });
    assert.ok(Date.now() - t0 < 3000, 'the turn waited on a helper outside the group');
    assert.equal(r.because, run.TIMED_OUT);
    const launcher = Number(fs.readFileSync(pidFile, 'utf8').trim());
    assert.ok(launcher > 0, 'CONTROL: the launcher ran');
    assert.deepEqual(groupSignals.filter((g) => g === -launcher), [], 'the exited launcher\'s group number was signalled');
  } finally {
    process.kill = realKill;
    try { process.kill(Number(fs.readFileSync(helperFile, 'utf8').trim()), 'SIGKILL'); } catch { /* gone: only the PID this test started */ }
    gate.resetForTests(); run.resetForTests();
  }
});

test('#3939 round 3: on anything but a Mac, runTurn refuses before running anything (the override bypasses slice 1\'s check)', { timeout: 5000 }, async () => {
  const marker = path.join(SANDBOX, 'win-ran.txt');
  fakeMuse('touch "' + marker + '"\nexit 0');
  process.env.AGENT_WORKFORCE_MUSE_BIN = BIN;
  run.setForTests({ platform: 'win32' });
  gate.allowLiveExecution();
  try {
    const r = await run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi' });
    assert.equal(r.because, run.NOT_WIRED_UP);
    assert.equal(fs.existsSync(marker), false, 'muse ran off a Mac');
  } finally { delete process.env.AGENT_WORKFORCE_MUSE_BIN; gate.resetForTests(); run.resetForTests(); }
});

test('#3939 3c-1: a refused turn ends the signed-in answer; a crash does not; a sign-in during the turn survives; a completed turn restores it', { timeout: 30000, skip: process.platform !== 'darwin' && 'the Mac branch' }, async () => {
  const musestatus = require('./musestatus');
  const markIn = () => { fs.mkdirSync(musestatus.signinFolder(), { recursive: true }); fs.writeFileSync(musestatus.signedInMarker(), '{}\n'); };
  const clean = () => { fs.rmSync(musestatus.signedInMarker(), { force: true }); fs.rmSync(musestatus.eventsFolder(), { recursive: true, force: true }); };
  const was = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = fs.mkdtempSync(path.join(SANDBOX, 'xdg-'));   // never the real auth.json (round 1)
  gate.allowLiveExecution();
  run.setForTests({ turnTimeoutMs: 4000, hardCapMs: 6000 });
  try {
    clean(); markIn();
    const old = Date.now() / 1000 - 60; fs.utimesSync(musestatus.signedInMarker(), old, old);   // signed in before the turns
    fakeMuse('kill -SEGV $$');
    await run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi' });
    assert.equal(musestatus.signedIn().signedIn, true, 'a crash ended the sign-in (it says nothing about it)');
    fakeMuse('echo "session ' + SID + ' is already in use" >&2\nexit 1');
    await run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi' });
    assert.equal(musestatus.signedIn().signedIn, true, 'a busy session ended the sign-in');
    fakeMuse('echo "missing meta credential in /x/auth.json: run muse login" >&2\nexit 1');
    let r = await run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi' });
    assert.match(r.because, /not signed in/, 'the turn\'s own answer changed');
    assert.equal(musestatus.signedIn().signedIn, false, 'a refused credential left Kosmos saying signed in');

    // The race (round 1): a turn that began signed out finishes AFTER the person signed in.
    clean();
    fakeMuse('sleep 1\necho "missing meta credential" >&2\nexit 1');
    const turn = run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi' });
    await new Promise((res) => setTimeout(res, 300));
    markIn();                                            // Kosmos's sign-in finished mid-turn
    r = await turn;
    assert.match(r.because, /not signed in/, 'CONTROL: the slow turn was refused');
    assert.deepEqual(musestatus.signedIn(), { signedIn: true, how: 'kosmos' }, 'a refusal that began before the sign-in undid it');

    // A completed turn restores the answer after a refusal (a terminal muse login is seen only this way).
    clean();
    musestatus.markSignedOut(Date.now() - 5000);   // refused well before: a same-millisecond tie is signed out by design (round 3)
    assert.equal(musestatus.signedIn().signedIn, false, 'CONTROL: signed out before the good turn');
    fakeMuse('cat > /dev/null\ncat "' + path.join(SANDBOX, 'turn.jsonl') + '"');
    r = await run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi' });
    assert.equal(r.ok, true, 'CONTROL: the turn completed');
    assert.deepEqual(musestatus.signedIn(), { signedIn: true, how: 'kosmos' }, 'a completed turn did not restore the answer');

    // Round 2: a slow success that began BEFORE another agent's refusal must not undo it.
    clean(); markIn();
    fakeMuse('sleep 1\ncat > /dev/null\ncat "' + path.join(SANDBOX, 'turn.jsonl') + '"');
    const slow = run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi' });
    await new Promise((res) => setTimeout(res, 300));
    musestatus.markSignedOut();                        // another agent's turn was refused meanwhile
    r = await slow;
    assert.equal(r.ok, true, 'CONTROL: the slow turn completed');
    assert.equal(musestatus.signedIn().signedIn, false, 'a slow success from before the refusal undid it');

    // Round 7: a refusal that FINISHES after another agent's success began is not beaten by it (overlap).
    clean();
    fakeMuse('sleep 1\necho "missing meta credential" >&2\nexit 1');
    const refusing = run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi' });
    await new Promise((res) => setTimeout(res, 300));
    musestatus.markTurnSignedIn(Date.now());            // another agent's turn began mid-refusal and completed
    r = await refusing;
    assert.match(r.because, /not signed in/, 'CONTROL: the slow turn was refused');
    assert.equal(musestatus.signedIn().signedIn, false, 'an overlapping success hid a refusal that finished after it');
  } finally {
    run.resetForTests(); clean();
    if (was === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = was;
  }
});

test('#3939 3c-3a: the caller\'s stop ends a running turn: Muse is stopped and the answer says Stopped', { timeout: 8000, skip: process.platform !== 'darwin' && 'the Mac branch' }, async () => {
  const pidFile = path.join(SANDBOX, 'stop.pid');
  fakeMuse('echo $$ > "' + pidFile + '"\nexec sleep 7');
  run.setForTests({ turnTimeoutMs: 60000, hardCapMs: 60000 });   // neither limit comes during this test
  gate.allowLiveExecution();
  try {
    let stop = null;
    const turn = run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi', onStop: (f) => { stop = f; } });
    assert.equal(typeof stop, 'function', 'the caller was not handed a stop');
    for (let i = 0; i < 250 && !fs.existsSync(pidFile); i++) await new Promise((res) => setTimeout(res, 20));
    assert.ok(fs.existsSync(pidFile), 'the fake muse never started, so this test cannot say anything about stop');
    stop();
    const r = await turn;
    assert.equal(r.ok, false);
    assert.equal(r.because, run.STOPPED);
    const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    await new Promise((res) => setTimeout(res, 300));
    let alive = true;
    try { process.kill(pid, 0); } catch { alive = false; }
    if (alive) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }   // only the PID this test started
    assert.equal(alive, false, 'Stopped was answered, but muse kept running behind it');
    assert.doesNotThrow(() => stop(), 'a second stop after the turn ended must do nothing');
  } finally { gate.resetForTests(); run.resetForTests(); }
});

/* #4603 (10-05 user diagnostic R7): the model is named while the turn runs, not only when it ends. */
test('#4603 R7: modelWatcher names the model from whole lines, across chunk and UTF-8 splits, and never throws', () => {
  const seen = [];
  const w = run.modelWatcher((m) => seen.push(m));
  const line = TURN.split('\n')[1] + '\n';   // the run.model.configured event
  const buf = Buffer.from('{"payload_type":"run.output.delta","payload":{"text":"café"}}\n' + line);
  // One byte at a time: the model line and a two-byte character are split everywhere they can be.
  for (let i = 0; i < buf.length; i++) w(buf.subarray(i, i + 1));
  assert.deepEqual(seen, ['muse-spark-1.3-contributor']);
  // A line that is not JSON, or names no model, is not a model; a throwing callback does not escape.
  w(Buffer.from('run.model.configured but not json\n{"payload_type":"run.model.configured","payload":{}}\n'));
  assert.deepEqual(seen, ['muse-spark-1.3-contributor'], 'a line with no model_id was read as one');
  assert.doesNotThrow(() => run.modelWatcher(() => { throw new Error('boom'); })(Buffer.from(line)));
  // A model event split by no newline yet is not read until its line ends.
  const w2seen = []; const w2 = run.modelWatcher((m) => w2seen.push(m));
  w2(Buffer.from(line.slice(0, -1)));
  assert.deepEqual(w2seen, [], 'a line was read before it ended');
  w2(Buffer.from('\n'));
  assert.deepEqual(w2seen, ['muse-spark-1.3-contributor']);
});

test('#4603 R7: a line longer than the cap is dropped whole, and the next line is still read', () => {
  const seen = [];
  const w = run.modelWatcher((m) => seen.push(m));
  // A model event that is only read if the whole over-long line was held: the cap is what keeps it out.
  const big = '{"payload_type":"run.model.configured","payload":{"model_id":"held-too-long","pad":"' + 'x'.repeat(70 * 1024) + '"}}';
  for (let i = 0; i < big.length; i += 4096) w(Buffer.from(big.slice(i, i + 4096)));
  w(Buffer.from('\n' + TURN.split('\n')[1] + '\n'));
  assert.deepEqual(seen, ['muse-spark-1.3-contributor'], 'the line after an over-long one was lost, or the long one was read');
});

test('#4603 R7: runTurn tells onModel while Muse still runs, and a stopped turn still carries the model', { timeout: 10000, skip: process.platform !== 'darwin' && 'the Mac branch' }, async () => {
  gate.allowLiveExecution();
  run.setForTests({ turnTimeoutMs: 8000, hardCapMs: 9000 });
  try {
    fakeMuse("echo '" + TURN.split('\n')[1] + "'\nexec sleep 7");
    let stopIt = null;
    let named = null;
    const gotModel = new Promise((ok) => { named = ok; });
    const p = run.runTurn({ workspace: WORK, sessionId: SID, prompt: 'hi', onStop: (f) => { stopIt = f; }, onModel: (m) => named(m) });
    const m = await Promise.race([gotModel, new Promise((_, no) => setTimeout(() => no(new Error('onModel did not fire while the turn ran')), 4000).unref())]);
    assert.equal(m, 'muse-spark-1.3-contributor');
    stopIt();
    const r = await p;
    assert.equal(r.because, run.STOPPED);
    assert.equal(r.model, 'muse-spark-1.3-contributor', 'a stopped turn dropped the model its stream named');
  } finally { gate.resetForTests(); run.resetForTests(); }
});
