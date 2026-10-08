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
});

test('#4752: CONTROL, a macOS or Linux path is unchanged', () => {
  assert.equal(sa.ruleAbs('/Users/alice/Library/Application Support/Kosmos', 'darwin'), '//Users/alice/Library/Application Support/Kosmos');
  assert.equal(sa.ruleAbs('/home/alice/.local/share/Kosmos', 'linux'), '//home/alice/.local/share/Kosmos');
  // a backslash in a POSIX path is part of a file name, not a separator
  assert.equal(sa.ruleAbs('/tmp/a\\b', 'darwin'), '//tmp/a\\b');
});

test('#4752: no Read rule the guide writes on THIS host carries a backslash or a drive colon', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'winrules-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const rules = sa.guideDenyRules({ home, dataRoot: path.join(home, 'data'), worldsBase: path.join(home, 'base'), legacyRoots: [] });
  const abs = rules.filter((r) => r.startsWith('Read(//'));
  assert.ok(abs.length > 0, 'no absolute rule was written, so this arm tests nothing');
  for (const r of abs) {
    assert.equal(r.includes('\\'), false, 'a rule keeps a native backslash: ' + r);
    assert.equal(/^Read\(\/\/[A-Za-z]:/.test(r), false, 'a rule keeps a drive colon: ' + r);
  }
});

test('#4752: rulePath reads a written rule back to the exact path, so the own-folder check compares real paths', () => {
  for (const p of ['C:\\Users\\alice\\AppData\\Roaming\\Kosmos', 'D:\\data\\Kosmos\\worlds', 'c:\\lower\\drive']) {
    const back = sa.rulePath(sa.ruleAbs(p, 'win32').slice(2), 'win32');
    assert.equal(back.toLowerCase(), p.toLowerCase(), 'the Windows round trip lost the path: ' + back);
    assert.match(back, /^[A-Z]:\\/, 'the drive is not restored as a drive');
  }
  assert.equal(sa.rulePath('C:\\written\\before', 'win32'), 'C:\\written\\before', 'a rule in the older native form is not read as it is');
  for (const p of ['/Users/alice/Library/Application Support/Kosmos', '/home/a/.local/share/Kosmos']) {
    assert.equal(sa.rulePath(sa.ruleAbs(p, 'darwin').slice(2), 'darwin'), p, 'CONTROL: the POSIX round trip changed');
  }
});

test('#4752: an older native-form Windows rule maps to its exact new-form equivalent (dropped only when that was made)', () => {
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
