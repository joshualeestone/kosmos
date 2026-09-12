'use strict';
/**
 * #1704 PR4: engine/worldimport -- copying agents from one Kosmos into another, one
 * at a time, completely (profile, avatar, brief), into the target's own store and a
 * folder of its own there, with the start recorded in the TARGET's record.
 *
 * Every test builds its own registry base in the sandbox, and passes the default
 * world's workers root explicitly (`opts.env`), so no two tests share a folder.
 *
 *   node --test engine/worldimport.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

// SANDBOX BEFORE REQUIRING: create/remove/worldstarts freeze store.ROOT at require.
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'worldimport-test-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const worlds = require('./worlds');
const create = require('./create');
const win32job = require('./win32job');
const worldstarts = require('./worldstarts');
const worldimport = require('./worldimport');

const MAC = { platform: 'darwin' };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function setup() {
  const base = fs.mkdtempSync(nodePath.join(SANDBOX, 'base-'));
  const env = { AGENT_WORKFORCE_WORKERS: nodePath.join(base, 'default-workers') };
  return { base, env, opts: { ...MAC, env }, def: worlds.defaultWorld() };
}
function seedAgent(base, env, world, name, o = {}) {
  const profiles = worlds.worldProfilesDir(base, world);
  fs.mkdirSync(profiles, { recursive: true });
  fs.writeFileSync(nodePath.join(profiles, name + '.json'), JSON.stringify(o.profile || { displayName: name.toUpperCase() }));
  if (o.brief !== false) {
    const folder = o.folder || nodePath.join(worlds.worldWorkersDir(base, world, env), name);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(nodePath.join(folder, o.briefName || 'CLAUDE.md'), o.brief || `# ${name}\nYou are ${name}.\n`);
  }
  if (o.avatar) {
    fs.mkdirSync(worlds.worldAvatarsDir(base, world), { recursive: true });
    fs.writeFileSync(nodePath.join(worlds.worldAvatarsDir(base, world), name + '.png'), o.avatar);
  }
}
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const recordOf = (base, world) => {
  const file = worldstarts.recordFileIn(worlds.worldStoreRoot(base, world));
  return fs.existsSync(file) ? readJson(file).entries : null;
};

test('a complete copy: profile (fresh identity), avatar and brief land in the target; the source is only read', () => {
  const { base, env, opts, def } = setup();
  const dst = worlds.createWorld(base, 'Client work');
  seedAgent(base, env, def, 'ava', {
    // No reportsTo here: server.js stores a manager's name or null (the person), and
    // a manager that does not come along is its own test (R3 item 2).
    profile: { displayName: 'Ava', role: 'Analyst', provider: 'claude', doctrineVersion: 3, id: 'deadbeef0001', idInstall: 'inst-1' },
    avatar: PNG,
  });
  const srcProfile = nodePath.join(worlds.worldProfilesDir(base, def), 'ava.json');
  const srcBrief = nodePath.join(worlds.worldWorkersDir(base, def, env), 'ava', 'CLAUDE.md');
  const srcAvatar = nodePath.join(worlds.worldAvatarsDir(base, def), 'ava.png');
  const before = [srcProfile, srcBrief, srcAvatar].map((p) => fs.readFileSync(p));

  const r = worldimport.importAgents(base, dst.id, [{ from: 'default', name: 'ava' }], opts);
  assert.equal(r.ok, true);
  assert.deepEqual(r.refused, []);
  assert.deepEqual(r.copied, [{ from: 'default', name: 'ava', displayName: 'Ava' }]);

  const copy = readJson(nodePath.join(worlds.worldProfilesDir(base, dst), 'ava.json'));
  assert.deepEqual(copy, { displayName: 'Ava', role: 'Analyst', provider: 'claude', doctrineVersion: 3, importedFrom: { kosmos: 'default', id: 'deadbeef0001' } },
    'the copy keeps everything a person set, and carries no identity: it mints its own on its first write');
  const folder = nodePath.join(worlds.worldWorkersDir(base, dst, env), 'ava');
  assert.ok(folder.startsWith(worlds.worldBaseDir(base, dst)), 'the copy works in a folder of its own, inside the target Kosmos');
  assert.equal(fs.readFileSync(nodePath.join(folder, 'CLAUDE.md'), 'utf8'), '# ava\nYou are ava.\n', 'the brief came across');
  assert.deepEqual(fs.readFileSync(nodePath.join(worlds.worldAvatarsDir(base, dst), 'ava.png')), PNG, 'the picture came across');
  assert.deepEqual([srcProfile, srcBrief, srcAvatar].map((p) => fs.readFileSync(p)), before, 'the source agent was changed');
  assert.equal(recordOf(base, def), null, 'nothing was recorded in the SOURCE Kosmos');
});

test('the working dir is stripped: the brief is read through a recorded dir, and the copy gets its own folder', () => {
  const { base, env, opts, def } = setup();
  const dst = worlds.createWorld(base, 'Dest');
  const own = nodePath.join(base, 'somewhere', 'their-own-folder');
  fs.mkdirSync(own, { recursive: true });
  fs.writeFileSync(nodePath.join(own, 'CLAUDE.md'), '# connected ava\n');
  seedAgent(base, env, def, 'ava', { profile: { displayName: 'Ava', dir: own }, brief: false });
  assert.equal(fs.existsSync(nodePath.join(worlds.worldWorkersDir(base, def, env), 'ava')), false,
    'the control: there is no derived folder, so a copied brief can only have come from the recorded dir');

  const r = worldimport.importAgents(base, dst.id, [{ from: 'default', name: 'ava' }], opts);
  assert.deepEqual(r.refused, []);
  const copy = readJson(nodePath.join(worlds.worldProfilesDir(base, dst), 'ava.json'));
  assert.equal('dir' in copy, false, 'a kept dir points the copy at the SOURCE agent\'s folder');
  assert.equal(fs.readFileSync(nodePath.join(worlds.worldWorkersDir(base, dst, env), 'ava', 'CLAUDE.md'), 'utf8'), '# connected ava\n');
  assert.deepEqual(fs.readdirSync(own), ['CLAUDE.md'], 'the source folder was touched');
});

test('a codex agent brings its AGENTS.md, and its record names the codex runner', () => {
  const { base, env, opts, def } = setup();
  const dst = worlds.createWorld(base, 'Dest');
  seedAgent(base, env, def, 'cody', { profile: { provider: 'openai' }, briefName: 'AGENTS.md', brief: '# codex\n' });
  const r = worldimport.importAgents(base, dst.id, [{ from: 'default', name: 'cody' }], opts);
  assert.deepEqual(r.refused, []);
  const folder = nodePath.join(worlds.worldWorkersDir(base, dst, env), 'cody');
  assert.deepEqual(fs.readdirSync(folder), ['AGENTS.md']);
  const [entry] = recordOf(base, dst);
  assert.equal(entry.runner, 'codex');
});

test('the start is recorded in the TARGET Kosmos\'s store, not the one this process serves', () => {
  const { base, env, opts, def } = setup();
  const dst = worlds.createWorld(base, 'Dest');
  seedAgent(base, env, def, 'ava');
  worldimport.importAgents(base, dst.id, [{ from: 'default', name: 'ava' }], opts);
  const entries = recordOf(base, dst);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'ava');
  assert.equal(entries[0].why, 'imported');
  assert.equal(entries[0].from, 'default');
  assert.equal(entries[0].runner, 'claude');
  assert.ok(Number.isFinite(Date.parse(entries[0].at)));
  assert.equal('model' in entries[0] || 'configDir' in entries[0], false, 'no job to read, so nothing is invented');
  const own = fs.existsSync(worldstarts.RECORD_FILE) ? readJson(worldstarts.RECORD_FILE).entries : [];
  assert.equal(own.some((e) => e.name === 'ava'), false, 'the booted world\'s record was written');
  assert.deepEqual(worldstarts.importsWaitingIn(worlds.worldStoreRoot(base, dst)), [{ name: 'ava', because: null }]);
});

test('the launch spec comes from the SOURCE Kosmos\'s own job (Mac), keyed by the source world', () => {
  const { base, env, opts } = setup();
  const src = worlds.createWorld(base, 'Src');
  const dst = worlds.createWorld(base, 'Dest');
  seedAgent(base, env, src, 'bo');
  fs.mkdirSync(nodePath.dirname(create.plistPath('bo', src.id)), { recursive: true });
  fs.writeFileSync(create.plistPath('bo', src.id), create.plistFor('bo', '/usr/local/bin/claude', '/usr/local/bin/tmux', 'claude-opus-4', '/Users/x/.claude-work', 'claude'));
  // A decoy: the DEFAULT world's bo, on another model. Reading it would be reading another agent.
  fs.writeFileSync(create.plistPath('bo', 'default'), create.plistFor('bo', '/usr/local/bin/claude', '/usr/local/bin/tmux', 'decoy-model', '/Users/x/.claude-decoy', 'claude'));
  try {
    const r = worldimport.importAgents(base, dst.id, [{ from: src.id, name: 'bo' }], opts);
    assert.deepEqual(r.refused, []);
    const [entry] = recordOf(base, dst);
    assert.equal(entry.model, 'claude-opus-4');
    assert.equal(entry.configDir, '/Users/x/.claude-work');
    assert.equal(entry.runner, 'claude');
  } finally {
    fs.rmSync(create.plistPath('bo', src.id), { force: true });
    fs.rmSync(create.plistPath('bo', 'default'), { force: true });
  }
});

test('the launch spec comes from the source\'s Scheduled Task on Windows, queried under the source world\'s name', () => {
  const { base, env } = setup();
  const src = worlds.createWorld(base, 'Src');
  const dst = worlds.createWorld(base, 'Dest');
  seedAgent(base, env, src, 'cy', { profile: { provider: 'openai' }, briefName: 'AGENTS.md' });
  const queried = [];
  // Written by the REAL task writer, so the reader is pinned to what install registers.
  const xml = win32job.taskXml({ name: 'cy', cwd: 'C:\\w\\cy', model: 'gpt-5', configDir: 'C:\\Users\\x\\.codex-work', runner: 'codex', world: src.id, node: 'C:\\node.exe', supervisor: 'C:\\sup.js' },
    { USERNAME: 'x', USERDOMAIN: 'BOX', SystemRoot: 'C:\\Windows' });
  win32job.setRunner((args) => {
    queried.push(args.join(' '));
    if (args.includes('/XML') && args.includes(win32job.taskName('cy', src.id))) return { ok: true, out: xml };
    return { ok: false, out: 'ERROR: The system cannot find the file specified.' };
  });
  try {
    const r = worldimport.importAgents(base, dst.id, [{ from: src.id, name: 'cy' }], { platform: 'win32', env });
    assert.deepEqual(r.refused, []);
    assert.ok(queried[0].includes(win32job.taskName('cy', src.id)), 'the task read was not the source world\'s: ' + queried[0]);
    const [entry] = recordOf(base, dst);
    assert.deepEqual({ runner: entry.runner, model: entry.model, configDir: entry.configDir },
      { runner: 'codex', model: 'gpt-5', configDir: 'C:\\Users\\x\\.codex-work' });
  } finally {
    win32job.setRunner(null);
  }
});

test('an unreadable job falls back to the profile\'s provider for the runner, and invents no model or account', () => {
  const { base, env, opts, def } = setup();
  const dst = worlds.createWorld(base, 'Dest');
  seedAgent(base, env, def, 'dee', { profile: { provider: 'openai' }, briefName: 'AGENTS.md' });
  worldimport.importAgents(base, dst.id, [{ from: 'default', name: 'dee' }], opts);
  const [entry] = recordOf(base, dst);
  assert.equal(entry.runner, 'codex');
  assert.equal(entry.model, undefined);
  assert.equal(entry.configDir, undefined);
});

test('a name already in the target is refused, and nothing there is overwritten: a profile, a folder or a picture', () => {
  const { base, env, opts, def } = setup();
  const dst = worlds.createWorld(base, 'Client work');
  seedAgent(base, env, def, 'ava', { avatar: PNG });
  seedAgent(base, env, def, 'bo');
  seedAgent(base, env, def, 'cy');
  // ava: a profile already there. bo: a folder already there. cy: a picture already there.
  fs.mkdirSync(worlds.worldProfilesDir(base, dst), { recursive: true });
  fs.writeFileSync(nodePath.join(worlds.worldProfilesDir(base, dst), 'ava.json'), '{"displayName":"Theirs"}');
  const boFolder = nodePath.join(worlds.worldWorkersDir(base, dst, env), 'bo');
  fs.mkdirSync(boFolder, { recursive: true });
  fs.writeFileSync(nodePath.join(boFolder, 'notes.txt'), 'theirs');
  fs.mkdirSync(worlds.worldAvatarsDir(base, dst), { recursive: true });
  fs.writeFileSync(nodePath.join(worlds.worldAvatarsDir(base, dst), 'cy.jpg'), 'theirs');

  const r = worldimport.importAgents(base, dst.id, ['ava', 'bo', 'cy'].map((name) => ({ from: 'default', name })), opts);
  assert.deepEqual(r.copied, []);
  assert.deepEqual(r.refused.map((x) => x.name), ['ava', 'bo', 'cy']);
  assert.equal(r.refused[0].because, 'Client work already has an agent called ava');
  assert.equal(r.refused[1].because, `Client work already has a folder called bo (${boFolder}) with no agent behind it; if an earlier import left it there, remove it and try again`,
    'a folder with no agent behind it must be named as what it is, and where');
  assert.equal(r.refused[2].because, 'Client work already has an agent called cy');
  assert.equal(fs.readFileSync(nodePath.join(worlds.worldProfilesDir(base, dst), 'ava.json'), 'utf8'), '{"displayName":"Theirs"}');
  assert.deepEqual(fs.readdirSync(boFolder), ['notes.txt']);
  assert.equal(fs.existsSync(nodePath.join(worlds.worldWorkersDir(base, dst, env), 'ava')), false, 'a refused import left a folder');
  assert.equal(fs.existsSync(nodePath.join(worlds.worldAvatarsDir(base, dst), 'ava.png')), false, 'a refused import left a picture');
  assert.equal(recordOf(base, dst), null, 'a refused import was recorded to start');
});

test('two agents of one name from two Kosmoses: the first is added, the second refused', () => {
  const { base, env, opts, def } = setup();
  const other = worlds.createWorld(base, 'Other');
  const dst = worlds.createWorld(base, 'Dest');
  seedAgent(base, env, def, 'ava', { brief: 'first\n' });
  seedAgent(base, env, other, 'ava', { brief: 'second\n' });
  const r = worldimport.importAgents(base, dst.id, [{ from: 'default', name: 'ava' }, { from: other.id, name: 'ava' }], opts);
  assert.deepEqual(r.copied.map((c) => c.from), ['default']);
  assert.equal(r.refused.length, 1);
  assert.equal(r.refused[0].from, other.id);
  assert.match(r.refused[0].because, /another agent called ava is already being added/);
  assert.equal(fs.readFileSync(nodePath.join(worlds.worldWorkersDir(base, dst, env), 'ava', 'CLAUDE.md'), 'utf8'), 'first\n');
});

test('refusals, each with a sentence: unknown source, the same Kosmos, missing, unreadable, a bad name, no brief, removed', () => {
  const { base, env, opts, def } = setup();
  const dst = worlds.createWorld(base, 'Dest');
  fs.mkdirSync(worlds.worldProfilesDir(base, def), { recursive: true });
  fs.writeFileSync(nodePath.join(worlds.worldProfilesDir(base, def), 'broken.json'), '{ not json');
  seedAgent(base, env, def, 'a');                       // one character: not a name a job can be built from
  seedAgent(base, env, def, 'nobrief', { brief: false });
  seedAgent(base, env, def, 'gone');
  fs.writeFileSync(nodePath.join(worlds.worldStoreRoot(base, def), 'removed.json'), JSON.stringify([{ name: 'gone' }]));
  seedAgent(base, env, dst, 'mine');

  const r = worldimport.importAgents(base, dst.id, [
    { from: 'no-such-world', name: 'ava' },
    { from: '../../evil', name: 'ava' },
    { from: dst.id, name: 'mine' },
    { from: 'default', name: 'ghost' },
    { from: 'default', name: 'broken' },
    { from: 'default', name: 'a' },
    { from: 'default', name: 'nobrief' },
    { from: 'default', name: 'gone' },
  ], opts);
  assert.deepEqual(r.copied, []);
  assert.deepEqual(r.refused.map((x) => x.because), [
    'there is no Kosmos with that id on this machine',
    'there is no Kosmos with that id on this machine',
    'it is already in Dest',
    'we could not find it in Kosmos 1',
    'we could not read it in Kosmos 1',
    'its name cannot be used to start it in another Kosmos',
    'we could not read its instructions in Kosmos 1',
    'it was removed from Kosmos 1',
  ]);
  assert.deepEqual(worlds.worldProfileNames(base, dst), ['mine'], 'a refused agent left something in the target');
  assert.equal(recordOf(base, dst), null);
});

test('an unknown target Kosmos is its own answer, not a list of refusals', () => {
  const { base, opts } = setup();
  assert.deepEqual(worldimport.importAgents(base, 'no-such-world', [{ from: 'default', name: 'ava' }], opts), { ok: false, code: 'ENOWORLD' });
});

test('when the start cannot be recorded, the copy is taken back out: never an agent with nothing set to start it', () => {
  const { base, env, opts, def } = setup();
  const dst = worlds.createWorld(base, 'Dest');
  seedAgent(base, env, def, 'ava', { avatar: PNG });
  // A folder where the record should be: it cannot be read, so it cannot be written safely.
  fs.mkdirSync(worldstarts.recordFileIn(worlds.worldStoreRoot(base, dst)), { recursive: true });
  const r = worldimport.importAgents(base, dst.id, [{ from: 'default', name: 'ava' }], opts);
  assert.deepEqual(r.copied, []);
  assert.equal(r.refused[0].because, 'we could not read the list of agents waiting to start there, so it was not added');
  assert.deepEqual(worlds.worldProfileNames(base, dst), [], 'the profile was left behind');
  assert.equal(fs.existsSync(nodePath.join(worlds.worldWorkersDir(base, dst, env), 'ava')), false, 'the folder was left behind');
  assert.equal(fs.existsSync(nodePath.join(worlds.worldAvatarsDir(base, dst), 'ava.png')), false, 'the picture was left behind');
});

test('the picker lists what can be added: removed agents are left out, unaddable ones say why', () => {
  const { base, env, def } = setup();
  const dst = worlds.createWorld(base, 'Dest');
  seedAgent(base, env, def, 'ava', { profile: { displayName: 'Ava' } });
  seedAgent(base, env, def, 'a');
  seedAgent(base, env, def, 'gone');
  fs.writeFileSync(nodePath.join(worlds.worldStoreRoot(base, def), 'removed.json'), JSON.stringify([{ name: 'gone' }]));
  fs.writeFileSync(nodePath.join(worlds.worldProfilesDir(base, def), 'broken.json'), '{ not json');
  assert.deepEqual(worldimport.importableAgents(base, def), [
    { name: 'a', displayName: 'A', because: 'its name cannot be used to start it in another Kosmos' },
    { name: 'ava', displayName: 'Ava', because: null },
    { name: 'broken', displayName: 'broken', because: 'we could not read it' },
  ]);
  worldimport.importAgents(base, dst.id, [{ from: 'default', name: 'ava' }], { platform: 'darwin', env });
  const rows = worldimport.listForPicker(base);
  const destRow = rows.find((w) => w.id === dst.id);
  assert.equal(destRow.agentCount, destRow.agents.length, 'the count and the boxes beneath it must agree');
  assert.deepEqual(destRow.waiting, [{ name: 'ava', displayName: 'Ava', because: null }], 'the copy is listed as waiting to start in its Kosmos, by the name a person reads');
});

test('a request\'s picks: the per-agent form, the legacy whole-Kosmos form, and the malformed ones', () => {
  const { base, env, def } = setup();
  seedAgent(base, env, def, 'ava');
  seedAgent(base, env, def, 'a');
  seedAgent(base, env, def, 'gone');
  fs.writeFileSync(nodePath.join(worlds.worldStoreRoot(base, def), 'removed.json'), JSON.stringify([{ name: 'gone' }]));

  assert.deepEqual(worldimport.picksFromBody(base, {}), { ok: true, picks: [] });
  assert.deepEqual(worldimport.picksFromBody(base, { importAgents: [{ from: ' default ', name: ' ava ' }] }),
    { ok: true, picks: [{ from: 'default', name: 'ava' }] });
  for (const bad of ['ava', [{ from: 'default' }], [null], [{ from: '', name: 'ava' }], [{ from: 'default', name: 5 }]]) {
    const r = worldimport.picksFromBody(base, { importAgents: bad });
    assert.equal(r.ok, false, `importAgents=${JSON.stringify(bad)} was accepted`);
    assert.match(r.because, /say which agents to add/);
  }
  // Legacy: every agent that Kosmos holds (removed ones excepted) -- the unofferable
  // `a` included, so it is REFUSED by name rather than dropped unmentioned; an unknown
  // id stays a pick so it is refused too.
  assert.deepEqual(worldimport.picksFromBody(base, { importAgentsFrom: ['default', 'nope', 'default'] }),
    { ok: true, legacy: true, picks: [{ from: 'default', name: 'a' }, { from: 'default', name: 'ava' }, { from: 'nope', name: null }] });
  assert.equal(worldimport.picksFromBody(base, { importAgentsFrom: 'default' }).ok, false);
});

test('R1 (C): the legacy form refuses what it cannot offer, and counts unknown Kosmoses apart', () => {
  const { base, env, opts, def } = setup();
  const dst = worlds.createWorld(base, 'Dest');
  seedAgent(base, env, def, 'ava');
  seedAgent(base, env, def, 'a');
  const asked = worldimport.picksFromBody(base, { importAgentsFrom: ['default', 'nope'] });
  const r = worldimport.importAgents(base, dst.id, asked.picks, opts);
  assert.deepEqual(r.copied.map((c) => c.name), ['ava']);
  assert.deepEqual(r.refused.map((x) => [x.name, x.because]), [
    ['a', 'its name cannot be used to start it in another Kosmos'],
    [null, 'there is no Kosmos with that id on this machine'],
  ]);
  assert.equal(r.unknownSources, 1);
});

test('R1: more than MAX_IMPORT_PICKS picks in one request is refused, in either form', () => {
  const { base } = setup();
  const many = Array.from({ length: worldimport.MAX_IMPORT_PICKS + 1 }, (_, i) => ({ from: 'default', name: 'a' + i }));
  const r = worldimport.picksFromBody(base, { importAgents: many });
  assert.equal(r.ok, false);
  assert.equal(r.because, `add at most ${worldimport.MAX_IMPORT_PICKS} agents at a time`);
  assert.equal(worldimport.picksFromBody(base, { importAgents: many.slice(1) }).ok, true, 'the limit itself is allowed');
});

test('R2: the legacy whole-Kosmos form is capped too -- its EXPANSION past MAX_IMPORT_PICKS is refused with the same sentence', () => {
  const { base, env, def } = setup();
  const other = worlds.createWorld(base, 'Other');
  const half = Math.ceil((worldimport.MAX_IMPORT_PICKS + 1) / 2);
  const names = (prefix, n) => Array.from({ length: n }, (_, i) => prefix + String(i).padStart(3, '0'));
  // More than the cap, spread across two source Kosmoses; every one is offerable.
  for (const name of names('ag', half)) seedAgent(base, env, def, name, { brief: false });
  for (const name of names('bg', half)) seedAgent(base, env, other, name, { brief: false });
  assert.ok(2 * half > worldimport.MAX_IMPORT_PICKS, 'the control: the seed must exceed the cap');
  const over = worldimport.picksFromBody(base, { importAgentsFrom: ['default', other.id] });
  assert.equal(over.ok, false, 'the legacy expansion was not capped');
  assert.equal(over.because, `add at most ${worldimport.MAX_IMPORT_PICKS} agents at a time`);
  // The control: one Kosmos's half alone is within the cap and is accepted.
  const within = worldimport.picksFromBody(base, { importAgentsFrom: ['default'] });
  assert.equal(within.ok, true);
  assert.equal(within.picks.length, half);
});

test('R1 (A): a name on the TARGET\'s removed list is refused -- never copied in, cleared and hidden behind an "Added"', () => {
  const { base, env, opts, def } = setup();
  const src = worlds.createWorld(base, 'Src');
  seedAgent(base, env, src, 'bob');
  fs.writeFileSync(nodePath.join(worlds.worldStoreRoot(base, def), 'removed.json'), JSON.stringify([{ name: 'bob' }]));
  const r = worldimport.importAgents(base, 'default', [{ from: src.id, name: 'bob' }], opts);
  assert.deepEqual(r.copied, []);
  assert.equal(r.refused[0].because, 'Kosmos 1 has a removed agent called bob; restore that one there instead');
  assert.deepEqual(worlds.worldProfileNames(base, def), [], 'the copy was made anyway');
  assert.equal(recordOf(base, def), null, 'a refused import was recorded to start');

  fs.writeFileSync(nodePath.join(worlds.worldStoreRoot(base, def), 'removed.json'), '{ not json');
  const unreadable = worldimport.importAgents(base, 'default', [{ from: src.id, name: 'bob' }], opts);
  assert.match(unreadable.refused[0].because, /could not check whether Kosmos 1 has a removed agent called bob/);
});

test('R1 (B, Mac): a leftover launch job under the TARGET\'s key takes the name; one under another Kosmos\'s key does not', () => {
  const { base, env, opts } = setup();
  const src = worlds.createWorld(base, 'Src');
  const dst = worlds.createWorld(base, 'Dest');
  seedAgent(base, env, src, 'sam');
  fs.mkdirSync(nodePath.dirname(create.plistPath('sam', dst.id)), { recursive: true });
  fs.writeFileSync(create.plistPath('sam', dst.id), '<plist/>');
  try {
    const r = worldimport.importAgents(base, dst.id, [{ from: src.id, name: 'sam' }], opts);
    assert.deepEqual(r.copied, []);
    assert.equal(r.refused[0].because, 'Dest already has something set to start as sam');
    assert.deepEqual(worlds.worldProfileNames(base, dst), []);
  } finally {
    fs.rmSync(create.plistPath('sam', dst.id), { force: true });
  }
  // The control: the SAME name's job in another Kosmos (here the default one) is not this Kosmos's.
  fs.writeFileSync(create.plistPath('sam', 'default'), '<plist/>');
  try {
    const r = worldimport.importAgents(base, dst.id, [{ from: src.id, name: 'sam' }], opts);
    assert.deepEqual(r.copied.map((c) => c.name), ['sam'], 'another Kosmos\'s job was read as this one\'s');
  } finally {
    fs.rmSync(create.plistPath('sam', 'default'), { force: true });
  }
});

test('R1 (B, Windows): a task registered under the TARGET\'s key takes the name; an unanswerable check refuses', () => {
  const { base, env } = setup();
  const src = worlds.createWorld(base, 'Src');
  const dst = worlds.createWorld(base, 'Dest');
  seedAgent(base, env, src, 'tia');
  let answer = { ok: true, out: 'Status: Ready\n' };
  const asked = [];
  win32job.setRunner((args) => {
    asked.push(args.join(' '));
    if (args.includes(win32job.taskName('tia', dst.id))) return answer;
    return { ok: false, out: 'ERROR: The system cannot find the file specified.' };
  });
  try {
    const r = worldimport.importAgents(base, dst.id, [{ from: src.id, name: 'tia' }], { platform: 'win32', env });
    assert.deepEqual(r.copied, []);
    assert.equal(r.refused[0].because, 'Dest already has something set to start as tia');
    assert.ok(asked.some((a) => a.includes(win32job.taskName('tia', dst.id))), 'the task was not asked for under the target\'s key');

    answer = { ok: false, out: 'ERROR: Access is denied.' };
    const unknown = worldimport.importAgents(base, dst.id, [{ from: src.id, name: 'tia' }], { platform: 'win32', env });
    assert.equal(unknown.refused[0].because, 'we could not check whether anything is already set to start as tia in Dest');
    assert.deepEqual(worlds.worldProfileNames(base, dst), []);
  } finally {
    win32job.setRunner(null);
  }
});

test('R1: a readable job decides the runner, over the profile\'s provider', () => {
  const { base, env, opts } = setup();
  const src = worlds.createWorld(base, 'Src');
  const dst = worlds.createWorld(base, 'Dest');
  // The profile still says openai; the job that actually starts it says claude.
  seedAgent(base, env, src, 'rae', { profile: { provider: 'openai' } });
  fs.mkdirSync(nodePath.dirname(create.plistPath('rae', src.id)), { recursive: true });
  fs.writeFileSync(create.plistPath('rae', src.id), create.plistFor('rae', '/usr/local/bin/claude', '/usr/local/bin/tmux', 'claude-opus-4', null, 'claude'));
  try {
    const r = worldimport.importAgents(base, dst.id, [{ from: src.id, name: 'rae' }], opts);
    assert.deepEqual(r.refused, []);
    const [entry] = recordOf(base, dst);
    assert.equal(entry.runner, 'claude', 'the profile outranked the job that actually starts the agent');
    assert.ok(fs.existsSync(nodePath.join(worlds.worldWorkersDir(base, dst, env), 'rae', 'CLAUDE.md')));
  } finally {
    fs.rmSync(create.plistPath('rae', src.id), { force: true });
  }
});

/* ── review round 3 ───────────────────────────────────────────────────── */

