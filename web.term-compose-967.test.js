'use strict';

/**
 * kosmos#967: the Terminal tab's respond-in-context message box. It reuses the
 * SAME delivery endpoint the Talk composer uses (POST /api/agent/<name>/thread),
 * so this pins that it is a surface addition (one mechanism, two entry points),
 * that it gates from paintTalk's single presence read, and that its clear-on-
 * placed / keep-on-doubt receipt matches sendTalk and pjSend.
 *
 *   node --test web.term-compose-967.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scriptOf, lift } = require('./test-support/page');

const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = scriptOf(PAGE);

// Sandbox before the fixture is required: it writes a real worker instruction file.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-term967-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
const fleet = require('./test-support/fleet');
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

/* The record sendTerm reads CURRENT from: a real card from the real reader
   (house rule, fixture-discipline.test.js), reduced to the two fields it uses. */
const CURRENT = (() => {
  const board = fleet.install([fleet.agent('alice', { displayName: 'Alice', state: 'idle' })]);
  try { const { sessionName, name } = board.agents[0]; return { sessionName, name }; } finally { board.restore(); }
})();

test('kosmos#967: the terminal composer is wired -- markup, endpoint, gating', () => {
  for (const id of ['d-term-composer', 'd-term-say', 'd-term-send', 'd-term-say-msg']) {
    assert.ok(PAGE.includes('id="' + id + '"'), id + ' is in the page');
  }
  // It sits inside the window box, so it only shows when there is a live pane.
  const boxAt = PAGE.indexOf('id="d-window-box"');
  const composerAt = PAGE.indexOf('id="d-term-composer"');
  const boxEnd = PAGE.indexOf('id="d-sec-remove"'); // the next section after the terminal section
  assert.ok(boxAt > -1 && composerAt > boxAt && composerAt < boxEnd, 'the composer is inside the Terminal section');

  // The SAME endpoint as the Talk composer: a surface addition, not a new mechanism.
  const sendTerm = lift(SCRIPT, 'sendTerm');
  assert.match(sendTerm, /fetch\('\/api\/agent\/' \+ encodeURIComponent\(sentName\) \+ '\/thread'/, 'sendTerm POSTs the agent thread endpoint');
  assert.match(sendTerm, /method: 'POST'/, 'it POSTs');

  // Wired to the button and to Enter (IME-guarded, like the Talk composer).
  assert.match(SCRIPT, /getElementById\('d-term-send'\)\.addEventListener\('click', sendTerm\)/, 'Send is wired');
  const kd = SCRIPT.slice(SCRIPT.indexOf("getElementById('d-term-say').addEventListener('keydown'"), SCRIPT.indexOf("getElementById('d-term-say').addEventListener('keydown'") + 260);
  assert.match(kd, /isComposing \|\| e\.keyCode === 229/, 'Enter-to-send has the IME guard');
  assert.match(kd, /sendTerm\(\)/, 'Enter calls sendTerm');

  // Gated from paintTalk's single presence read, not a second reachability check.
  assert.match(SCRIPT, /termSay\.disabled = body\.presence === 'off'/, 'the terminal box gates on the same presence read as the composer');

  // #967 cross-agent safety: the draft lifecycle is wired like the Talk box's --
  // parked per agent on input, restored by paintTalk, and cleared (box + receipt)
  // on agent switch -- so a reply typed for one agent never carries onto or is
  // delivered to the next. These pin the wiring the behavioural harness cannot
  // drive end-to-end (paintTalk/openDetail are not lifted).
  assert.match(SCRIPT, /getElementById\('d-term-say'\)\.addEventListener\('input'/, 'the terminal box parks its draft on input');
  assert.match(SCRIPT, /TERM_DRAFTS\[CURRENT\.sessionName\] = v/, 'it parks the draft under the open agent');
  assert.match(SCRIPT, /if \(termSay && !termSay\.disabled && !termSay\.value && TERM_DRAFTS\[sessionName\]\)/, 'paintTalk restores the parked terminal draft, gated on presence');
  assert.match(SCRIPT, /getElementById\('d-term-say'\); if \(t\) t\.value = ''/, 'the agent-switch clear resets the terminal box');
  assert.match(SCRIPT, /getElementById\('d-term-say-msg'\); if \(t\) t\.textContent = ''/, 'the agent-switch clear resets the terminal receipt');
});

/** Lift sendTerm and run it against a stub fetch + DOM, injecting CURRENT.
 * placedWords is lifted alongside it (sendTerm calls it for the #402 silent-
 * when-worked receipt), and TERM_DRAFTS is declared in the same scope so the
 * placed arm can clear the parked draft. `duringFetch` runs while the request
 * is in flight, so a test can simulate the person opening another agent. */
function runSendTerm({ deliveryState, delivery, ok = true, errorBody, throws = false,
                       boxText = 'hello world', current = CURRENT, duringFetch } = {}) {
  const els = {
    'd-term-say': { value: boxText },
    'd-term-send': { disabled: false },
    'd-term-say-msg': { textContent: '' },
  };
  const document = { getElementById(id) { if (!(id in els)) throw new Error('unstubbed #' + id); return els[id]; } };
  let posted = null;
  const fetch = async (url, opts) => {
    posted = { url, opts };
    if (duringFetch) duringFetch();
    if (throws) throw new Error('network down');
    return {
      ok,
      json: async () => (ok ? { delivery: (delivery || { state: deliveryState }), recorded: true } : (errorBody || { error: 'nope' })),
    };
  };
  const make = new Function('CURRENT', 'document', 'fetch',
    'let TERM_SENDING = false;\nlet TERM_DRAFTS = {};\n'
    + lift(SCRIPT, 'placedWords') + '\n' + lift(SCRIPT, 'sendTerm') + '\nreturn sendTerm;');
  const sendTerm = make(current, document, fetch);
  return { sendTerm, els, getPosted: () => posted };
}

test('kosmos#967: a clean PLACED clears the box and says nothing (#402 silent-when-worked)', async () => {
  const { sendTerm, els, getPosted } = runSendTerm({ deliveryState: 'placed' });
  await sendTerm();
  assert.equal(getPosted().url, '/api/agent/' + CURRENT.sessionName + '/thread', 'posted to the open agent thread');
  assert.equal(els['d-term-say'].value, '', 'a placed message clears the box (it reached the agent)');
  assert.equal(els['d-term-say-msg'].textContent, '', 'an idle placed says nothing, matching sendTalk and the thread rows');
});

test('kosmos#967: a PLACED with a consequential note speaks it', async () => {
  const { sendTerm, els } = runSendTerm({
    delivery: { state: 'placed', paneNote: 'queued behind what it is doing', paneState: 'working' },
  });
  await sendTerm();
  assert.equal(els['d-term-say'].value, '', 'the box still clears -- the words reached the agent');
  assert.equal(els['d-term-say-msg'].textContent, 'Queued behind what it is doing.',
    'when the note says something about what happens next, the receipt speaks it (capitalised, via placedWords)');
});

test('kosmos#967: if the flight moves to another agent, nothing is written to the box it left', async () => {
  const current = { ...CURRENT };            // a mutable copy, so the module CURRENT is untouched
  const { sendTerm, els } = runSendTerm({
    deliveryState: 'placed', current,
    duringFetch: () => { current.sessionName = 'someone-else'; },   // the person opened another agent mid-send
  });
  await sendTerm();
  assert.equal(els['d-term-say'].value, 'hello world',
    'the box now belongs to another agent, so a placed verdict must not clear it');
  assert.notEqual(els['d-term-say-msg'].textContent, '',
    'and the receipt line is not overwritten under the new agent (it keeps the "Sending" line, not a placed verdict)');
});

test('kosmos#967: UNCONFIRMED keeps the words for a retry', async () => {
  const { sendTerm, els } = runSendTerm({ deliveryState: 'unconfirmed' });
  await sendTerm();
  assert.equal(els['d-term-say'].value, 'hello world', 'an unconfirmed send keeps the words');
  assert.match(els['d-term-say-msg'].textContent, /could not confirm it arrived/i, 'it says it could not confirm');
});

test('kosmos#967: COULD_NOT keeps the words and says why', async () => {
  const { sendTerm, els } = runSendTerm({ deliveryState: 'could_not' });
  await sendTerm();
  assert.equal(els['d-term-say'].value, 'hello world', 'a could_not send keeps the words');
  assert.match(els['d-term-say-msg'].textContent, /could not be handed the message/i, 'it says it was not delivered');
});

test('kosmos#967: COULD_NOT surfaces the reason when the server gives one', async () => {
  const { sendTerm, els } = runSendTerm({
    delivery: { state: 'could_not', because: 'it is waiting on an answer from you' },
  });
  await sendTerm();
  assert.equal(els['d-term-say'].value, 'hello world', 'still keeps the words');
  assert.match(els['d-term-say-msg'].textContent, /waiting on an answer from you/, 'it surfaces the server reason');
});

test('kosmos#967: a non-ok response surfaces the error, keeps the words', async () => {
  const { sendTerm, els } = runSendTerm({ ok: false, errorBody: { error: 'the agent is gone' } });
  await sendTerm();
  assert.equal(els['d-term-say'].value, 'hello world', 'a failed send keeps the words');
  assert.match(els['d-term-say-msg'].textContent, /the agent is gone/, 'it surfaces the server error');
});

test('kosmos#967: a thrown fetch keeps the words for a retry', async () => {
  const { sendTerm, els } = runSendTerm({ throws: true });
  await sendTerm();
  assert.equal(els['d-term-say'].value, 'hello world', 'a network failure keeps the words');
  assert.match(els['d-term-say-msg'].textContent, /kept here to try again/i, 'it invites a retry');
});

test('kosmos#967: an empty box sends nothing', async () => {
  const { sendTerm, getPosted } = runSendTerm({ deliveryState: 'placed', boxText: '   ' });
  await sendTerm();
  assert.equal(getPosted(), null, 'whitespace-only does not POST');
});
