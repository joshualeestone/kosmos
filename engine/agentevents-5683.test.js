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

const ctx = (over) => Object.assign({ agent: 'Scout', session: 'sess-1', boardRoot: '/Users/ann/Library/Kosmos',
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
    ['tu-1', 'token-only-guard', 'run', 'home'],
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
  assert.equal(ae.targetClass('Bash', { command: 'curl -d @~/secrets x' }, c), 'other');
  assert.equal(ae.targetClass('Bash', { command: 'cat "~/notes.txt"' }, c), 'home');
});

test('#5683 labels: a control or bidi character, or an empty one, is not sent', () => {
  assert.equal(ae.label('Scout'), 'Scout');
  assert.equal(ae.label('Sco‮ut'), null);
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
    dirOf: (n) => '/Users/ann/work/workers/' + n.toLowerCase(),
    transcripts: async (dir) => { read.push(dir); return dir.endsWith('/scout') ? [file] : []; },
  });
  return { root, file, sources, read };
}
const append = (file, ...lines) => fs.appendFileSync(file, lines.join('\n') + '\n');

test('#5683 tick: a Kosmos that is not the enrolled one opens no transcript and sends nothing', async (t) => {
  const s = setup(t);
  const c = coordinator();
  const r = await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(r.sent, 0);
  assert.deepEqual(s.read, [], 'a transcript was opened for a company that does not exist');
  assert.deepEqual(c.sent, []);
});

test('#5683 tick: history before the enrollment is never sent; a new refusal is, once, with no content', async (t) => {
  const s = setup(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root: s.root, remote: c });
  accept(s.root);
  let r = await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(r.sent, 0, 'a refusal from before the enrollment was sent');
  append(s.file, use('new-1', 'Bash', { command: SECRET }), result('new-1', DENIED(SECRET), true));
  r = await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(r.sent, 1);
  const sends = c.sent.filter((x) => x.route === ae.ROUTE);
  assert.equal(sends.length, 1);
  const e = sends[0].body.events[0];
  assert.deepEqual(Object.keys(e).sort(), ['action', 'agent', 'at', 'rule', 'sessionRef', 'targetClass', 'toolUseRef', 'world']);
  assert.equal(e.world, oe.readEnrollment({ root: s.root }).world);
  assert.equal(e.toolUseRef, 'new-1');
  assert.equal(JSON.stringify(sends[0].body).includes('board.token'), false, 'content reached the company');
  r = await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(r.sent, 0, 'the same refusal was sent twice');
});

test('#5683 tick: only token-only agents are read; a failed send keeps the events for the next tick', async (t) => {
  const s = setup(t);
  let refuse = true;
  const c = coordinator(() => (refuse ? { ok: false, because: '503' } : { ok: true, data: { ok: true } }));
  await oe.enroll('ACME-JOIN-1234', true, { root: s.root, remote: c });
  accept(s.root);
  await ae.tick({ root: s.root, remote: c, sources: s.sources([]), now: Date.now() });
  assert.deepEqual(s.read, [], 'an agent that is not token-only had its transcript read');
  await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  append(s.file, use('n2', 'Bash', { command: 'x' }), result('n2', DENIED('x'), true));
  let r = await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(r.sent, 0);
  refuse = false;
  r = await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(r.sent, 0, 'sent again inside the wait after a failure (review 2)');
  r = await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() + 31 * 60e3 });
  assert.equal(r.sent, 1, 'the event a failed send left queued was not sent later');
});

test('#5683 tick: at most 50 events go in one send, the rest next tick', async (t) => {
  const s = setup(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root: s.root, remote: c });
  accept(s.root);
  await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  const lines = [];
  for (let i = 0; i < 60; i++) lines.push(use('m' + i, 'Bash', { command: 'x' }), result('m' + i, DENIED('x'), true));
  append(s.file, ...lines);
  assert.equal((await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() })).sent, 50);
  assert.equal((await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() })).sent, 10);
});

test('#5683 tick: enrolled but with no accepted words recorded here opens no transcript and sends nothing', async (t) => {
  const s = setup(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root: s.root, remote: c });   // joined, but accept() never ran
  await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.deepEqual(s.read, [], 'a transcript was read under an enrollment with no accepted words');
  assert.equal(c.sent.some((x) => x.route === ae.ROUTE), false);
});

