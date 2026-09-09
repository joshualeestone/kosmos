'use strict';
/**
 * #570: the win32 arm of `runningas` -- "what account and model is this agent
 * ACTUALLY running on", on a machine with no tmux.
 *
 * 🛑 WHAT THIS ARM MUST NOT DO IS THE POINT. The module exists because agents
 * gave confident wrong answers about their account off briefs that had gone
 * stale. Windows cannot read another process's environment, so the account is
 * genuinely unknowable live there -- and the tempting bug is to fall back to the
 * default config dir, which is what the darwin arm does when the variable is
 * ABSENT from an environment it successfully read. Here the environment was
 * never read at all, so that fallback would be a confident answer off a look
 * that did not happen. Several tests below exist only to pin that null.
 *
 * 🔑 EVERY INPUT IS INJECTED, INCLUDING THE PLATFORM, so the fleet's Macs can
 * assert this arm and this Windows box can assert the darwin one. Nothing here
 * shells a real `claude`, a real tmux or a real PowerShell.
 *
 *   node --test engine/runningas.win32-570.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const runningas = require('./runningas');

const WIN = 'win32';
const CLAUDE = 'C:\\Users\\x\\AppData\\Local\\claude\\claude.exe';

/** One owned, live agent, as `win32live.byName` hands it over. */
function joined(over) {
  const e = { name: 'raph-9a', sessionId: 'aaaa-1111', pid: 4242, status: 'idle', liveName: 'raph-50', runner: 'claude', ...over };
  return new Map([[e.name, e]]);
}
const cmdlinesOf = (map) => () => new Map(map);

test('#570 win32: the model is read live off the claude process the ownership join named', () => {
  const r = runningas.runningAs('raph-9a', {
    platform: WIN,
    live: () => joined(),
    cmdlines: cmdlinesOf([[4242, CLAUDE + ' --model claude-opus-5 --session-id aaaa-1111']]),
  });
  assert.equal(r.ok, true, r.because);
  assert.equal(r.model, 'claude-opus-5');
});

test('#570 win32 CONTROL: two different command lines give two different models', () => {
  /* Without this, every assertion above passes against a reader that returns one
     hardcoded answer -- the acceptance bar #1304 set for this module. */
  const model = (cmd) => runningas.runningAs('raph-9a', {
    platform: WIN, live: () => joined(), cmdlines: cmdlinesOf([[4242, cmd]]),
  }).model;
  assert.equal(model(CLAUDE + ' --model claude-opus-5'), 'claude-opus-5');
  assert.equal(model(CLAUDE + ' --model claude-fable-5'), 'claude-fable-5');
  assert.equal(model(CLAUDE + ' --session-id aaaa-1111'), null, 'no --model flag is an honest null, not the last answer');
  assert.equal(model(CLAUDE + ' --model=claude-opus-5'), 'claude-opus-5', 'the = form is the same flag');
});

test('#570 win32: the ACCOUNT is null and says why -- never the default account by assumption', () => {
  /* 🛑 The whole card. `CLAUDE_CONFIG_DIR` lives in the process ENVIRONMENT and
     Windows will not show it, so "no override was seen, therefore the default
     account" is a guess dressed as a reading. Baron was MIGRATED off the account
     his brief named; a defaulted answer would have said the stale thing
     confidently, which is the failure this module was built to remove. */
  const r = runningas.runningAs('raph-9a', {
    platform: WIN, live: () => joined(), cmdlines: cmdlinesOf([[4242, CLAUDE + ' --model claude-opus-5']]),
  });
  assert.equal(r.ok, true, 'the look DID happen: an unreadable account is not a failure to look');
  assert.equal(r.account, null);
  assert.equal(r.organization, null);
  assert.equal(r.configDir, null, 'a synthesised default config dir here would be a confident wrong answer about an account');
  assert.match(r.because, /environment/, 'a null with no reason is indistinguishable from a bug');
  assert.equal(r.model, 'claude-opus-5', 'CONTROL: the half that IS knowable is still answered');
});

