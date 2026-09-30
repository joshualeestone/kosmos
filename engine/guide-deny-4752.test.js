'use strict';
/**
 * #4752: the setup guide's deny rules name every folder of Kosmos's where a board token can sit, not only
 * the guide's own data folder: the older data folder (store.LEGACY_APP) and, for a guide in a named world,
 * the default world's token and every world's store. They must NOT name the worlds' base whole: a named
 * world's guide lives under it.
 *
 * The rules as strings are proven here. That a Mac's sandbox refuses a command's read under each rule
 * shape (one file, a folder, a `*` in the middle of the path) and still lets the guide read its own
 * folder under the base was measured once by hand, 2026-09-30: the table is in
 * .claude/plans/guidedeny-4752-20260930.md and on #4752.
 *
 * The rule strings below are POSIX paths: this file runs on the Mac and Linux jobs, not on Windows.
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
    'Read(//b/.board.token.*)',
    'Read(//b/.*.tmp)',
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

test('#4752 a process that has entered a named world (an agent\'s way, applyAgentWorldEnv; the board\'s goes through the same applyWorldEnv) still finds the base it came from', () => {
  const home = path.join(SANDBOX, 'home2');
  fs.mkdirSync(home, { recursive: true });
  const env = { PATH: process.env.PATH, HOME: home, AGENT_WORKFORCE_HOME: home, KOSMOS_WORLD: 'beta' };
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
  assert.ok(out.rules.includes(`Read(${abs(path.join(out.base, require('./boardauth').TOKEN_FILE))})`), 'the default world\'s token is not denied');
  assert.ok(out.rules.includes(`Read(${abs(path.join(out.base, require('./worlds').WORLDS_SUBDIR))}/*/${store.APP}/**)`), 'the other worlds\' stores are not denied');
  assert.ok(!out.rules.includes(`Read(${abs(out.base)}/**)`), 'the base is denied whole, which cuts the guide off from its own folder');
});

/* The stub below makes WORLDS_SUBDIR throw where guideDenyRulesFor first reads it (here, with no store to list,
   the worlds folder rules); the one `#4752:` line this test expects is that failure's. */
test('#4752 when the extra folders cannot be worked out, the rules that were there before still come back', () => {
  const worlds = require('./worlds');
  const was = Object.getOwnPropertyDescriptor(worlds, 'WORLDS_SUBDIR');
  Object.defineProperty(worlds, 'WORLDS_SUBDIR', { configurable: true, get() { throw new Error('cannot be read'); } });
  const said = [];
  const write = process.stderr.write;
  process.stderr.write = (s, ...rest) => { if (String(s).startsWith('#4752')) { said.push(String(s)); return true; } return write.call(process.stderr, s, ...rest); };
  try {
    const rules = setupAssistant.guideDenyRules({ dataRoot: '/b/worlds/w1/Kosmos', worldsBase: '/b', legacyRoots: ['/old/AgentWorkforce'] });
    assert.ok(rules.includes('Read(//b/worlds/w1/Kosmos/**)') && rules.includes('Read(~/.ssh/**)'), 'the earlier rules were lost: ' + rules.length);
    assert.deepEqual(rules.filter((r) => r.includes('/old/') || r.includes('board.token')), [], 'half of the extra rules were kept');
    assert.equal(said.length, 1, 'leaving the rules out was not said on stderr');
    assert.match(said[0], /left out: cannot be read/);
  } finally { process.stderr.write = write; Object.defineProperty(worlds, 'WORLDS_SUBDIR', was); }
  assert.ok(setupAssistant.guideDenyRules({ dataRoot: '/b/worlds/w1/Kosmos', worldsBase: '/b', legacyRoots: [] }).includes('Read(//b/board.token)'),
    'CONTROL: with the folder readable again the extra rules are back');
});

