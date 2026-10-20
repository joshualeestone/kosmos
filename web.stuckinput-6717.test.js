'use strict';
/* kosmos#6717: a draft Kosmos took out of an agent's input box is drawn in its conversation as Kosmos's line, with the
   words, Put in the message box and Dismiss, and never as a message from the person or the agent. Lifts the page's own
   dmRow and dmDraftUse. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));

function dmRowWith(globals) {
  return new Function(...Object.keys(globals), page.liftAll(SCRIPT, ['esc', 'dmRow']) + '\nreturn dmRow;')(...Object.values(globals));
}
const DRAFT = { id: 'kosmos-draft:0123456789ab', at: '2026-10-20T14:00:00.000Z', text: 'look at <b>the invoice</b> & the "second" one',
  from: null, delivery: null, kind: 'kosmos', draft: true, draftId: '0123456789ab' };

test('kosmos#6717: a draft row says it was not sent, shows the words escaped, and offers both buttons', () => {
  const dmRow = dmRowWith({ CURRENT: null });
  const html = dmRow(DRAFT, 'Al');
  assert.match(html, /class="msg-valve dm-kosmos dm-draft"/, 'Kosmos\'s quiet band, not a message bubble');
  assert.doesNotMatch(html, /class="msg( you)?"/, 'never drawn as the person\'s or the agent\'s message');
  assert.match(html, /It was not sent\./);
  assert.match(html, /look at &lt;b&gt;the invoice&lt;\/b&gt; &amp; the &quot;second&quot; one/, 'the words, escaped');
  assert.match(html, /<button type="button" class="pj-refused-add dm-draft-use" data-draft-id="0123456789ab">Put in the message box<\/button>/);
  assert.match(html, /<button type="button" class="pj-refused-add dm-draft-dismiss" data-draft-id="0123456789ab">Dismiss<\/button>/);
  assert.doesNotMatch(html, /\u2014/, 'no em dash');
  // CONTROL: the account line (#3723), also kind kosmos but no draft, keeps its own shape and offers no buttons.
  const account = dmRow({ id: 'kosmos-account:al', at: null, text: 'Its account is signed out.', from: null, kind: 'kosmos' }, 'Al');
  assert.doesNotMatch(account, /dm-draft/);
});

test('kosmos#6717: Put in the message box only fills the box (after anything typed there); nothing is sent', () => {
  const fired = [];
  const input = { value: '', focus() { fired.push('focus'); }, dispatchEvent(e) { fired.push(e.type); } };
  const quote = { textContent: 'the stuck words' };
  const row = { querySelector: (sel) => (sel === '.dm-draft-text' ? quote : null) };
  const btn = { closest: (sel) => (sel === '.dm-draft' ? row : null) };
  const sentBy = [];
  const use = new Function('document', 'Event', 'fetch', page.lift(SCRIPT, 'dmDraftUse') + '\nreturn dmDraftUse;')(
    { getElementById: (id) => (id === 'd-say' ? input : null) },
    function Event(type) { this.type = type; },
    (...a) => { sentBy.push(a); return Promise.resolve({ ok: true }); });
  use(btn);
  assert.equal(input.value, 'the stuck words');
  input.value = 'already typed  ';
  use(btn);
  assert.equal(input.value, 'already typed\nthe stuck words', 'added after what the person had typed, never over it');
  assert.deepEqual(sentBy, [], 'nothing reaches the board: the person sends it, or not');
  assert.ok(fired.includes('input') && fired.includes('focus'));
});

test('kosmos#6717: words longer than one message can be are said under the box at once, not refused at send', () => {
  const input = { value: '', maxLength: 20, focus() {}, dispatchEvent() {} };
  const under = { textContent: '' };
  const quote = { textContent: 'far more words than twenty characters' };
  const btn = { closest: () => ({ querySelector: () => quote }) };
  const use = new Function('document', 'Event', page.lift(SCRIPT, 'dmDraftUse') + '\nreturn dmDraftUse;')(
    { getElementById: (id) => (id === 'd-say' ? input : id === 'd-say-msg' ? under : null) }, function Event(t) { this.type = t; });
  use(btn);
  assert.equal(under.textContent, 'This is longer than one message can be. Send it in parts.');
  // CONTROL: a draft that fits says nothing.
  under.textContent = ''; input.value = ''; quote.textContent = 'short';
  use(btn);
  assert.equal(under.textContent, '');
});
