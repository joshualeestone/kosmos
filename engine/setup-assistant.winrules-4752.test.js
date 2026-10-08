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
