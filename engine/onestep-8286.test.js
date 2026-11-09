'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273)

/**
 * kosmos#8286: one tool call running for minutes, read from the agent's own transcript. Row shapes are the ones measured
 * on Claude Code 2026-11-09 (renettilley's session): assistant rows per content block (thinking, tool_use), the user
 * tool_result row with the same tool_use_id, and other row types between them.
 *
 *   node --test engine/onestep-8286.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-onestep-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-onestep-proj-'));
const FLEET_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-onestep-fleet-'));
process.env.AGENT_WORKFORCE_WORKERS = path.join(FLEET_ROOT, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(FLEET_ROOT, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(FLEET_ROOT, 'launch');

const test = require('node:test');
const assert = require('node:assert/strict');
const onestep = require('./onestep');
const status = require('./status');

const T0 = Date.parse('2026-11-09T14:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const row = (o) => JSON.stringify(o);
const thinking = (at) => row({ type: 'assistant', timestamp: iso(at), message: { content: [{ type: 'thinking', thinking: '...' }] } });
const use = (id, name, at) => row({ type: 'assistant', timestamp: iso(at), message: { content: [{ type: 'tool_use', id, name, input: {} }] } });
const result = (id, at) => row({ type: 'user', timestamp: iso(at), message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
const prompt = (at) => row({ type: 'user', timestamp: iso(at), message: { content: 'next thing please' } });
const other = (at) => row({ type: 'pr-link', timestamp: iso(at) });

test('a tool_use with no result is the step in flight, since its own row', () => {
  const text = [prompt(T0), thinking(T0 + 1000), use('a', 'Bash', T0 + 2000)].join('\n');
  assert.deepEqual(onestep.openStep(text), { tool: 'Bash', since: iso(T0 + 2000) });
});

test('CONTROL: a tool_use whose result was written is closed, whatever rows sit between', () => {
  const text = [use('a', 'Bash', T0), other(T0 + 500), result('a', T0 + 1000), thinking(T0 + 2000)].join('\n');
  assert.equal(onestep.openStep(text), null, 'the model writing after a result is not a step');
});

test('several calls at once: the oldest still open is the one shown', () => {
  const text = [use('a', 'Read', T0), use('b', 'Bash', T0 + 1000), result('a', T0 + 2000)].join('\n');
  assert.deepEqual(onestep.openStep(text), { tool: 'Bash', since: iso(T0 + 1000) });
  const both = [use('a', 'Read', T0), use('b', 'Bash', T0 + 1000)].join('\n');
  assert.deepEqual(onestep.openStep(both), { tool: 'Read', since: iso(T0) });
});

test('a new prompt closes a call left with no result (an interrupt on some builds)', () => {
  const text = [use('a', 'Bash', T0), prompt(T0 + 5000), thinking(T0 + 6000)].join('\n');
  assert.equal(onestep.openStep(text), null);
});

test('a meta user row (a hook note) does not close an open call', () => {
  const meta = row({ type: 'user', isMeta: true, timestamp: iso(T0 + 100), message: { content: 'hook output' } });
  assert.deepEqual(onestep.openStep([use('a', 'Bash', T0), meta].join('\n')), { tool: 'Bash', since: iso(T0) });
});

test('a cut first line and junk rows are skipped, not fatal', () => {
  const text = '{"type":"assis' + '\n' + 'not json' + '\n' + use('a', 'Agent', T0);
  assert.deepEqual(onestep.openStep(text), { tool: 'Agent', since: iso(T0) });
  assert.equal(onestep.openStep(''), null);
  assert.equal(onestep.openStep(null), null);
});

function transcript(lines, mtimeMs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-onestep-t-'));
  const file = path.join(dir, 's.jsonl');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  fs.utimesSync(file, mtimeMs / 1000, mtimeMs / 1000);
  return file;
}

test('oneStepIn: shown once the step has run SHOW_MS; not before', () => {
  const start = T0;
  const file = transcript([use('a', 'Bash', start)], start + 100);
  assert.deepEqual(onestep.oneStepIn(file, { now: start + onestep.SHOW_MS + 1000 }), { tool: 'Bash', since: iso(start) });
  assert.equal(onestep.oneStepIn(file, { now: start + onestep.SHOW_MS - 60000 }), null, 'four minutes in: nothing yet');
});

test('oneStepIn: the age of the step itself is checked too, not only the file time (a restored file, a clock step)', () => {
  const now = T0 + 60 * 60000;
  const file = transcript([use('a', 'Bash', now - 2 * 60000)], T0);   // an old file time, a call two minutes old
  assert.equal(onestep.oneStepIn(file, { now }), null);
});

test('review 1: rows written mid-call (api-request, queue-operation, metadata) do not hide the step', () => {
  const mid = (t, at) => row({ type: t, timestamp: iso(at) });
  const now = T0 + 20 * 60000;
  const file = transcript([use('a', 'Bash', T0), mid('api-request', T0 + 60000), mid('queue-operation', now - 30000), mid('last-prompt', now - 10000)], now - 10000);
  assert.deepEqual(onestep.oneStepIn(file, { now }), { tool: 'Bash', since: iso(T0) }, 'the file was written seconds ago and the step is still 20 minutes old');
});

test('review 1: a call older than the session start was left open by a killed session, and is not shown', () => {
  const now = T0 + 200 * 3600e3;
  const file = transcript([use('a', 'Bash', T0)], T0 + 1000);
  assert.equal(onestep.oneStepIn(file, { now, notBefore: now - 3600e3 }), null);
  assert.deepEqual(onestep.oneStepIn(file, { now, notBefore: T0 - 1000 }), { tool: 'Bash', since: iso(T0) }, 'CONTROL: a call inside the session shows');
});

test('review 1: sidechain rows are skipped; an MCP tool is named by its last part', () => {
  const side = row({ type: 'assistant', isSidechain: true, timestamp: iso(T0), message: { content: [{ type: 'tool_use', id: 's', name: 'Bash', input: {} }] } });
  assert.equal(onestep.openStep(side), null);
  assert.equal(onestep.toolName('mcp__plugin_discord_discord__reply'), 'reply');
  assert.equal(onestep.toolName('Bash'), 'Bash');
  assert.equal(onestep.toolName(''), 'a tool');
});

test('review 1: an unchanged file is read once (the per-file cache), a changed one again', () => {
  const now = T0 + 20 * 60000;
  const file = transcript([use('a', 'Bash', T0)], T0 + 1000);
  assert.ok(onestep.oneStepIn(file, { now }));
  fs.writeFileSync(file, use('b', 'Read', T0 + 2000) + '\n');   // same name, new content and size
  fs.utimesSync(file, (T0 + 3000) / 1000, (T0 + 3000) / 1000);
  assert.deepEqual(onestep.oneStepIn(file, { now }), { tool: 'Read', since: iso(T0 + 2000) }, 'a changed file is read again');
});

test('oneStepIn: a closed step, a missing file, and nonsense answer null and never throw', () => {
  const file = transcript([use('a', 'Bash', T0), result('a', T0 + 1000)], T0 + 1000);
  assert.equal(onestep.oneStepIn(file, { now: T0 + 60 * 60000 }), null);
  assert.equal(onestep.oneStepIn('/no/such/file.jsonl'), null);
  assert.equal(onestep.oneStepIn(undefined), null);
});

test('oneStepIn reads only the tail: an open call far above the last TAIL_BYTES is not seen', () => {
  const pad = Array.from({ length: 9000 }, (_, i) => other(T0 + 10 + i));   // well over TAIL_BYTES of rows, all after the call
  const file = transcript([use('a', 'Bash', T0), ...pad], T0 + 5000);
  assert.ok(fs.statSync(file).size > onestep.TAIL_BYTES, 'the fixture is larger than the tail');
  assert.equal(onestep.oneStepIn(file, { now: T0 + 60 * 60000 }), null, 'a known residual: bounded read');
});

test('status.oneStepOf: a working, tied Claude Code card only; never another agent\'s transcript, a Windows pane or a killed session', () => {
  const file = transcript([use('a', 'Bash', T0)], T0 + 100);
  const now = T0 + 20 * 60000;
  const find = () => file;
  const start = () => T0 - 60000;
  const claude = { name: 'leo', session: 'leo', runner: '', command: 'claude' };
  const W = { state: 'working' };
  assert.deepEqual(status.oneStepOf(claude, W, true, now, find, start), { tool: 'Bash', since: iso(T0) });
  assert.equal(status.oneStepOf(claude, W, false, now, find, start), null, 'an untied pane: never read another agent\'s transcript');
  assert.equal(status.oneStepOf({ ...claude, runner: 'codex', command: 'codex' }, W, true, now, find, start), null, 'a Codex agent');
  for (const st of ['idle', status.STATE.NEEDS_YOU, status.STATE.STOPPED, 'rate_limited']) {
    assert.equal(status.oneStepOf(claude, { state: st }, true, now, find, start), null, 'not on a ' + st + ' card');
  }
  assert.equal(status.oneStepOf(claude, W, true, now, find, () => T0 + 1000), null, 'a call from before this session started');
  assert.deepEqual(status.oneStepOf(claude, W, true, now, find, () => null), { tool: 'Bash', since: iso(T0) }, 'an unknown session start keeps it');
  assert.equal(status.oneStepOf(claude, W, true, now, () => null, start), null, 'no transcript found');
  assert.equal(status.oneStepOf(claude, W, true, now, () => { throw new Error('boom'); }, start), null, 'never throws');
});

test('the page: the sentence names the step and its age, in #7368 words; never on the tile; after the Windows rule', () => {
  const page = require('../test-support/page');
  const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8'));
  const stateReason = new Function(page.lift(SCRIPT, 'stateReason') + '\nreturn stateReason;')();
  const MIN = 60000;
  const card = (mins, extra) => ({ name: 'Ada', state: 'working', oneStep: { tool: 'Bash', since: new Date(Date.now() - mins * MIN).toISOString() }, ...extra });
  assert.equal(stateReason(card(12)), 'Ada has been on one step for about 12 minutes: Bash. If that is a long job, it is fine; if not, open it to see what it shows.');
  assert.match(stateReason(card(130)), /^Ada has been on one step for about 2 hours: Bash\./);
  assert.equal(stateReason(card(12), { card: true }), '', 'never on the tile (#6716)');
  assert.equal(stateReason({ name: 'Ada', state: 'working' }), '', 'CONTROL: a working card with no step says nothing');
  assert.equal(stateReason({ ...card(12), state: 'idle' }), '', 'an idle card is not on a step');
  // The Windows sentence (#7368) names waiting messages too, so it is kept when both are present.
  const both = card(70, { deliveryStall: { since: new Date(Date.now() - 70 * MIN).toISOString(), count: 2, lastWhy: 'turn', step: 'running x' } });
  assert.match(stateReason(both), /2 messages are waiting behind it/);
  // Review 1: and #7212's "no message has reached it" keeps priority too.
  const stall = card(40, { deliveryStall: { since: new Date(Date.now() - 40 * MIN).toISOString(), count: 1, lastWhy: 'menu', words: 'its box held a menu' } });
  assert.match(stateReason(stall), /^No message has reached Ada/);
});
