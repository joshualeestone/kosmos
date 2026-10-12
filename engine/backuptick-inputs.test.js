'use strict';
/**
 * kosmos#5535 E0.6 slice (d): engine/backuptick.js inputsHere, the real sources (profiles, the workers root, the
 * projects file, the config roots), in a sandboxed data root, workers root and projects root. Its own file because
 * store and create read their roots from the environment when first loaded.
 *   node --test engine/backuptick-inputs.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BASE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-backuptick-in-')));
const mk = (...p) => { const d = path.join(BASE, ...p); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mk('claude');
process.env.AGENT_WORKFORCE_GEMINI_HOME = mk('gemini');
process.env.AGENT_WORKFORCE_CODEX_HOME = mk('codex');
process.env.AGENT_WORKFORCE_HOME = mk('home');
delete process.env.AGENT_WORKFORCE_GROK_HOME;
const store = require('./store');
const tick = require('./backuptick');
const snap = require('./backupsnapshot');

test.after(() => fs.rmSync(BASE, { recursive: true, force: true }));

test('inputsHere reads profiles, workers folders and projects, and every root it yields is one the snapshot accepts', () => {
  fs.mkdirSync(store.PROFILES, { recursive: true });
  fs.writeFileSync(path.join(store.PROFILES, 'ann.json'), JSON.stringify({ displayName: 'Ann' }));
  mk('workers', 'ann');
  mk('workers', 'bob');                          // a folder with no profile is still an agent here
  mk('workers', '.hidden');                      // never an agent
  const far = mk('far', 'beta');
  fs.writeFileSync(path.join(store.ROOT, 'projects.json'), JSON.stringify([{ id: 'beta', folder: far }, { id: 'alpha', folder: mk('projects', 'alpha') }]));
  const input = tick.inputsHere();
  assert.equal(fs.realpathSync(input.workersDir), path.join(BASE, 'workers'));
  assert.deepEqual(input.agents.map((a) => a.id).sort(), ['ann', 'bob']);
  assert.deepEqual(input.projects.map((p) => p.slug).sort(), ['alpha', 'beta']);
  // Review 1: the data root and every provider config home are protected.
  for (const d of [store.ROOT, process.env.AGENT_WORKFORCE_CONFIG_ROOT, process.env.AGENT_WORKFORCE_GEMINI_HOME, process.env.AGENT_WORKFORCE_CODEX_HOME]) assert.ok(input.protect.includes(d), d);
  const { roots } = tick.rootsFor(input);
  assert.deepEqual(roots.map((r) => r.name), ['workers', 'projects', 'elsewhere/beta']);
  const snap = require('./backupsnapshot');
  for (const r of roots) assert.equal(snap.rootNameProblem(r.name), null, r.name);
});

test('inputsHere never throws on a projects file it cannot read; the workers root still comes back', () => {
  fs.writeFileSync(path.join(store.ROOT, 'projects.json'), 'not json');
  const input = tick.inputsHere();
  assert.deepEqual(input.projects, []);
  assert.deepEqual(tick.rootsFor(input).roots[0].name, 'workers');
});

test('review 5: every account folder and every hidden folder in the home folder is protected; a root holding home is refused', () => {
  const grok = mk('home', '.grok'), codexAcct = mk('home', '.codex-work'), ssh = mk('home', '.ssh');
  fs.writeFileSync(path.join(store.ROOT, 'projects.json'), JSON.stringify([{ id: 'home', folder: path.join(BASE, 'home') }, { id: 'far', folder: mk('far2') }]));
  const input = tick.inputsHere();
  for (const d of [grok, codexAcct, ssh]) assert.ok(input.protect.includes(d), d);
  const { roots, left } = tick.rootsFor(input);
  assert.ok(!roots.some((r) => r.name === 'elsewhere/home'), 'a root holding the home folder was added');
  assert.ok(roots.some((r) => r.name === 'elsewhere/far'), 'CONTROL: an ordinary folder is added');
  assert.ok(left.some((l) => l.what === 'a project' && /sign-in folder/.test(l.why)), JSON.stringify(left));
});

test('review 5: a Grok home set OUTSIDE the home folder is protected too (only the provider line can see it)', () => {
  const grokOut = mk('elsewhere-grok');
  process.env.AGENT_WORKFORCE_GROK_HOME = grokOut;
  try {
    const input = tick.inputsHere();
    assert.ok(input.protect.includes(grokOut), 'an env-set Grok home outside home was not protected');
  } finally { delete process.env.AGENT_WORKFORCE_GROK_HOME; }
});

test('review 6: the real home\'s hidden folders are protected too when AGENT_WORKFORCE_HOME is another folder', () => {
  const input = tick.inputsHere();
  const realHidden = fs.readdirSync(os.homedir()).filter((n) => n.startsWith('.')).map((n) => path.join(os.homedir(), n));
  if (!realHidden.length) return;   // a home with no hidden entry: nothing to check
  assert.ok(realHidden.every((d) => input.protect.includes(d)), 'a hidden folder of the real home was not protected');
});

test('review 7: the gate is consent, not enrolment alone: a record with no consentHash gives no backup', () => {
  const world = 'a'.repeat(32);
  fs.writeFileSync(path.join(store.ROOT, 'org-world-id'), world + '\n');
  const rec = { at: new Date().toISOString(), world, org: { id: 'org1', name: 'Co', slug: 'co' }, role: 'member' };
  fs.writeFileSync(path.join(store.ROOT, 'org-enrollment.json'), JSON.stringify(rec));
  const oe = require('./orgenroll');
  assert.equal(oe.isEnrolledHere(), true, 'CONTROL: the record reads as enrolled here');
  assert.equal(tick.mayBackUp(), false, 'enrolled with no consent recorded here must not back up');
  fs.writeFileSync(path.join(store.ROOT, 'org-enrollment.json'), JSON.stringify(Object.assign({}, rec, { consentHash: 'b'.repeat(64) })));
  assert.equal(tick.mayBackUp(), true, 'with the words accepted here it may');
});

test('#5883: a Codex agent on a named account is backed up from THAT account\'s sessions, not the default home', () => {
  const agentDir = path.join(BASE, 'workers', 'cody');
  fs.mkdirSync(agentDir, { recursive: true });
  const acct = mk('home', '.codex-work2');
  const day = path.join(acct, 'sessions', '2026', '10', '11');
  fs.mkdirSync(day, { recursive: true });
  fs.writeFileSync(path.join(day, 'rollout-a.jsonl'), JSON.stringify({ type: 'session_meta', payload: { cwd: agentDir } }) + '\n');
  const readJob = (name) => (name === 'cody' ? { runner: 'codex', configDir: acct } : null);
  const { roots } = tick.rootsFor(tick.inputsHere({ readJob }));
  const r = roots.find((x) => /^sessions\/cody\/codex-a[0-9a-f]{8}$/.test(x.name));
  assert.ok(r, `no transcript root for the agent on a named account: ${JSON.stringify(roots.map((x) => x.name))}`);
  assert.equal(fs.realpathSync(r.path), fs.realpathSync(path.join(acct, 'sessions')));
  assert.deepEqual(r.only, [path.join('2026', '10', '11', 'rollout-a.jsonl')]);
  // CONTROL: with no job read, the default Codex home (which holds no rollout of this agent) gives none.
  const none = tick.rootsFor(tick.inputsHere({ readJob: () => null })).roots.find((x) => x.name.startsWith('sessions/cody/codex'));
  assert.equal(none, undefined);
});

test('#5883: a Gemini agent\'s sessions are read from its account storage home (create.geminiStorageHome)', () => {
  const create = require('./create');
  const acct = mk('home', '.gemini-two');
  mk('workers', 'cody');   // the control agent, made here so this test runs alone (review 1)
  const seen = {};
  const sessionsFor = (dir, opts) => { seen[opts.id] = opts; return []; };
  mk('workers', 'gemma');
  const input = tick.inputsHere({ readJob: (n) => (n === 'gemma' ? { runner: 'gemini', configDir: acct } : null), sessionsFor });
  tick.rootsFor(input);
  // The default storage home as `gemini`, the account's as gemini-a<hex> (review 2: named by folder, never by role).
  assert.equal(seen.gemma.geminiHome, create.geminiStorageHome(null));
  const acctHome = seen.gemma.moreHomes.find((h) => h.provider === 'gemini');
  assert.equal(acctHome.home, create.geminiStorageHome(acct));
  assert.match(acctHome.tag, /^-a[0-9a-f]{8}$/);
  // CONTROL: an agent with no job keeps the default home, so the line above is the job's doing.
  assert.ok(seen.cody, 'CONTROL: the agent with no job was asked too');
  assert.equal(seen.cody.moreHomes.length, 0, 'an agent with no job was given an account home');
});

function rollout(home, agentDir, name) {
  const day = path.join(home, 'sessions', '2026', '10', '12');
  fs.mkdirSync(day, { recursive: true });
  fs.writeFileSync(path.join(day, name), JSON.stringify({ type: 'session_meta', payload: { cwd: agentDir } }) + '\n');
}

test('#5883 review 1: a backup reads EVERY home an agent\'s Codex sessions can be in: account, runtime, and the default', () => {
  const create = require('./create');
  const agentDir = mk('workers', 'rhea');
  const acct = mk('home', '.codex-acct3');
  rollout(acct, agentDir, 'rollout-acct.jsonl');
  rollout(require('./codexruntime').forAgent('rhea'), agentDir, 'rollout-runtime.jsonl');
  rollout(create.defaultAgentCodexHome(), agentDir, 'rollout-before.jsonl');   // kept before the account move
  const readJob = (n) => (n === 'rhea' ? { runner: 'codex', configDir: acct } : null);
  const { roots } = tick.rootsFor(tick.inputsHere({ readJob }));
  const mine = roots.filter((r) => r.name.startsWith('sessions/rhea/'));
  const names = mine.map((r) => r.name).sort();
  assert.equal(names.length, 3, JSON.stringify(names));
  assert.deepEqual([names[0], names[2]], ['sessions/rhea/codex', 'sessions/rhea/codex-runtime']);
  assert.match(names[1], /^sessions\/rhea\/codex-a[0-9a-f]{8}$/);
  for (const r of mine) assert.equal(r.only.length, 1, r.name);
  for (const r of mine) assert.equal(snap.rootNameProblem(r.name), null, r.name);
  // On the DEFAULT account there is no separate default root: the account home IS the default (one folder, one root).
  const d = tick.rootsFor(tick.inputsHere({ readJob: (n) => (n === 'rhea' ? { runner: 'codex', configDir: null } : null) })).roots
    .filter((r) => r.name.startsWith('sessions/rhea/')).map((r) => r.name).sort();
  assert.deepEqual(d, ['sessions/rhea/codex', 'sessions/rhea/codex-runtime']);
});

test('#5883 review 2: one folder keeps ONE name across an account move, so its files are never stored again under another', () => {
  const agentDir = mk('workers', 'vale');
  const acct = mk('home', '.codex-vale');
  rollout(acct, agentDir, 'rollout-a.jsonl');
  rollout(require('./create').defaultAgentCodexHome(), agentDir, 'rollout-d.jsonl');
  const namesOn = (configDir) => Object.fromEntries(tick.rootsFor(tick.inputsHere({ readJob: (n) => (n === 'vale' ? { runner: 'codex', configDir } : null) })).roots
    .filter((r) => r.name.startsWith('sessions/vale/')).map((r) => [fs.realpathSync(r.path), r.name]));
  const before = namesOn(null);   // on the default account
  const after = namesOn(acct);    // moved to a named account
  for (const [folder, name] of Object.entries(before)) assert.equal(after[folder], name, `${folder} was renamed by the move`);
  assert.equal(Object.keys(after).length, 2, 'CONTROL: after the move both homes are read');
});

test('#5883 review 3: `codex` names the agents\' default home for every agent, never the board\'s CODEX_HOME', (t) => {
  const create = require('./create');
  const saved = { a: process.env.AGENT_WORKFORCE_CODEX_HOME, c: process.env.CODEX_HOME };
  try {
    // Inside the try (review 4): a throw here must still restore the environment for the tests after this one.
    delete process.env.AGENT_WORKFORCE_CODEX_HOME;
    process.env.CODEX_HOME = mk('board-codex-home');
    const board = require('./codexupdate').defaultHome();
    const agents = create.defaultAgentCodexHome();
    if (board === agents) { t.skip('the two homes do not differ here, so there is nothing to tell apart'); return; }
    const seen = {};
    mk('workers', 'plain');
    tick.rootsFor(tick.inputsHere({ readJob: (n) => (n === 'plain' ? { runner: 'claude', configDir: null } : null), sessionsFor: (d, o) => { seen[o.id] = o; return []; } }));
    assert.equal(seen.plain.codexHome, agents, 'a non-Codex agent was read from the board\'s CODEX_HOME');
  } finally {
    if (saved.a === undefined) delete process.env.AGENT_WORKFORCE_CODEX_HOME; else process.env.AGENT_WORKFORCE_CODEX_HOME = saved.a;
    if (saved.c === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = saved.c;
  }
});

test('#5883 review 4: an account folder named through a link gets the same root name as its real path', () => {
  const real = mk('home', '.codex-linked-acct');
  const link = path.join(BASE, 'acct-link');
  if (!fs.existsSync(link)) fs.symlinkSync(real, link);
  const seen = [];
  mk('workers', 'lynn');
  const nameVia = (configDir) => {
    seen.length = 0;
    tick.rootsFor(tick.inputsHere({ readJob: (n) => (n === 'lynn' ? { runner: 'codex', configDir } : null), sessionsFor: (d, o) => { if (o.id === 'lynn') seen.push(...o.moreHomes); return []; } }));
    return seen.find((h) => h.home === configDir).tag;
  };
  assert.equal(nameVia(link), nameVia(real));
  assert.notEqual(nameVia(real), nameVia(mk('home', '.codex-other-acct')), 'CONTROL: another folder gets another name');
});

test('#5883 slice 2: a Grok agent on a named account is backed up from that account, under the folder\'s own name', () => {
  const agentDir = mk('workers', 'gwen');
  const acct = mk('home', '.grok-two');
  const sid = path.join(acct, 'sessions', 'any-folder-name', 'sid1');
  fs.mkdirSync(sid, { recursive: true });
  fs.writeFileSync(path.join(sid, 'summary.json'), JSON.stringify({ info: { cwd: agentDir } }));
  fs.writeFileSync(path.join(sid, 'chat_history.jsonl'), '{}\n');
  const { roots } = tick.rootsFor(tick.inputsHere({ readJob: (n) => (n === 'gwen' ? { runner: 'grok', configDir: acct } : null) }));
  const g = roots.find((r) => /^sessions\/gwen\/grok-a[0-9a-f]{8}$/.test(r.name));
  assert.ok(g, JSON.stringify(roots.map((r) => r.name)));
  assert.deepEqual(g.only, ['any-folder-name/sid1/chat_history.jsonl', 'any-folder-name/sid1/summary.json']);
  assert.equal(snap.rootNameProblem(g.name), null);
});

test('#5883 slice 4: an agent that moved between two named accounts keeps the FIRST account\'s conversations', () => {
  const agentDir = mk('workers', 'mira');
  const first = mk('home', '.codex-first'), now = mk('home', '.codex-now');
  const defaultRow = mk('home', '.codex-defaultrow'), gemOnly = mk('home', '.gemini-only');
  for (const [home, f] of [[first, 'rollout-first.jsonl'], [now, 'rollout-now.jsonl'], [defaultRow, 'rollout-def.jsonl'], [gemOnly, 'rollout-gem.jsonl']]) rollout(home, agentDir, f);
  const accountsOf = (m) => (m === 'openaiaccounts' ? [{ dir: defaultRow, isDefault: true }, { dir: first, isDefault: false }, { dir: now, isDefault: false }]
    : m === 'geminiaccounts' ? [{ dir: gemOnly, isDefault: false }] : []);
  const readJob = (n) => (n === 'mira' ? { runner: 'codex', configDir: now } : null);
  const { roots } = tick.rootsFor(tick.inputsHere({ readJob, accountsOf }));
  const files = roots.filter((r) => r.name.startsWith('sessions/mira/')).flatMap((r) => (r.only || []).map((f) => f.split('/').pop()));
  assert.ok(files.includes('rollout-first.jsonl') && files.includes('rollout-now.jsonl'), JSON.stringify(files));
  // The default ROW (isDefault) is not read as a named account; another provider's account is never read.
  assert.ok(!files.includes('rollout-def.jsonl'), 'the default row was read as a named account');
  assert.ok(!files.includes('rollout-gem.jsonl'), 'a Gemini account was read for a Codex agent');
  const acctRoots = roots.filter((r) => r.name.startsWith('sessions/mira/codex-a'));
  assert.equal(acctRoots.length, 2);
  assert.equal(new Set(acctRoots.map((r) => r.name)).size, 2);
});

test('#5883 slice 4 review 1: a current account whose sessions folder is a link is not added twice under one name', () => {
  const agentDir = mk('workers', 'lena');
  const acct = mk('home', '.codex-linkedsess');
  const realSessions = mk('elsewhere-sessions');
  if (!fs.existsSync(path.join(acct, 'sessions'))) fs.symlinkSync(realSessions, path.join(acct, 'sessions'));
  const { roots } = tick.rootsFor(tick.inputsHere({ readJob: (n) => (n === 'lena' ? { runner: 'codex', configDir: acct } : null),
    accountsOf: (m) => (m === 'openaiaccounts' ? [{ dir: acct, isDefault: false }] : []) }));
  const names = roots.map((r) => r.name).filter((n) => n.startsWith('sessions/lena/'));
  assert.equal(names.length, new Set(names).size, `a root name repeated: ${JSON.stringify(names)}`);
  assert.equal(names.filter((n) => n.startsWith('sessions/lena/codex-a')).length, 1);
  void agentDir;
});