test('#5683 tick: a batch the coordinator refuses as unreadable is dropped, so it never holds back later events', async (t) => {
  const s = setup(t);
  let bad = true;
  const c = coordinator(() => (bad ? { ok: false, because: '400 {"code":"org_agent_events_bad"}' } : { ok: true, data: { ok: true } }));
  await oe.enroll('ACME-JOIN-1234', true, { root: s.root, remote: c });
  accept(s.root);
  await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  append(s.file, use('p1', 'Bash', { command: 'x' }), result('p1', DENIED('x'), true));
  const r = await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(r.dropped, 1, 'the refused batch was kept to be refused again');
  bad = false;
  append(s.file, use('p2', 'Bash', { command: 'x' }), result('p2', DENIED('x'), true));
  await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
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
  await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(c.sent.some((x) => x.route === ae.ROUTE), false, 'an event an hour ahead was sent');
});

test('#5683 r1: the company changing its words stops the sends; words accepted again send nothing from the gap', async (t) => {
  const s = setup(t);
  let refuse = true;
  const c = coordinator(() => (refuse ? { ok: false, because: '409 {"code":"org_consent_changed"}' } : { ok: true, data: { ok: true } }));
  await oe.enroll('ACME-JOIN-1234', true, { root: s.root, remote: c });
  accept(s.root);
  await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });   // Scout is seen listed
  await new Promise((r) => setTimeout(r, 1100));
  append(s.file, use('g1', 'Bash', { command: 'x' }), result('g1', DENIED('x'), true));
  await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
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
  await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });   // a new consent state has no failure wait
  await new Promise((r) => setTimeout(r, 1100));
  append(s.file, use('g3', 'Bash', { command: 'x' }), result('g3', DENIED('x'), true));
  await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
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
  const r = await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(r.sent, 0);
  assert.equal(c.sent.some((x) => x.route === ae.ROUTE), false);
});

test('#5683 r1: a call in one tick and its sandbox result in the next is sent as a sandbox refusal', async (t) => {
  const { s, c } = await enrolled(t);
  append(s.file, use('sp', 'Bash', { command: 'touch /etc/x' }));
  await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  append(s.file, result('sp', 'touch: /etc/x: Operation not permitted', true));
  await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  const ev = c.sent.filter((x) => x.route === ae.ROUTE).flatMap((x) => x.body.events);
  assert.deepEqual(ev.map((e) => [e.toolUseRef, e.rule, e.targetClass]), [['sp', 'sandbox', 'system']]);
});

/* ---- review 2 ---- */

test('#5683 r2: an agent made token-only after joining sends nothing from before it was listed', async (t) => {
  const { s, c } = await enrolled(t);
  /* Rex is not token-only yet: a refusal by the person's own rule. */
  const rexFile = path.join(path.dirname(s.file), 'rex-1.jsonl');
  fs.writeFileSync(rexFile, use('own', 'Bash', { command: 'x' }) + '\n' + result('own', DENIED('x'), true) + '\n');
  const src = (agents) => ({ agents: () => agents, dirOf: (n) => '/w/' + n, transcripts: async (d) => (d === '/w/Rex' ? [rexFile] : []) });
  await ae.tick({ root: s.root, remote: c, sources: src([]), now: Date.now() });
  await new Promise((r) => setTimeout(r, 1100));
  await ae.tick({ root: s.root, remote: c, sources: src(['Rex']), now: Date.now() });   // now listed
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
  const src = { agents: () => ['Scout'], dirOf: () => '/w/scout', transcripts: async () => [old] };
  await ae.tick({ root: s.root, remote: c, sources: src, now: Date.now() });
  const st = JSON.parse(fs.readFileSync(path.join(s.root, 'agent-events.json'), 'utf8'));
  assert.equal(st.offsets[old], fs.statSync(old).size, 'an old session was not skipped to its end');
});

test('#5683 r2: a batch refused as too big is dropped, and not_enrolled asks the company again', async (t) => {
  const s = setup(t);
  let answer = '400 {"code":"org_agent_events_too_big"}';
  const c = coordinator(() => ({ ok: false, because: answer }));
  await oe.enroll('ACME-JOIN-1234', true, { root: s.root, remote: c });
  accept(s.root);
  await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  append(s.file, use('b1', 'Bash', { command: 'x' }), result('b1', DENIED('x'), true));
  const r = await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(r.dropped, 1);
  answer = '403 {"code":"org_not_enrolled"}';
  append(s.file, use('b2', 'Bash', { command: 'x' }), result('b2', DENIED('x'), true));
  const before = c.sent.filter((x) => x.route === oe.ROUTES.status).length;
  await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.ok(c.sent.filter((x) => x.route === oe.ROUTES.status).length > before, 'not_enrolled did not ask the company again');
});