function captureStderr(fn) {
  const real = process.stderr.write;
  const lines = [];
  process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
  try { return { result: fn(), lines }; } finally { process.stderr.write = real; }
}
const workerBrief = (base, env, world, name, file = 'CLAUDE.md') => nodePath.join(worlds.worldWorkersDir(base, world, env), name, file);

test('R3 (1): the copy\'s brief loses the SOURCE Kosmos\'s projects section; the source keeps it', () => {
  const projects = require('./projects');
  const { base, env, opts, def } = setup();
  const dst = worlds.createWorld(base, 'Dest');
  const withBlock = projects.spliceBlock('# ava\nMy own words.\n', 'Your projects:\n- src-proj, at /the/source/folder (kosmos post src1)', projects.BLOCK_START, projects.BLOCK_END);
  assert.ok(withBlock.includes(projects.BLOCK_START), 'the control: the source brief carries the section');
  seedAgent(base, env, def, 'ava', { brief: withBlock });
  const r = worldimport.importAgents(base, dst.id, [{ from: 'default', name: 'ava' }], opts);
  assert.deepEqual(r.refused, []);
  const copy = fs.readFileSync(workerBrief(base, env, dst, 'ava'), 'utf8');
  assert.equal(copy.includes(projects.BLOCK_START), false, 'the copy carries the source Kosmos\'s projects section');
  assert.equal(copy.includes('src-proj'), false);
  assert.ok(copy.includes('My own words.'), 'the person\'s own words went with it');
  assert.equal(fs.readFileSync(workerBrief(base, env, def, 'ava'), 'utf8'), withBlock, 'the source brief was changed');
});

