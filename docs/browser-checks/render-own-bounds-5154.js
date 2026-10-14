'use strict';

/**
 * #5154 slice B: a Kosmos helper (quota resume / idle nudge / first-reply nudge) that gave up on an agent
 * says so ON THE CARD and counts as an Issue; an agent with no raised give-up does not.
 *
 * 🔑 A RENDERED CHECK IS THE RIGHT KIND HERE, for the same reason as slice C's: the escalation lives in
 * web/index.html's stateReason (the sentence) and agentNeedsAttention (the Issue filter), both reading the
 * `ownBound` field the server attaches to /api/status (engine/ownbounds.js decides `raised`). Whether the
 * rendered card carries the give-up sentence, and whether the filter counts it, are facts about the page a
 * source test cannot see. This drives the real card() + agentNeedsAttention() with engine-contract-shaped
 * agents and reads the DOM. Read-only: it never POSTs, so it needs no sandbox.
 *
 *   node docs/browser-checks/render-own-bounds-5154.js <url>
 */
const { chromium } = require('playwright');
(async () => {
  const URL = process.argv[2] || process.env.KOSMOS_URL || 'http://127.0.0.1:17471';
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  const fails = [];
  const say = (ok, l, x) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (x ? '  ' + x : '')); if (!ok) fails.push(l); };
  const pg = await b.newPage({ viewport: { width: 1000, height: 800 } });
  pg.on('pageerror', (e) => say(false, 'page error: ' + e.message));
  try {
    await pg.goto(URL + '/?tab=agents', { waitUntil: 'networkidle' });
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
    const out = await pg.evaluate(() => {
      const now = Date.now();
      const base = (over) => Object.assign({
        sessionName: 's', name: 'Research bot', role: '', running: true,
        reported: false, confidence: 'structured', stateConfidence: 'structured',
      }, over);
      const raised = (cls, mins, over) => base(Object.assign({ isNamedOurs: true,
        ownBound: { raised: true, items: [{ cls, sinceAt: now - mins * 60000, forMs: mins * 60000, evidence: 'gave up after 3 tries that reached nothing' }], stale: [] } }, over));
      // A quota give-up is NOT idle-gated. Use a realistic quota-paused state (rate_limited): the server would
      // moot a quota give-up on a `working` agent (isMoot), so `working` + raised:true is a shape it never emits.
      const quota = raised('quota', 20, { sessionName: 'q', name: 'Leo', state: 'rate_limited' });
      // The two nudges only ever fire for an idle agent (the board's mootness clear drops them otherwise).
      const nudge = raised('nudge', 15, { sessionName: 'n', name: 'Mia', state: 'idle' });
      const first = raised('firstreply', 10, { sessionName: 'f', name: 'Ray', state: 'idle' });
      // CONTROL: an ownBound that is NOT raised (within grace, or recovered) shows no give-up sentence, no Issue.
      const notRaised = base({ sessionName: 'c', name: 'Sam', state: 'idle', isNamedOurs: true, ownBound: { raised: false, items: [], stale: [] } });
      // CONTROL: a healthy agent with no ownBound field value at all.
      const healthy = base({ sessionName: 'h', name: 'Ada', state: 'working', isNamedOurs: true, ownBound: null });
      // PRECEDENCE: an agent with BOTH a raised give-up AND its own reported question. The card must show the
      // agent's OWN question (stateReason's own-question arm), NOT the give-up sentence -- a Kosmos give-up must
      // never mask the person's actual question. (Server-side the push/pill honour this too; this pins the card.)
      const ownQuestion = base({ sessionName: 'o', name: 'Zed', state: 'needs_you', stateReported: true, stateReportedBy: 'agent',
        because: 'Which launch date should I use, the 14th or the 21st?', isNamedOurs: true,
        ownBound: { raised: true, items: [{ cls: 'quota', sinceAt: now - 20 * 60000, forMs: 20 * 60000, evidence: 'gave up after 3 tries that reached nothing' }], stale: [] } });
      const cardHtml = {};
      try { for (const a of [quota, nudge, first, notRaised, healthy, ownQuestion]) cardHtml[a.sessionName] = card(a); }
      catch (e) { return { error: 'card() threw: ' + e.message }; }
      // The grid card shows the STATE LABEL (cardStOf), never the reported sentence: card() renders taskLine
      // with noQuote, and in fact NO surface renders stateReason's quoted-because (every taskLine caller passes
      // noQuote). So the precedence a person actually sees is on the CARD: a needs_you own-question agent reads as
      // its own calm "Question" (st-question), and the Kosmos give-up sentence must not sit on that card.
      return {
        quotaText: cardHtml.q, nudgeText: cardHtml.n, firstText: cardHtml.f, notRaisedText: cardHtml.c, ownQuestionText: cardHtml.o,
        attnQuota: agentNeedsAttention(quota), attnNudge: agentNeedsAttention(nudge), attnFirst: agentNeedsAttention(first),
        attnNotRaised: agentNeedsAttention(notRaised), attnHealthy: agentNeedsAttention(healthy),
      };
    });
    if (out.error) { say(false, out.error); }
    else {
      say(/get this agent going again after its quota reset/i.test(out.quotaText) && /20\s+minutes/.test(out.quotaText), 'a raised quota give-up names the quota resume and the minutes');
      say(/nudged this idle agent to pick up its open task/i.test(out.nudgeText) && /15\s+minutes/.test(out.nudgeText), 'a raised nudge give-up names the idle nudge and the minutes');
      say(/reminded this agent to answer its first message/i.test(out.firstText) && /10\s+minutes/.test(out.firstText), 'a raised first-reply give-up names the reminder and the minutes');
      say(!/gave up/i.test(out.notRaisedText) && !/quota reset/i.test(out.notRaisedText), 'a NOT-raised ownBound shows no give-up sentence (CONTROL)');
      // PRECEDENCE, asserted on the CARD the person sees (the real guard: a Kosmos give-up must never sit on the
      // card of an agent that is asking the person its own question). cardStOf renders a stateReportedBy agent
      // needs_you as the calm "Question" treatment (st-question); the give-up arm in stateReason is guarded on the
      // state not being needs_you, so its sentence never reaches this card. Both are rendered facts, not source
      // order. The PR carries a negative control: removing that guard makes assertion B below go RED, then green.
      say(/astate st-question/.test(out.ownQuestionText), 'a needs_you agent asking its own question reads as a Question on the card (st-question), not an Issue or a give-up');
      say(!/get this agent going again after its quota reset/i.test(out.ownQuestionText), 'and the Kosmos give-up sentence is absent from that question card (precedence)');
      say(out.attnQuota === true, 'a raised quota give-up counts as an Issue (agentNeedsAttention)');
      say(out.attnNudge === true, 'a raised nudge give-up counts as an Issue');
      say(out.attnFirst === true, 'a raised first-reply give-up counts as an Issue');
      say(out.attnNotRaised === false, 'a NOT-raised ownBound is NOT an Issue (CONTROL)');
      say(out.attnHealthy === false, 'a healthy agent (no ownBound) is NOT an Issue (CONTROL)');
    }
  } catch (e) { say(false, 'threw: ' + e.message); }
  await b.close();
  if (fails.length) { console.log('\n' + fails.length + ' FAILED'); process.exit(1); }
  console.log('\nall good');
})();