test('#4752 for a guide in a named world, every entry of the default world\'s store is named, except the worlds folder and its registry', () => {
  const base = path.join(SANDBOX, 'base-entries');
  for (const d of ['sendertokens', 'secrets', 'chats', 'worlds/w1/workers/guide']) fs.mkdirSync(path.join(base, d), { recursive: true });
  for (const f of ['board.token', 'connect.json', 'github-app.json', 'messages.jsonl', 'worlds.json']) fs.writeFileSync(path.join(base, f), 'x');
  const abs = (p) => '//' + p.replace(/^\/+/, '');
  const rules = setupAssistant.guideDenyRules({ dataRoot: path.join(base, 'worlds', 'w1', store.APP), worldsBase: base, legacyRoots: [] });
  for (const d of ['sendertokens', 'secrets', 'chats']) assert.ok(rules.includes(`Read(${abs(path.join(base, d))}/**)`), 'folder not named: ' + d);
  for (const f of ['board.token', 'connect.json', 'github-app.json', 'messages.jsonl']) assert.ok(rules.includes(`Read(${abs(path.join(base, f))})`), 'file not named: ' + f);
  const named = rules.filter((r) => r.startsWith(`Read(${abs(base)}/`));
  assert.ok(!named.some((r) => r === `Read(${abs(path.join(base, 'worlds'))}/**)` || r === `Read(${abs(path.join(base, 'worlds.json'))})`),
    'the worlds folder or its registry was named: ' + named.join(' '));
  assert.ok(!named.some((r) => r === `Read(${abs(base)}/**)`), 'the base was named whole');
  assert.ok(named.length >= 9, 'CONTROL: the entries were not read at all: ' + named.length);
  assert.equal(new Set(rules).size, rules.length, 'a rule is there twice: ' + rules.filter((r, i) => rules.indexOf(r) !== i).join(' '));
});

test('#4752 when the base cannot be worked out (preWorldEnv throws), that is said, and the earlier rules still come back', () => {
  const worlds = require('./worlds');
  const was = worlds.preWorldEnv;
  worlds.preWorldEnv = () => { throw new Error('no pre-world roots'); };
  const said = [];
  const write = process.stderr.write;
  process.stderr.write = (s, ...rest) => { if (String(s).startsWith('#4752')) { said.push(String(s)); return true; } return write.call(process.stderr, s, ...rest); };
  let rules;
  try { rules = setupAssistant.guideDenyRules(); } finally { process.stderr.write = write; worlds.preWorldEnv = was; }
  assert.ok(rules.includes(`Read(//${store.ROOT.replace(/^\/+/, '')}/**)`) && rules.includes('Read(~/.ssh/**)'), 'the earlier rules were lost');
  assert.equal(said.length, 1, 'the failure was not said');
  assert.match(said[0], /left out: no pre-world roots/);
});

test('#4752 the base\'s own passing files are not named one by one, a name the rule syntax would misread is left out, and a link gets both forms', () => {
  const base = path.join(SANDBOX, 'base-odd');
  fs.mkdirSync(path.join(base, 'worlds'), { recursive: true });
  fs.mkdirSync(path.join(base, '.worlds.json.lock'));
  for (const f of ['.worlds.json.4242.tmp', '.board.token.4242.tmp', '.world-boot-attempts.json.4242.tmp', 'notes (1).txt', 'a*b', 'My Notes.txt', 'trailing ']) fs.writeFileSync(path.join(base, f), 'x');
  fs.mkdirSync(path.join(SANDBOX, 'elsewhere'), { recursive: true });
  fs.symlinkSync(path.join(SANDBOX, 'elsewhere'), path.join(base, 'linked'));
  const abs = (p) => '//' + p.replace(/^\/+/, '');
  const rules = setupAssistant.guideDenyRules({ dataRoot: path.join(base, 'worlds', 'w1', store.APP), worldsBase: base, legacyRoots: [] });
  const named = rules.filter((r) => r.startsWith(`Read(${abs(base)}/`));
  for (const skipped of ['.worlds.json.lock', '.worlds.json.4242.tmp', '.board.token.4242.tmp', '.world-boot-attempts.json.4242.tmp', 'notes (1).txt', 'a*b', 'trailing ']) {
    assert.ok(!named.some((r) => r.includes(skipped)), 'named one by one: ' + skipped);
  }
  assert.ok(named.includes(`Read(${abs(path.join(base, 'My Notes.txt'))})`), 'a name with a space was not named');
  assert.ok(named.includes(`Read(${abs(path.join(base, 'linked'))})`) && named.includes(`Read(${abs(path.join(base, 'linked'))}/**)`), 'a link did not get both forms');
  assert.ok(named.includes(`Read(${abs(path.join(base, '.board.token'))}.*)`) && named.includes(`Read(${abs(base)}/.*.tmp)`),
    'the pattern rules that cover the temporary files are gone');
});

