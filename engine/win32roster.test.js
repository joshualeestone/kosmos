'use strict';
/**
 * #570: the win32 roster provider synthesizes PANE_COLUMNS text from
 * `claude agents --json`, and it must FAIL CLOSED - only Kosmos-created sessions
 * become ours, and the ownership PROCESS arm must never rescue an unrecorded
 * session. These tests drive the provider through the REAL status.js parse +
 * ownership logic (the strongest check: the synthesized line must work with the
 * unchanged engine, not just look right).
 *
 *   node --test engine/win32roster.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

// A sandbox data root BEFORE requiring anything that reads the store, so the
// win32sessions unit tests never touch the real record.
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'win32roster-570-'));
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');

const status = require('./status');
const win32roster = require('./win32roster');
const win32sessions = require('./win32sessions');
const fleet = require('../test-support/fleet');

// A fixture straight from real `claude agents --json` output.
const OURS = { pid: 100, cwd: '/w/raph', kind: 'interactive', startedAt: 1, sessionId: 'aaaa-1111', name: 'raph-9a', status: 'idle' };
const THEIRS = { pid: 200, cwd: '/Users/agent1', kind: 'interactive', startedAt: 2, sessionId: 'bbbb-2222', name: 'agent1-d2', status: 'busy' }; // the operator's OWN session

function providerWith(agents, recordMap) {
  return win32roster.make({
    run: () => agents,
    record: { read: () => recordMap },
  });
}

test('#570 fail-closed: a RECORDED live session is emitted and reads as OURS + an AGENT through real status.js', () => {
  const src = providerWith([OURS], { 'aaaa-1111': { name: 'raph-9a', runner: '' } });
  const list = status.parsePanes(src());   // parsePanes returns the pane array directly
  assert.equal(list.length, 1, 'exactly the one recorded session is emitted');
  const p = list[0];
  assert.equal(p.command, 'claude.exe', 'command is claude.exe (agent, not process-arm-ours)');
  assert.equal(p.claim, 'raph-9a', 'claim equals the name so isNamedOurs matches');
  assert.equal(status.isNamedOurs(p), true, 'a recorded session is OURS via the claim arm');
  assert.equal(status.isAgentSession(p), true, 'claude.exe classifies as a Claude agent (typeable/restartable)');
});

test('#570 fail-closed: an UNRECORDED live session (the operator\'s own) is NEVER emitted', () => {
  // Both live; only OURS recorded. THEIRS must not appear at all.
  const src = providerWith([OURS, THEIRS], { 'aaaa-1111': { name: 'raph-9a', runner: '' } });
  const names = status.parsePanes(src()).map((p) => p.session);
  assert.ok(names.includes('raph-9a'), 'the recorded session is present');
  assert.ok(!names.includes('agent1-d2'), 'the operator\'s own session is absent (fail-closed by construction)');
});

test('#570 defense-in-depth: a claude.exe pane with an EMPTY claim is NOT a fleet session, but a VERSION-STRING command IS (proving claude.exe is the load-bearing choice)', () => {
  // Property 2 is: command="claude.exe" classifies as an agent yet does NOT let the
  // ownership PROCESS arm claim an unrecorded row. That arm is isNativeClaude, and
  // it lives inside isFleetSession (isNamedOurs(pane) || isNativeClaude(pane.command)),
  // NOT in isNamedOurs -- which never reads the command column at all and so returns
  // false for EVERY command. So the load-bearing assertion is on isFleetSession, and
  // the CONTRAST row (a version-string command, which the process arm DOES claim) is
  // the control that can return the dangerous answer -- without it this test would
  // pass even if property 2 were violated.
  const mk = (command) =>
    status.parsePanes(fleet.line({ session: 'agent1-d2', command, claim: '', title: 'agent1-d2' }) + '\n')[0];

  const exe = mk('claude.exe');
  assert.ok(exe, 'the claude.exe row parsed');
  assert.equal(exe.claim, '', 'empty claim');
  assert.equal(status.isNamedOurs(exe), false, 'the NAME arm does not claim it (empty claim, non-discord session)');
  assert.equal(status.isFleetSession(exe), false, 'the PROCESS arm does not claim it either: isNativeClaude("claude.exe") is false');
  assert.equal(status.isAgentSession(exe), false, 'so it is not an agent session (not writable/restartable)');

  // Control: the ONLY change is the command. A version string fires isNativeClaude,
  // so the process arm WOULD rescue this same unrecorded row -> the test CAN return
  // the dangerous answer, and choosing claude.exe (not a version string) is exactly
  // what prevents it.
  const ver = mk('2.1.212');
  assert.equal(status.isFleetSession(ver), true, 'a version-string command IS claimed by the process arm (the dangerous answer claude.exe avoids)');
});

test('#570: a failed `claude agents --json` returns NULL, not "" (so listPanes refuses honestly, not empty-machine)', () => {
  const src = win32roster.make({ run: () => null, record: { read: () => ({}) } });
  assert.equal(src(), null, 'run() null -> provider null (a failed look, not an empty machine)');
});

test('#570: an empty roster (no recorded / no live agents) returns "" (readable empty - unblocks create)', () => {
  assert.equal(providerWith([], {})(), '', 'no agents -> empty readable roster');
  assert.equal(providerWith([THEIRS], {})(), '', 'only unrecorded agents -> empty readable roster');
});

test('#570: the runner column rides through from the record', () => {
  const src = providerWith([OURS], { 'aaaa-1111': { name: 'raph-9a', runner: 'codex' } });
  const list = status.parsePanes(src());   // parsePanes returns the pane array directly
  assert.equal(list.length, 1);
  assert.equal(list[0].runner, 'codex', 'the recorded runner is emitted in the runner column');
});

test('#570 emit guard: a corrupt store with an OWN __proto__ key + a live session of that id is NOT emitted (validId gate)', () => {
  // The one path property 1 does not close by construction: JSON.parse of a
  // hand-corrupted store yields an OWN "__proto__" key, and were a live session
  // ever named "__proto__", hasOwnProperty(owned, id) would be true. The emit-loop
  // validId gate rejects the id first, so nothing is emitted. (Both halves are
  // outside the single-local-user threat model; this makes the record the sole
  // trust root explicitly rather than by construction.)
  const owned = JSON.parse('{"__proto__":{"name":"evil","runner":""}}'); // an OWN __proto__ key
  assert.equal(Object.prototype.hasOwnProperty.call(owned, '__proto__'), true, 'the corrupt store has an own __proto__ key');
  const liveAgent = { pid: 1, cwd: '/x', kind: 'interactive', startedAt: 1, sessionId: '__proto__', name: 'evil', status: 'idle' };
  const src = win32roster.make({ run: () => [liveAgent], record: { read: () => owned } });
  assert.equal(src(), '', 'an invalid id is never emitted, even when a matching own key exists in the store');
});

test('#570 emit guard: a corrupt store with a ZERO-WIDTH name + a live session of that id is NOT emitted (validName gate)', () => {
  // The name pair of the id guard above: a hand-corrupted store could hold a
  // zero-width name (bypassing record()'s write-time gate). The bare truthiness
  // belt AND status.js's .trim() would both pass it, emitting a degenerate
  // invisible row that reads as ours. The emit-loop validName gate rejects it.
  const owned = { 'aaaa-1111': { name: '\u200b\u200b', runner: '' } };
  const src = win32roster.make({ run: () => [OURS], record: { read: () => owned } });
  assert.equal(src(), '', 'a zero-width recorded name is not emitted (validName re-checked at read time)');
});

// ---- win32sessions record store (the ownership authority) ----

test('#570 record: record/read/isOurs/forget round-trip, keyed on sessionId', () => {
  win32sessions.record('sess-xyz', { name: 'leo-11', runner: '' });
  assert.equal(win32sessions.isOurs('sess-xyz'), true, 'a recorded session is ours');
  assert.equal(win32sessions.isOurs('sess-unknown'), false, 'an unrecorded session is NOT ours (fail-closed)');
  const all = win32sessions.read();
  assert.equal(all['sess-xyz'].name, 'leo-11');
  win32sessions.forget('sess-xyz');
  assert.equal(win32sessions.isOurs('sess-xyz'), false, 'forget removes it');
});

test('#570 record: a record with no name is refused; a bad id is refused', () => {
  assert.equal(win32sessions.record('sess-ok', {}).ok, false, 'no name -> refused');
  assert.equal(win32sessions.record('has space', { name: 'x' }).ok, false, 'a bad id -> refused');
  assert.equal(win32sessions.isOurs(''), false, 'empty id is not ours');
});

test('#570 record: a name with no VISIBLE character is refused (whitespace AND zero-width)', () => {
  assert.equal(win32sessions.record('sess-blank', { name: '   ' }).ok, false, 'all-whitespace name -> refused');
  assert.equal(win32sessions.isOurs('sess-blank'), false, 'a blank-named session is never recorded/ours');
  // .trim() alone would let this through: U+200B is not JS-whitespace.
  assert.equal(win32sessions.record('sess-zw', { name: '\u200b\u200b' }).ok, false, 'all-zero-width name -> refused');
  assert.equal(win32sessions.isOurs('sess-zw'), false, 'a zero-width-named session is never recorded/ours');
  // A real (visible) name still records, even padded with invisibles.
  assert.equal(win32sessions.record('sess-real', { name: ' raph-9a ' }).ok, true, 'a visible name still records');
  win32sessions.forget('sess-real');
});

test('#570 record: a valid id that names an Object.prototype member (toString) round-trips correctly', () => {
  // "toString" passes the charset and is NOT reserved (it is a harmless data key,
  // unlike __proto__), so record/isOurs/forget must handle it like any other id.
  // forget() uses hasOwnProperty (not `in`) precisely so such names behave.
  assert.equal(win32sessions.record('toString', { name: 'leo-11' }).ok, true, 'toString is a valid id and records');
  assert.equal(win32sessions.isOurs('toString'), true, 'recorded toString-id reads as ours');
  win32sessions.forget('toString');
  assert.equal(win32sessions.isOurs('toString'), false, 'forget removes a prototype-member-named id');
});

test('#570 record: a JS-reserved key (__proto__) is refused HONESTLY, not ok:true on a silent no-op', () => {
  // __proto__ passes the charset but `obj["__proto__"] = {...}` hits the
  // prototype setter, not an own key, so it would vanish at JSON.stringify and
  // record() would (without the RESERVED gate) return ok:true on a write that
  // did nothing. Assert the honest refusal AND that ownership never leaks.
  const r = win32sessions.record('__proto__', { name: 'evil' });
  assert.equal(r.ok, false, '__proto__ is refused (ok:false), not a silent ok:true no-op');
  assert.equal(win32sessions.isOurs('__proto__'), false, '__proto__ is never ours');
  assert.equal(Object.prototype.hasOwnProperty.call(win32sessions.read(), '__proto__'), false,
    'the store gained no own __proto__ key');
});

test('#570 record: a corrupt store file reads as EMPTY (fail-safe -> nothing ours), not a throw', () => {
  fs.mkdirSync(win32sessions.DIR, { recursive: true });
  fs.writeFileSync(win32sessions.FILE, '{ not json', 'utf8');
  assert.deepEqual(win32sessions.read(), {}, 'a corrupt record reads empty, so nothing is ours');
  assert.equal(win32sessions.isOurs('anything'), false);
});
