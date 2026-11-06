'use strict';

/**
 * A timed-out restart stops the moving restart mark and tells the truth, without dropping to "gone" (#2019).
 *
 * The mark is the 16 px Sweep dots since Josh 11-06 12:18 (#7896); it was the breathing .kspin K before.
 *
 * 🔑 A RENDERED CHECK IS THE ONLY KIND THAT CAN SEE THE ANIMATION STOP. The
 * engine (Renet's #2019 engine half) emits state 'restarting' with
 * disruption.timedOut when the restart overruns its window. The render must then
 * hold the dots STILL rather than keep them sweeping (#920, the spinner that lies
 * forever), say "not back yet" instead of promising "a few seconds", and STAY in
 * the restarting family -- never a bare stopped card that reads as "this agent
 * doesn't exist". Whether the pulse actually stopped is a COMPUTED fact
 * (the animation-name of the dots' ::before), which only a browser can read; a source test cannot.
 *
 *   node docs/browser-checks/render-restart-timedout-2019.js <url>
 *
 * Read-only: it drives the real card() renderer with two engine-contract-shaped
 * agents (state 'restarting', disruption { cause, startedAt, timedOut }) and
 * reads the resulting DOM. It never POSTs, so it needs no sandbox.
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
    const render = await pg.evaluate(() => {
      const base = (over) => Object.assign({
        sessionName: 's', name: 'Research bot', role: '', running: true, state: 'restarting',
        modelName: 'GPT-5', reported: false, confidence: 'structured', stateConfidence: 'structured',
        disruption: { cause: 'model', startedAt: Date.now() - 5000, timedOut: false },
      }, over);
      const inprog = base({ sessionName: 'inprog', disruption: { cause: 'model', startedAt: Date.now() - 5000, timedOut: false } });
      const timed  = base({ sessionName: 'timed',  disruption: { cause: 'model', startedAt: Date.now() - 90000, timedOut: true } });
      /* #4006: a restart that did not come back (the engine's needs_you with disruption.failed), and a plain
         needs_you with no disruption as its control. */
      const failed = base({ sessionName: 'failed', state: 'needs_you', isNamedOurs: true, because: 'Kosmos restarted this agent and it did not come back. Restart it to bring it back', disruption: { cause: 'restart', startedAt: Date.now() - 90000, timedOut: true, failed: true } });
      const plainNeeds = base({ sessionName: 'plainneeds', state: 'needs_you', isNamedOurs: true, disruption: null });
      try {
        document.getElementById('grid').innerHTML = [inprog, timed, failed, plainNeeds].map((a) => card(a)).join('');
        return 'OK';
      } catch (e) { return 'ERR: ' + e.message; }
    });
    say(render === 'OK', 'both restarting cards render without error', render);

    const cardSel = (n) => '.acard[data-agent="' + n + '"]';
    // The restart mark is the Sweep dots in the pill (kGlyph). Each dot is an <i>'s ::before; read the first one's
    // animation, and require all eight to agree, so one stray dot cannot hide behind another.
    const markSel = (n) => cardSel(n) + ' .astate .spin.spin-sweep';
    const animOf = (n) => pg.$eval(markSel(n), (el) => {
      const dots = [...el.querySelectorAll(':scope > i')];
      if (dots.length !== 8) return 'dots=' + dots.length;
      const names = [...new Set(dots.map((i) => getComputedStyle(i, '::before').animationName))];
      return names.length === 1 ? names[0] : 'mixed:' + names.join('|');
    }).catch(() => 'missing');
    const hasStill = (n) => pg.$eval(markSel(n), (el) => el.classList.contains('spin-still')).catch(() => 'missing');
    const hasOldK = (n) => pg.$(cardSel(n) + ' .kspin').then((h) => !!h);
    const stateClass = (n) => pg.$eval(cardSel(n) + ' .astate', (el) => el.className).catch(() => 'missing');
    const text = (n) => pg.$eval(cardSel(n), (el) => el.innerText).catch(() => 'missing');

    // In-progress restart: the dots sweep, the label is the plain cause, the
    // sub-line still promises "a few seconds". This is the control that proves
    // the timed-out assertions below are a real difference, not a constant.
    say((await animOf('inprog')) === 'sweepLite', 'in progress: the restart dots are moving (sweepLite)', String(await animOf('inprog')));
    say((await hasStill('inprog')) === false, 'in progress: the dots are NOT marked still');
    say((await hasOldK('inprog')) === false, 'in progress: the retired breathing .kspin K is gone');
    const inTxt = await text('inprog');
    say(/Switching to GPT-5/.test(inTxt) && !/not back yet/.test(inTxt), 'in progress: label is the plain cause, no "not back yet"', JSON.stringify(inTxt));
    say(/a few seconds/.test(inTxt), 'in progress: sub-line still says "a few seconds"');

    // Timed-out restart: the dots hold STILL (the whole point), the label admits it
    // has not come back, the sub-line drops the timing promise, and it is STILL a
    // restarting card -- never a stopped/gone one.
    say((await animOf('timed')) === 'none', 'timed out: the restart dots are STOPPED (animation none)', String(await animOf('timed')));
    say((await hasStill('timed')) === true, 'timed out: the dots are marked still (.spin-still)');
    say((await hasOldK('timed')) === false, 'timed out: the retired breathing .kspin K is gone');
    const tTxt = await text('timed');
    say(/Switching to GPT-5, not back yet/.test(tTxt), 'timed out: label keeps the cause and says "not back yet"', JSON.stringify(tTxt));
    say(/taking longer than usual/.test(tTxt) && !/a few seconds/.test(tTxt), 'timed out: sub-line drops "a few seconds" for the honest overrun line');
    say(/\bst-restarting\b/.test(await stateClass('timed')), 'timed out: still the RESTARTING family (never a bare stopped/gone card)', await stateClass('timed'));
    say(!/doesn't exist|does not exist/i.test(tTxt), 'timed out: never "this agent doesn\'t exist"');

    // #4006: a restart that did not come back is red and says so, with what to do (Josh's Grok agent sat dead
    // 23 minutes behind a card that said nothing). CONTROL: a plain needs_you card does not say it.
    const fTxt = await text('failed');
    say(/did not come back/.test(fTxt) && /Restart it/.test(fTxt), 'failed restart: the card says it did not come back and to restart it (#4006)', JSON.stringify(fTxt));
    say(/\bst-attn\b/.test(await stateClass('failed')), 'failed restart: the card is in the needs-you (red, st-attn) family', await stateClass('failed'));
    say(!/did not come back/.test(await text('plainneeds')), 'CONTROL: a needs_you card with no failed restart does not say it (#4006)');
    // Nothing is running, so the failed card is not "Online", and the page offers Start (presence off).
    say(!/\bOnline\b/.test(fTxt), 'failed restart: the card does not say Online (#4006)', JSON.stringify(fTxt));
    say(await pg.evaluate(() => cardStOf({ state: 'needs_you', disruption: { failed: true } }).pres === 'off'
      && cardStOf({ state: 'needs_you' }).pres !== 'off'), 'failed restart: presence is off, so Start this agent stays offered; CONTROL: a plain needs_you is not');
    // #6400: the answer route is the card itself (data-answer), not an Answer link in the pill.
    const answers = (n) => pg.$eval(cardSel(n), (el) => el.hasAttribute('data-answer')).catch(() => 'missing');
    say((await answers('failed')) === false, 'failed restart: no answer route, there is no question (#4006)', String(await answers('failed')));
    say((await answers('plainneeds')) === true, 'CONTROL: a plain needs_you card still answers (the card is the route, #6400)', String(await answers('plainneeds')));
  } finally {
    await b.close();
  }
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'all good');
  process.exit(fails.length ? 1 : 0);
})();
