'use strict';
/**
 * #4752: the setup guide's deny rules name every folder of Kosmos's where a board token can sit, not only
 * the guide's own data folder: the older data folder (store.LEGACY_APP) and, for a guide in a named world,
 * the default world's token and every world's store. They must NOT name the worlds' base whole: a named
 * world's guide lives under it.
 *
 * The rules as strings are proven here. That a Mac's sandbox refuses a command's read under each rule
 * shape (one file, a folder, a `*` in the middle of the path) and still lets the guide read its own
 * folder under the base was measured once by hand, 2026-09-30, and is recorded on the card.
 *
 *   node --test engine/guide-deny-4752.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-guide-deny-4752-')));
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
fs.mkdirSync(process.env.AGENT_WORKFORCE_HOME, { recursive: true });

const setupAssistant = require('./setup-assistant');
const store = require('./store');

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const tokenish = (rules) => rules.filter((r) => /^Read\(\/\/(b|old)\b/.test(r));

test('#4752 a guide in a named world denies its own store, the default world\'s token, every world\'s store and the older folders', () => {
  const rules = tokenish(setupAssistant.guideDenyRules({
    dataRoot: '/b/worlds/w1/Kosmos', worldsBase: '/b', legacyRoots: ['/b/worlds/w1/AgentWorkforce', '/old/AgentWorkforce'],
  }));
  assert.deepEqual(rules, [
    'Read(//b/worlds/w1/Kosmos/**)',
    'Read(//b/worlds/w1/AgentWorkforce/**)',
    'Read(//old/AgentWorkforce/**)',
    'Read(//b/board.token)',
    'Read(//b/worlds/*/Kosmos/**)',
    'Read(//b/worlds/*/AgentWorkforce/**)',
  ]);
});

test('#4752 no rule takes in the worlds\' base whole, or a world\'s whole folder: the guide\'s own folder is under them', () => {
  const rules = setupAssistant.guideDenyRules({ dataRoot: '/b/worlds/w1/Kosmos', worldsBase: '/b', legacyRoots: [] });
  const own = '/b/worlds/w1/workers/guide/CLAUDE.md';
  /* A rule covers a path when the path starts with the rule's folder; `*` stands for one folder name. */
  const covers = (rule) => {
    const m = /^Read\(\/(\/.*)\/\*\*\)$/.exec(rule);
    if (!m) return rule === `Read(/${own})`;
    const re = new RegExp('^' + m[1].split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+') + '/');
    return re.test(own);
  };
  assert.deepEqual(rules.filter(covers), [], 'a rule would cut the guide off from its own instructions');
  assert.ok(covers('Read(//b/**)'), 'CONTROL: the cover check cannot say yes');
  assert.ok(covers('Read(//b/worlds/*/workers/**)'), 'CONTROL: the cover check cannot say yes through a `*`');
  assert.ok(!covers('Read(//b/worlds/*/Kosmos/**)'), 'CONTROL: the cover check cannot say no');
});

test('#4752 in the default world the base IS the data folder: no second rule for it, and the older folder only when it is another folder', () => {
  assert.deepEqual(tokenish(setupAssistant.guideDenyRules({ dataRoot: '/b', worldsBase: '/b', legacyRoots: ['/old/AgentWorkforce'] })),
    ['Read(//b/**)', 'Read(//old/AgentWorkforce/**)']);
  assert.deepEqual(tokenish(setupAssistant.guideDenyRules({ dataRoot: '/b', worldsBase: '/b', legacyRoots: ['/b'] })),
    ['Read(//b/**)'], 'an older folder that is the data folder was named twice');
  assert.deepEqual(tokenish(setupAssistant.guideDenyRules({ dataRoot: '/b', worldsBase: null, legacyRoots: [null] })),
    ['Read(//b/**)'], 'a base or older folder that could not be worked out made a rule');
});

