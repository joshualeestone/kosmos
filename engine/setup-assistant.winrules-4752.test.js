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

test('#4752: a Windows drive path is written in the POSIX form Claude Code matches', () => {
  assert.equal(sa.ruleAbs('C:\\Users\\alice\\AppData\\Roaming\\Kosmos', 'win32'), '//c/Users/alice/AppData/Roaming/Kosmos');
  assert.equal(sa.ruleAbs('D:\\', 'win32'), '//d/');
  assert.equal(sa.ruleAbs('E:/mixed\\seps', 'win32'), '//e/mixed/seps');
  assert.equal(sa.ruleAbs('\\\\?\\C:\\Users\\a\\K', 'win32'), '//c/Users/a/K', 'the extended-length prefix stayed (its ? is a glob)');
});

test('#4752: CONTROL, a macOS or Linux path is unchanged', () => {
  assert.equal(sa.ruleAbs('/Users/alice/Library/Application Support/Kosmos', 'darwin'), '//Users/alice/Library/Application Support/Kosmos');
  assert.equal(sa.ruleAbs('/home/alice/.local/share/Kosmos', 'linux'), '//home/alice/.local/share/Kosmos');
  // a backslash in a POSIX path is part of a file name, not a separator
  assert.equal(sa.ruleAbs('/tmp/a\\b', 'darwin'), '//tmp/a\\b');
});

test('#4752: on THIS host (meaningful on the Windows job; trivially true elsewhere) no Read rule carries a backslash or a drive colon', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'winrules-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const rules = sa.guideDenyRules({ home, dataRoot: path.join(home, 'data'), worldsBase: path.join(home, 'base'), legacyRoots: [] });
  const abs = rules.filter((r) => r.startsWith('Read(//'));
  assert.ok(abs.length > 0, 'no absolute rule was written, so this arm tests nothing');
  for (const r of abs) {
    if (process.platform === 'win32') assert.match(r, /^Read\(\/\/[a-z]\//, 'a Windows rule is not in the //c/ form: ' + r);
    assert.equal(r.includes('\\'), false, 'a rule keeps a native backslash: ' + r);
    assert.equal(/^Read\(\/\/[A-Za-z]:/.test(r), false, 'a rule keeps a drive colon: ' + r);
  }
});

test('#4752: rulePath reads a written rule back to the exact path, so the own-folder check compares real paths', () => {
  for (const p of ['C:\\Users\\alice\\AppData\\Roaming\\Kosmos', 'D:\\data\\Kosmos\\worlds', 'c:\\lower\\drive']) {
    const back = sa.rulePath(sa.ruleAbs(p, 'win32').slice(2), 'win32');
    assert.equal(back.slice(1), p.slice(1), 'the Windows round trip changed the path past its drive letter: ' + back);
    assert.equal(back[0], p[0].toUpperCase(), 'the drive is not restored as a drive');
  }
  assert.equal(sa.rulePath('C:\\written\\before', 'win32'), 'C:\\written\\before', 'a rule in the older native form is not read as it is');
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
  const kept = sa.migrateKept([oldR], { entryBase: null, rules: [newR], extra: [newR] }, 'win32');
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
