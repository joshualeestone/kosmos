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
  const fn = new Function('esc', 'CURRENT', 'fetch', 'pjSentence', 'paintTalk', 'document', 'CSS', 'TALK_SENDING', 'TALK_FLIGHT', REGION
    + '\nreturn { from: dmChoicesFrom, html: dmChoicesHtml, press: dmChoicePress, get: () => DM_CHOICES, answered: (k) => DM_CHOICE_ANSWERED.get(k) || null, blocksSend: dmChoiceBlocksSend };');
  const doc = env.document || { activeElement: null, getElementById: () => null };
  return fn(esc, env.CURRENT, env.fetch || (async () => ({ ok: true, json: async () => PLACED })), (s) => s, env.paintTalk || (async () => {}), doc, { escape: (x) => x }, Boolean(env.typedFlight), env.typedFlight || null);
}
const PLACED = { delivery: { state: 'placed' } };
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
      return { ok: true, json: async () => PLACED };
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
  // Answered: the redrawn buttons stay off for that question (the menu can linger a few seconds after the key).
  assert.equal((m.html(Q).match(/ disabled>/g) || []).length, 2, 'an answered question offered its buttons again');
  assert.match(m.html(Q), />Sent\.</);
  // The lock covers only the page's own stale poll: past DM_CHOICE_ANSWERED_MS the same question drawn again is pressable.
  m.answered(CUR.sessionName).at -= 7000;
  assert.doesNotMatch(m.html(Q), / disabled>/, 'a question repeated word for word stayed locked');
  m.answered(CUR.sessionName).at += 7000;
  // CONTROL: a NEW question on the same agent is pressable.
  m.from({ ...BODY, asked: 'Which colour?' }, CUR.sessionName);
  assert.doesNotMatch(m.html(Q), / disabled>/);
  assert.equal(msg.textContent, 'Sent.');
  // Once this agent's menu is gone, the lock goes with it.
  m.from({ ...BODY, asking: false }, CUR.sessionName);
  assert.equal(m.answered(CUR.sessionName), null, 'a lock outlived the menu it was about');
  // A refusal (the menu moved) gives the buttons back and repaints; its sentence goes on the conversation's line, once.
  let painted2 = 0;
  const line2 = { textContent: '' };
  const m2 = load({ CURRENT: CUR, paintTalk: () => { painted2 += 1; }, document: { activeElement: null, getElementById: (id) => (id === 'd-say-msg' ? line2 : null) },
    fetch: async () => ({ ok: false, json: async () => ({ error: 'its screen moved' }) }) });
  m2.from(BODY, CUR.sessionName);
  const b2 = [{ disabled: false }]; const msg2 = { textContent: '' };
  await m2.press({ getAttribute: () => '1', closest: () => ({ querySelectorAll: () => b2, querySelector: () => msg2 }) });
  assert.equal(line2.textContent, 'its screen moved');
  assert.equal(msg2.textContent, '', 'the refusal was said twice (bubble status and the alert line)');
  assert.equal(b2[0].disabled, false, 'the buttons stayed disabled after a refusal');
  assert.equal(painted2, 1, 'expected one repaint after a refusal (stale buttons would stay up)');
  assert.doesNotMatch(m2.html(Q), / disabled>|Sent\./, 'a refused question was drawn as answered');
});

test('#5406 C: an outcome that may have sent the key says "could not confirm", never "did not go"; could_not says why', async () => {
  const CUR = realCard();
  const cases = [
    ['unconfirmed', async () => ({ ok: true, json: async () => ({ delivery: { state: 'unconfirmed', because: 'its question was still on its screen after the answer' } }) }),
      'We could not confirm that it went (pressing again may answer twice). its question was still on its screen after the answer'],
    ['a 200 with no verdict', async () => ({ ok: true, json: async () => { throw new Error('not json'); } }), 'We could not confirm that it went (pressing again may answer twice).'],
    ['the request failed', async () => { throw new Error('board restarted'); }, 'We could not confirm that it went (pressing again may answer twice).'],
    ['could_not (nothing typed)', async () => ({ ok: true, json: async () => ({ delivery: { state: 'could_not', because: 'we could not reach it' } }) }), 'we could not reach it'],
  ];
  for (const [name, fetch, want] of cases) {
    const line = { textContent: '' };
    const m = load({ CURRENT: CUR, fetch, document: { activeElement: null, getElementById: (id) => (id === 'd-say-msg' ? line : null) } });
    m.from(BODY, CUR.sessionName);
    await m.press({ getAttribute: () => '1', closest: () => ({ querySelectorAll: () => [], querySelector: () => null }) });
    assert.equal(line.textContent, want, name);
    if (name.startsWith('could_not')) {
      assert.doesNotMatch(m.html(Q), / disabled>/, name + ': nothing was typed, so the buttons come straight back');
    } else {
      // The key may have gone: the same short lock as an answer, so a quick second press cannot answer twice; not "Sent.".
      assert.match(m.html(Q), / disabled>/, name + ': a may-have-sent outcome re-offered the buttons at once');
      assert.doesNotMatch(m.html(Q), /Sent\./, name + ': an unconfirmed answer was drawn as sent');
      m.answered(CUR.sessionName).at -= 7000;
      assert.doesNotMatch(m.html(Q), / disabled>/, name + ': retry stayed impossible after the lock');
    }
  }
});

