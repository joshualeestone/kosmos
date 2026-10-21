'use strict';
/* kosmos#6752: the Settings company block lists the reviewer grants /api/org reports (engine/orgenroll.js keeps them
   from the hourly status answer), so every member can see someone was made a reviewer. The page works out pending or
   in effect from the times, since the record is up to an hour old, and writes each line as text. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const fn = (name) => { const at = PAGE.indexOf(name); return at < 0 ? '' : PAGE.slice(at, PAGE.indexOf('\n}\n', at) + 2); };

const T = 1_790_000_000;
const when = (s) => '@' + s;

test('#6752: a grant reads as pending, in effect or removed by its times, not by a stored state', () => {
  const line = new Function(fn('function plusOrgReviewerLine(g, now, when)') + '\nreturn plusOrgReviewerLine;')();
  const g = { who: 'pat', grantedAt: T, effectiveAt: T + 86400 };
  assert.equal(line(g, T + 10, when), 'pat, made a reviewer @' + T + ', takes effect @' + (T + 86400) + '.');
  // The same record an hour-old read carried, painted after the 24 hours: in effect, whatever the coordinator said then.
  assert.equal(line({ ...g, state: 'pending' }, T + 86401, when), 'pat, made a reviewer @' + T + ', in effect since @' + (T + 86400) + '.');
  assert.equal(line({ ...g, removedAt: T + 5 }, T + 86401, when), 'pat, made a reviewer @' + T + ', removed @' + (T + 5) + '.');
});

/* A document with just the block's elements, enough for plusOrgReviewers. */
function page() {
  const els = {};
  for (const id of ['plus-org-reviewers', 'plus-org-reviewers-head', 'plus-org-reviewers-list']) {
    els[id] = { id, hidden: true, textContent: '', children: [], set innerHTML(v) { throw new Error('markup written to #' + id); },
      appendChild(c) { this.children.push(c); } };
  }
  // textContent = '' empties a list, as in a browser.
  const list = els['plus-org-reviewers-list'];
  let text = '';
  Object.defineProperty(list, 'textContent', { get: () => text, set: (v) => { text = v; if (v === '') list.children = []; } });
  return {
    els,
    document: { getElementById: (id) => els[id] || null, createElement: () => ({ textContent: '', set innerHTML(v) { throw new Error('markup in a line'); } }) },
  };
}
function paint(st) {
  const p = page();
  const src = fn('function plusOrgIn(org, text)') + '\n' + fn('function plusOrgReviewerLine(g, now, when)') + '\n' + fn('function plusOrgReviewers(st)');
  new Function('document', src + '\nreturn plusOrgReviewers;')(p.document)(st);
  return p.els;
}

test('#6752: the block lists each grant as text under a heading in the org\'s words, and hides when there are none', () => {
  const grants = [{ who: '<b>pat</b>', grantedAt: T, effectiveAt: T + 86400 }, { who: 'lee', grantedAt: T, effectiveAt: T, removedAt: T + 9 }];
  const co = paint({ enrolled: true, org: { kind: 'company', name: 'Acme' }, reviewerGrants: grants });
  assert.equal(co['plus-org-reviewers'].hidden, false);
  assert.equal(co['plus-org-reviewers-head'].textContent, 'Reviewers added to your company in the last 30 days:');
  assert.equal(co['plus-org-reviewers-list'].children.length, 2);
  assert.match(co['plus-org-reviewers-list'].children[0].textContent, /^<b>pat<\/b>, made a reviewer /, 'the name was not written as text');
  assert.match(co['plus-org-reviewers-list'].children[1].textContent, /, removed /);
  const fam = paint({ enrolled: true, org: { kind: 'family', name: 'Renet Family' }, reviewerGrants: grants });
  assert.equal(fam['plus-org-reviewers-head'].textContent, 'Reviewers added to your family in the last 30 days:');
  // CONTROLS: none, and a computer not joined (a stale state from before a Leave), show nothing.
  assert.equal(paint({ enrolled: true, org: { kind: 'company' } })['plus-org-reviewers'].hidden, true);
  assert.equal(paint(null)['plus-org-reviewers'].hidden, true);
  const left = paint({ enrolled: false, org: null, reviewerGrants: grants });
  assert.equal(left['plus-org-reviewers'].hidden, true, 'a computer not joined listed the company\'s reviewers');
  assert.equal(left['plus-org-reviewers-list'].children.length, 0);
});

test('#6752: the joined view paints the list on every paint, and /api/org sends the grants to the screen only, when there are some', () => {
  const paintSrc = fn('function plusOrgPaint()');
  assert.match(paintSrc, /\n  plusOrgReviewers\(here \? st : null\);/, 'plusOrgPaint does not paint the reviewer list');
  assert.ok(PAGE.indexOf('id="plus-org-reviewers"') > PAGE.indexOf('id="plus-org-in"') && PAGE.indexOf('id="plus-org-reviewers"') < PAGE.indexOf('id="plus-org-leave-row"'),
    'the list is not inside the joined view');
  const route = SERVER.slice(SERVER.indexOf("if (pathname === '/api/org' && (req.method === 'GET'"), SERVER.indexOf("if ((pathname === '/api/org/preview'"));
  const screenOnly = route.indexOf('if (!isViaScreen(req, {}))');
  assert.ok(screenOnly > 0 && route.indexOf('reviewerGrants') > screenOnly, 'the grants reach a caller that is not the screen');
  assert.match(route, /\.\.\.\(here && rec && Array\.isArray\(rec\.reviewerGrants\) && rec\.reviewerGrants\.length \? \{ reviewerGrants: oe\.cleanReviewerGrants\(rec\.reviewerGrants\) \} : \{\}\)/);
});
