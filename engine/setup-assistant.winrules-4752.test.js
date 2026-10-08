'use strict';
/**
 * #4752 follow-up: on Windows Claude Code matches a Read rule against the path in POSIX form (its permissions
 * docs: C:\Users\alice becomes /c/Users/alice). ruleAbs writes a drive path that way, so the setup guide's Read
 * rules name a form that can match there. Pinned from any host by passing the platform; the last arm reads the
 * real rules on the host it runs on (the Windows job runs it there).
 *
 *   node --test engine/setup-assistant.winrules-4752.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const sa = require('./setup-assistant');
const { removeTree } = require('../test-support/remove-tree');

test('#4752: a Windows drive path is written in the POSIX form Claude Code matches', () => {
  assert.equal(sa.ruleAbs('C:\\Users\\alice\\AppData\\Roaming\\Kosmos', 'win32'), '//c/Users/alice/AppData/Roaming/Kosmos');
  assert.equal(sa.ruleAbs('D:\\', 'win32'), '//d', 'a drive root has no trailing slash (its folder rule would be //d//**)');
  assert.equal(sa.ruleAbs('E:/mixed\\seps', 'win32'), '//e/mixed/seps');
  assert.equal(sa.ruleAbs('\\\\?\\C:\\Users\\a\\K', 'win32'), '//c/Users/a/K', 'an extended-length path was not written as its plain path (its ? is a glob)');
  assert.equal(sa.ruleAbs('\\\\?\\UNC\\srv\\share\\K', 'win32'), sa.ruleAbs('\\\\srv\\share\\K', 'win32'), 'an extended-length UNC path is not written as the same share');
});

test('#4752: CONTROL, a macOS or Linux path is unchanged', () => {
  assert.equal(sa.ruleAbs('/Users/alice/Library/Application Support/Kosmos', 'darwin'), '//Users/alice/Library/Application Support/Kosmos');
  assert.equal(sa.ruleAbs('/home/alice/.local/share/Kosmos', 'linux'), '//home/alice/.local/share/Kosmos');
  // a backslash in a POSIX path is part of a file name, not a separator
  assert.equal(sa.ruleAbs('/tmp/a\\b', 'darwin'), '//tmp/a\\b');
});

test('#4752: on THIS host (meaningful on the Windows job; trivially true elsewhere) every rule is in the documented form, and on Windows also has its native twin', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'winrules-'));
  t.after(() => removeTree(home));
  const rules = sa.guideDenyRules({ home, dataRoot: path.join(home, 'data'), worldsBase: path.join(home, 'base'), legacyRoots: [] });
  const isTwin = (r) => /^Read\(\/\/[A-Za-z]:\\/.test(r);   // the deliberate old native spelling (Windows only)
  const abs = rules.filter((r) => r.startsWith('Read(//') && !isTwin(r));
  assert.ok(abs.length > 0, 'no absolute rule was written, so this arm tests nothing');
  for (const r of abs) {
    if (process.platform === 'win32') {
      assert.match(r, /^Read\(\/\/[a-z]\//, 'a Windows rule is not in the //c/ form: ' + r);
      assert.ok(rules.some((x) => isTwin(x) && sa.legacyWinEquivalent(x) === r), 'a Windows rule has no native twin: ' + r);
    }
    assert.equal(r.includes('\\'), false, 'a documented-form rule keeps a native backslash: ' + r);
  }
  if (process.platform !== 'win32') assert.equal(rules.some(isTwin), false, 'CONTROL: a native twin was written off Windows');
});

test('#4752: rulePath reads a written rule back to the exact path, so the own-folder check compares real paths', () => {
  for (const p of ['C:\\Users\\alice\\AppData\\Roaming\\Kosmos', 'D:\\data\\Kosmos\\worlds', 'c:\\lower\\drive']) {
    const back = sa.rulePath(sa.ruleAbs(p, 'win32').slice(2), 'win32');
    assert.equal(back.slice(1), p.slice(1), 'the Windows round trip changed the path past its drive letter: ' + back);
    assert.equal(back[0], p[0].toUpperCase(), 'the drive is not restored as a drive');
  }
  assert.equal(sa.rulePath('C:\\written\\before', 'win32'), 'C:\\written\\before', 'a rule in the older native form was changed on reading; it must come back exactly as written');
  for (const p of ['/Users/alice/Library/Application Support/Kosmos', '/home/a/.local/share/Kosmos']) {
    assert.equal(sa.rulePath(sa.ruleAbs(p, 'darwin').slice(2), 'darwin'), p, 'CONTROL: the POSIX round trip changed');
  }
});

test('#4752: an older native-form Windows rule maps to its exact new-form equivalent', () => {
  const eq = sa.legacyWinEquivalent;
  assert.equal(eq('Read(//C:\\Users\\a\\AppData\\Roaming\\Kosmos/**)'), 'Read(//c/Users/a/AppData/Roaming/Kosmos/**)');
  assert.equal(eq('Read(//C:\\Users\\a\\K\\board-token)'), 'Read(//c/Users/a/K/board-token)');
  assert.equal(eq('Read(//C:\\Users\\a\\K\\.board-token.*)'), 'Read(//c/Users/a/K/.board-token.*)', 'the temp-copy suffix was lost');
  assert.equal(eq('Read(//C:\\base\\worlds/*/Kosmos/**)'), 'Read(//c/base/worlds/*/Kosmos/**)', 'the worlds pattern suffix was lost');
  assert.equal(eq('Read(//c/Users/a/x)'), null, 'CONTROL: a new-form rule has no older equivalent');
  assert.equal(eq('Read(~/.ssh/**)'), null, 'CONTROL: a home rule is not a native-form rule');
  // the equivalent is exactly what ruleAbs writes for the same path, so `fresh.rules.includes(eq)` can be true
  assert.equal(eq('Read(//C:\\Users\\a\\x)'), `Read(${sa.ruleAbs('C:\\Users\\a\\x', 'win32')})`);
});

test('#4752: migrating a Windows guide keeps exactly the right rules (pure, so it runs from any host)', () => {
  const base = 'C:\\Users\\a\\AppData\\Roaming\\Kosmos';
  const nf = (p) => `Read(${sa.ruleAbs(p, 'win32')})`;   // a rule in the new form
  const fresh = {
    entryBase: base,
    rules: [nf(base + '\\notes.json'), nf(base + '\\board-token'), 'Read(~/.ssh/**)'],
  };
  const had = [
    'Read(//C:\\Users\\a\\AppData\\Roaming\\Kosmos\\notes.json)',   // old form, new form made just now: BOTH kept (unmeasured)
    'Read(//C:\\Users\\a\\AppData\\Roaming\\Kosmos\\gone.log)',     // old form, entry gone from the listed store: dropped
    'Read(//C:\\Users\\a\\AppData\\Roaming\\Kosmos\\gone-dir/**)',   // old form, a FOLDER entry gone: dropped too
    nf(base + '\\also-gone.log'),                                     // new form, entry gone: dropped (wasEntryRule)
    'Read(//C:\\Users\\a\\Documents\\private)',                        // a person's own old-form rule elsewhere: kept
    nf('C:\\Users\\a\\Documents\\other'),                              // a person's own new-form rule elsewhere: kept
    'Read(~/.ssh/**)',
  ];
  assert.deepEqual(sa.migrateKept(had, fresh, 'win32'), [
    'Read(//C:\\Users\\a\\AppData\\Roaming\\Kosmos\\notes.json)',   // its path is still protected: the old form stays too
    'Read(//C:\\Users\\a\\Documents\\private)',
    nf('C:\\Users\\a\\Documents\\other'),
    'Read(~/.ssh/**)',
  ]);
  // with no complete listing (entryBase null), an old rule with no fresh equivalent stays: never a path left bare
  assert.deepEqual(sa.migrateKept(['Read(//C:\\Users\\a\\AppData\\Roaming\\Kosmos\\gone.log)'], { entryBase: null, rules: [] }, 'win32'),
    ['Read(//C:\\Users\\a\\AppData\\Roaming\\Kosmos\\gone.log)']);
});

test('#4752: CONTROL, off Windows no native-looking rule is touched by the Windows migration', () => {
  const had = ['Read(//C:\\Users\\a\\x)', 'Read(//Users/a/y)'];
  assert.deepEqual(sa.migrateKept(had, { entryBase: null, rules: ['Read(//c/Users/a/x)'] }, 'darwin'), had);
});

test('#4752: on Windows a refused rule (it would take in the guide\'s own folder) is left out in BOTH spellings', () => {
  const newR = `Read(${sa.ruleAbs('C:\\Users\\a\\old\\Kosmos', 'win32')}/**)`;
  const oldR = 'Read(//C:\\Users\\a\\old\\Kosmos/**)';
  // migrateKept keeps the old rule beside its new form, since the new form was just made...
  const kept = sa.migrateKept([oldR], { entryBase: null, rules: [newR] }, 'win32');
  assert.deepEqual(kept, [oldR]);
  // ...and the refusal must reach it too, or the old spelling would still cut the guide off
  const refused = new Set([newR]);
  assert.deepEqual(sa.finalDeny(kept, [], refused, 'win32'), []);
  // CONTROL: an old rule whose new form was NOT refused stays
  const other = 'Read(//C:\\Users\\a\\Documents\\private)';
  assert.deepEqual(sa.finalDeny([other], [newR], new Set(), 'win32'), [other, newR]);
  // CONTROL: off Windows only the exact refused string is left out
  assert.deepEqual(sa.finalDeny([oldR], [], refused, 'darwin'), [oldR]);
});

test('#4752 on a Windows host: guardGuideFolder leaves out a rule taking in the guide\'s folder in BOTH spellings, end to end', { skip: process.platform !== 'win32' && 'measures the real Windows path through guardGuideFolder; runs on the Windows job' }, (t) => {
  // On a Windows runner os.tmpdir() is an 8.3 short name (RUNNER~1). That still works: the rules are written from the
  // same short-name strings this test builds, and both sides of the own-folder comparison go through realpath.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'winrules-e2e-'));
  t.after(() => removeTree(root));
  const workers = path.join(root, 'home', 'workers');
  const guide = path.join(workers, 'guide');
  fs.mkdirSync(path.join(guide, '.claude'), { recursive: true });
  const oldNative = `Read(//${workers.replace(/^[\\/]+/, '')}/**)`;          // how a rule for it was spelt before this change
  const personal = `Read(//${path.join(root, 'elsewhere').replace(/^[\\/]+/, '')})`;   // a person's own native-form rule
  fs.writeFileSync(path.join(guide, '.claude', 'settings.json'), JSON.stringify({ permissions: { deny: [oldNative, personal] } }));
  const dataOwn = path.join(root, 'data-own');
  const write = process.stderr.write;
  const said = [];
  process.stderr.write = (s, ...rest) => { if (String(s).startsWith('#4752')) { said.push(String(s)); return true; } return write.call(process.stderr, s, ...rest); };
  let deny;
  try {
    assert.equal(sa.guardGuideFolder(guide, 'guide', { dataRoot: dataOwn, worldsBase: null, legacyRoots: [workers] }).ok, true);
    deny = JSON.parse(fs.readFileSync(path.join(guide, '.claude', 'settings.json'), 'utf8')).permissions.deny;
  } finally { process.stderr.write = write; }
  const newForm = `Read(${sa.ruleAbs(workers, 'win32')}/**)`;
  // positive: the rule WAS made and refused (not simply never generated), and the refusal was said
  assert.ok(said.some((l) => l.includes('own folder') && l.includes(newForm)), 'the refusal of the rule taking in the guide\'s folder was not said: ' + said.join(' | '));
  assert.equal(deny.includes(newForm), false, 'the new-form rule taking in the guide\'s folder was written');
  assert.equal(deny.includes(oldNative), false, 'the old spelling of that rule survived and still cuts the guide off');
  assert.equal(deny.some((r) => sa.legacyWinEquivalent(r) === newForm), false, 'some old spelling of the refused rule survived');
  assert.ok(deny.includes(personal), 'CONTROL: a person\'s own rule elsewhere was dropped');
  assert.ok(deny.includes(`Read(${sa.ruleAbs(dataOwn, 'win32')}/**)`), 'CONTROL: the data folder rule is missing, or not in the //c/ form');
});

test('#4752: a Windows rule with no drive (a share) reads back as nothing, never as a path on the current drive', () => {
  assert.equal(sa.rulePath('host/share/K', 'win32'), null);
  assert.equal(sa.rulePath('Users/a', 'darwin'), '/Users/a', 'CONTROL: off Windows a rule reads back as its POSIX path');
});

test('#4752: on Windows every absolute rule is also written in the old native spelling (pure; any host)', () => {
  const rules = ['Read(~/.ssh/**)', 'Read(//c/Users/a/Kosmos/**)', 'Read(//c/b/.board-token.*)', 'Read(//c/b/worlds/*/Kosmos/**)', 'Read(//c/b/token)'];
  assert.deepEqual(sa.withNativeTwins(rules, 'win32'), [
    'Read(~/.ssh/**)',
    'Read(//c/Users/a/Kosmos/**)', 'Read(//C:\\Users\\a\\Kosmos/**)',
    'Read(//c/b/.board-token.*)', 'Read(//C:\\b\\.board-token.*)',
    'Read(//c/b/worlds/*/Kosmos/**)', 'Read(//C:\\b\\worlds/*/Kosmos/**)',
    'Read(//c/b/token)', 'Read(//C:\\b\\token)',
  ]);
  // each twin maps back to its own new-form rule, so migrateKept and finalDeny treat it as that rule's old spelling
  for (const r of sa.withNativeTwins(rules, 'win32').filter((x) => x.includes(':\\'))) {
    assert.ok(rules.includes(sa.legacyWinEquivalent(r)), 'a twin does not map back to its rule: ' + r);
  }
  assert.deepEqual(sa.withNativeTwins(rules, 'darwin'), rules, 'CONTROL: off Windows nothing is added');
});

test('#4752: an old rule for a drive root maps to the same rule ruleAbs writes now', () => {
  assert.equal(sa.legacyWinEquivalent('Read(//D:\\/**)'), `Read(${sa.ruleAbs('D:\\', 'win32')}/**)`);
});

test('#4752: on Windows a path that is not a drive path gets no rule (said), off Windows the same strings are ordinary', () => {
  for (const p of ['\\\\srv\\share\\K', '\\\\s\\share\\K', '\\\\?\\UNC\\srv\\share', '\\\\.\\C:\\x', 'c:foo']) {
    assert.equal(sa.ruleUnwritable(p, 'win32'), true, 'written as a rule that matches nothing on Windows: ' + p);
  }
  for (const p of ['C:\\Users\\a', 'd:/data', '\\\\?\\C:\\Users\\a']) assert.equal(sa.ruleUnwritable(p, 'win32'), false, 'CONTROL: a drive path refused: ' + p);
  assert.equal(sa.ruleUnwritable('/srv/share/K', 'darwin'), false, 'CONTROL: an ordinary POSIX path refused');
  assert.equal(sa.ruleUnwritable('/a/b*c', 'darwin'), true, 'CONTROL: a pattern character not refused');
});

test('#4752: a refusal reaches an old rule spelt in another case on Windows', () => {
  const refused = new Set(['Read(//c/Users/a/old/**)']);
  assert.deepEqual(sa.finalDeny(['Read(//C:\\Users\\A\\old/**)'], [], refused, 'win32'), []);
});

test('#4752: a drive root\'s twin is the old writer\'s spelling', () => {
  assert.deepEqual(sa.withNativeTwins(['Read(//d/**)'], 'win32'), ['Read(//d/**)', 'Read(//D:\\/**)']);
});

test('#4752: a refusal reaches a new-form rule spelt in another case on Windows, never off Windows', () => {
  const refused = new Set(['Read(//c/Users/a/old/**)']);
  assert.deepEqual(sa.finalDeny(['Read(//c/Users/A/old/**)'], [], refused, 'win32'), []);
  assert.deepEqual(sa.finalDeny(['Read(//c/Users/A/old/**)'], [], refused, 'darwin'), ['Read(//c/Users/A/old/**)'], 'CONTROL: case folded off Windows');
});
