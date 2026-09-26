'use strict';
/**
 * #3923: the project notice (Mona Lisa's design, project-notice-mock.html). One notice above the
 * members list while an agent could not be given the project's folder, shaped by what the person
 * must do: WAIT (Try again only), ACT (a sentence only), RETRY (a sentence and Try again),
 * EXPLAIN (a sentence saying there is nothing to do). Success and not_tried say nothing.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const ENGINE = fs.readFileSync(nodePath.join(__dirname, 'engine', 'projects.js'), 'utf8');

function notice() {
  const at = PAGE.indexOf('const PJ_NOTICE = [');
  const end = PAGE.indexOf('/**\n * How a member reads.', at);
  assert.ok(at > 0 && end > at, 'the notice code moved; re-anchor');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const pjSentence = (b) => { const s = String(b || '').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? '' : '.') : ''; };
  // eslint-disable-next-line no-new-func
  return new Function('esc', 'pjSentence', PAGE.slice(at, end) + '\nreturn { pjNotice, pjNoticeRow, PJ_NOTICE };')(esc, pjSentence);
}
const member = (name, because, state = 'could_not') => ({ name, sessionName: name.toLowerCase(), told: { state, because } });
// The words a person reads: the decorative (aria-hidden) hazard mark is not one of them.
const text = (html) => html.replace(/<span class="haz" aria-hidden="true">!<\/span>/, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('#3923: nothing wrong says nothing (success and not_tried included)', () => {
  const { pjNotice } = notice();
  assert.equal(pjNotice([]), '');
  assert.equal(pjNotice([member('Leo', null, 'told'), member('April', null, 'not_tried')]), '');
});

test('#3923: the four shapes, one agent each, as the design draws them', () => {
  const { pjNotice } = notice();
  const wait = pjNotice([member('Leo', 'we could not write to its instructions')]);
  assert.equal(text(wait), 'Leo does not have this project’s folder. We could not write to Leo’s instructions. Try again');
  assert.match(wait, /data-pn-retry="leo"/);

  const act = pjNotice([member('April', 'it has no instructions file yet, and we will not create one')]);
  assert.equal(text(act), 'April does not have this project’s folder. April has no instructions file, and Kosmos will not create one. Give April some instructions and it will pick this up next time.');
  assert.doesNotMatch(act, /Try again/, 'Act offers no button: pressing it would fail every time');
  assert.match(act, /<b class="pnfix">Give April/);

  const retry = pjNotice([member('Mikey', 'we could not find an agent with exactly this name on this computer')]);
  assert.equal(text(retry), 'Mikey does not have this project’s folder. Kosmos cannot match Mikey to a session on this computer. Start Mikey, then try again. Try again');

  const explain = pjNotice([member('Casey', 'it has no folder of its own on this computer yet')]);
  assert.equal(text(explain), 'Casey does not have this project’s folder. Kosmos only keeps instructions for agents it made. Casey came from somewhere else, so Kosmos has nowhere to write.');
  assert.doesNotMatch(explain, /Try again|pnfix/, 'Explain prescribes nothing');
});

test('#3923: several agents: the header counts, each row carries its own why and only its own button', () => {
  const { pjNotice } = notice();
  const html = pjNotice([
    member('Leo', 'we could not write to its instructions'),
    member('Bob', null, 'told'),
    member('April', 'it has no instructions file yet, and we will not create one'),
    member('Casey', 'it has no folder of its own on this computer yet'),
  ]);
  assert.match(text(html), /^Three agents do not have this project’s folder\./);
  assert.equal((html.match(/class="pnrow"/g) || []).length, 3, 'one row per failing agent; the told one says nothing');
  assert.equal((html.match(/Try again/g) || []).length, 1, 'only Leo (Wait) gets a button');
  assert.match(html, /<span class="pnwho">Leo<\/span><span class="pnwhy">We could not write to its instructions\./);
  assert.match(html, /<span class="pnwho">Casey<\/span><span class="pnwhy">Kosmos only keeps instructions for agents it made, and Casey came from somewhere else\./);
  assert.doesNotMatch(html, /Bob/);
});

test('#3923: an unknown cause is one honest retry with the engine\'s own sentence', () => {
  const { pjNotice } = notice();
  const html = pjNotice([member('Leo', 'the disk is full')]);
  assert.equal(text(html), 'Leo does not have this project’s folder. The disk is full. Try again');
});

test('#3923: names are escaped', () => {
  const { pjNotice } = notice();
  const html = pjNotice([member('<img src=x>', 'we could not write to its instructions')]);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x&gt;/);
});

test('#3923: every could_not sentence the engine names has a shape (none falls through to the generic retry)', () => {
  const { PJ_NOTICE } = notice();
  const at = ENGINE.indexOf('const GROUP_BECAUSE = new Map([');
  const end = ENGINE.indexOf(']);', at);
  assert.ok(at > 0 && end > at, 'GROUP_BECAUSE moved; re-anchor');
  const keys = [...ENGINE.slice(at, end).matchAll(/\['([^']+)',\s*\n\s*'/g)].map((m) => m[1]);
  assert.ok(keys.length >= 9, 'CONTROL: the scan reads the engine map (found ' + keys.length + ')');
  // The other could_not sentences tellAgent can return, which have no plural.
  keys.push('its instructions contain 2 Kosmos project blocks, so we cannot tell which is ours and did not change anything',
    'its worker folder is a link, so we do not read through it');
  for (const because of keys) {
    assert.ok(PJ_NOTICE.some(([re]) => re.test(because)), 'no shape for: ' + because);
  }
});
