'use strict';

/**
 * A timed-out restart stops the animated K and tells the truth, without dropping to "gone" (#2019).
 *
 * 🔑 A RENDERED CHECK IS THE ONLY KIND THAT CAN SEE THE ANIMATION STOP. The
 * engine (Renet's #2019 engine half) emits state 'restarting' with
 * disruption.timedOut when the restart overruns its window. The render must then
 * hold the K STILL rather than keep it pulsing (#920, the spinner that lies
 * forever), say "not back yet" instead of promising "a few seconds", and STAY in
 * the restarting family -- never a bare stopped card that reads as "this agent
 * doesn't exist". Whether the pulse actually stopped is a COMPUTED fact
 * (animation-name), which only a browser can read; a source test cannot.
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
      try {
        document.getElementById('grid').innerHTML = [inprog, timed].map((a) => card(a)).join('');
        return 'OK';
      } catch (e) { return 'ERR: ' + e.message; }
    });
    say(render === 'OK', 'both restarting cards render without error', render);

    const cardSel = (n) => '.acard[data-agent="' + n + '"]';
    const animOf = (n) => pg.$eval(cardSel(n) + ' .kspin img', (el) => getComputedStyle(el).animationName).catch(() => 'missing');
    const hasStill = (n) => pg.$eval(cardSel(n) + ' .kspin', (el) => el.classList.contains('kspin-still')).catch(() => 'missing');
    const stateClass = (n) => pg.$eval(cardSel(n) + ' .astate', (el) => el.className).catch(() => 'missing');
    const text = (n) => pg.$eval(cardSel(n), (el) => el.innerText).catch(() => 'missing');

    // In-progress restart: the K breathes, the label is the plain cause, the
    // sub-line still promises "a few seconds". This is the control that proves
    // the timed-out assertions below are a real difference, not a constant.
    say((await animOf('inprog')) === 'kbreathe', 'in progress: the K is animated (kbreathe)', String(await animOf('inprog')));
    say((await hasStill('inprog')) === false, 'in progress: the K is NOT marked still');
    const inTxt = await text('inprog');
    say(/Switching to GPT-5/.test(inTxt) && !/not back yet/.test(inTxt), 'in progress: label is the plain cause, no "not back yet"', JSON.stringify(inTxt));
    say(/a few seconds/.test(inTxt), 'in progress: sub-line still says "a few seconds"');

    // Timed-out restart: the K holds STILL (the whole point), the label admits it
    // has not come back, the sub-line drops the timing promise, and it is STILL a
    // restarting card -- never a stopped/gone one.
    say((await animOf('timed')) === 'none', 'timed out: the K animation is STOPPED (none)', String(await animOf('timed')));
    say((await hasStill('timed')) === true, 'timed out: the K is marked still (.kspin-still)');
    const tTxt = await text('timed');
    say(/Switching to GPT-5, not back yet/.test(tTxt), 'timed out: label keeps the cause and says "not back yet"', JSON.stringify(tTxt));
    say(/taking longer than usual/.test(tTxt) && !/a few seconds/.test(tTxt), 'timed out: sub-line drops "a few seconds" for the honest overrun line');
    say(/\bst-restarting\b/.test(await stateClass('timed')), 'timed out: still the RESTARTING family (never a bare stopped/gone card)', await stateClass('timed'));
    say(!/doesn't exist|does not exist/i.test(tTxt), 'timed out: never "this agent doesn\'t exist"');
  } finally {
    await b.close();
  }
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'all good');
  process.exit(fails.length ? 1 : 0);
})();