test('R3 (2): a manager that comes along keeps the line; one that does not is cleared -- even when the target has a same-name stranger', () => {
  const projects = require('./projects');
  const reports = require('./reports');
  const { base, env, opts, def } = setup();
  const briefFor = (name) => projects.spliceBlock(`# ${name}\n`, reports.blockBody({ reportsTo: 'boss' }), reports.START, reports.END);
  seedAgent(base, env, def, 'boss', { profile: { displayName: 'Boss', id: 'b0551d000001', idInstall: 'inst-1' } });
  seedAgent(base, env, def, 'ann', { profile: { displayName: 'Ann', reportsTo: 'boss', id: 'a00a00000001', idInstall: 'inst-1' }, brief: briefFor('ann') });
  const readCopy = (w, n) => readJson(nodePath.join(worlds.worldProfilesDir(base, w), n + '.json'));
  const escalatesToBoss = (text) => /You report to \*\*[Bb]oss\*\*/.test(text);

  // (a) The manager comes along in the same request: the line survives, untouched.
  const together = worlds.createWorld(base, 'Together');
  worldimport.importAgents(base, together.id, [{ from: 'default', name: 'boss' }, { from: 'default', name: 'ann' }], opts);
  assert.equal(readCopy(together, 'ann').reportsTo, 'boss');
  assert.equal(fs.readFileSync(workerBrief(base, env, together, 'ann'), 'utf8'), briefFor('ann'), 'the line was rewritten although the manager came along');

  // (b) Alone: cleared, and the section now names the person.
  const alone = worlds.createWorld(base, 'Alone');
  worldimport.importAgents(base, alone.id, [{ from: 'default', name: 'ann' }], opts);
  assert.equal(readCopy(alone, 'ann').reportsTo, null, 'the copy keeps a manager who is not in its Kosmos');
  const aloneBrief = fs.readFileSync(workerBrief(base, env, alone, 'ann'), 'utf8');
  assert.ok(aloneBrief.includes(reports.START), 'the control: the section is still there');
  assert.equal(escalatesToBoss(aloneBrief), false, 'the copy still escalates to a manager who is not there');
  assert.match(aloneBrief, /directly/);

  // (c) The target already has a DIFFERENT agent called boss: it must not become ann's manager.
  const stranger = worlds.createWorld(base, 'Stranger');
  seedAgent(base, env, stranger, 'boss', { profile: { displayName: 'Another Boss' } });
  worldimport.importAgents(base, stranger.id, [{ from: 'default', name: 'ann' }], opts);
  assert.equal(readCopy(stranger, 'ann').reportsTo, null, 'a different agent that shares the name became the copy\'s manager');
  assert.equal(escalatesToBoss(fs.readFileSync(workerBrief(base, env, stranger, 'ann'), 'utf8')), false);

  assert.equal(readCopy(def, 'ann').reportsTo, 'boss', 'the source agent was changed');
});

