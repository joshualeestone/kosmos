'use strict';

/**
 * Who a CLAUDE.md says it belongs to (kosmos#1078).
 *
 * 🛑 THE PARSER HAD NO TESTS OF ITS OWN, which is how the bold requirement went
 * unnoticed: every file on every machine we own was written by
 * `engine/create.js`, so the parser has only ever read its own generator's
 * output. Import exists for the person whose files Kosmos did NOT write.
 *
 * 🔑 THE DANGEROUS DIRECTION IS ACCEPTING TOO MUCH, so most of this file is
 * negative. A parser that finds an agent in project notes puts folders in a
 * list of people, and A WRONG LIST IS USED WHILE AN EMPTY ONE IS QUESTIONED.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const status = require('./status');

const who = (t) => { const r = status.identityFromText(t); return r && r.displayName; };

test('CONTROL: it can answer, and it can answer differently', () => {
  /* Every assertion below reads a displayName. If the export were missing or
     always-null, the negatives would all pass over nothing. */
  assert.equal(typeof status.identityFromText, 'function');
  assert.equal(who('You are **Anna**, a copywriter.'), 'Anna');
  assert.equal(who('nothing here'), null);
});

test('the bold form still works, and still takes names that are not capitalised', () => {
  /* ⚠️ NOT LAZINESS. Live agents are named `rep-own` and `side-quests`, and a
     template writes `You are **{{NAME}}**`. Requiring a capital inside the bold
     would un-find agents that are found today, which is a regression wearing a
     tightening's clothes. */
  assert.equal(who('You are **Anna**, a copywriter.'), 'Anna');
  assert.equal(who('You are **rep-own**, in my own words.'), 'rep-own');
  assert.equal(who('You are **{{NAME}}**, precisely what I typed.'), '{{NAME}}');
  assert.equal(who('You are **side-quests**.'), 'side-quests');
});

test('plain prose introduces an agent too, which is the whole point', () => {
  /* Josh, 2026-08-27: a person hand-writing this file has no way to know the
     asterisks are load-bearing. */
  assert.equal(who('You are Nevaeh, a copywriter.'), 'Nevaeh');
  assert.equal(who('You are Mona Lisa, the design worker.'), 'Mona Lisa');
  assert.equal(who('You are Ada Lovelace Jones, a tester.'), 'Ada Lovelace Jones');
});

test('the role still comes out, bold or not', () => {
  assert.equal(status.identityFromText('You are Nevaeh, a copywriter.').role, 'copywriter');
  assert.equal(status.identityFromText('You are **Anna**, the Web Properties Worker.').role,
    'Web Properties Worker');
});

/**
 * #1168. The non-bold arm exists for a person hand-writing this file in plain
 * prose, and **the most natural plain prose was the shape it got wrong.** Every
 * `CLAUDE.md` in this org came from one template and is bold, with a comma and a
 * role, so the row that failed is the row no file here uses: exactly the
 * population the arm was added to serve.
 */
test('#1168: a name that ends the sentence keeps neither the stop nor the next sentence', () => {
  const r = (t) => status.identityFromText(t);

  /* Defect 1: the full stop welded to the name, which reaches the card through
     discover.js and renders as the agent's name. */
  assert.equal(who('You are Bob.'), 'Bob');
  assert.equal(who('You are Mary Anne Smith.'), 'Mary Anne Smith');

  /* 🛑 Defect 2, the expensive one: it read PAST the stop and invented a role out
     of the following sentence. A fabricated role is worse than a missing one,
     because nothing on the card says where it came from. */
  assert.equal(who('You are Bob. He writes copy.'), 'Bob');
  assert.equal(r('You are Bob. He writes copy.').role, null,
    'a role was invented out of the sentence after the name');

  /* 🔑 THE ROW THE OBVIOUS FIX BREAKS, and the reason the stop stays in the
     character class: a name that really does end in a stop. Stripping every
     trailing stop, or dropping `.` from the class, loses this. */
  assert.equal(who('You are J.R.'), 'J.R.');

  /* 🔑 CONTROLS: the shapes that worked before must still work, including the
     three-word name, the comma-role, and the bold arm with a trailing stop. */
  assert.equal(who('You are Nevaeh, a copywriter.'), 'Nevaeh');
  assert.equal(r('You are Nevaeh, a copywriter.').role, 'copywriter');
  assert.equal(who('You are Ada Lovelace Jones, a tester.'), 'Ada Lovelace Jones');
  assert.equal(who('You are **side-quests**.'), 'side-quests');
  assert.equal(r('You are **rep-own**, in my own words.').role, 'in my own words');

  /* 📌 THE COST, PINNED RATHER THAN LEFT TO BE REDISCOVERED. A role written as
     its own sentence is dropped too. Somebody may have meant one, and guessing
     across a full stop is what produced defect 2, so this declines to guess in
     both directions. Flip this row only with an observed file that needs it. */
  assert.equal(r('You are Bob. A copywriter.').role, null,
    'a role in a following sentence is now being read again');
});

test('a sentence that is not a name is NOT an agent', () => {
  /* 🛑 THE ROW THAT EARNS THIS FILE is the first one: it is not invented, it is
     `engine/defaults.js`, the working-rules block Kosmos writes INTO agent
     instructions. A parser that accepted "anything up to the comma" would find
     a person called "talking to a person running a business" on every machine
     where those defaults have been applied. */
  assert.equal(who('You are talking to a person running a business, not an engineer.'), null);
  assert.equal(who('You are an expert in Rust.'), null);
  assert.equal(who('You are the assistant for this repo.'), null);
  assert.equal(who('You are working in a monorepo.'), null);
  assert.equal(who('You are not alone, ask for help.'), null);
});

test('the working-rules text Kosmos ships introduces nobody, read from the file itself', () => {
  /* 🔑 READ, NOT QUOTED. A copy of that sentence here would keep passing after
     someone edited defaults.js, which is the drift this whole card is about. */
  const src = fs.readFileSync(path.join(__dirname, 'defaults.js'), 'utf8');
  const lines = src.split('\n').filter((l) => /You are /.test(l));
  assert.ok(lines.length, 'defaults.js no longer contains a "You are" line; re-derive this test');
  for (const l of lines) {
    assert.equal(who(l), null, `defaults.js line reads as an agent: ${l.trim().slice(0, 80)}`);
  }
});

test('a CLAUDE.md that is project notes is not an agent', () => {
  assert.equal(who('# Build notes\n\nRun yarn test before pushing.\n'), null);
  assert.equal(who(''), null);
  assert.equal(who(null), null);
});