test('#4752 when the default world\'s store cannot be listed, only its entry list is lost, and that is said', () => {
  const base = path.join(SANDBOX, 'base-is-a-file');
  fs.writeFileSync(base, 'not a folder');
  const said = [];
  const write = process.stderr.write;
  process.stderr.write = (s, ...rest) => { if (String(s).startsWith('#4752')) { said.push(String(s)); return true; } return write.call(process.stderr, s, ...rest); };
  let rules;
  try { rules = setupAssistant.guideDenyRules({ dataRoot: '/b/worlds/w1/Kosmos', worldsBase: base, legacyRoots: ['/old/AgentWorkforce'] }); }
  finally { process.stderr.write = write; }
  const abs = (p) => '//' + p.replace(/^\/+/, '');
  assert.ok(rules.includes(`Read(${abs(path.join(base, 'board.token'))})`) && rules.includes('Read(//old/AgentWorkforce/**)')
    && rules.includes(`Read(${abs(path.join(base, 'worlds'))}/*/${store.APP}/**)`),
    'rules that do not need the list were lost');
  assert.equal(said.length, 1, 'the lost list was not said');
  assert.match(said[0], /could not be listed/);
});

test('#4752 rewriting the guide\'s rules drops the rule for a store entry that is gone, and keeps every other rule', () => {
  const base = path.join(SANDBOX, 'base-rewrite');
  fs.mkdirSync(path.join(base, 'worlds'), { recursive: true });
  for (const f of ['keep.json', 'projects.json.bak-20260824-201717']) fs.writeFileSync(path.join(base, f), 'x');
  const guide = path.join(SANDBOX, 'guide-rewrite');
  fs.mkdirSync(guide, { recursive: true });
  const deps = { dataRoot: path.join(base, 'worlds', 'w1', store.APP), worldsBase: base, legacyRoots: [] };
  const abs = (p) => '//' + p.replace(/^\/+/, '');
  const read = () => JSON.parse(fs.readFileSync(path.join(guide, '.claude', 'settings.json'), 'utf8')).permissions.deny;
  assert.equal(setupAssistant.guardGuideFolder(guide, 'guide', deps).ok, true);
  const bak = `Read(${abs(path.join(base, 'projects.json.bak-20260824-201717'))})`;
  assert.ok(read().includes(bak), 'CONTROL: the backup was not named the first time');
  /* A person's own rule under the same folder but deeper, and one elsewhere, must survive. */
  const s = JSON.parse(fs.readFileSync(path.join(guide, '.claude', 'settings.json'), 'utf8'));
  s.permissions.deny.push(`Read(${abs(path.join(base, 'deeper', 'x.txt'))})`, 'Read(//elsewhere/**)', `Read(${abs(path.join(base, 'worlds.json'))})`);
  fs.writeFileSync(path.join(guide, '.claude', 'settings.json'), JSON.stringify(s));
  fs.unlinkSync(path.join(base, 'projects.json.bak-20260824-201717'));
  assert.equal(setupAssistant.guardGuideFolder(guide, 'guide', deps).ok, true);
  const after = read();
  assert.ok(!after.includes(bak), 'the rule for a deleted entry stayed');
  assert.ok(after.includes(`Read(${abs(path.join(base, 'keep.json'))})`), 'the rule for an entry that is still there was lost');
  assert.ok(after.includes(`Read(${abs(path.join(base, 'deeper', 'x.txt'))})`) && after.includes('Read(//elsewhere/**)'), 'a rule that is not one entry of the store was dropped');
  assert.ok(after.includes(`Read(${abs(path.join(base, 'worlds.json'))})`), 'a person\'s rule for the registry (a name this code never writes) was dropped');
  assert.ok(after.includes('Read(~/.ssh/**)'), 'CONTROL: the ordinary rules are gone');
});