test('#5406 C: an answered lock is per agent, so visiting another agent with no menu does not drop it', async () => {
  const CUR = realCard();
  const cur = { ...CUR };
  const m = load({ CURRENT: cur });
  m.from(BODY, cur.sessionName);
  await m.press({ getAttribute: () => '1', closest: () => ({ querySelectorAll: () => [], querySelector: () => null }) });
  cur.sessionName = 'other-agent';
  m.from({ ...BODY, asking: false }, 'other-agent');   // the other agent has no menu
  cur.sessionName = CUR.sessionName;
  m.from(BODY, CUR.sessionName);                        // back within the lock, the stale screen still shows the question
  assert.equal((m.html(Q).match(/ disabled>/g) || []).length, 2, 'the answered lock was dropped by another agent\'s paint');
  assert.match(m.html(Q), />Sent\.</);
});

test('#5406 C: after a press, focus goes to the message box (answered) or back to the same choice (not), when it fell to the page', async () => {
  const CUR = realCard();
  const focused = [];
  const body = {};
  const thread = { querySelector: (sel) => (sel.includes('data-n="2"') ? { focus: () => focused.push('2') } : null) };
  const say = { focus: () => focused.push('say') };
  const doc = { activeElement: body, body, getElementById: (id) => (id === 'd-dmthread' ? thread : id === 'd-say' ? say : null) };
  const placed = load({ CURRENT: CUR, document: doc });
  placed.from(BODY, CUR.sessionName);
  const b0 = [{ disabled: false }]; const msg0 = { textContent: '' };
  await placed.press({ getAttribute: () => '2', closest: () => ({ querySelectorAll: () => b0, querySelector: () => msg0 }) });
  assert.deepEqual(focused, ['say'], 'an answered press left focus on the page (its buttons stay disabled)');
  focused.length = 0;
  const m = load({ CURRENT: CUR, document: doc, fetch: async () => ({ ok: false, json: async () => ({ error: 'its screen moved' }) }) });
  m.from(BODY, CUR.sessionName);
  const b = [{ disabled: false }]; const msg = { textContent: '' };
  await m.press({ getAttribute: () => '2', closest: () => ({ querySelectorAll: () => b, querySelector: () => msg }) });
  assert.deepEqual(focused, ['2'], 'focus was left on the page after the press');
  // CONTROL: focus that went somewhere else is left there.
  doc.activeElement = { other: true }; focused.length = 0;
  await m.press({ getAttribute: () => '2', closest: () => ({ querySelectorAll: () => b, querySelector: () => msg }) });
  assert.deepEqual(focused, []);
});

test('#5406 C: a press on one agent does not block a press on another', async () => {
  const CUR = realCard();
  let release; const sent = [];
  const cur = { ...CUR };
  const m = load({ CURRENT: cur, fetch: async (url) => { sent.push(url); if (sent.length === 1) await new Promise((r) => { release = r; }); return { ok: true, json: async () => PLACED }; } });
  m.from(BODY, cur.sessionName);
  const mk = (n) => ({ getAttribute: () => n, closest: () => ({ querySelectorAll: () => [], querySelector: () => null }) });
  const first = m.press(mk('1'));
  cur.sessionName = 'other-agent';   // the person switched agents while the first press is in the air
  m.from(BODY, 'other-agent');
  await m.press(mk('2'));
  assert.equal(sent.length, 2, 'a press on another agent was dropped while the first was in flight');
  release(); await first;
});