test('R3 (2a): a manager with NO source id (never minted) that comes along in the same request keeps the line', () => {
  const { base, env, opts, def } = setup();
  // Profiles written without the store carry no id, so provenance cannot match them.
  seedAgent(base, env, def, 'lead', { profile: { displayName: 'Lead' } });
  seedAgent(base, env, def, 'kit', { profile: { displayName: 'Kit', reportsTo: 'lead' } });
  const dst = worlds.createWorld(base, 'Dest');
  worldimport.importAgents(base, dst.id, [{ from: 'default', name: 'lead' }, { from: 'default', name: 'kit' }], opts);
  assert.equal(readJson(nodePath.join(worlds.worldProfilesDir(base, dst), 'lead.json')).importedFrom.id, null, 'the control: the manager has no id to match by');
  assert.equal(readJson(nodePath.join(worlds.worldProfilesDir(base, dst), 'kit.json')).reportsTo, 'lead',
    'a manager copied in the same request was dropped because it had no id');
});

test('R3 (2, by provenance): Mara imported yesterday, Rook today -- Rook keeps Mara; a stranger, a mismatched copy or a removed one does not count', () => {
  const projects = require('./projects');
  const reports = require('./reports');
  const { base, env, opts, def } = setup();
  const briefFor = (name) => projects.spliceBlock(`# ${name}\n`, reports.blockBody({ reportsTo: 'mara' }), reports.START, reports.END);
  seedAgent(base, env, def, 'mara', { profile: { displayName: 'Mara', id: 'ma4a00000001', idInstall: 'inst-1' } });
  seedAgent(base, env, def, 'rook', { profile: { displayName: 'Rook', reportsTo: 'mara', id: '400c00000001', idInstall: 'inst-1' }, brief: briefFor('rook') });
  const profileOf = (w, n) => readJson(nodePath.join(worlds.worldProfilesDir(base, w), n + '.json'));
  const briefOf = (w, n) => fs.readFileSync(workerBrief(base, env, w, n), 'utf8');
  const seedProfileOnly = (w, n, profile) => {
    fs.mkdirSync(worlds.worldProfilesDir(base, w), { recursive: true });
    fs.writeFileSync(nodePath.join(worlds.worldProfilesDir(base, w), n + '.json'), JSON.stringify(profile));
  };

  // Provenance is recorded on the copy, by the source's own id, and not on the source.
  const later = worlds.createWorld(base, 'Later');
  worldimport.importAgents(base, later.id, [{ from: 'default', name: 'mara' }], opts);
  assert.deepEqual(profileOf(later, 'mara').importedFrom, { kosmos: 'default', id: 'ma4a00000001' });
  assert.equal('importedFrom' in profileOf(def, 'mara'), false, 'the source agent was stamped');
  assert.equal(profileOf(later, 'mara').id, undefined, 'the copy carries the source identity instead of minting its own');

  // (b) The next day: Rook alone. Mara is there AS THE SAME AGENT, so the line is kept.
  worldimport.importAgents(base, later.id, [{ from: 'default', name: 'rook' }], opts);
  assert.equal(profileOf(later, 'rook').reportsTo, 'mara', 'a manager imported earlier was dropped');
  assert.equal(briefOf(later, 'rook'), briefFor('rook'), 'the line to a manager who is there was rewritten');

  // (c) A same-name agent with no provenance is a stranger.
  const stranger = worlds.createWorld(base, 'Stranger');
  seedAgent(base, env, stranger, 'mara', { profile: { displayName: 'Another Mara' } });
  worldimport.importAgents(base, stranger.id, [{ from: 'default', name: 'rook' }], opts);
  assert.equal(profileOf(stranger, 'rook').reportsTo, null, 'a stranger with the same name became Rook\'s manager');

  // (c) A copy whose provenance names ANOTHER agent (or another Kosmos) does not count either.
  const mismatched = worlds.createWorld(base, 'Mismatched');
  seedProfileOnly(mismatched, 'mara', { displayName: 'Mara', importedFrom: { kosmos: 'default', id: 'not-mara' } });
  seedProfileOnly(mismatched, 'mara2', { displayName: 'Mara', importedFrom: { kosmos: 'elsewhere', id: 'ma4a00000001' } });
  worldimport.importAgents(base, mismatched.id, [{ from: 'default', name: 'rook' }], opts);
  assert.equal(profileOf(mismatched, 'rook').reportsTo, null, 'provenance that names another agent was taken as a match');

  // (c) Mara was imported earlier and then REMOVED there: not a manager any more.
  const removedThere = worlds.createWorld(base, 'Removed');
  worldimport.importAgents(base, removedThere.id, [{ from: 'default', name: 'mara' }], opts);
  fs.writeFileSync(nodePath.join(worlds.worldStoreRoot(base, removedThere), 'removed.json'), JSON.stringify([{ name: 'mara' }]));
  worldimport.importAgents(base, removedThere.id, [{ from: 'default', name: 'rook' }], opts);
  assert.equal(profileOf(removedThere, 'rook').reportsTo, null, 'a manager removed from that Kosmos was kept');
  assert.equal(/You report to \*\*[Mm]ara\*\*/.test(briefOf(removedThere, 'rook')), false, 'the brief still escalates to a removed manager');
});

