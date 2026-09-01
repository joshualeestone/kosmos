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
});

/** Lift sendTerm and run it against a stub fetch + DOM, injecting CURRENT. */
function runSendTerm({ deliveryState, ok = true, errorBody, boxText = 'hello world' }) {
  const els = {
    'd-term-say': { value: boxText },
    'd-term-send': { disabled: false },
    'd-term-say-msg': { textContent: '' },
  };
  const document = { getElementById(id) { if (!(id in els)) throw new Error('unstubbed #' + id); return els[id]; } };
  let posted = null;
  const fetch = async (url, opts) => {
    posted = { url, opts };
    return {
      ok,
      json: async () => (ok ? { delivery: { state: deliveryState }, recorded: true } : (errorBody || { error: 'nope' })),
    };
  };
  const make = new Function('CURRENT', 'document', 'fetch',
    'let TERM_SENDING = false;\n' + lift(SCRIPT, 'sendTerm') + '\nreturn sendTerm;');
  const sendTerm = make(CURRENT, document, fetch);
  return { sendTerm, els, getPosted: () => posted };
}

test('kosmos#967: PLACED clears the box and confirms', async () => {
  const { sendTerm, els, getPosted } = runSendTerm({ deliveryState: 'placed' });
  await sendTerm();
  assert.equal(getPosted().url, '/api/agent/' + CURRENT.sessionName + '/thread', 'posted to the open agent thread');
  assert.equal(els['d-term-say'].value, '', 'a placed message clears the box (it reached the agent)');
  assert.match(els['d-term-say-msg'].textContent, /^Sent to Alice/, 'it confirms delivery by name');
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

test('kosmos#967: a non-ok response surfaces the error, keeps the words', async () => {
  const { sendTerm, els } = runSendTerm({ ok: false, errorBody: { error: 'the agent is gone' } });
  await sendTerm();
  assert.equal(els['d-term-say'].value, 'hello world', 'a failed send keeps the words');
  assert.match(els['d-term-say-msg'].textContent, /the agent is gone/, 'it surfaces the server error');
});

test('kosmos#967: an empty box sends nothing', async () => {
  const { sendTerm, getPosted } = runSendTerm({ deliveryState: 'placed', boxText: '   ' });
  await sendTerm();
  assert.equal(getPosted(), null, 'whitespace-only does not POST');
});