test('#570 win32: an agent the join does not own says so, and invents nothing', () => {
  const r = runningas.runningAs('not-an-agent', {
    platform: WIN, live: () => joined(), cmdlines: cmdlinesOf([]),
  });
  assert.equal(r.ok, false);
  assert.match(r.because, /no session called not-an-agent/);
  assert.equal(r.account, undefined, 'it invented an account for a session it cannot see');
  assert.equal(r.model, undefined);
});

test('#570 win32: a FAILED live look and an UNKNOWN session are different refusals', () => {
  /* "We could not see what is running" and "that agent is not running" are
     different answers and only one of them is ever true -- the same distinction
     win32live draws with null vs []. */
  const failed = runningas.runningAs('raph-9a', { platform: WIN, live: () => null, cmdlines: cmdlinesOf([]) });
  const missing = runningas.runningAs('raph-9a', { platform: WIN, live: () => new Map(), cmdlines: cmdlinesOf([]) });
  assert.equal(failed.ok, false);
  assert.equal(missing.ok, false);
  assert.match(failed.because, /could not read the live Claude sessions/);
  assert.notEqual(failed.because, missing.because, 'the two refusals must not read the same to an operator');
});

test('#570 win32: a session with no pid, and a pid gone by the time we looked, refuse in their own words', () => {
  const noPid = runningas.runningAs('raph-9a', {
    platform: WIN, live: () => joined({ pid: null }), cmdlines: cmdlinesOf([]),
  });
  assert.equal(noPid.ok, false);
  assert.match(noPid.because, /no process id/);

  const gone = runningas.runningAs('raph-9a', {
    platform: WIN, live: () => joined(), cmdlines: () => new Map(),   // the read worked; the pid is not in it
  });
  assert.equal(gone.ok, false);
  assert.match(gone.because, /gone by the time we looked/);

  const unreadable = runningas.runningAs('raph-9a', {
    platform: WIN, live: () => joined(), cmdlines: () => null,        // the read itself failed
  });
  assert.equal(unreadable.ok, false);
  assert.match(unreadable.because, /could not read the process table/);
  assert.notEqual(gone.because, unreadable.because, '"the process is gone" and "we could not look" are different facts');
});

test('#570 win32: everyone() answers for the whole fleet with ONE process read, sorted by name', () => {
  /* ⚠️ THE COUNT IS THE ASSERTION. The darwin `everyone()` carries a comment
     about exactly this defect: a per-session read there cost a full `ps` per
     pane AND multiplied the timeout by the fleet. On win32 each read is a
     PowerShell start (~0.5s), so the same mistake is more expensive, not less. */
  let reads = 0;
  const fleet = new Map([
    ['b-9a', { name: 'b-9a', sessionId: 'b', pid: 2, status: 'busy', liveName: 'b-2', runner: '' }],
    ['a-9a', { name: 'a-9a', sessionId: 'a', pid: 1, status: 'idle', liveName: 'a-1', runner: '' }],
  ]);
  const all = runningas.everyone({
    platform: WIN,
    live: () => fleet,
    cmdlines: (pids) => {
      reads++;
      assert.deepEqual([...pids].sort(), [1, 2], 'every pid must be asked for in the one call');
      return new Map([[1, CLAUDE + ' --model claude-opus-5'], [2, CLAUDE + ' --model claude-fable-5']]);
    },
  });
  assert.equal(reads, 1, 'a process read per agent multiplies the worst case by the size of the fleet');
  assert.deepEqual(all.map((a) => a.session), ['a-9a', 'b-9a']);
  assert.deepEqual(all.map((a) => a.model), ['claude-opus-5', 'claude-fable-5'],
    'CONTROL: the batched read is still attributed per pid, not smeared across the fleet');
});

test('#570 win32: everyone() on a failed live look reports nothing rather than an empty fleet with answers', () => {
  assert.deepEqual(runningas.everyone({ platform: WIN, live: () => null, cmdlines: cmdlinesOf([]) }), []);
});