test('#4752 worked out from this process, not handed in: the older folder beside the data folder is denied', () => {
  const rules = setupAssistant.guideDenyRules();
  const abs = (p) => '//' + p.replace(/^\/+/, '');
  assert.ok(rules.includes(`Read(${abs(store.ROOT)}/**)`), 'CONTROL: the data folder rule is gone');
  const older = path.join(process.env.AGENT_WORKFORCE_DATA, store.LEGACY_APP);
  assert.notEqual(older, store.ROOT, 'CONTROL: the older folder is the data folder here, so this arm proves nothing');
  assert.ok(rules.includes(`Read(${abs(older)}/**)`), 'the older data folder is not denied: ' + rules.filter((r) => r.includes(SANDBOX)).join(' '));
});

test('#4752 a process that has entered a named world (as a guide\'s board does) still finds the base it came from', () => {
  const home = path.join(SANDBOX, 'home2');
  fs.mkdirSync(home, { recursive: true });
  const env = { PATH: process.env.PATH, AGENT_WORKFORCE_HOME: home, KOSMOS_WORLD: 'beta' };
  const script = `
    const worlds = require(${JSON.stringify(path.join(__dirname, 'worlds.js'))});
    const base = worlds.baseRoot(process.env);
    worlds.applyAgentWorldEnv(process.env);
    const store = require(${JSON.stringify(path.join(__dirname, 'store.js'))});
    const sa = require(${JSON.stringify(path.join(__dirname, 'setup-assistant.js'))});
    process.stdout.write(JSON.stringify({ base, root: store.ROOT, rules: sa.guideDenyRules() }));
  `;
  const out = JSON.parse(execFileSync(process.execPath, ['-e', script], { env, encoding: 'utf8' }));
  const abs = (p) => '//' + p.replace(/^\/+/, '');
  assert.notEqual(out.root, out.base, 'CONTROL: the child is not in a named world, so this arm proves nothing');
  assert.ok(out.root.startsWith(path.join(out.base, 'worlds', 'beta') + path.sep), 'CONTROL: the world\'s store is not under the base: ' + out.root);
  assert.ok(out.rules.includes(`Read(${abs(out.root)}/**)`), 'the world\'s own store is not denied');
  assert.ok(out.rules.includes(`Read(${abs(path.join(out.base, 'board.token'))})`), 'the default world\'s token is not denied');
  assert.ok(out.rules.includes(`Read(${abs(path.join(out.base, 'worlds'))}/*/${store.APP}/**)`), 'the other worlds\' stores are not denied');
  assert.ok(!out.rules.includes(`Read(${abs(out.base)}/**)`), 'the base is denied whole, which cuts the guide off from its own folder');
});

test('#4752 when the extra folders cannot be worked out, the rules that were there before still come back', () => {
  const worlds = require('./worlds');
  const was = Object.getOwnPropertyDescriptor(worlds, 'WORLDS_SUBDIR');
  Object.defineProperty(worlds, 'WORLDS_SUBDIR', { configurable: true, get() { throw new Error('cannot be read'); } });
  try {
    const rules = setupAssistant.guideDenyRules({ dataRoot: '/b/worlds/w1/Kosmos', worldsBase: '/b', legacyRoots: ['/old/AgentWorkforce'] });
    assert.ok(rules.includes('Read(//b/worlds/w1/Kosmos/**)') && rules.includes('Read(~/.ssh/**)'), 'the earlier rules were lost: ' + rules.length);
    assert.deepEqual(rules.filter((r) => r.includes('/old/') || r.includes('board.token')), [], 'half of the extra rules were kept');
  } finally { Object.defineProperty(worlds, 'WORLDS_SUBDIR', was); }
  assert.ok(setupAssistant.guideDenyRules({ dataRoot: '/b/worlds/w1/Kosmos', worldsBase: '/b', legacyRoots: [] }).includes('Read(//b/board.token)'),
    'CONTROL: with the folder readable again the extra rules are back');
});