test('R3 (3): a rollback that cannot remove the folder SAYS so, and the next try names the leftover folder', () => {
  const { base, env, opts, def } = setup();
  const dst = worlds.createWorld(base, 'Dest');
  seedAgent(base, env, def, 'ava');
  const recordAt = worldstarts.recordFileIn(worlds.worldStoreRoot(base, dst));
  fs.mkdirSync(recordAt, { recursive: true });   // an unreadable record: the copy is rolled back
  const folder = nodePath.join(worlds.worldWorkersDir(base, dst, env), 'ava');
  const realRm = fs.rmSync;
  fs.rmSync = (p, o) => {
    if (p === folder) { const e = new Error('busy'); e.code = 'EBUSY'; throw e; }   // an antivirus holding it
    return realRm(p, o);
  };
  let first;
  let lines;
  try {
    ({ result: first, lines } = captureStderr(() => worldimport.importAgents(base, dst.id, [{ from: 'default', name: 'ava' }], opts)));
  } finally {
    fs.rmSync = realRm;
  }
  assert.deepEqual(first.copied, []);
  assert.ok(lines.some((l) => l.includes('step=rollback') && l.includes('code=EBUSY') && l.includes(folder)),
    'a rollback that could not remove the folder was silent: ' + lines.join(''));
  assert.ok(fs.existsSync(folder), 'the control: the folder really was left behind');

  fs.rmSync(recordAt, { recursive: true, force: true });   // the record is fine again
  const again = worldimport.importAgents(base, dst.id, [{ from: 'default', name: 'ava' }], opts);
  assert.match(again.refused[0].because, /already has a folder called ava .* with no agent behind it/);
  assert.ok(again.refused[0].because.includes(folder), 'the refusal does not say where the leftover folder is');
});