test('#4752 when the store cannot be listed on a rewrite, the earlier rules for its entries are kept', () => {
  const base = path.join(SANDBOX, 'base-unlistable');
  fs.mkdirSync(path.join(base, 'worlds'), { recursive: true });
  fs.writeFileSync(path.join(base, 'keep.json'), 'x');
  const guide = path.join(SANDBOX, 'guide-unlistable');
  fs.mkdirSync(guide, { recursive: true });
  const deps = { dataRoot: path.join(base, 'worlds', 'w1', store.APP), worldsBase: base, legacyRoots: [] };
  const rule = `Read(//${path.join(base, 'keep.json').replace(/^\/+/, '')})`;
  assert.equal(setupAssistant.guardGuideFolder(guide, 'guide', deps).ok, true);
  const read = () => JSON.parse(fs.readFileSync(path.join(guide, '.claude', 'settings.json'), 'utf8')).permissions.deny;
  assert.ok(read().includes(rule), 'CONTROL: the entry was not named the first time');
  /* The store's folder replaced by a file: listing it fails (ENOTDIR) whoever runs the test, root included. */
  fs.renameSync(base, base + '.moved');
  fs.writeFileSync(base, 'not a folder');
  const write = process.stderr.write;
  process.stderr.write = (s, ...rest) => (String(s).startsWith('#4752') ? true : write.call(process.stderr, s, ...rest));
  try { assert.equal(setupAssistant.guardGuideFolder(guide, 'guide', deps).ok, true); }
  finally { process.stderr.write = write; }
  assert.ok(read().includes(rule), 'an unlistable store dropped the rules made from its last listing');
});

test('#4752 the older folder is worked out for the home the rules were asked about, as the other rules are', () => {
  const home = path.join(SANDBOX, 'other-home');
  const env = { PATH: process.env.PATH, HOME: path.join(SANDBOX, 'home'), AGENT_WORKFORCE_HOME: path.join(SANDBOX, 'home') };
  const script = `
    const sa = require(${JSON.stringify(path.join(__dirname, 'setup-assistant.js'))});
    const store = require(${JSON.stringify(path.join(__dirname, 'store.js'))});
    const want = store.dataRootFor(process.platform, ${JSON.stringify(home)}, {}, store.LEGACY_APP);
    const ambient = store.dataRootFor(process.platform, process.env.AGENT_WORKFORCE_HOME, {}, store.LEGACY_APP);
    process.stdout.write(JSON.stringify({ want, ambient, rules: sa.guideDenyRules({ home: ${JSON.stringify(home)}, worldsBase: null }) }));
  `;
  const out = JSON.parse(execFileSync(process.execPath, ['-e', script], { env, encoding: 'utf8' }));
  const abs = (p) => '//' + p.replace(/^\/+/, '');
  assert.notEqual(out.want, out.ambient, 'CONTROL: the two homes give the same folder, so this arm proves nothing');
  assert.ok(out.rules.includes(`Read(${abs(out.want)}/**)`), 'the older folder of the home asked about is not denied');
});
