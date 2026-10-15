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
    "This Kosmos already has its company's words accepted here.", 'Your company asks it to report nothing.']) {
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
