'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mkTemp } = require('../test-support/tmpdir.js');
const skills = require('./skills');

function sandbox() { return mkTemp('skills-'); }

test('list reads the runtime convention: SKILL.md folders, frontmatter for the screens, folder name as the honest fallback', () => {
  const dir = sandbox();
  fs.mkdirSync(path.join(dir, 'summarise'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'summarise', 'SKILL.md'),
    '---\nname: summarise\ndescription: Boil a document down to a page.\nallowed-tools: [Read]\n---\n\n# Summarise\n');
  // A skill with no frontmatter still lists (the runtime loads it).
  fs.mkdirSync(path.join(dir, 'bare'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'bare', 'SKILL.md'), 'Just instructions.\n');
  // Not skills: a folder with no SKILL.md, a loose file, a dotfolder.
  fs.mkdirSync(path.join(dir, 'not-a-skill'));
  fs.writeFileSync(path.join(dir, 'loose.md'), 'x');
  fs.mkdirSync(path.join(dir, '.hidden'));
  const got = skills.list(dir);
  assert.equal(got.ok, true);
  assert.deepEqual(got.skills.map((s) => s.key), ['bare', 'summarise']);
  assert.equal(got.skills[1].description, 'Boil a document down to a page.');
  assert.equal(got.skills[0].name, 'bare');
  assert.equal(got.skills[0].description, null);
});

test('a missing directory is no skills; an unreadable one says so and never reads as empty', () => {
  const dir = sandbox();
  const none = skills.list(path.join(dir, 'never-made'));
  assert.deepEqual(none, { ok: true, skills: [] });
  const blocked = path.join(dir, 'blocked');
  fs.mkdirSync(blocked, { mode: 0o000 });
  try {
    const got = skills.list(blocked);
    assert.equal(got.ok, false, 'an unreadable folder listed as empty, the exact lie this codebase hunts');
    assert.match(got.because, /could not read/);
  } finally { fs.chmodSync(blocked, 0o700); }
});

test('add writes the convention a real skill on this machine uses, refuses a replace, and round-trips through list', () => {
  const dir = sandbox();
  const made = skills.add(dir, { name: 'Meeting Notes', body: 'Turn a transcript into minutes.\nKeep decisions and owners.' });
  assert.equal(made.ok, true, made.because);
  assert.equal(made.key, 'meeting-notes');
  const file = fs.readFileSync(path.join(dir, 'meeting-notes', 'SKILL.md'), 'utf8');
  assert.match(file, /^---\nname: meeting-notes\ndescription: Turn a transcript into minutes\./);
  const got = skills.list(dir);
  assert.deepEqual(got.skills.map((s) => s.key), ['meeting-notes']);
  // No overwrite: the refusal names the skill and the way out.
  const again = skills.add(dir, { name: 'meeting notes', body: 'different words' });
  assert.equal(again.ok, false);
  assert.match(again.because, /already a skill called meeting-notes/);
  assert.match(fs.readFileSync(path.join(dir, 'meeting-notes', 'SKILL.md'), 'utf8'), /transcript into minutes/,
    'the refusal still replaced the file');
});

test('the refusals: no name, empty body, oversized body', () => {
  const dir = sandbox();
  assert.match(skills.add(dir, { name: '###', body: 'x' }).because, /short name/);
  assert.match(skills.add(dir, { name: 'ok', body: '   ' }).because, /empty skill teaches nothing/);
  assert.match(skills.add(dir, { name: 'ok', body: 'x'.repeat(70 * 1024) }).because, /longer than a skill file/);
  assert.deepEqual(skills.list(dir).skills, [], 'a refusal left something on disk');
});

test('remove takes the folder, refuses a name that is not there, and says so', () => {
  const os = require('node:os');
  const dir = mkTemp('aw-sk-rm-');
  skills.add(dir, { name: 'Meeting minutes', body: 'Decisions and owners.' });
  assert.ok(fs.existsSync(path.join(dir, 'meeting-minutes', 'SKILL.md')));
  const gone = skills.remove(dir, 'meeting-minutes');
  assert.equal(gone.ok, true);
  assert.ok(!fs.existsSync(path.join(dir, 'meeting-minutes')), 'the folder survived removal');
  // The second click is a refusal with a sentence, never a quiet yes.
  const again = skills.remove(dir, 'meeting-minutes');
  assert.equal(again.ok, false);
  assert.match(again.because, /no skill by this name/);
  // A path-shaped key is refused before any filesystem look.
  assert.equal(skills.remove(dir, '../escape').ok, false);
});