test('#5406 C: a refusal is also said on the conversation\'s line (the repaint may draw another question, or none)', async () => {
  const CUR = realCard();
  const line = { textContent: '' };
  const doc = { activeElement: null, getElementById: (id) => (id === 'd-say-msg' ? line : null) };
  const m = load({ CURRENT: CUR, document: doc, fetch: async () => ({ ok: false, json: async () => ({ error: 'its question is no longer on its screen' }) }) });
  m.from(BODY, CUR.sessionName);
  await m.press({ getAttribute: () => '1', closest: () => ({ querySelectorAll: () => [], querySelector: () => null }) });
  assert.equal(line.textContent, 'its question is no longer on its screen', 'a refusal was said only inside a bubble the repaint may drop');
  // CONTROL: a placed answer leaves the line alone.
  line.textContent = '';
  const ok = load({ CURRENT: CUR, document: doc });
  ok.from(BODY, CUR.sessionName);
  await ok.press({ getAttribute: () => '1', closest: () => ({ querySelectorAll: () => [], querySelector: () => null }) });
  assert.equal(line.textContent, '');
});

test('#5406 C: an answer that returns after the person switched agents neither repaints nor moves focus', async () => {
  const CUR = realCard();
  const cur = { ...CUR };
  let painted = 0; const focused = [];
  const body = {};
  const doc = { activeElement: body, body, getElementById: (id) => (id === 'd-say' ? { focus: () => focused.push('say') } : null) };
  const m = load({ CURRENT: cur, document: doc, paintTalk: async () => { painted += 1; },
    fetch: async () => { cur.sessionName = 'other-agent'; return { ok: true, json: async () => PLACED }; } });
  m.from(BODY, CUR.sessionName);
  await m.press({ getAttribute: () => '1', closest: () => ({ querySelectorAll: () => [], querySelector: () => null }) });
  assert.equal(painted, 0, 'the other agent\'s conversation was repainted for this answer');
  assert.deepEqual(focused, [], 'focus moved into the other agent\'s conversation');
});

test('#5406 C: in-flight is per agent, so one agent\'s finished press does not unlock another\'s', async () => {
  const CUR = realCard();
  const cur = { ...CUR };
  const releases = [];
  const m = load({ CURRENT: cur, fetch: async () => { await new Promise((r) => releases.push(r)); return { ok: true, json: async () => PLACED }; } });
  const mk = () => ({ getAttribute: () => '1', closest: () => ({ querySelectorAll: () => [], querySelector: () => null }) });
  m.from(BODY, cur.sessionName);
  const a = m.press(mk());
  cur.sessionName = 'other-agent';
  m.from(BODY, 'other-agent');
  const b = m.press(mk());
  await new Promise((r) => setImmediate(r));
  releases[0](); await a;   // A's press finishes while B's is still in the air
  assert.match(m.html(Q), / disabled>/, 'B\'s buttons were unlocked by A\'s press finishing');
  releases[1](); await b;
});

test('#5406 C: a success clears the refusal it follows from the conversation\'s line, and only that one', async () => {
  const CUR = realCard();
  const line = { textContent: '' };
  const doc = { activeElement: null, getElementById: (id) => (id === 'd-say-msg' ? line : null) };
  let refuse = true;
  const m = load({ CURRENT: CUR, document: doc, fetch: async () => (refuse ? { ok: false, json: async () => ({ error: 'its screen moved' }) } : { ok: true, json: async () => PLACED }) });
  m.from(BODY, CUR.sessionName);
  const mk = () => ({ getAttribute: () => '1', closest: () => ({ querySelectorAll: () => [], querySelector: () => null }) });
  await m.press(mk());
  assert.equal(line.textContent, 'its screen moved');
  refuse = false;
  await m.press(mk());
  assert.equal(line.textContent, '', 'a refusal stayed under the composer after the answer went');
  // CONTROL: a sentence something else put there is left alone.
  refuse = true; await m.press(mk()); line.textContent = 'Your message is in the box below.';
  refuse = false; m.from({ ...BODY, asked: 'Which colour?' }, CUR.sessionName); await m.press(mk());
  assert.equal(line.textContent, 'Your message is in the box below.');
});

test('#5406 C: no buttons where the composer is closed (presence off), the same rule as the box', () => {
  const CUR = realCard();
  const m = load({ CURRENT: CUR });
  m.from({ ...BODY, presence: 'off' }, CUR.sessionName);
  assert.equal(m.html(Q), '', 'buttons were drawn for an agent nothing can be typed into');
  m.from({ ...BODY, presence: 'on' }, CUR.sessionName);
  assert.match(m.html(Q), /class="dmchoice"/, 'CONTROL: an agent that can be typed into gets its buttons');
});

