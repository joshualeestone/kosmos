'use strict';

/**
 * #5154 slice C: an agent STUCK past the threshold on the same terminal error (an expired login or a rate
 * limit that has not lifted) says what is wrong and what to do, and counts as an Issue; a BRIEF one still
 * shows its ordinary paused card and does not.
 *
 * 🔑 A RENDERED CHECK IS THE RIGHT KIND HERE. The escalation lives in web/index.html's stateReason (the
 * sentence) and agentNeedsAttention (the Issue filter), both reading the `stuckError` field the server
 * attaches to /api/status (engine/stuckterminal.js decides `stuck`). Whether the rendered card carries the
 * sharper sentence, and whether the filter counts it, are facts about the page, so a source test cannot see
 * them. This drives the real card() renderer + agentNeedsAttention() with engine-contract-shaped agents and
 * reads the DOM. Read-only: it never POSTs, so it needs no sandbox.
 *
 *   node docs/browser-checks/render-stuck-terminal-5154.js <url>
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
      const base = (over) => Object.assign({
        sessionName: 's', name: 'Research bot', role: '', running: true,
        reported: false, confidence: 'structured', stateConfidence: 'structured',
      }, over);
      // Stuck past threshold on each terminal error, plus the brief (not-stuck) control and a healthy control.
      const stuckAuth = base({ sessionName: 'auth', name: 'Leo', state: 'auth_failed', isNamedOurs: true,
        stuckError: { stuck: true, state: 'auth_failed', sinceAt: Date.now() - 20 * 60000, forMs: 20 * 60000 } });
      const stuckRate = base({ sessionName: 'rate', name: 'Mia', state: 'rate_limited', isNamedOurs: true,
        stuckError: { stuck: true, state: 'rate_limited', sinceAt: Date.now() - 40 * 60000, forMs: 40 * 60000 } });
      const briefAuth = base({ sessionName: 'brief', name: 'Ray', state: 'auth_failed', isNamedOurs: true,
        stuckError: { stuck: false, state: 'auth_failed', sinceAt: null, forMs: 0 } });
      const healthy = base({ sessionName: 'ok', name: 'Sam', state: 'working', isNamedOurs: true, stuckError: { stuck: false, state: null, sinceAt: null, forMs: 0 } });
      const cardHtml = {};
      try {
        for (const a of [stuckAuth, stuckRate, briefAuth, healthy]) cardHtml[a.sessionName] = card(a);
      } catch (e) { return { error: 'card() threw: ' + e.message }; }
      return {
        authText: cardHtml.auth, rateText: cardHtml.rate, briefText: cardHtml.brief,
        // agentNeedsAttention is the Issue filter; a stuck agent counts, a brief/healthy one does not.
        attnStuckAuth: agentNeedsAttention(stuckAuth), attnStuckRate: agentNeedsAttention(stuckRate),
        attnBrief: agentNeedsAttention(briefAuth), attnHealthy: agentNeedsAttention(healthy),
      };
    });
    if (out.error) { say(false, out.error); }
    else {
      say(/unable to sign in for about\s+20\s+minutes/i.test(out.authText), 'a stuck auth_failed card names the expired sign-in and the minutes');
      say(/reconnect its account/i.test(out.authText), 'a stuck auth_failed card says to reconnect the account');
      say(/paused by a rate limit for about\s+40\s+minutes/i.test(out.rateText), 'a stuck rate_limited card names the rate limit and the minutes');
      say(!/unable to sign in for about/i.test(out.briefText), 'a BRIEF auth_failed card does NOT show the stuck escalation sentence (falls through to the ordinary card)');
      say(out.attnStuckAuth === true, 'a stuck auth_failed agent counts as an Issue (agentNeedsAttention)');
      say(out.attnStuckRate === true, 'a stuck rate_limited agent counts as an Issue');
      say(out.attnBrief === false, 'a brief (not-stuck) terminal error is NOT an Issue');
      say(out.attnHealthy === false, 'a healthy agent is not an Issue');
    }
  } catch (e) { say(false, 'threw: ' + e.message); }
  await b.close();
  if (fails.length) { console.log('\n' + fails.length + ' FAILED'); process.exit(1); }
  console.log('\nall good');
})();
