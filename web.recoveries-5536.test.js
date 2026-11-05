'use strict';
/* kosmos#5536 (#5529: every recovery is shown to the affected employee): Settings lists the recoveries of this
   member's own backup that /api/org reports (engine/orgenroll.js keeps them from the status answer, kosmos-relay #781).
   A key given says given, files opened says opened with the count; newest first as sent; older than 30 days dropped by
   the page; each line text, the name in its own bdi.
     node --test web.recoveries-5536.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const fn = (name) => { const at = PAGE.indexOf(name); return at < 0 ? '' : PAGE.slice(at, PAGE.indexOf('\n}\n', at) + 2); };
const DAY = 86400;

function el(tag) {
  return { tag, className: '', textContent: '', children: [], hidden: true,
    set innerHTML(v) { throw new Error('markup written to a ' + tag); },
    appendChild(c) { this.children.push(c); return c; } };
}
function paint(st) {
  const els = {};
  for (const id of ['plus-org-recoveries', 'plus-org-recoveries-head', 'plus-org-recoveries-list', 'plus-org-recoveries-more']) els[id] = el('div');
  const list = els['plus-org-recoveries-list'];
  let text = '';
  Object.defineProperty(list, 'textContent', { get: () => text, set: (v) => { text = v; if (v === '') list.children = []; } });
  const document = { getElementById: (id) => els[id] || null, createElement: (tag) => el(tag), createTextNode: (t) => ({ tag: '#text', textContent: t }) };
  const src = fn('function plusOrgIn(org, text)') + '\nconst PLUS_ORG_RECOVERY_DAYS = 30;\n' + fn('function plusOrgRecoveryLine(r)') + '\n' + fn('function plusOrgRecoveries(st)');
  new Function('document', src + '\nreturn plusOrgRecoveries;')(document)(st);
  return els;
}
const lineText = (l) => l.children.map((c) => c.textContent).join('');

test('#5536: Settings lists each recovery as text, given or opened with its count, and hides when there are none', () => {
  assert.match(PAGE, /const PLUS_ORG_RECOVERY_DAYS = 30;/, 'the window this test copies is not the page\'s');
  const now = Math.floor(Date.now() / 1000);
  const recs = [
    { what: 'files_opened', who: '<b>rev</b>', at: now - 60, epoch: 3, count: 7 },
    { what: 'files_opened', who: 'rev', at: now - 90, epoch: 3, count: 1 },
    { what: 'files_opened', who: 'rev', at: now - 100, epoch: 3 },
    { what: 'key_released', who: 'rev', at: now - 120, epoch: 3 },
    { what: 'key_released', at: now - 200 },
    { what: 'key_released', who: 'old', at: now - 31 * DAY },
  ];
  const v = paint({ enrolled: true, recoveries: recs, recoveriesAt: Date.now() });
  assert.equal(v['plus-org-recoveries'].hidden, false);
  assert.equal(v['plus-org-recoveries-head'].textContent, 'Reviewers given access to your backup in the last 30 days:',
    'the heading names access: a key given opens nothing by itself');
  assert.equal(v['plus-org-recoveries-more'].hidden, true, 'CONTROL: no recoveriesMore, no more line');
  const lines = v['plus-org-recoveries-list'].children;
  assert.equal(lines.length, 5, 'a recovery older than 30 days was listed');
  for (const l of lines) {
    assert.equal(l.tag, 'p'); assert.equal(l.className, 'fhint');
    assert.equal(l.children[0].tag, 'bdi', 'the name is not in its own bdi');
  }
  assert.equal(lines[0].children[0].textContent, '<b>rev</b>', 'the name is text, as sent');
  assert.match(lineText(lines[0]), /^<b>rev<\/b> opened 7 files from your backup, [^,:]+$/);
  assert.match(lineText(lines[1]), /^rev opened 1 file from your backup, /);
  assert.match(lineText(lines[2]), /^rev opened files from your backup, /, 'no count reads as files, not a number');
  assert.match(lineText(lines[3]), /^rev was given your backup key, /, 'a key given is not said to open anything');
  assert.match(lineText(lines[4]), /^A reviewer was given your backup key, /, 'no name is said neutrally, not as a fact about the person');
  assert.doesNotMatch(lineText(lines[0]), /\d{4}|\d:\d/, 'a line carries a year or a time');
  // A list not confirmed for over a day says when it last was.
  const stale = paint({ enrolled: true, recoveries: recs.slice(0, 1), recoveriesAt: Date.now() - 3 * DAY * 1000 });
  assert.match(stale['plus-org-recoveries-head'].textContent, /^Reviewers given access to your backup in the last 30 days \(last confirmed [^)]+\):$/);
  // recoveriesMore: the coordinator left older ones out, and the page says so under the list.
  const more = paint({ enrolled: true, recoveries: recs.slice(0, 1), recoveriesMore: true, recoveriesAt: Date.now() });
  assert.equal(more['plus-org-recoveries-more'].hidden, false);
  assert.equal(more['plus-org-recoveries-more'].textContent, "Older ones are not listed here. Your company's admins can see every one in its log.");
  const fam = paint({ enrolled: true, org: { kind: 'family' }, recoveries: recs.slice(0, 1), recoveriesMore: true, recoveriesAt: Date.now() });
  assert.equal(fam['plus-org-recoveries-more'].textContent, "Older ones are not listed here. Your family's admins can see every one in its log.",
    'a family is told about its own admins, in its own word');
  // CONTROLS: none, only old ones, and a computer not joined show nothing.
  assert.equal(paint({ enrolled: true })['plus-org-recoveries'].hidden, true);
  assert.equal(paint({ enrolled: true, recoveries: [recs[5]] })['plus-org-recoveries'].hidden, true);
  assert.equal(paint(null)['plus-org-recoveries'].hidden, true);
  const left = paint({ enrolled: false, recoveries: recs });
  assert.equal(left['plus-org-recoveries'].hidden, true, 'a computer not joined listed recoveries');
});

test('#5536: the joined view paints the list, and /api/org sends the recoveries to the screen only, cleaned', () => {
  assert.match(fn('function plusOrgPaint()'), /\n  plusOrgRecoveries\(here \? st : null\);/, 'plusOrgPaint does not paint the recoveries');
  assert.match(PAGE, /<div id="plus-org-recoveries" hidden>\s*<p class="fhint" id="plus-org-recoveries-head"><\/p>\s*<div id="plus-org-recoveries-list"><\/div>/);
  assert.match(SERVER, /here && rec && Array\.isArray\(rec\.recoveries\) && rec\.recoveries\.length \? \{ recoveries: oe\.cleanRecoveries\(rec\.recoveries\)/,
    '/api/org does not pass the cleaned recoveries, only when joined here');
});
