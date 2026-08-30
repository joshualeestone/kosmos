'use strict';
/**
 * AN AGENT WHOSE NAME WE CANNOT READ IS OFFERED, NOT DROPPED (#1527).
 *
 * 🛑 THE MEASUREMENT THAT MADE THIS URGENT. A `CLAUDE.md` reading
 * `You are lilnacho, a project manager.` names nobody: the prose arm of
 * `identityFromText` needs a capital or bold markers, and every agent name on this
 * fleet is lowercase. Measured before this change:
 *
 *   plain lowercase name      agents 0   offered 0   <- INVISIBLE
 *   bold name                 agents 1   offered 0
 *   NO CLAUDE.md at all       agents 0   offered 1   <- offered!
 *
 * ⇒ **WRITING THE FILE IN THE NATURAL FORM MADE THE AGENT LESS DISCOVERABLE THAN
 * WRITING NO FILE AT ALL.** That is the defect, and it is worse than the card said.
 *
 * ⭐ THE FIX IS NOT A WIDER PARSER, AND `discover.js`'s own comment rejected that
 * for good reasons that still hold: loosening `identityFromText` fabricates a NAME
 * on the board, which is an assertion. An earlier attempt at exactly that produced
 * "a Project Manager" out of ordinary prose. Offering the folder instead fabricates
 * a QUESTION, which costs one click to decline, and the decline persists.
 *
 * ⚠️ THE DISCRIMINATOR IS CRUDE ON PURPOSE. "You are ..." at the start of a line is
 * what an agent's file says and a project README does not. It cannot tell
 * "You are lilnacho" from "You are an expert Python developer" and does not try.
 * Measured on 85 real instruction files: 18 named, 63 silent, THREE new offers, all
 * three template repos. The price is three declines against an agent being
 * invisible.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-unnamed-1527-'));
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, 'claude');
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');

const discover = require('./discover');

test.after(() => { fs.rmSync(SB, { recursive: true, force: true }); });

function seed(key, name, md) {
  const cwd = path.join(SB, 'work', name);
  fs.mkdirSync(cwd, { recursive: true });
  if (md !== null) fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), md);
  const proj = path.join(SB, 'claude', 'projects', key);
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'a.jsonl'), `{"type":"user"}\n{"cwd":${JSON.stringify(cwd)}}\n`);
  return cwd;
}

const HER   = seed('-k-her',   'lilnacho', '# lilnacho\n\nYou are lilnacho, a project manager.\n');
const BOLD  = seed('-k-bold',  'bolded',   '# x\n\nYou are **Bolded**, a tester.\n');
const README= seed('-k-readme','repo',     '# repo\n\nThis project builds a thing. It has no agent.\n');
const NOFILE= seed('-k-none',  'nofile',   null);
/* 🛑 "you are" IN THE MIDDLE OF A SENTENCE IS NOT AN INTRODUCTION, and without this
   fixture nothing proved the line anchor mattered. A perturbation that removed the
   anchor SURVIVED my first six arms, which means the anchor was untested code. */
const PROSE = seed('-k-prose', 'prose',
  '# repo\n\nDescribe what you are building here, then run the tests.\n');

const offered = () => (discover.found().adoptable || []).map((a) => a.dir);

test('#1527: a lowercase unbolded name is OFFERED rather than dropped', () => {
  /* CONTROL FIRST: the bold one must still be a real agent, or "offered" would be
     what happens to everything and this arm would prove nothing. */
  const r = discover.found();
  assert.deepEqual(r.agents.map((a) => a.name), ['Bolded'],
    `the control agent was not recognised: ${JSON.stringify(r.agents.map((a) => a.name))}`);
  assert.ok(offered().includes(HER),
    'the folder whose file says "You are lilnacho" is still invisible');
});

test('#1527: an ordinary project README is NOT offered, which is the whole risk', () => {
  /* If this fails, every repo in the org becomes a row on the found screen, which
     is what discover.js's comment warns buries the real agents. */
  assert.equal(offered().includes(README), false,
    'a project README with no "You are" line was offered as an agent');
});

test('#1527: "you are" MID-SENTENCE is not an introduction', () => {
  /* The anchor is the difference between "this file addresses somebody" and "this
     file contains the words". A README saying "describe what you are building"
     matches an unanchored pattern and is not an agent. */
  assert.equal(offered().includes(PROSE), false,
    'a README with "you are" mid-sentence was offered as an agent, so the line anchor is gone');
});

test('#1527: a recognised agent is not ALSO offered as a nameless folder', () => {
  assert.equal(offered().includes(BOLD), false,
    'the named agent appears twice, once as itself and once as an unnamed folder');
});

test('#1527: a folder with no instruction file is still offered, unchanged', () => {
  /* The pre-existing source of adoptable folders must survive the new one. */
  assert.ok(offered().includes(NOFILE), 'the no-file case stopped being offered');
});

test('#1527: it is still counted as unreadable, because it still is', () => {
  /* Offering it does not make it readable. The count is what the screen uses to say
     "we could not read these", and losing it would trade one silence for another. */
  assert.ok(discover.found().unreadable >= 2,
    `expected her folder and the README to count as unreadable: ${discover.found().unreadable}`);
});

test('#1527: declining it works, the same as any other offer', () => {
  assert.equal(discover.decline(HER).ok, true);
  assert.equal(offered().includes(HER), false, 'a declined unnamed folder is still offered');
  discover.undecline(HER);
  assert.ok(offered().includes(HER), 'undo did not restore it');
});
