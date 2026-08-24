/**
 * The search box above the agent's thread (#403): the room's control on the
 * agent page. Driven against the page with a stubbed thread: typing filters
 * the rows by who and by text, no match prints the room's sentence, clearing
 * brings the rows back, and switching agent resets the box.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules node docs/browser-checks/render-talk-search.js
 */
const path = require('path');
const { chromium } = require('playwright');
const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const fail = [];
const chk = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fail.push(label); };
(async () => {
  // Convention polarity: headed unless HEADED=0. This line used to read
  // HEADED !== '1', which ran headless on every machine that never set the
  // variable, silently opting this one check out of the real compositor.
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => {
    const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    window.setInterval = () => 0;
    const at = new Date(Date.now() - 4 * 60000).toISOString();
    const row = (text, from) => ({ at, text, from, delivery: { state: 'placed', because: null, paneState: 'idle', paneNote: null } });
    window.__fx = {
      messages: [row('Keep day one and day seven.', 'you'), row('Two of the help docs disagree about the trial.', 'april'), row('Drop day three.', 'you')],
      olderCount: 0, historyBecause: null, historyUnfilable: false, presence: 'on', presenceBecause: null, asking: false, question: null, options: null, owes: null,
    };
    window.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/thread')) return enc(window.__fx);
      if (u.includes('/api/status')) return enc({ agents: [], version: '0.5.00' });
      return enc({});
    };
  });
  await page.goto(PAGE);
  await page.evaluate(() => {
    CURRENT = { sessionName: 'april', name: 'April' };
    document.getElementById('panel-detail').hidden = false;
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
    document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
  });
  await page.evaluate(() => paintTalk('april', 'April'));
  await page.waitForTimeout(300);
  const count = () => page.evaluate(() => document.querySelectorAll('#d-dmthread .dm').length);
  chk(await count() === 3, 'three rows before any search', String(await count()));
  chk(await page.evaluate(() => { const i = document.getElementById('d-talk-search'); const t = document.getElementById('d-dmthread'); return !!i && !!t && (i.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0; }), 'the search box sits above the thread');

  /* The panel is not opened on this bare page, so the box is driven by the
     same event a keystroke fires rather than by a visible-element fill. */
  const type = async (q) => { await page.evaluate((v) => { const i = document.getElementById('d-talk-search'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }, q); await page.waitForTimeout(150); };
  await type('day');
  chk(await count() === 2, 'typing "day" keeps the two rows that say it', String(await count()));
  await type('april');
  chk(await count() === 1, 'typing the agent\'s name keeps the row they said', String(await count()));
  await type('zzz');
  const none = await page.$eval('#d-dmthread', (e) => e.textContent.trim());
  chk(await count() === 0 && /Nothing here matches "zzz"\. Clearing the search brings the conversation back\./.test(none), 'no match prints the room\'s sentence', none);
  await type('');
  chk(await count() === 3, 'clearing the search brings the rows back', String(await count()));

  /* A poll while a search is up repaints filtered, not all. */
  await type('Drop');
  await page.evaluate(() => paintTalk('april', 'April'));
  await page.waitForTimeout(300);
  chk(await count() === 1, 'a poll while searching keeps the filter', String(await count()));

  /* Switching agent resets the box: a reading posture, not agent state. The
     real opener, with a different agent; the stub answers it the same thread. */
  await type('Drop');
  /* The card is the engine's own shape (copied from a fleet.install card),
     because openDetail reads its fields. */
  await page.evaluate(() => { try { LAST = [{ name: 'Bob', sessionName: 'bob', session: 'bob-discord', role: null, target: 'bob-discord:0.0', isAgentPane: true, isAgentSession: true, isFleetSession: true, isNamedOurs: true, task: null, state: 'idle', stateConfidence: 'scraped', stateEvidence: null, because: 'it finished and is waiting for you', context: { tokens: null, percent: null, confidence: 'none', notYet: false, because: 'we cannot find a transcript for it' }, model: null, modelName: null, hasAvatar: false, profile: {} }]; openDetail('bob', 'talk'); } catch (e) { window.__openErr = String(e); } });
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({ q: TALK_QUERY, v: document.getElementById('d-talk-search').value, err: window.__openErr || '' }));
  chk(after.q === '' && after.v === '', 'opening another agent clears the search', JSON.stringify(after));
  chk(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  console.log(fail.length ? `\n${fail.length} FAILED` : '\nall passed');
  process.exit(fail.length ? 1 : 0);
})();
