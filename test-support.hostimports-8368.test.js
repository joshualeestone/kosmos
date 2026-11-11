'use strict';
/* kosmos#8368: the rule that lets a macOS-pinned guard test skip on a host whose own instruction files import what the
   pinned rules cannot carry (test-support/hostimports-8368.js). It decides whether real assertions run, so every way it
   must say "no" is pinned here. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { onlyImportComplaints, onCi, IMPORT_NOTE, COVER_PREFIX } = require('./test-support/hostimports-8368');

const SUFFIX = ': renaming that folder so its name has none of ( ) [ ] { } * ? ! or \\, or pointing the link somewhere else, lets Kosmos cover it';
const entry = (p, note) => `${p} ${note}`;
const reason = (entries, suffix = SUFFIX) => COVER_PREFIX + entries.join(', ') + ')' + suffix;

test('only import complaints, one or several, with or without the renaming advice: yes', () => {
  assert.equal(onlyImportComplaints(reason([entry('C:\\Users\\a\\.claude\\B.md', IMPORT_NOTE)])), true);
  assert.equal(onlyImportComplaints(reason([entry('C:\\Users\\a\\.claude\\B.md', IMPORT_NOTE), entry('C:\\Users\\a\\.claude\\P.md', IMPORT_NOTE)])), true);
  assert.equal(onlyImportComplaints(reason([entry('/Users/a/.claude/B.md', IMPORT_NOTE)], '')), true);
});

test('a second complaint of any kind beside the imports: no, so the arms run', () => {
  assert.equal(onlyImportComplaints(reason([entry('C:\\x\\B.md', IMPORT_NOTE), entry('C:\\x\\plugins', '(a plugin folder a Claude Code variable names, whose path the permission rules cannot carry)')])), false);
  assert.equal(onlyImportComplaints(reason([entry('C:\\x\\B.md', IMPORT_NOTE), "other agents' config homes (they could not be read: EACCES)"])), false);
  assert.equal(onlyImportComplaints(reason(["the agents' folder (it could not be read: EPERM), so other agents' config homes are not found"])), false);
});

test('a path with its own brackets, an empty list, another shape, or nothing: no', () => {
  assert.equal(onlyImportComplaints(reason([entry('C:\\Program Files (x86)\\B.md', IMPORT_NOTE)])), false, 'brackets in the path: not ours to guess');
  assert.equal(onlyImportComplaints(COVER_PREFIX + ')'), false);
  assert.equal(onlyImportComplaints('the PATH this agent starts with has an entry Kosmos could not cover (C:\\Windows)'), false);
  assert.equal(onlyImportComplaints(COVER_PREFIX + entry('C:\\x\\B.md', IMPORT_NOTE)), false, 'no closing bracket');
  assert.equal(onlyImportComplaints(''), false);
  assert.equal(onlyImportComplaints(null), false);
});

test('onCi: CI set and not false or 0', () => {
  assert.equal(onCi({ CI: 'true' }), true);
  assert.equal(onCi({ CI: '1' }), true);
  assert.equal(onCi({ CI: 'false' }), false);
  assert.equal(onCi({ CI: '0' }), false);
  assert.equal(onCi({}), false);
});