test('#570 THE PLATFORM IS INJECTED: the same deps take different arms, so either machine can assert either', () => {
  /* 🔑 This is what makes the whole file meaningful on a Mac. If the arm were
     chosen by a bare `process.platform` read, every assertion above would be
     unreachable on the fleet's machines and this suite would be decoration
     wherever it mattered. */
  const deps = {
    live: () => joined(),
    cmdlines: cmdlinesOf([[4242, CLAUDE + ' --model claude-opus-5']]),
    // The darwin arm's inputs, supplied so the control cannot fail merely for
    // want of a process table.
    panes: new Map([['raph-9a', 4242]]),
    procs: new Map([[4242, { ppid: 1, command: '/usr/local/bin/claude --model claude-fable-5' }]]),
    envOf: () => 'CLAUDE_CONFIG_DIR=/Users/x/.claude-account-d claude',
    identityOf: () => ({ email: 'agent@example.com', organization: 'Example' }),
  };
  const win = runningas.runningAs('raph-9a', { ...deps, platform: 'win32' });
  const mac = runningas.runningAs('raph-9a', { ...deps, platform: 'darwin' });
  assert.equal(win.model, 'claude-opus-5', 'win32 must read the pid the ownership join named');
  assert.equal(mac.model, 'claude-fable-5', 'darwin must still walk the process tree');
  assert.equal(win.account, null);
  assert.equal(mac.account, 'agent@example.com', 'the darwin arm is UNCHANGED: it still reads the account out of the environment');
  assert.notEqual(win.model, mac.model, 'the two arms must be able to return different values, or the dispatch is not observable');
});

/* ── the PowerShell reply parser ─────────────────────────────────────────── */

test('#570 win32 parse: an unmade look is NULL, not an empty process table', () => {
  /* 🛑 THE FALSE-ZERO GUARD. `Get-CimInstance` with a filter matching nothing
     exits 0 with NO output, so empty stdout cannot by itself mean "that process
     is not there" -- it is equally what a missing powershell.exe, a timeout or a
     spent budget produces. The sentinel is what separates them, and injecting
     `cmdlines` in every test above replaces this parser wholesale, so without
     this it would be asserted nowhere. */
  assert.equal(runningas._parseCmdlines(''), null, 'no sentinel: the look never completed');
  assert.equal(runningas._parseCmdlines(undefined), null);
  assert.equal(runningas._parseCmdlines('4242 claude --model m\r\n'), null,
    'rows without the sentinel are a TRUNCATED read, which must not read as a complete one');
  const empty = runningas._parseCmdlines('\r\nKOSMOS-CMDLINES-OK\r\n');
  assert.ok(empty instanceof Map, 'CONTROL: with the sentinel, no rows is a real answer');
  assert.equal(empty.size, 0);
});

test('#570 win32 parse: real PowerShell output, including a process whose command line is unreadable', () => {
  /* Measured shape (2026-09-09, this box): CRLF, `<pid> <command line>`, a
     trailing blank line from Out-String, and a protected process (pid 4, System)
     whose CommandLine is null -- which arrives as a pid with an EMPTY command
     line. Empty is not the same as absent: the process IS there, we just cannot
     read its arguments, so it must not be reported as "gone". */
  const out = [
    '4 ',
    '12180 C:\\Users\\joshu\\claude.exe --model claude-opus-5 --session-id aaaa-1111',
    '',
    'KOSMOS-CMDLINES-OK',
    '',
  ].join('\r\n');
  const map = runningas._parseCmdlines(out);
  assert.equal(map.get(4), '', 'a protected process is present with no readable command line');
  assert.match(map.get(12180), /--model claude-opus-5/);
  assert.equal(map.has(999), false);
});

test('#570 win32 parse: a present-but-argumentless process is UNKNOWN model, not a missing process', () => {
  /* The two land on different answers, and conflating them would report a live
     agent as gone. */
  const map = runningas._parseCmdlines('4242 \r\nKOSMOS-CMDLINES-OK\r\n');
  const r = runningas.runningAs('raph-9a', { platform: WIN, live: () => joined(), cmdlines: () => map });
  assert.equal(r.ok, true, 'the process was found; only its arguments were unreadable');
  assert.equal(r.model, null);
});
