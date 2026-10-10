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

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = PAGE.slice(PAGE.lastIndexOf('<script>'));
const REGION = SCRIPT.slice(SCRIPT.indexOf('let DM_CHOICES = null;'), SCRIPT.indexOf("document.addEventListener('click', (e) => {\n  const b = e.target && e.target.closest ? e.target.closest('#d-dmthread .dmchoice')"));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function load(env) {
  const fn = new Function('esc', 'CURRENT', 'fetch', 'pjSentence', 'paintTalk', REGION
    + '\nreturn { from: dmChoicesFrom, html: dmChoicesHtml, press: dmChoicePress, get: () => DM_CHOICES };');
  return fn(esc, env.CURRENT, env.fetch || (async () => ({ ok: true, json: async () => ({}) })), (s) => s, env.paintTalk || (() => {}));
}
const BODY = { asking: true, asked: 'Which fruit do you want?', options: [{ n: 1, label: 'Apple' }, { n: 2, label: 'Banana <b>' }] };
const Q = { kind: 'question', id: 'needs-you-question:casey', text: 'Which fruit do you want?' };

test('#5406 C: buttons only on the question row, only when the server is sure, labels escaped', () => {
  assert.ok(REGION.includes('function dmChoicePress'), 'premise: the region holds the shipped code');
  const m = load({ CURRENT: { sessionName: 'casey', name: 'Casey' } });
  m.from(BODY, 'casey');
  const html = m.html(Q);
  assert.match(html, /role="group" aria-label="Choices"/);
  assert.equal((html.match(/class="dmchoice"/g) || []).length, 2);
  assert.ok(html.includes('Banana &lt;b&gt;') && !html.includes('Banana <b>'), 'a label was not escaped');
  assert.equal(m.html({ kind: 'agent', text: 'hi' }), '', 'buttons on an ordinary message');
  // Not sure, not asking, or another agent's thread: no buttons.
  for (const b of [{ ...BODY, asked: null }, { ...BODY, asking: false }, { ...BODY, options: null }, { ...BODY, options: [] }]) {
    m.from(b, 'casey');
    assert.equal(m.html(Q), '', JSON.stringify(b));
  }
  m.from(BODY, 'otheragent');
  assert.equal(m.html(Q), '', 'another agent\'s choices were drawn here');
});

test('#5406 C: a press sends the digit, the option\'s words and the question it was drawn for, then repaints', async () => {
  const sent = []; let painted = 0;
  const m = load({
    CURRENT: { sessionName: 'casey', name: 'Casey' },
    fetch: async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({}) }; },
    paintTalk: () => { painted += 1; },
  });
  m.from(BODY, 'casey');
  const btns = [{ disabled: false }, { disabled: false }];
  const msg = { textContent: '' };
  const box = { querySelectorAll: () => btns, querySelector: () => msg };
  const btn = { getAttribute: () => '2', closest: () => box };
  await m.press(btn);
  assert.deepEqual(sent, [{ url: '/api/agent/casey/thread', body: { text: '2', chose: 'Banana <b>', asked: 'Which fruit do you want?' } }]);
  assert.equal(painted, 1, 'no repaint after the answer');
  // A refusal (the menu moved) says why and gives the buttons back.
  const m2 = load({ CURRENT: { sessionName: 'casey', name: 'Casey' }, fetch: async () => ({ ok: false, json: async () => ({ error: 'its screen moved' }) }) });
  m2.from(BODY, 'casey');
  const b2 = [{ disabled: false }]; const msg2 = { textContent: '' };
  await m2.press({ getAttribute: () => '1', closest: () => ({ querySelectorAll: () => b2, querySelector: () => msg2 }) });
  assert.equal(msg2.textContent, 'its screen moved');
  assert.equal(b2[0].disabled, false, 'the buttons stayed disabled after a refusal');
});
