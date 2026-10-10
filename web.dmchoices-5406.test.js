'use strict';
/**
 * kosmos#5406 part 2 slice C: a question's choices as buttons inside its bubble in the direct-message thread (Josh's
 * #3419 ruling: no prompt box). Runs the shipped dmChoicesFrom / dmChoicesHtml / dmChoicePress against a small stub
 * (the repo has no jsdom; the pattern of web.add-project.test.js).
 *
 *   node --test web.dmchoices-5406.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fleet = require('./test-support/fleet');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = PAGE.slice(PAGE.lastIndexOf('<script>'));
const REGION = SCRIPT.slice(SCRIPT.indexOf('let DM_CHOICES = null;'), SCRIPT.indexOf("document.addEventListener('click', (e) => {\n  const b = e.target && e.target.closest ? e.target.closest('#d-dmthread .dmchoice')"));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function load(env) {
  const fn = new Function('esc', 'CURRENT', 'fetch', 'pjSentence', 'paintTalk', REGION
    + '\nreturn { from: dmChoicesFrom, html: dmChoicesHtml, press: dmChoicePress, get: () => DM_CHOICES, note: () => DM_CHOICE_NOTE };');
  return fn(esc, env.CURRENT, env.fetch || (async () => ({ ok: true, json: async () => ({}) })), (s) => s, env.paintTalk || (() => {}));
}
const BODY = { asking: true, asked: 'Which fruit do you want?', options: [{ n: 1, label: 'Apple' }, { n: 2, label: 'Banana <b>' }] };
const Q = { kind: 'question', id: 'needs-you-question:casey', text: 'Which fruit do you want?' };
/* CURRENT is a board card, so it comes from the fleet fixture (fixture-discipline), not a hand-built object. */
const pick = ({ sessionName, name }) => ({ sessionName, name });
function realCard() {
  const board = fleet.install([fleet.agent('casey')]);
  const card = board.agents.find((a) => a.sessionName === 'casey');
  fleet.restore();
  assert.ok(card && card.sessionName, 'the fixture produced no card');
  return pick(card);
}

test('#5406 C: buttons only on the question row, only when the server is sure, labels escaped', () => {
  assert.ok(REGION.includes('function dmChoicePress'), 'premise: the region holds the shipped code');
  const CUR = realCard();
  const m = load({ CURRENT: CUR });
  m.from(BODY, CUR.sessionName);
  const html = m.html(Q);
  assert.match(html, /role="group" aria-label="Choices"/);
  assert.equal((html.match(/class="dmchoice"/g) || []).length, 2);
  assert.ok(html.includes('Banana &lt;b&gt;') && !html.includes('Banana <b>'), 'a label was not escaped');
  assert.equal(m.html({ kind: 'agent', text: 'hi' }), '', 'buttons on an ordinary message');
  assert.equal(m.html({ ...Q, reported: true }), '', 'buttons on a question the agent reported, not one on its screen');
  assert.match(html, /<span class="dmchoice-n">1<\/span> Apple/, 'the digit left the accessible name (WCAG 2.5.3)');
  // Not sure, not asking, or another agent's thread: no buttons.
  for (const b of [{ ...BODY, asked: null }, { ...BODY, asking: false }, { ...BODY, options: null }, { ...BODY, options: [] }]) {
    m.from(b, CUR.sessionName);
    assert.equal(m.html(Q), '', JSON.stringify(b));
  }
  m.from(BODY, 'otheragent');
  assert.equal(m.html(Q), '', 'another agent\'s choices were drawn here');
});

test('#5406 C: a press sends the digit, the option\'s words and the question it was drawn for, then repaints', async () => {
  const sent = []; let painted = 0; let duringFlight = null;
  const CUR = realCard();
  const btns = [{ disabled: false }, { disabled: false }];
  const msg = { textContent: '' };
  const box = { querySelectorAll: () => btns, querySelector: () => msg };
  const btn = { getAttribute: () => '2', closest: () => box };
  const m = load({
    CURRENT: CUR,
    fetch: async (url, init) => {
      duringFlight = { disabled: btns.map((b) => b.disabled), msg: msg.textContent, redrawn: m.html(Q) };
      await m.press(btn);   // a second press while the first is in the air (a repaint re-drew the buttons) sends nothing
      sent.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({}) };
    },
    paintTalk: () => { painted += 1; },
  });
  m.from(BODY, CUR.sessionName);
  await m.press(btn);
  assert.deepEqual(sent, [{ url: '/api/agent/' + encodeURIComponent(CUR.sessionName) + '/thread', body: { text: '2', chose: 'Banana <b>', asked: 'Which fruit do you want?' } }]);
  assert.equal(painted, 1, 'no repaint after the answer');
  assert.deepEqual({ disabled: duringFlight.disabled, msg: duringFlight.msg }, { disabled: [true, true], msg: 'Sending…' }, 'the buttons stayed pressable while the answer was in flight');
  assert.equal(sent.length, 1, 'a second press during the first one\'s flight was sent');
  // A repaint during the flight draws the buttons disabled, still saying Sending.
  assert.equal((duringFlight.redrawn.match(/class="dmchoice" data-n="\d+" disabled>/g) || []).length, 2, 'a mid-flight repaint gave the buttons back');
  assert.match(duringFlight.redrawn, />Sending…</);
  // CONTROL: after the flight the redrawn buttons are pressable again and say what happened.
  assert.doesNotMatch(m.html(Q), / disabled>/);
  assert.match(m.html(Q), />Sent\.</);
  assert.equal(msg.textContent, 'Sent.');
  // A refusal (the menu moved) says why and gives the buttons back.
  let painted2 = 0;
  const m2 = load({ CURRENT: CUR, paintTalk: () => { painted2 += 1; }, fetch: async () => ({ ok: false, json: async () => ({ error: 'its screen moved' }) }) });
  m2.from(BODY, CUR.sessionName);
  const b2 = [{ disabled: false }]; const msg2 = { textContent: '' };
  await m2.press({ getAttribute: () => '1', closest: () => ({ querySelectorAll: () => b2, querySelector: () => msg2 }) });
  assert.equal(msg2.textContent, 'its screen moved');
  assert.equal(b2[0].disabled, false, 'the buttons stayed disabled after a refusal');
  assert.equal(painted2, 1, 'a refusal did not repaint, so stale buttons stay up');
  // The repaint keeps the reason: the redrawn bubble carries it.
  assert.match(m2.html(Q), /role="status" aria-live="polite">its screen moved</, 'the repaint dropped why the press did not go');
  // CONTROL: once the menu is gone the note goes with it.
  m2.from({ ...BODY, asking: false }, CUR.sessionName);
  assert.equal(m2.note(), null, 'a note outlived the menu it was about');
});
