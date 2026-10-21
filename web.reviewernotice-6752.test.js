'use strict';
/* kosmos#6752: the Settings company block lists the reviewer grants /api/org reports (engine/orgenroll.js keeps them
   from the hourly status answer), so every member can see someone was made a reviewer. The page works out pending or
   in effect from the times, since the record is up to an hour old, drops anything older than 30 days itself, puts the
   newest first, and writes each line as text with the name in its own bdi. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const fn = (name) => { const at = PAGE.indexOf(name); return at < 0 ? '' : PAGE.slice(at, PAGE.indexOf('\n}\n', at) + 2); };

const T = 1_790_000_000;
const DAY = 86400;
const fmt = { day: (s) => 'D' + s, soon: (s) => 'S' + s };

test('#6752: a grant leads with what is true now, by its times; a time only when it lands within a day', () => {
  const line = new Function(fn('function plusOrgReviewerLine(g, now, fmt)') + '\nreturn plusOrgReviewerLine;')();
  const g = { who: 'pat', grantedAt: T, effectiveAt: T + DAY };
  assert.equal(line(g, T + 10, fmt), ', becomes a reviewer S' + (T + DAY), 'a grant landing within a day says when, with the time');
  assert.equal(line({ ...g, effectiveAt: T + 3 * DAY }, T + 10, fmt), ', becomes a reviewer D' + (T + 3 * DAY), 'a grant days away carries a time');
  // An hour-old record painted after the 24 hours: in effect, whatever state the coordinator had then.
  assert.equal(line({ ...g, state: 'pending' }, T + DAY + 1, fmt), ', a reviewer since D' + (T + DAY));
  assert.equal(line({ ...g, removedAt: T + 5 }, T + DAY + 1, fmt), ', no longer a reviewer since D' + (T + 5) + ' (made a reviewer D' + T + ')');
});

/* A document with just the block's elements, enough for plusOrgReviewers. Nothing may be written as markup. */
function el(tag) {
  return { tag, className: '', textContent: '', children: [], hidden: true,
    set innerHTML(v) { throw new Error('markup written to a ' + tag); },
    appendChild(c) { this.children.push(c); return c; } };
}
function page() {
  const els = {};
  for (const id of ['plus-org-reviewers', 'plus-org-reviewers-head', 'plus-org-reviewers-what', 'plus-org-reviewers-list']) els[id] = el('div');
  const list = els['plus-org-reviewers-list'];
  let text = '';
  Object.defineProperty(list, 'textContent', { get: () => text, set: (v) => { text = v; if (v === '') list.children = []; } });
  return {
    els,
    document: { getElementById: (id) => els[id] || null, createElement: (tag) => el(tag), createTextNode: (t) => ({ tag: '#text', textContent: t }) },
  };
}
function paint(st) {
  const p = page();
  const src = fn('function plusOrgIn(org, text)') + '\n' + fn('function plusOrgReviewerLine(g, now, fmt)') + '\n'
    + 'const PLUS_ORG_REVIEWER_DAYS = 30;\n' + fn('function plusOrgReviewers(st)');
  new Function('document', src + '\nreturn plusOrgReviewers;')(p.document)(st);
  return p.els;
}
const lineText = (l) => l.children.map((c) => c.textContent).join('');

test('#6752: the block lists each grant newest first, as text with the name in a bdi, in the org\'s words, and hides when there are none', () => {
  assert.match(PAGE, /const PLUS_ORG_REVIEWER_DAYS = 30;/, 'the window this test copies is not the page\'s');
  const now = Date.now() / 1000;
  const grants = [
    { who: 'old', grantedAt: Math.floor(now - 31 * DAY), effectiveAt: Math.floor(now - 30 * DAY) },
    { who: '<b>pat</b>', grantedAt: Math.floor(now - 3 * DAY), effectiveAt: Math.floor(now - 2 * DAY) },
    { who: 'lee', grantedAt: Math.floor(now - 3600), effectiveAt: Math.floor(now - 3600 + DAY) },
  ];
  const co = paint({ enrolled: true, org: { kind: 'company', name: 'Acme' }, reviewerGrants: grants });
  assert.equal(co['plus-org-reviewers'].hidden, false);
  assert.equal(co['plus-org-reviewers-head'].textContent, 'Reviewers added to your company in the last 30 days:');
  assert.match(co['plus-org-reviewers-what'].textContent, /^Once reviewer access is available, a reviewer may later be given the key/);
  const lines = co['plus-org-reviewers-list'].children;
  assert.equal(lines.length, 2, 'a grant older than 30 days was listed');
  assert.deepEqual(lines.map((l) => l.children[0].textContent), ['lee', '<b>pat</b>'], 'not newest first');
  for (const l of lines) {
    assert.equal(l.tag, 'p'); assert.equal(l.className, 'fhint', 'a line is not the block\'s body text');
    assert.equal(l.children[0].tag, 'bdi', 'the name is not in its own bdi');
  }
  assert.match(lineText(lines[0]), /^lee, becomes a reviewer (today|tomorrow) at /);
  assert.match(lineText(lines[1]), /^<b>pat<\/b>, a reviewer since \S+ \d+$/, 'the line carries a year or a time');
  const fam = paint({ enrolled: true, org: { kind: 'family', name: 'Renet Family' }, reviewerGrants: grants });
  assert.equal(fam['plus-org-reviewers-head'].textContent, 'Reviewers added to your family in the last 30 days:');
  assert.match(fam['plus-org-reviewers-what'].textContent, /^In a family, a reviewer opens nothing/);
  // CONTROLS: none, only old ones, and a computer not joined (a stale state from before a Leave), show nothing.
  assert.equal(paint({ enrolled: true, org: { kind: 'company' } })['plus-org-reviewers'].hidden, true);
  assert.equal(paint({ enrolled: true, org: { kind: 'company' }, reviewerGrants: [grants[0]] })['plus-org-reviewers'].hidden, true);
  assert.equal(paint(null)['plus-org-reviewers'].hidden, true);
  const left = paint({ enrolled: false, org: null, reviewerGrants: grants });
  assert.equal(left['plus-org-reviewers'].hidden, true, 'a computer not joined listed the company\'s reviewers');
  assert.equal(left['plus-org-reviewers-list'].children.length, 0);
});

test('#6752: the joined view paints the list on every paint, and /api/org sends the grants to the screen only', () => {
  assert.match(fn('function plusOrgPaint()'), /\n  plusOrgReviewers\(here \? st : null\);/, 'plusOrgPaint does not paint the reviewer list');
  assert.ok(PAGE.indexOf('id="plus-org-reviewers"') > PAGE.indexOf('id="plus-org-in"') && PAGE.indexOf('id="plus-org-reviewers"') < PAGE.indexOf('id="plus-org-leave-row"'),
    'the list is not inside the joined view');
  const route = SERVER.slice(SERVER.indexOf("if (pathname === '/api/org' && (req.method === 'GET'"), SERVER.indexOf("if ((pathname === '/api/org/preview'"));
  const screenOnly = route.indexOf('if (!isViaScreen(req, {}))');
  assert.ok(screenOnly > 0 && route.indexOf('reviewerGrants') > screenOnly, 'the grants reach a caller that is not the screen');
  assert.match(route, /reviewerGrants: oe\.cleanReviewerGrants\(/, 'the route sends grants it has not cleaned');
});
