'use strict';
/**
 * #570: the win32 roster provider synthesizes PANE_COLUMNS text from
 * `claude agents --json`, and it must FAIL CLOSED — only Kosmos-created sessions
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

test('#570 belt-and-suspenders: even a hand-built claude.exe pane with an EMPTY claim is NOT ours (process arm does not rescue it)', () => {
  // Prove the second fail-closed property directly: were an unrecorded row ever
  // emitted (empty claim), the ownership process arm must not claim it. Built via
  // the sanctioned fleet.line() (from PANE_COLUMNS) rather than a hand-typed line.
  const text = fleet.line({ session: 'agent1-d2', command: 'claude.exe', claim: '', title: 'agent1-d2' }) + '\n';
  const p = status.parsePanes(text)[0];
  assert.ok(p, 'the row parsed');
  assert.equal(p.claim, '', 'empty claim');
  assert.equal(status.isNamedOurs(p), false, 'claude.exe + empty claim is NOT ours (isNativeClaude is version-string only)');
});

test('#570: a failed `claude agents --json` returns NULL, not "" (so listPanes refuses honestly, not empty-machine)', () => {
  const src = win32roster.make({ run: () => null, record: { read: () => ({}) } });
  assert.equal(src(), null, 'run() null -> provider null (a failed look, not an empty machine)');
});

test('#570: an empty roster (no recorded / no live agents) returns "" (readable empty — unblocks create)', () => {
  assert.equal(providerWith([], {})(), '', 'no agents -> empty readable roster');
  assert.equal(providerWith([THEIRS], {})(), '', 'only unrecorded agents -> empty readable roster');
});

test('#570: the runner column rides through from the record', () => {
  const src = providerWith([OURS], { 'aaaa-1111': { name: 'raph-9a', runner: 'codex' } });
  const list = status.parsePanes(src());   // parsePanes returns the pane array directly
  assert.equal(list.length, 1);
  assert.equal(list[0].runner, 'codex', 'the recorded runner is emitted in the runner column');
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

test('#570 record: a corrupt store file reads as EMPTY (fail-safe -> nothing ours), not a throw', () => {
  fs.mkdirSync(win32sessions.DIR, { recursive: true });
  fs.writeFileSync(win32sessions.FILE, '{ not json', 'utf8');
  assert.deepEqual(win32sessions.read(), {}, 'a corrupt record reads empty, so nothing is ours');
  assert.equal(win32sessions.isOurs('anything'), false);
});
