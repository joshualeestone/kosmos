'use strict';
/* kosmos#8710 slice 3: engine/handoversend.js, the leaving member's computer packing a hand-over. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const hs = require('./handoversend');
const { hpkeKeyPair } = require('./hpke');
const sealPub = () => hpkeKeyPair().pk.toString('base64');
const up = require('./backupupload');

const rows = [
  { name: 'permit-intake', shownAs: 'Permit Intake', profile: true, removed: false },
  { name: 'ledger', shownAs: 'Ledger', profile: true, removed: false },
  { name: 'old', shownAs: 'Old', profile: true, removed: true },
  { name: 'stray', shownAs: 'Stray', profile: false, removed: false },
  { name: 'twin-a', shownAs: 'Twin', profile: true, removed: false },
  { name: 'twin-b', shownAs: 'Twin', profile: true, removed: false },
];

test('names resolve by machine name or shown name, and a missing or doubled one fails with that name', () => {
  assert.deepEqual(hs.resolveNames(['Permit Intake', 'ledger'], rows), { ok: true, names: [{ name: 'permit-intake', label: 'Permit Intake' }, { name: 'ledger', label: 'ledger' }] });
  assert.deepEqual(hs.resolveNames(['Ledger', 'ledger'], rows), { ok: true, names: [{ name: 'ledger', label: 'Ledger' }] });
  assert.equal(hs.resolveNames(['Old'], rows).final, true);
  assert.match(hs.resolveNames(['Old'], rows).because, /no agent called Old/);       // removed
  assert.match(hs.resolveNames(['Stray'], rows).because, /no agent called Stray/);   // no profile
  assert.match(hs.resolveNames(['Twin'], rows).because, /more than one agent on this computer is called Twin/);
  assert.equal(hs.resolveNames([], rows).ok, false);
  assert.equal(hs.resolveNames(['x', 3], rows).ok, false);
});

test('session files are trimmed newest first to the byte cap, across roots', () => {
  const st = { 'a/1': [10, 100], 'a/2': [10, 300], 'b/1': [15, 200], 'b/2': [5, 50] };
  const stat = (p) => { const k = p.split(path.sep).slice(-2).join('/'); const v = st[k]; if (!v) throw new Error('nope'); return { isFile: () => true, size: v[0], mtimeMs: v[1] }; };
  const roots = [{ name: 'sessions/x/claude', path: '/r/a', only: ['1', '2', 'gone'] }, { name: 'sessions/x/codex', path: '/r/b', only: ['1', '2'] }];
  // cap 30: a/2 (300) 10, b/1 (200) 15 -> 25; a/1 (10) would make 35: skipped; b/2 (5) fits -> 30.
  assert.deepEqual(hs.trimSessions(roots, 30, { stat }), [
    { name: 'sessions/x/claude', path: '/r/a', only: ['2'] },
    { name: 'sessions/x/codex', path: '/r/b', only: ['1', '2'] },
  ]);
  // The newest file is kept even alone over the cap; nothing else then fits.
  assert.deepEqual(hs.trimSessions(roots, 4, { stat }), [{ name: 'sessions/x/claude', path: '/r/a', only: ['2'] }]);
  assert.deepEqual(hs.trimSessions([{ name: 'sessions/x/claude', path: '/r/a', only: ['gone'] }], 4, { stat }), []);
});

test('only a send part in packing with a key is packed', () => {
  const k = sealPub();
  const got = hs.sendable({ handovers: [
    { id: 'h1', side: 'send', state: 'packing', seal_pub: k, agents: ['a'] },
    { id: 'h2', side: 'receive', state: 'packing', seal_pub: k },
    { id: 'h3', side: 'send', state: 'requested', seal_pub: null },
    { id: 'h4', side: 'send', state: 'packed', seal_pub: k },
    { id: '../x', side: 'send', state: 'packing', seal_pub: k },
  ] });
  assert.deepEqual(got.map((h) => h.id), ['h1']);
  assert.deepEqual(hs.sendable(null), []);
});

function world() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'khandsend-')));
  const workers = path.join(base, 'workers'), profiles = path.join(base, 'data', 'profiles'), sess = path.join(base, 'sess');
  for (const d of [path.join(workers, 'ledger', 'Files'), profiles, sess]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(workers, 'ledger', 'CLAUDE.md'), 'you keep the ledger\n');
  fs.writeFileSync(path.join(workers, 'ledger', 'Files', 'q3.txt'), 'quarter three\n');
  fs.writeFileSync(path.join(profiles, 'ledger.json'), JSON.stringify({ name: 'ledger' }));
  fs.writeFileSync(path.join(sess, 'one.jsonl'), '{"m":1}\n');
  return { base, workers, profiles, sess };
}
const depsFor = (w, extra) => Object.assign({
  root: path.join(w.base, 'data'),   // send-<id>.json goes here, never into this computer's real data folder
  survey: () => ({ ok: true, agents: rows }),
  inputsHere: () => ({ protect: [path.join(w.base, 'data')], protectIncomplete: false,
    sessions: (dir, seg) => [{ name: `sessions/${seg}/claude`, path: w.sess, optional: true, only: ['one.jsonl'] }] }),
  workerDir: (n) => path.join(w.workers, n),
  profilesDir: w.profiles,
  deviceKey: () => ({ ok: true, privateKey: crypto.generateKeyPairSync('ed25519').privateKey }),
}, extra || {});
const part = (extra) => Object.assign({ id: 'ho1', side: 'send', state: 'packing', seal_pub: sealPub(), agents: ['Ledger'] }, extra || {});

test('a pack input carries the folder, the one profile and the sessions, under the hand-over context', () => {
  const w = world();
  try {
    const p = hs.packInput(part(), 'org1', depsFor(w));
    assert.equal(p.ok, true, p.because);
    assert.deepEqual(p.input.roots.map((r) => r.name), ['workers/ledger', 'profiles/ledger', 'sessions/ledger/claude']);
    assert.deepEqual(p.input.roots[1].only, ['ledger.json']);
    assert.deepEqual(p.input.handover, { id: 'ho1', prefix: 'handover/org1/ho1/' });
    assert.equal(p.input.ctx.epoch, 'handover');
    assert.equal(p.input.memberPk.length, 32);
    // A new naming key every pack.
    assert.notDeepEqual(hs.packInput(part(), 'org1', depsFor(w)).input.namingKey, p.input.namingKey);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a pack input is refused for a bad key, a protected folder, a missing folder or a missing device key', () => {
  const w = world();
  try {
    assert.match(hs.packInput(part({ seal_pub: crypto.randomBytes(31).toString('base64') }), 'org1', depsFor(w)).because, /key for this hand-over/);
    assert.match(hs.packInput(part({ seal_pub: 'not base64!' }), 'org1', depsFor(w)).because, /key for this hand-over/);
    // 32 bytes, but bit 255 set: not a canonical X25519 key (half of all random 32-byte strings).
    const high = hpkeKeyPair().pk; high[31] |= 0x80;
    assert.match(hs.packInput(part({ seal_pub: high.toString('base64') }), 'org1', depsFor(w)).because, /key for this hand-over/);
    // The agent folder inside Kosmos's own data.
    fs.mkdirSync(path.join(w.base, 'data', 'ledger'));
    assert.match(hs.packInput(part(), 'org1', depsFor(w, { workerDir: (n) => path.join(w.base, 'data', n) })).because, /holds, or is inside/);
    // The agent folder holding Kosmos's data.
    assert.match(hs.packInput(part(), 'org1', depsFor(w, { workerDir: () => w.base })).because, /holds, or is inside/);
    assert.match(hs.packInput(part(), 'org1', depsFor(w, { workerDir: (n) => path.join(w.base, 'nowhere', n) })).because, /folder of Ledger could not be found/);   // the company's name for it
    const nd = hs.packInput(part(), 'org1', depsFor(w, { deviceKey: () => ({ ok: false, because: 'no key here' }) }));
    assert.equal(nd.because, 'no key here');
    assert.equal(hs.packInput(part(), 'org1', depsFor(w, { inputsHere: () => ({ protect: [], protectIncomplete: true }) })).ok, false);
    assert.equal(hs.packInput(part(), 'org1', depsFor(w, { survey: () => ({ ok: false }) })).retryLater, true);
    // The control: the same world packs.
    assert.equal(hs.packInput(part(), 'org1', depsFor(w)).ok, true);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('the real snapshot accepts the pack input and asks the hand-over grant first', async () => {
  const w = world();
  try {
    const p = hs.packInput(part(), 'org1', depsFor(w));
    const calls = [];
    const r = await require('./backupsnapshot').takeSnapshot(p.input, { macRequest: async (m, route) => { calls.push(route); return { ok: false, because: 'stopped by the test' }; }, sleep: async () => {} });
    assert.equal(r.ok, false);
    assert.deepEqual([...new Set(calls)], [up.HANDOVER_GRANT_ROUTE], r.because);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a tick packs one part; a final failure is kept, another waits RETRY_MS, retryLater waits SOFT_RETRY_MS', async () => {
  const w = world();
  try {
    const parts = [part({ id: 'ho1' }), part({ id: 'ho2' })];
    const asked = [];
    const takes = [];
    let clock = 1000;
    let answer = { ok: false, final: true, because: 'refused for good' };
    const d = depsFor(w, {
      org: () => 'org1',
      now: () => clock,
      macRequest: async (m, route, body) => { asked.push(route); assert.deepEqual(body, {}); return { ok: true, data: { handovers: parts } }; },
      takeSnapshot: async (input) => { takes.push(input.handover.id); return answer; },
    });
    const state = hs.newSendState();
    assert.deepEqual(await hs.tick(state, d), { ok: false, id: 'ho1', because: 'refused for good' });
    assert.equal(asked[0], hs.MINE_ROUTE);
    // ho1 is decided: the next tick moves to ho2. A coordinator error (no final, no retryLater) waits RETRY_MS.
    answer = { ok: false, because: 'HTTP 503' };
    assert.equal((await hs.tick(state, d)).id, 'ho2');
    assert.deepEqual(await hs.tick(state, d), { ok: true, none: true }, 'tried again before RETRY_MS');
    clock += hs.RETRY_MS + 1;
    answer = { ok: false, retryLater: true, because: 'later' };
    assert.equal((await hs.tick(state, d)).id, 'ho2');
    assert.deepEqual(await hs.tick(state, d), { ok: true, none: true }, 'retryLater waits SOFT_RETRY_MS');
    clock += hs.SOFT_RETRY_MS + 1;
    assert.equal((await hs.tick(state, d)).id, 'ho2', 'then tries again');
    clock += hs.SOFT_RETRY_MS + 1;
    answer = { ok: true };
    assert.equal((await hs.tick(state, d)).ok, true);
    assert.deepEqual(await hs.tick(state, d), { ok: true, none: true });
    assert.deepEqual(takes, ['ho1', 'ho2', 'ho2', 'ho2', 'ho2']);
    // A changed part (a new key) is tried again.
    parts[0].seal_pub = sealPub();
    assert.equal((await hs.tick(state, d)).id, 'ho1');
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a coordinator refusal no retry can change is final, in this module\'s words; 8 failed attempts are too', async () => {
  const w = world();
  try {
    let clock = 0;
    let answer = { ok: false, because: 'Kosmos+ refused (HTTP 413 on /v1/mac/org/handover/grant, code handover_too_big)' };
    const parts = [part({ id: 'ho1' })];
    const d = depsFor(w, { org: () => 'org1', now: () => clock,
      macRequest: async () => ({ ok: true, data: { handovers: parts } }),
      takeSnapshot: async () => answer });
    const state = hs.newSendState();
    await hs.tick(state, d);
    assert.deepEqual(hs.notice(state), { agents: ['Ledger'], stopped: 'the agents are larger than one hand-over can carry' });
    assert.equal(JSON.stringify(hs.notice(state)).includes('HTTP'), false, 'no coordinator text reaches the screen');
    // The ceiling: a failure that is neither final nor retryLater, every hour.
    const s2 = hs.newSendState();
    answer = { ok: false, because: 'Kosmos+ refused (HTTP 503 on /v1/mac/org/handover/grant)' };
    const d2 = Object.assign({}, d, { root: path.join(w.base, 'data2') });   // its own decisions file: the first part's final is kept on disk
    for (let i = 1; i < hs.MAX_ATTEMPTS; i++) { await hs.tick(s2, d2); assert.equal(hs.notice(s2).stopped, undefined, 'attempt ' + i); clock += hs.RETRY_MS + 1; }
    await hs.tick(s2, d2);
    assert.match(hs.notice(s2).stopped, /tried 8 times/);
    // A changed part starts again from nothing.
    parts[0].seal_pub = sealPub();
    answer = { ok: true };
    assert.equal((await hs.tick(s2, d2)).ok, true);
    assert.equal(hs.notice(s2).stopped, undefined);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('leaving the company clears the notice at the next tick', async () => {
  const state = { running: false, failed: new Map(), retryAt: new Map(), attempts: new Map(), soft: new Map(), packed: new Set(), loaded: new Set(), open: [{ id: 'h1', agents: ['Ledger'] }] };
  assert.deepEqual(hs.notice(state), { agents: ['Ledger'] });
  await hs.tick(state, { org: () => null, macRequest: async () => { throw new Error('not asked'); } });
  assert.equal(hs.notice(state), null);
});

test('a tick sends only where orgenroll.mayReport allows: enrolled here with no accepted words asks nothing', async () => {
  const oe = require('./orgenroll');
  const keep = { mayReport: oe.mayReport, readEnrollment: oe.readEnrollment };
  let asked = 0;
  const macRequest = async () => { asked++; return { ok: true, data: { handovers: [] } }; };
  try {
    oe.readEnrollment = () => ({ org: { id: 'org1' }, world: 'w' });
    oe.mayReport = () => false;   // enrolled, words not accepted here
    assert.deepEqual(await hs.tick(hs.newSendState(), { macRequest }), { ok: true, none: true });
    assert.equal(asked, 0);
    oe.mayReport = () => true;    // CONTROL: the same record, words accepted
    await hs.tick(hs.newSendState(), { macRequest });
    assert.equal(asked, 1);
  } finally { Object.assign(oe, keep); }
});

test('a tick asks nothing when this computer is not in a company, and never runs twice at once', async () => {
  let asked = 0;
  const d = { org: () => null, macRequest: async () => { asked++; return { ok: true, data: { handovers: [] } }; } };
  assert.deepEqual(await hs.tick(hs.newSendState(), d), { ok: true, none: true });
  assert.equal(asked, 0);
  assert.deepEqual(await hs.tick(Object.assign(hs.newSendState(), { running: true }), { org: () => 'org1', macRequest: d.macRequest }), { skipped: true });
  assert.equal(asked, 0);
  // A refused /mine (an older connector, say) packs nothing.
  let took = 0;
  assert.equal((await hs.tick(hs.newSendState(), { org: () => 'org1', macRequest: async () => ({ ok: false, notSent: true, because: 'down' }), takeSnapshot: async () => { took++; return { ok: true }; } })).because, 'down');
  assert.equal(took, 0);
});

test('the tick is off unless KOSMOS_ORG_HANDOVER=1', () => {
  assert.equal(hs.enabled({}), false);
  assert.equal(hs.enabled({ KOSMOS_ORG_HANDOVER: '0' }), false);
  assert.equal(hs.startHere({}), null);
  assert.equal(hs.enabled({ KOSMOS_ORG_HANDOVER: ' 1 ' }), true);
});

test('the notice lists every open send part\'s agents, with a stopped pack\'s reason', async () => {
  const k = sealPub();
  const state = hs.newSendState();
  assert.equal(hs.notice(state), null);
  const d = { org: () => 'org1', macRequest: async () => ({ ok: true, data: { handovers: [
    { id: 'h1', side: 'send', state: 'packed', seal_pub: k, agents: ['Ledger'] },
    { id: 'h2', side: 'receive', state: 'packing', seal_pub: k, agents: ['Other'] },
    { id: 'h3', side: 'send', state: 'requested', seal_pub: null, agents: ['Scout', 'Ledger'] },
  ] } }) };
  await hs.tick(state, d);
  assert.deepEqual(hs.notice(state), { agents: ['Ledger', 'Scout'] });
  state.failed.set('h3', { key: 'x', because: 'no folder' });
  assert.deepEqual(hs.notice(state), { agents: ['Ledger', 'Scout'], stopped: 'no folder' });
  // Nothing open: nothing said.
  await hs.tick(state, { org: () => 'org1', macRequest: async () => ({ ok: true, data: { handovers: [] } }) });
  assert.equal(hs.notice(state), null);
});

test('round 3: an agent folder holding other work is refused; a pack over the cap is refused before anything is sent', () => {
  const w = world();
  try {
    // The agent's recorded folder is the parent of the workers folder.
    const holdsWorkers = hs.packInput(part(), 'org1', depsFor(w, { workerDir: () => w.base,
      inputsHere: () => ({ protect: [], workersDir: w.workers, agents: [], projects: [], sessions: () => [] }) }));
    assert.match(holdsWorkers.because, /holds other work/);
    assert.equal(holdsWorkers.final, true);
    // Another agent's folder inside this one.
    fs.mkdirSync(path.join(w.workers, 'ledger', 'nested'), { recursive: true });
    const holdsAgent = hs.packInput(part(), 'org1', depsFor(w, {
      inputsHere: () => ({ protect: [], workersDir: w.workers, agents: [{ id: 'other', dir: path.join(w.workers, 'ledger', 'nested') }], projects: [], sessions: () => [] }) }));
    assert.match(holdsAgent.because, /holds other work/);
    // A project inside it.
    const holdsProject = hs.packInput(part(), 'org1', depsFor(w, {
      inputsHere: () => ({ protect: [], workersDir: w.workers, agents: [], projects: [{ slug: 'p', folder: path.join(w.workers, 'ledger', 'nested') }], sessions: () => [] }) }));
    assert.match(holdsProject.because, /holds other work/);
    // CONTROL: its own folder, with itself listed among the agents, packs.
    assert.equal(hs.packInput(part(), 'org1', depsFor(w, {
      inputsHere: () => ({ protect: [], workersDir: w.workers, agents: [{ id: 'ledger', dir: path.join(w.workers, 'ledger') }], projects: [], sessions: () => [] }) })).ok, true);
    // Over the cap: refused, final, in this module's words.
    const big = hs.packInput(part(), 'org1', depsFor(w, { maxPackBytes: 10 }));
    assert.equal(big.final, true);
    assert.match(big.because, /larger than one hand-over can carry/);
    assert.equal(hs.packInput(part(), 'org1', depsFor(w, { maxPackBytes: 10 * 1024 * 1024 })).ok, true, 'CONTROL: under the cap');
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('round 3: retryLater is not counted; "too big" after a try that uploaded says so; a restart keeps the count and a final reason', async () => {
  const w = world();
  try {
    let clock = 0;
    let answer = { ok: false, retryLater: true, because: 'network' };
    const parts = [part({ id: 'ho9' })];
    const d = depsFor(w, { org: () => 'org1', now: () => clock, macRequest: async () => ({ ok: true, data: { handovers: parts } }), takeSnapshot: async () => answer });
    const fresh = () => (hs.newSendState());
    let st = fresh();
    for (let i = 0; i < 12; i++) { await hs.tick(st, d); clock += hs.SOFT_RETRY_MS + 1; }
    assert.equal(st.attempts.get('ho9'), 0, 'twelve network refusals counted none');
    answer = { ok: false, because: 'Kosmos+ refused (HTTP 503 on /v1/mac/org/handover/grant)', added: new Map([['c1', {}]]) };   // it had uploaded
    await hs.tick(st, d);
    assert.equal(st.attempts.get('ho9'), 1);
    st = fresh();   // a restart
    clock += hs.RETRY_MS + 1;
    answer = { ok: false, because: 'Kosmos+ refused (HTTP 413 on /v1/mac/org/handover/grant, code handover_too_big)' };
    await hs.tick(st, d);
    assert.equal(st.attempts.get('ho9'), 2, 'the count came back from disk');
    assert.match(hs.notice(st).stopped, /an earlier try used up the room/);
    st = fresh();   // another restart: the final reason is kept, and nothing is tried
    let took = 0;
    await hs.tick(st, Object.assign({}, d, { takeSnapshot: async () => { took++; return { ok: true }; } }));
    assert.equal(took, 0);
    assert.match(hs.notice(st).stopped, /an earlier try used up the room/);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('round 4: memory notes survive the transcript cap; retryLater ends after MAX_SOFT in a row', async () => {
  // Newest first alone would take new + older (60 of 60) and drop the memory note.
  const st = { 'a/new.jsonl': [30, 300], 'a/older.jsonl': [30, 200], 'a/memory/notes.md': [30, 1] };
  const roots = [{ name: 'sessions/x/claude', path: '/r/a', only: ['memory/notes.md', 'new.jsonl', 'older.jsonl'] }];
  const kept = hs.trimSessions(roots, 60, { stat: (p) => { const rel = path.relative('/r', p); const v = st[rel]; if (!v) throw new Error('nope'); return { isFile: () => true, size: v[0], mtimeMs: v[1] }; } });
  assert.deepEqual(kept[0].only, ['memory/notes.md', 'new.jsonl'], 'the old memory note first, then the newest transcript');
  const w = world();
  try {
    let clock = 0;
    const d = depsFor(w, { org: () => 'org1', now: () => clock, macRequest: async () => ({ ok: true, data: { handovers: [part({ id: 'hsoft' })] } }),
      takeSnapshot: async () => ({ ok: false, retryLater: true, because: 'quota' }) });
    const s1 = hs.newSendState();
    for (let i = 1; i < hs.MAX_SOFT; i++) { await hs.tick(s1, d); assert.equal(hs.notice(s1) && hs.notice(s1).stopped, undefined, 'soft ' + i); clock += hs.SOFT_RETRY_MS + 1; }
    await hs.tick(s1, d);
    assert.match(hs.notice(s1).stopped, /kept asking this computer to wait/);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('round 5: a counted failure ends a retryLater run; old decision files are swept; a failed /mine clears the notice', async () => {
  const w = world();
  try {
    let clock = 0;
    let answer = { ok: false, retryLater: true, because: 'quota' };
    const d = depsFor(w, { org: () => 'org1', now: () => clock, macRequest: async () => ({ ok: true, data: { handovers: [part({ id: 'hrun' })] } }), takeSnapshot: async () => answer });
    const st = hs.newSendState();
    for (let i = 1; i < hs.MAX_SOFT; i++) { await hs.tick(st, d); clock += hs.RETRY_MS + 1; }
    answer = { ok: false, because: 'HTTP 503' };   // counted: the run of waits ends
    await hs.tick(st, d); clock += hs.RETRY_MS + 1;
    answer = { ok: false, retryLater: true, because: 'quota' };
    await hs.tick(st, d);
    assert.equal(hs.notice(st).stopped, undefined, 'not final: the run started again');
    // Sweep: an unlisted decision file a day old goes; a listed one stays.
    const dir = path.join(w.base, 'data', 'handover');
    fs.mkdirSync(dir, { recursive: true });
    for (const id of ['gone', 'kept']) fs.writeFileSync(path.join(dir, `send-${id}.json`), '{}');
    const old = (Date.now() - 2 * 86400 * 1000) / 1000;
    for (const id of ['gone', 'kept']) fs.utimesSync(path.join(dir, `send-${id}.json`), old, old);
    hs.sweepSends(new Set(['kept']), Date.now(), path.join(w.base, 'data'));
    assert.equal(fs.existsSync(path.join(dir, 'send-gone.json')), false);
    assert.equal(fs.existsSync(path.join(dir, 'send-kept.json')), true);
    // A failed /mine: the old line goes.
    const s2 = hs.newSendState();
    s2.open = [{ id: 'h1', agents: ['Ledger'] }];
    await hs.tick(s2, { org: () => 'org1', macRequest: async () => ({ ok: false, because: 'down' }) });
    assert.equal(hs.notice(s2), null);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('round 5: too big after an uncounted try that uploaded says the earlier try used up the room', async () => {
  const w = world();
  try {
    let clock = 0;
    let answer = { ok: false, retryLater: true, because: 'network', added: new Map([['c1', {}]]) };   // uploaded, then a network refusal
    const d = depsFor(w, { org: () => 'org1', now: () => clock, macRequest: async () => ({ ok: true, data: { handovers: [part({ id: 'hspent' })] } }), takeSnapshot: async () => answer });
    const st = hs.newSendState();
    await hs.tick(st, d);
    clock += hs.SOFT_RETRY_MS + 1;
    answer = { ok: false, because: 'Kosmos+ refused (HTTP 413 on /v1/mac/org/handover/grant, code handover_too_big)' };
    await hs.tick(st, d);
    assert.equal(st.attempts.get('hspent'), 1, 'the first counted try');
    assert.match(hs.notice(st).stopped, /an earlier try used up the room/);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('round 6: wrong state after a try that uploaded says the pack may be half sent', async () => {
  const w = world();
  try {
    let clock = 0;
    let answer = { ok: false, because: 'HTTP 503', added: new Map([['c1', {}]]) };
    const d = depsFor(w, { org: () => 'org1', now: () => clock, macRequest: async () => ({ ok: true, data: { handovers: [part({ id: 'hhalf' })] } }), takeSnapshot: async () => answer });
    const st = hs.newSendState();
    await hs.tick(st, d);
    clock += hs.RETRY_MS + 1;
    answer = { ok: false, because: 'Kosmos+ refused (HTTP 409 on /v1/mac/org/handover/manifest, code handover_wrong_state)' };
    await hs.tick(st, d);
    assert.match(hs.notice(st).stopped, /may have left the pack half sent/);
    // CONTROL: with nothing granted before, it is the hand-over that is no longer open.
    const w2 = world();
    try {
      const d2 = depsFor(w2, { org: () => 'org1', now: () => clock, macRequest: async () => ({ ok: true, data: { handovers: [part({ id: 'hclosed' })] } }), takeSnapshot: async () => answer });
      const s2 = hs.newSendState();
      await hs.tick(s2, d2);
      assert.equal(hs.notice(s2).stopped, 'the hand-over is no longer open');
    } finally { fs.rmSync(w2.base, { recursive: true, force: true }); }
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});