test('R3 (4): a picture copy that fails partway leaves no partial picture behind', () => {
  const store = require('./store');
  const { base, env, opts, def } = setup();
  const dst = worlds.createWorld(base, 'Dest');
  seedAgent(base, env, def, 'ava', { avatar: PNG });
  const realCopy = fs.copyFileSync;
  fs.copyFileSync = (from, to) => {
    fs.writeFileSync(to, PNG.subarray(0, 3));   // a partial write
    const e = new Error('io'); e.code = 'EIO'; throw e;
  };
  let r;
  try {
    r = captureStderr(() => worldimport.importAgents(base, dst.id, [{ from: 'default', name: 'ava' }], opts)).result;
  } finally {
    fs.copyFileSync = realCopy;
  }
  assert.deepEqual(r.copied, []);
  assert.match(r.refused[0].because, /could not copy it into Dest \(EIO\)/);
  assert.equal(store.avatarPathIn(worlds.worldAvatarsDir(base, dst), 'ava'), null, 'a partial picture was left behind');
  assert.equal(fs.existsSync(nodePath.join(worlds.worldWorkersDir(base, dst, env), 'ava')), false);
});

test('R3 (5): an error refusal logs one line -- source, target, name, step, code, path -- never the brief; an ordinary refusal logs nothing', () => {
  const { base, env, opts, def } = setup();
  const dst = worlds.createWorld(base, 'Dest');
  seedAgent(base, env, def, 'ava', { brief: 'SECRET-BRIEF-WORDS\n' });
  const recordAt = worldstarts.recordFileIn(worlds.worldStoreRoot(base, dst));
  fs.mkdirSync(recordAt, { recursive: true });
  const failed = captureStderr(() => worldimport.importAgents(base, dst.id, [{ from: 'default', name: 'ava' }], opts));
  const line = failed.lines.find((l) => l.startsWith('Kosmos import refused:') && l.includes('step=record'));
  assert.ok(line, 'no log line for a refusal that came from an error: ' + failed.lines.join(''));
  assert.match(line, /^Kosmos import refused: source=default target=dest name=ava step=record code=UNREADABLE path=\S/);
  assert.equal(failed.lines.join('').includes('SECRET-BRIEF-WORDS'), false, 'the brief\'s words were logged');

  fs.rmSync(recordAt, { recursive: true, force: true });
  assert.deepEqual(worldimport.importAgents(base, dst.id, [{ from: 'default', name: 'ava' }], opts).refused, [], 'the control: it copies once the record is fine');
  const ordinary = captureStderr(() => worldimport.importAgents(base, dst.id, [{ from: 'default', name: 'ava' }], opts));
  assert.match(ordinary.result.refused[0].because, /already has an agent called ava/);
  assert.equal(ordinary.lines.some((l) => l.startsWith('Kosmos import refused:')), false, 'an ordinary refusal was logged as an error');
});

test('R3 (B): the legacy com.<name>.discord job takes the name in Kosmos 1 (main\'s one rule, remove.jobFor), not in a named Kosmos', () => {
  const { base, env, opts } = setup();
  const src = worlds.createWorld(base, 'Src');
  const dst = worlds.createWorld(base, 'Dest');
  seedAgent(base, env, src, 'lee');
  const discord = nodePath.join(nodePath.dirname(create.plistPath('lee', 'default')), 'com.lee.discord.plist');
  fs.mkdirSync(nodePath.dirname(discord), { recursive: true });
  fs.writeFileSync(discord, '<plist/>');
  try {
    const intoKosmos1 = worldimport.importAgents(base, 'default', [{ from: src.id, name: 'lee' }], opts);
    assert.deepEqual(intoKosmos1.copied, []);
    assert.equal(intoKosmos1.refused[0].because, 'Kosmos 1 already has something set to start as lee');
    const intoNamed = worldimport.importAgents(base, dst.id, [{ from: src.id, name: 'lee' }], opts);
    assert.deepEqual(intoNamed.copied.map((c) => c.name), ['lee'], 'a Kosmos 1-only legacy job took the name in a named Kosmos');
  } finally {
    fs.rmSync(discord, { force: true });
  }
});
