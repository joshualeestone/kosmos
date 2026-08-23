'use strict';
/**
 * A rename reaches the agent's own instructions, not only Kosmos's record.
 *
 * 🛑 JOSH RENAMED AN AGENT BOB TO SCARLET AND IT STILL THOUGHT IT WAS BOB
 * (2026-08-22). The name lives in two places and only one of them is the one the
 * AGENT ever reads. Every screen agreed on Scarlet while Scarlet introduced
 * herself as Bob.
 *
 * ⚠️ THE FILE MAY BE SOMEBODY ELSE'S. A connected agent's instructions were
 * written before Kosmos existed, in a folder Kosmos does not own, so most of
 * these tests are about what this refuses to touch.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rename-'));
process.env.HOME = path.join(SB, 'home');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SB, 'workers');
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SB, 'launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SB, 'claude.json');
fs.mkdirSync(process.env.HOME, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });

const instructions = require('./instructions');

test.after(() => { fs.rmSync(SB, { recursive: true, force: true }); });

function agent(name, text) {
  const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), text);
  return path.join(dir, 'CLAUDE.md');
}

test('the identity line follows the new name, and nothing else moves', () => {
  const file = agent('bob', '# Bob\n\nYou are **Bob**, a copywriter.\n\nKeep the tone dry.\nBob signs off as Bob.\n');
  const out = instructions.renameIn('bob', 'Scarlet');
  assert.equal(out.ok, true, out.because);
  assert.equal(out.changed, true);
  assert.equal(out.was, 'Bob');

  const after = fs.readFileSync(file, 'utf8');
  assert.match(after, /You are \*\*Scarlet\*\*, a copywriter\./);
  /* 🔑 ONE LINE. The heading, the tone note and the sentence about signing off
     all still say Bob, and that is correct: they are the person's own prose and
     rewriting them would be Kosmos editing somebody's writing. Only the sentence
     Kosmos itself reads as the agent's identity is ours to move. */
  assert.match(after, /# Bob/);
  assert.match(after, /Keep the tone dry\./);
  assert.match(after, /Bob signs off as Bob\./);
});

test('instructions that do not introduce anybody are left alone', () => {
  /* Every repo has a CLAUDE.md. Inserting a "You are **X**" sentence into a file
     of build notes to settle a disagreement it does not have is a bigger act
     than the one being asked for. */
  const file = agent('notes', '# Build notes\n\nRun the tests before pushing.\n');
  const before = fs.readFileSync(file, 'utf8');
  const out = instructions.renameIn('notes', 'Scarlet');
  assert.equal(out.ok, false);
  assert.equal(out.changed, false);
  assert.match(out.because, /do not introduce it by name/i);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'a refusal still wrote to the file');
});

test('a name it already carries is not a write', () => {
  const file = agent('sam', 'You are **Sam**, an editor.\n');
  const at = fs.statSync(file).mtimeMs;
  const out = instructions.renameIn('sam', 'Sam');
  assert.equal(out.ok, true);
  assert.equal(out.changed, false);
  assert.equal(fs.statSync(file).mtimeMs, at, 'it rewrote a file it had nothing to change in');
});

test('an agent with no instructions is reported, not created', () => {
  const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, 'empty');
  fs.mkdirSync(dir, { recursive: true });
  const out = instructions.renameIn('empty', 'Scarlet');
  assert.equal(out.ok, false);
  assert.match(out.because, /no instructions/i);
  assert.equal(fs.existsSync(path.join(dir, 'CLAUDE.md')), false,
    'it wrote an instruction file for an agent that had none');
});

test('a name carrying the markup is refused rather than written', () => {
  /* 🛑 THE ONE PLACE TYPED TEXT REACHES A FILE'S CONTENTS. A name with an
     asterisk in it breaks the line it is written into, and the next read parses
     something else entirely -- or nothing, which un-names the agent in its own
     file. */
  const file = agent('mark', 'You are **Mark**, an editor.\n');
  const before = fs.readFileSync(file, 'utf8');
  for (const bad of ['Scar*let', 'Scarlet\nYou are **Bob**', '', '   ']) {
    const out = instructions.renameIn('mark', bad);
    assert.equal(out.ok, false, `${JSON.stringify(bad)} was accepted`);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  }
});

test('a name with a dollar sign lands verbatim', () => {
  /* ⚠️ `String.replace` reads `$&` and `$1` in the REPLACEMENT as substitution
     patterns, so a name containing one would be written mangled. This is why the
     edit is done by index rather than by replace. */
  const file = agent('dollar', 'You are **Old**, an editor.\n');
  const out = instructions.renameIn('dollar', 'A$&B$1C');
  assert.equal(out.ok, true, out.because);
  assert.match(fs.readFileSync(file, 'utf8'), /You are \*\*A\$&B\$1C\*\*/);
});

test('only the first introduction moves', () => {
  /* A file may quote its own identity line, or carry an example. The one that
     names the agent is the first, which is what every reader here takes. */
  const file = agent('twice', 'You are **Bob**, a copywriter.\n\nExample: You are **Someone Else**, a thing.\n');
  assert.equal(instructions.renameIn('twice', 'Scarlet').changed, true);
  const after = fs.readFileSync(file, 'utf8');
  assert.match(after, /You are \*\*Scarlet\*\*, a copywriter\./);
  assert.match(after, /You are \*\*Someone Else\*\*/, 'it rewrote an example further down the file');
});