test('#5406 C: while a typed send to this agent is in the air its buttons are off and a press sends nothing', async () => {
  const CUR = realCard();
  let fetched = 0;
  const m = load({ CURRENT: CUR, typedFlight: CUR.sessionName, fetch: async () => { fetched += 1; return { ok: true, json: async () => PLACED }; } });
  m.from(BODY, CUR.sessionName);
  assert.equal((m.html(Q).match(/ disabled>/g) || []).length, 2, 'buttons were pressable during a typed send');
  await m.press({ getAttribute: () => '1', closest: () => ({ querySelectorAll: () => [], querySelector: () => null }) });
  assert.equal(fetched, 0, 'a press went out while a typed send was in the air');
  // CONTROL: a typed send to ANOTHER agent does not touch this one's buttons.
  const other = load({ CURRENT: CUR, typedFlight: 'other-agent' });
  other.from(BODY, CUR.sessionName);
  assert.doesNotMatch(other.html(Q), / disabled>/);
});

test('#5406 C: a 5xx after a press may have followed the key, so it reads as could-not-confirm and locks briefly', async () => {
  const CUR = realCard();
  const line = { textContent: '' };
  const m = load({ CURRENT: CUR, document: { activeElement: null, getElementById: (id) => (id === 'd-say-msg' ? line : null) },
    fetch: async () => ({ ok: false, status: 502, json: async () => ({ error: 'bad gateway' }) }) });
  m.from(BODY, CUR.sessionName);
  await m.press({ getAttribute: () => '1', closest: () => ({ querySelectorAll: () => [], querySelector: () => null }) });
  assert.match(line.textContent, /could not confirm that it went/);
  assert.match(m.html(Q), / disabled>/);
  // A typed send in the air turns the buttons off but does not say "Sending…" under the choices.
  const typed = load({ CURRENT: CUR, typedFlight: CUR.sessionName });
  typed.from(BODY, CUR.sessionName);
  assert.doesNotMatch(typed.html(Q), /Sending…/, 'a typed send read as the choice being sent');
});

test('#5406 C review 20: a typed send while a press is in the air is refused with the wait line, which the press clears when it ends', async () => {
  const CUR = realCard();
  const line = { textContent: '' };
  let release;
  const doc = { activeElement: null, getElementById: (id) => (id === 'd-say-msg' ? line : null) };
  const m = load({ CURRENT: CUR, document: doc, fetch: async () => { await new Promise((r) => { release = r; }); return { ok: true, json: async () => PLACED }; } });
  m.from(BODY, CUR.sessionName);
  assert.equal(m.blocksSend(CUR.sessionName), false, 'CONTROL: no press in the air, the send goes');
  const press = m.press({ getAttribute: () => '1', closest: () => ({ querySelectorAll: () => [], querySelector: () => null }) });
  assert.equal(m.blocksSend(CUR.sessionName), true, 'a typed send went out while a press was in the air');
  assert.equal(line.textContent, 'Still sending your choice. Try again in a moment.');
  assert.equal(m.blocksSend('other-agent'), false, 'another agent\'s send was blocked');
  release(); await press;
  assert.equal(line.textContent, '', 'the wait line outlived the press');
});

test('#5406 C review 20: after a could-not-confirm press (buttons locked) focus goes to the message box', async () => {
  const CUR = realCard();
  const focused = []; const body = {};
  const doc = { activeElement: body, body, getElementById: (id) => (id === 'd-say' ? { focus: () => focused.push('say') } : null) };
  const m = load({ CURRENT: CUR, document: doc, fetch: async () => ({ ok: true, json: async () => ({ delivery: { state: 'unconfirmed' } }) }) });
  m.from(BODY, CUR.sessionName);
  await m.press({ getAttribute: () => '1', closest: () => ({ querySelectorAll: () => [], querySelector: () => null }) });
  assert.deepEqual(focused, ['say'], 'focus was left on the page behind locked buttons');
});

test('#5406 C review 20 pin: the composer send asks dmChoiceBlocksSend before it takes off', () => {
  const at = SCRIPT.indexOf('if (dmChoiceBlocksSend(CURRENT.sessionName)) return;');
  assert.notEqual(at, -1, 'the composer send no longer checks for a press in the air');
  assert.ok(at < SCRIPT.indexOf('TALK_SENDING = true;', at - 4000) || SCRIPT.indexOf('TALK_SENDING = true;', at) > at, 'the check comes after the send takes off');
});
