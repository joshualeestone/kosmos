'use strict';
/* kosmos#6251 (board half): the joined panel tells a family's computer about its family. The page words the sentences
   it builds itself by the kind /api/org reports for the record (plusOrgIn), as engine/orgenroll.js inKind does. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const fn = (name) => { const at = PAGE.indexOf(name); return at < 0 ? '' : PAGE.slice(at, PAGE.indexOf('\n}\n', at) + 2); };
const oe = require('./engine/orgenroll');

test('#6251: plusOrgIn words a sentence for a family exactly as the engine\'s inKind does, and leaves a company\'s', () => {
  const src = fn('function plusOrgIn(org, text)');
  assert.ok(src.length > 50, 'plusOrgIn is gone');
  const plusOrgIn = new Function(src + '\nreturn plusOrgIn;')();
  // Board review 1: every phrase either rewrites, so a rule added to one copy and not the other is seen.
  for (const s of ["Backups already taken stay with your company, under its rules.", "Your company's terms.",
    "This Kosmos already has its company's words accepted here.", 'Your company asks it to report nothing.',
    'This Kosmos is no longer your work Kosmos, so nothing was sent.', 'Your work Kosmos is elsewhere.']) {   // kosmos#6565: the work-Kosmos rule, in both copies
    assert.equal(plusOrgIn({ kind: 'company' }, s), s);
    assert.equal(plusOrgIn(null, s), s, 'no org reads as a company');
    assert.equal(plusOrgIn({ kind: 'family' }, s), oe.inKind('family', s), 'the page and the engine word a family differently: ' + s);
    assert.ok(!/company/i.test(plusOrgIn({ kind: 'family' }, s)), s);
  }
});

test('#6251: the joined panel\'s title and Leave button follow the record\'s kind, and /api/org reports it', () => {
  const paint = fn('function plusOrgPaint()');
  assert.match(paint, /plus-org-title'\)\.textContent = here && st\.org\.kind === 'family' \? 'Your family' : 'Your company'/);
  assert.match(paint, /plus-org-leave'\)\.textContent = here && st\.org\.kind === 'family' \? 'Leave family' : 'Leave company'/);
  assert.match(paint, /textContent = plusOrgIn\(st\.org, 'This Kosmos is your work Kosmos for '/, 'the joined line is not worded by kind');
  const arm = fn('function plusOrgLeaveArm(on)');
  assert.match(arm, /\|\| plusOrgIn\(st\.org, 'your company'\)\) \+ plusOrgIn\(st\.org, '\? This Kosmos stops reporting/, 'the leave question is not worded by kind');
  // Board review 1: the org's own name is never put through the rewrite.
  assert.doesNotMatch(arm + paint, /plusOrgIn\([^)]*\.name/, 'an org name goes through plusOrgIn');
  assert.match(SERVER, /org: rec && rec\.org \? \{ name: rec\.org\.name, slug: rec\.org\.slug, kind: rec\.org\.kind === 'family' \? 'family' : 'company' \}/,
    '/api/org does not report the kind the page words by');
});

test('#6565: a family’s joined line reads "This Kosmos is in" the family; a company still says "your work Kosmos for"', () => {
  const plusOrgIn = new Function(fn('function plusOrgIn(org, text)') + '\nreturn plusOrgIn;')();
  const line = (org) => plusOrgIn(org, 'This Kosmos is your work Kosmos for ') + org.name + plusOrgIn(org, '.');
  const family = line({ kind: 'family', name: 'Renet Family' });
  assert.equal(family, 'This Kosmos is in Renet Family.');
  assert.ok(!/work Kosmos/.test(family), family);
  // CONTROL: a company keeps the work-Kosmos wording, so the rule is family-only.
  assert.equal(line({ kind: 'company', name: 'Acme' }), 'This Kosmos is your work Kosmos for Acme.');
  assert.equal(plusOrgIn(null, 'This Kosmos is your work Kosmos for '), 'This Kosmos is your work Kosmos for ');
  // The 6251 rewording still holds beside the new rule.
  assert.equal(plusOrgIn({ kind: 'family' }, 'It reports to your company.'), 'It reports to your family.');
});

test('#6565: every other "your work Kosmos" on the page reads "your family\'s Kosmos" for a family, and each sentence goes through plusOrgIn', () => {
  const plusOrgIn = new Function(fn('function plusOrgIn(org, text)') + '\nreturn plusOrgIn;')();
  const fam = { kind: 'family' };
  assert.equal(plusOrgIn(fam, ': you are its last admin. This Kosmos is your work Kosmos'), ': you are its last admin. This Kosmos is your family\'s Kosmos');
  assert.equal(plusOrgIn(fam, ' was refused: you are its last admin. This Kosmos is your work Kosmos again'), ' was refused: you are its last admin. This Kosmos is your family\'s Kosmos again');
  assert.equal(plusOrgIn(fam, ': your work Kosmos is elsewhere, so leave from there.'), ': your family\'s Kosmos is elsewhere, so leave from there.');
  // CONTROL: a company keeps every one of them.
  assert.equal(plusOrgIn({ kind: 'company' }, ': your work Kosmos is elsewhere, so leave from there.'), ': your work Kosmos is elsewhere, so leave from there.');
  // Each of the three sentences is passed through plusOrgIn where it is written (an unwrapped one would reach a family as is).
  for (const said of [
    "plusOrgIn(j.org, ': you are its last admin. This Kosmos is your work Kosmos')",
    "plusOrgIn(j.org, ' was refused: you are its last admin. This Kosmos is your work Kosmos again')",
    "plusOrgIn(org0, ': your work Kosmos is elsewhere, so leave from there.')",
  ]) assert.ok(PAGE.includes(said), 'not passed through plusOrgIn: ' + said);
  // Every "your work Kosmos" on the page, counted: 4 in plusOrgIn calls (the joined line, both leave-refused lines,
  // stopped-reporting), 1 in the rule (the "for" rule; the general one is written ([Yy])our), 4 in comments. A new sentence that says it without plusOrgIn raises only the total:
  // wrap it in plusOrgIn (and raise both counts), or the family sees company wording. A comment that mentions the phrase
  // raises the total too; then raise it here.
  const wrapped = (PAGE.match(/plusOrgIn\([^,()]+, '[^'\n]*your work Kosmos/g) || []).length;
  const total = PAGE.split('your work Kosmos').length - 1;
  assert.equal(wrapped, 4, 'sentences passed through plusOrgIn');
  assert.equal(total, 9, 'every "your work Kosmos" on the page: a new one outside plusOrgIn reaches a family as is');
});

test('#6565: the page-only "your work Kosmos for" rule stays page-only: no engine sentence says it', () => {
  // plusOrgIn turns "your work Kosmos for" into "in"; inKind has only the general rule, so an engine sentence saying
  // "your work Kosmos for" would be worded differently by the two copies. What this checks: no line of orgenroll.js
  // outside a comment holds that lowercase phrase. A sentence split across a concatenation is not seen.
  const ENGINE = fs.readFileSync(path.join(__dirname, 'engine', 'orgenroll.js'), 'utf8');
  const said = ENGINE.split('\n').filter((l) => /your work Kosmos for/.test(l) && !/^\s*(\/\*|\*|\/\/)/.test(l));
  assert.deepEqual(said, [], 'an engine sentence says "your work Kosmos for": give inKind the page\'s "for" rule too');
  // CONTROL: the page does say it (the joined line), so the search reads the right kind of file.
  assert.ok(PAGE.includes("'This Kosmos is your work Kosmos for '"));
});