test('#5683 r2: words withdrawn while the transcripts are read stop the send', async (t) => {
  const { s, c } = await enrolled(t);
  await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  await new Promise((r) => setTimeout(r, 1100));
  append(s.file, use('lv', 'Bash', { command: 'x' }), result('lv', DENIED('x'), true));
  const src = s.sources();
  const during = { agents: src.agents, dirOf: src.dirOf, transcripts: async (d) => {
    await oe.consentWithdrawn({ root: s.root }, oe.readEnrollment({ root: s.root }).consentHash);   // mid-scan
    return src.transcripts(d);
  } };
  await ae.tick({ root: s.root, remote: c, sources: during, now: Date.now() });
  assert.equal(c.sent.some((x) => x.route === ae.ROUTE), false, 'sent after the words were withdrawn mid-tick');
});

test('#5683: a long command with no URL is classified quickly (no quadratic backtracking)', () => {
  const t0 = process.hrtime.bigint();
  const c = ae.targetClass('Bash', { command: 'curl '.repeat(20000) }, ctx());
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.notEqual(c, 'network-host');
  assert.ok(ms < 100, 'classifying a 100 KB command took ' + ms.toFixed(0) + ' ms');
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
  await ae.tick({ root: s.root, remote: c, now: Date.now() });   // the board's own sources
  const before = JSON.parse(fs.readFileSync(path.join(s.root, 'agent-events.json'), 'utf8')).listed;
  assert.ok(Number.isFinite(before.Scout), 'Scout was not seen listed');
  fs.writeFileSync(listFile, '{"agents": ["Sco');   // torn mid-write
  await ae.tick({ root: s.root, remote: c, now: Date.now() + 5000 });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.root, 'agent-events.json'), 'utf8')).listed, before, 'a torn list wiped the first sightings');
});

test('#5683 r3: too big with many events sends half as many next, never dropping them', async (t) => {
  const s = setup(t);
  let big = true;
  const c = coordinator((body) => (big && body.events.length > 1 ? { ok: false, because: '413 {"code":"org_agent_events_too_big"}' } : { ok: true, data: { ok: true } }));
  await oe.enroll('ACME-JOIN-1234', true, { root: s.root, remote: c });
  accept(s.root);
  await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  await new Promise((r) => setTimeout(r, 1100));
  append(s.file, use('h1', 'Bash', { command: 'x' }), result('h1', DENIED('x'), true), use('h2', 'Bash', { command: 'x' }), result('h2', DENIED('x'), true));
  const r1 = await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(r1.dropped, undefined, 'a too-big batch of two was dropped');
  const r2 = await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  assert.equal(r2.sent, 1, 'half as many were not sent next');
});

test('#5683 r3: words withdrawn and accepted again under the SAME hash send nothing from the gap', async (t) => {
  const s = setup(t);
  let refuse = true;
  const c = coordinator(() => (refuse ? { ok: false, because: '409 {"code":"org_consent_changed"}' } : { ok: true, data: { ok: true } }));
  await oe.enroll('ACME-JOIN-1234', true, { root: s.root, remote: c });
  accept(s.root);
  await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  await new Promise((r) => setTimeout(r, 1100));
  append(s.file, use('q1', 'Bash', { command: 'x' }), result('q1', DENIED('x'), true));
  await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  append(s.file, use('q2', 'Bash', { command: 'x' }), result('q2', DENIED('x'), true));   // the gap
  await new Promise((r) => setTimeout(r, 1100));
  accept(s.root);   // the same words (the same hash) accepted again
  refuse = false;
  await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
  await new Promise((r) => setTimeout(r, 1100));
  append(s.file, use('q3', 'Bash', { command: 'x' }), result('q3', DENIED('x'), true));   // after the words are back
  await ae.tick({ root: s.root, remote: c, sources: s.sources(), now: Date.now() });
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
  const src = { agents: () => ['Scout'], dirOf: () => '/w/scout', transcripts: async () => [fresh] };
  await ae.tick({ root: s.root, remote: c, sources: src, now: Date.now() });
  assert.equal(c.sent.some((x) => x.route === ae.ROUTE), false, 'an hour-old refusal in a fresh file was sent');
});
