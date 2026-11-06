'use strict';

/**
 * kosmos#2365 / retest #11 (Josh 0.6.40) + #2236 (Josh 0.6.42 re-test): the Choose-a-Model
 * screen's system-working loading lines must show Mona Lisa's "Sweep" loading spinner (the
 * dots-trail she designed and Josh chose 2026-09-05; installkosmos.com/design/loading-indicators,
 * variant D) -- rendered here as `<span class="spin spin-sweep"> x8 <i></i>`.
 *
 * WHY THIS CHECK WAS REWRITTEN (the bug it now catches): the first version asserted only that
 * *a* spinner (`.kspin`) was present. #11 shipped the wrong asset -- the `.kspin` Kosmos MARK
 * (a tiny Kosmos icon), not the loading dots -- and the check passed anyway, because "a spinner
 * exists" was true. Josh caught the wrong icon by eye on the 0.6.42 re-test. This version pins
 * the SPECIFIC component so that failure cannot recur: each system-working state must render a
 * `.spin.spin-sweep` with its eight `<i>` dots, and must NOT render a `.kspin` icon.
 *
 * Uses the page's own painter (frPaintConnect into #fr-sub) plus the OpenAI connect handler in
 * a real DOM:
 *  - the SYSTEM-working connect phases (downloading, installing, signin-launching,
 *    signin-completing) each render a `.spin.spin-sweep` (8 dots) and NO `.kspin`;
 *  - the OpenAI "Adding..." validate state renders a `.spin.spin-sweep` and NO `.kspin`;
 *  - the CONTROL that keeps this honest: 'signin-browser-open' is waiting on the PERSON to
 *    sign in in their browser, NOT the system working, so it must render NEITHER a spinner nor
 *    an icon.
 *
 * CONTROL for the whole feature: on a page whose loading states render the Kosmos icon (the
 * pre-fix #11 shape) or no spinner, the sweep+no-icon assertions red.
 *
 * #7896 (Josh 2026-11-03): the loading mark is now the KOSMOS orb (KORB draws it into a canvas inside each
 * .spin-sweep). The arm at the end reads the drawing, not the markup: drawn, turning, the old dots hidden, and with
 * reduced motion drawn once and still.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-model-spinners-2365.js
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-model-spinners-2365: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-model-spinners-2365: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(() => {
    if (typeof frPaintConnect !== 'function') return { error: 'frPaintConnect is not a function' };
    const sub = document.getElementById('fr-sub');
    if (!sub) return { error: 'no #fr-sub connect box on the page' };
    // Read the component precisely: is Mona's Sweep spinner present, does it have its 8 dots,
    // and is the wrong-asset Kosmos icon (.kspin) present? The .kspin read is the negative
    // assertion that would have caught the original #11 defect.
    const probe = (el) => {
      const sweep = el.querySelector('.spin.spin-sweep');
      return {
        sweep: !!sweep,
        dots: sweep ? sweep.querySelectorAll('i').length : 0,
        icon: !!el.querySelector('.kspin'),   // the wrong asset (Kosmos mark) must be absent
      };
    };
    // frPaintConnect skips a repaint when the phase+because key is unchanged; give each call
    // a distinct `because` so nothing is skipped.
    let n = 0;
    const paint = (phase) => {
      n += 1;
      try { frPaintConnect({ phase, because: 'probe' + n, progress: { receivedBytes: 0, totalBytes: 230000000 }, url: '' }); }
      catch (e) { return { threw: String((e && e.message) || e) }; }
      const p = probe(sub);
      p.html = sub.innerHTML.slice(0, 140);
      return p;
    };
    const out = {
      downloading: paint('downloading'),
      installing: paint('installing'),
      signinLaunching: paint('signin-launching'),
      signinCompleting: paint('signin-completing'),
      signinBrowserOpen: paint('signin-browser-open'),   // control: waiting on the person
    };
    // OpenAI "Adding..." validate state: stub the POST as never-resolving, put a key in the
    // field, click, and read #fr-openai-msg while the validation is in flight.
    out.openaiAdding = null;
    try {
      const key = document.getElementById('fr-openai-key');
      const go = document.getElementById('fr-openai-go');
      const msg = document.getElementById('fr-openai-msg');
      if (key && go && msg) {
        const realFetch = window.fetch;
        window.fetch = (u) => (String(u).indexOf('/api/accounts/openai') !== -1)
          ? new Promise(() => {})   // never resolves: hold the "Adding..." state
          : realFetch(u);
        key.value = 'sk-test-probe';
        go.click();
        const p = probe(msg);
        p.text = (msg.textContent || '').trim();
        out.openaiAdding = p;
        window.fetch = realFetch;
      } else {
        out.openaiAdding = { error: 'openai field/button/msg missing' };
      }
    } catch (e) { out.openaiAdding = { threw: String((e && e.message) || e) }; }
    return out;
  });

  /* #7896, as Josh corrected it 11-06: the KOSMOS orb is only for whole-screen waits (kOrbWaitHtml, .orb-wait); small
     spinners keep the Sweep dots (the arm after this one). This reads the orb's DRAWING: the page's own kOrbWaitHtml,
     put on the page, gets a canvas.korb with drawn pixels (alpha) on it that
     change between frames, and its old dots are hidden. Then, with reduced motion, it is drawn once and holds still.
     And the loop STOPS once no spinner is visible: four spinners live hidden in the page, so a loop that only stops
     when there are none would run forever (review round 1 measured 289 frames in 2 s with nothing showing). */
  const orbRead = async (pg) => pg.evaluate(async () => {
    if (typeof KORB !== 'object' || typeof kOrbWaitHtml !== 'function') return { error: 'KORB or kOrbWaitHtml is missing' };
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:10px;top:10px;z-index:99999;background:#faf9f7';
    host.innerHTML = kOrbWaitHtml('chk-orb', '', 32);
    document.body.appendChild(host);
    const frames = (n) => new Promise((res) => { let k = 0; const f = () => (++k < n ? requestAnimationFrame(f) : res()); requestAnimationFrame(f); });
    const lit = (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0, sum = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 20) { n++; sum += i * d[i]; } return { n, sum }; };
    await frames(12);
    const span = host.querySelector('.spin.spin-sweep');
    const cv = span && span.querySelector('canvas.korb');
    if (!cv) return { error: 'no canvas.korb inside the .spin-sweep after 12 frames' };
    const a = lit(cv);
    await new Promise((res) => setTimeout(res, 400)); await frames(4);
    const b = lit(cv);
    const dot = span.querySelector('i');
    // Taken off the page WHILE turning and put back (round 3: it froze for good): it must turn again.
    // From a timer, as a page's own code removes things: a removal straight after a frame is seen by the visibility
    // watcher first and escapes the bug, so it would not test it.
    await new Promise((res) => setTimeout(() => { host.remove(); res(); }, 0));
    await new Promise((res) => setTimeout(res, 150));
    await new Promise((res) => setTimeout(() => { document.body.appendChild(host); res(); }, 0));
    await frames(8);
    const r1 = lit(cv);
    await new Promise((res) => setTimeout(res, 400)); await frames(4);
    const reattachedTurns = lit(cv).sum !== r1.sum;
    const wasRunning = KORB.running();
    host.style.display = 'none';
    await new Promise((res) => setTimeout(res, 300)); await frames(6);
    const stopped = !KORB.running();
    const want = Math.round(32 * (window.devicePixelRatio || 1));   // Josh: the same sized circle; this host asks for 32 px
    return { side: cv.width, want, litA: a.n, litB: b.n, changed: a.sum !== b.sum, oldDotsShown: dot ? getComputedStyle(dot).display !== 'none' : false, wasRunning, stopped, reattachedTurns };
  });
  const orb = await orbRead(page);
  // Josh 11-06: "the small loading spinners [stay] the small loading spinners". The page's own small spinner, given time
  // to be drawn, has no orb canvas and shows its eight Sweep dots.
  const smallKeepsDots = await page.evaluate(async () => {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:600px;top:10px;z-index:99999';
    host.innerHTML = LOAD_SPIN_HTML;
    document.body.appendChild(host);
    await new Promise((res) => { let k = 0; const f = () => (++k < 12 ? requestAnimationFrame(f) : res()); requestAnimationFrame(f); });
    const span = host.querySelector('.spin.spin-sweep');
    const r = { orbCanvas: !!host.querySelector('canvas.korb'), dots: span ? [...span.querySelectorAll('i')].filter((i) => getComputedStyle(i).display !== 'none').length : 0,
      dot: span ? getComputedStyle(span).getPropertyValue('--spin-dot').trim() : '',
      orbDot: (() => { const o = document.createElement('div'); o.innerHTML = kOrbWaitHtml('chk-orb', '', 88); host.appendChild(o); return getComputedStyle(o.firstElementChild).getPropertyValue('--spin-dot').trim(); })() };
    host.remove();
    return r;
  });
  // On a gold button it is drawn in the button's ink (--spin-dot), so it shows on the gold.
  const onGold = await page.evaluate(async () => {
    const frames = (n) => new Promise((res) => { let k = 0; const f = () => (++k < n ? requestAnimationFrame(f) : res()); requestAnimationFrame(f); });
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:400px;top:10px;z-index:99999';
    host.innerHTML = '<button class="btn" type="button">' + kOrbWaitHtml('chk-orb', '', 32) + ' Adding</button>';
    document.body.appendChild(host);
    await frames(6);
    const cv = host.querySelector('canvas.korb');
    if (!cv || !cv.width) { host.remove(); return { error: 'no drawn canvas on the gold button' }; }
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0, r = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 60) { n++; r += d[i]; }
    host.remove();
    return { avgRed: n ? Math.round(r / n) : -1 };
  });
  /* #7896 follow-up: off a gold button the orb is drawn in --spin-gold: the deep gold #9c741b on a light ground (3:1 or
     more on every light ground; --gold is about 2.1:1) and --gold #d6a62e on a dark one, and on the Kosmos+ navy
     (body.plus-active) in either theme. Read by the colour of the drawn pixels, as the gold-button arm above, in every
     theme state: system light and forced dark (this light page), system dark and forced light (a dark-scheme page). */
  const goldIn = (pg, theme, plus) => pg.evaluate(async ([theme, plus]) => {
    const frames = (n) => new Promise((res) => { let k = 0; const f = () => (++k < n ? requestAnimationFrame(f) : res()); requestAnimationFrame(f); });
    const html = document.documentElement, was = html.getAttribute('data-theme'), wasPlus = document.body.classList.contains('plus-active');
    if (theme === null) html.removeAttribute('data-theme'); else html.setAttribute('data-theme', theme);
    document.body.classList.toggle('plus-active', !!plus);
    const host = document.createElement('div');
    try {
      host.style.cssText = 'position:fixed;left:500px;top:10px;z-index:99999';
      host.innerHTML = kOrbWaitHtml('chk-orb', '', 32);
      document.body.appendChild(host);
      await frames(6);
      const cv = host.querySelector('canvas.korb');
      if (!cv || !cv.width) return { error: 'no drawn canvas' };
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let n = 0, r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 60) { n++; r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      return n ? { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), n } : { error: 'no drawn pixels' };
    } finally {
      host.remove();
      document.body.classList.toggle('plus-active', wasPlus);
      if (was === null) html.removeAttribute('data-theme'); else html.setAttribute('data-theme', was);
    }
  }, [theme, plus]);
  const themeGold = {
    systemLight: await goldIn(page, null, false),
    forcedDark: await goldIn(page, 'dark', false),
    plusLight: await goldIn(page, null, true),
  };
  const darkPage = await browser.newPage({ viewport: { width: 900, height: 800 }, colorScheme: 'dark' });
  await darkPage.goto('file://' + PAGE);
  themeGold.systemDark = await goldIn(darkPage, null, false);
  themeGold.forcedLight = await goldIn(darkPage, 'light', false);
  // The first-run card is white in both themes, so it pins the deep gold even on a dark system. Read as the orb reads
  // it (the computed --spin-dot of a spinner inside the card), which needs no layout, so the card may stay hidden.
  themeGold.firstrunDark = await darkPage.evaluate(() => {
    const fr = document.getElementById('firstrun');
    if (!fr) return { error: 'no #firstrun on the page' };
    const host = document.createElement('div');
    try { host.innerHTML = kOrbWaitHtml('chk-orb', '', 14); fr.appendChild(host); return { dot: getComputedStyle(host.querySelector('.spin')).getPropertyValue('--spin-dot').trim().toLowerCase() }; }
    finally { host.remove(); }
  });
  await darkPage.close();
  /* A still orb (reduced motion) is redrawn when its gold changes under it: on a switch from the light theme to the dark,
     and on going into the Kosmos+ screen in the light theme. Nothing turns, so only the theme and plus-active watchers
     can redraw it. Each reads the drawn colour before and after. */
  const calmSwitch = async (change) => {
    const pg = await browser.newPage({ viewport: { width: 900, height: 800 }, reducedMotion: 'reduce', colorScheme: 'light' });
    await pg.goto('file://' + PAGE);
    const r = await pg.evaluate(async (change) => {
      const frames = (n) => new Promise((res) => { let k = 0; const f = () => (++k < n ? requestAnimationFrame(f) : res()); requestAnimationFrame(f); });
      const rgb = (cv) => { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0, r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 60) { n++; r += d[i]; g += d[i + 1]; b += d[i + 2]; } return n ? { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) } : { error: 'no drawn pixels' }; };
      const host = document.createElement('div');
      try {
        host.style.cssText = 'position:fixed;left:500px;top:10px;z-index:99999';
        host.innerHTML = kOrbWaitHtml('chk-orb', '', 32);
        document.body.appendChild(host);
        await frames(8);
        const cv = host.querySelector('canvas.korb');
        if (!cv || !cv.width) return { error: 'no drawn canvas' };
        const before = rgb(cv);
        if (change === 'theme') document.documentElement.setAttribute('data-theme', 'dark'); else document.body.classList.add('plus-active');
        await new Promise((res) => setTimeout(res, 100)); await frames(8);
        return { before, after: rgb(cv) };
      } finally { host.remove(); document.body.classList.remove('plus-active'); document.documentElement.removeAttribute('data-theme'); }
    }, change);
    await pg.close();
    return r;
  };
  const calmTheme = await calmSwitch('theme');
  const plusCalm = await calmSwitch('plus');
  // Drawn on its FIRST frame (round 5: 2 to 3 blank frames, a blink each time a list repaints a spinner).
  const firstFrame = await page.evaluate(async () => {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:300px;top:10px;z-index:99999';
    host.innerHTML = kOrbWaitHtml('chk-orb', '', 88);   // the size a person sees on a whole-screen wait
    document.body.appendChild(host);
    await new Promise((res) => requestAnimationFrame(res));
    const cv = host.querySelector('canvas.korb');
    if (!cv || !cv.width) return { lit: 0, why: cv ? 'canvas has no size yet' : 'no canvas yet' };
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let lit = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 20) lit++;
    host.remove();
    return { lit };
  });
  const calmPage = await browser.newPage({ viewport: { width: 900, height: 800 }, reducedMotion: 'reduce' });
  await calmPage.goto('file://' + PAGE);
  const calm = await orbRead(calmPage);
  /* A still orb after a browser zoom or a move to a denser screen: its CSS size does not change (so the size watcher
     cannot see it), only the pixel density does, and the orb must be drawn again at the new density. Round 7: the
     earlier arm changed --sz, which the size watcher catches alone, so it passed with the resize listener deleted. */
  const calmMk = await calmPage.evaluate(async () => {
    const frames = (n) => new Promise((res) => { let k = 0; const f = () => (++k < n ? requestAnimationFrame(f) : res()); requestAnimationFrame(f); });
    const host = document.createElement('div');
    window.__korbDensityHost = host;   // the arm's own element, kept by reference (no page id)
    host.style.cssText = 'position:fixed;left:200px;top:10px;z-index:99999';
    host.innerHTML = kOrbWaitHtml('chk-orb', '', 88);
    document.body.appendChild(host);
    await frames(8);
    const cv = host.querySelector('canvas.korb');
    return cv ? { before: cv.width, dpr: window.devicePixelRatio || 1 } : { error: 'no canvas.korb in the still spinner' };
  });
  let calmResize = calmMk;
  if (!calmMk.error) {
    const cdp = await calmPage.context().newCDPSession(calmPage);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 800, deviceScaleFactor: calmMk.dpr * 2, mobile: false });
    calmResize = await calmPage.evaluate(async (was) => {
      const frames = (n) => new Promise((res) => { let k = 0; const f = () => (++k < n ? requestAnimationFrame(f) : res()); requestAnimationFrame(f); });
      // Headless emulation changes the density but fires neither resize nor the density query's change (measured);
      // a real zoom fires resize, so that is fired here. The density query itself cannot be driven headless.
      window.dispatchEvent(new Event('resize'));
      await new Promise((res) => setTimeout(res, 200)); await frames(8);
      const cv = window.__korbDensityHost && window.__korbDensityHost.querySelector('canvas.korb');
      if (!cv) return { error: 'the still spinner lost its canvas' };
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let lit = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 20) lit++;
      return { before: was.before, after: cv.width, want: Math.round(88 * (window.devicePixelRatio || 1)), dpr: window.devicePixelRatio, lit };
    }, calmMk);
  }

  await browser.close();

  const orbProblems = [];
  if (smallKeepsDots.orbCanvas || smallKeepsDots.dots !== 8) orbProblems.push('a small spinner was given the orb or lost its dots (Josh 11-06: small spinners keep the Sweep dots): ' + JSON.stringify(smallKeepsDots));
  // The dots keep the contrast fix (#7930): the same gold as the orb, the deep one on a light ground.
  if (!smallKeepsDots.dot || smallKeepsDots.dot !== smallKeepsDots.orbDot) orbProblems.push('a small spinner is not in the orb\'s gold (the deep gold on light grounds, 3:1): ' + JSON.stringify(smallKeepsDots));
  if (onGold.error) orbProblems.push('orb on a gold button: ' + onGold.error);
  else if (!(onGold.avgRed >= 0 && onGold.avgRed < 90)) orbProblems.push('orb on a gold button: drawn in gold (average red ' + onGold.avgRed + '), not the button\'s dark ink, so it vanishes on the gold');
  // Within 14 of the wanted colour on each channel: the canvas blends edges, so the average is near the colour, not on it.
  const near = (got, want) => got && !got.error && Math.abs(got.r - want[0]) <= 14 && Math.abs(got.g - want[1]) <= 14 && Math.abs(got.b - want[2]) <= 14;
  const DEEP = [0x9c, 0x74, 0x1b], GOLD = [0xd6, 0xa6, 0x2e];
  if (themeGold.firstrunDark.error || themeGold.firstrunDark.dot !== '#9c741b') orbProblems.push('orb on the first-run card on a dark system: --spin-dot is not the deep gold #9c741b but ' + JSON.stringify(themeGold.firstrunDark));
  for (const [res, words] of [[calmTheme, 'a still orb on a switch from the light theme to the dark'], [plusCalm, 'a still orb going into the Kosmos+ screen in the light theme']]) {
    if (res.error || !near(res.before, DEEP) || !near(res.after, GOLD)) orbProblems.push(words + ' was not redrawn from the deep gold to --gold: ' + JSON.stringify(res));
  }
  for (const [state, want, words] of [['systemLight', DEEP, 'light theme (system)'], ['forcedLight', DEEP, 'light theme forced on a dark system'],
    ['systemDark', GOLD, 'dark theme (system)'], ['forcedDark', GOLD, 'dark theme forced on a light system'], ['plusLight', GOLD, 'Kosmos+ navy in the light theme']]) {
    if (!near(themeGold[state], want)) orbProblems.push('orb, ' + words + ': not ' + (want === DEEP ? 'the deep gold #9c741b' : '--gold #d6a62e') + ' but ' + JSON.stringify(themeGold[state]));
  }
  if (!(firstFrame.lit > 40)) orbProblems.push('orb: not drawn on its first frame (' + (firstFrame.why || firstFrame.lit + ' drawn pixels') + '), so it blinks in');
  if (orb.error) orbProblems.push('orb: ' + orb.error);
  else {
    if (!(orb.litA > 40)) orbProblems.push('orb: the canvas has ' + orb.litA + ' drawn pixels, so no orb was drawn');
    if (!orb.changed) orbProblems.push('orb: the drawing did not change between frames, so it is not turning');
    if (orb.oldDotsShown) orbProblems.push('orb: the old Sweep dots still show beside the orb');
    if (!orb.wasRunning) orbProblems.push('orb: the loop was not running while a spinner showed (CONTROL for the stop arm)');
    if (!orb.stopped) orbProblems.push('orb: the loop kept running with no spinner visible');
    if (!orb.reattachedTurns) orbProblems.push('orb: a spinner taken off the page and put back does not turn again');
    if (orb.side !== orb.want) orbProblems.push('orb: drawn at ' + orb.side + ' px, not the spinner\'s own size (' + orb.want + ')');
  }
  if (calm.error) orbProblems.push('orb (reduced motion): ' + calm.error);
  else {
    if (!(calm.litA > 40)) orbProblems.push('orb (reduced motion): nothing drawn; it should hold still, not vanish');
    if (calm.changed) orbProblems.push('orb (reduced motion): the drawing still moves');
    if (calm.wasRunning) orbProblems.push('orb (reduced motion): the loop was still running with the still orb showing');
  }
  if (calmResize.error) orbProblems.push('orb (reduced motion, density change): ' + calmResize.error);
  else {
    if (calmResize.after !== calmResize.want) orbProblems.push('orb (reduced motion): after a zoom or denser screen it is still drawn at ' + calmResize.after + ' px, not ' + calmResize.want);
    if (!(calmResize.lit > 40)) orbProblems.push('orb (reduced motion): after a zoom or denser screen the canvas is blank (' + calmResize.lit + ' drawn pixels)');
  }

  const problems = orbProblems.slice();
  if (r.error) problems.push(r.error);
  if (!r.error) {
    const want = [['downloading', r.downloading], ['installing', r.installing], ['signin-launching', r.signinLaunching], ['signin-completing', r.signinCompleting]];
    for (const [name, res] of want) {
      if (res.threw) { problems.push('phase ' + name + ' threw: ' + res.threw); continue; }
      if (!res.sweep) problems.push('phase ' + name + ' has no .spin.spin-sweep loading spinner (system-working wait): ' + res.html);
      else if (res.dots !== 8) problems.push('phase ' + name + ' spinner has ' + res.dots + ' dots, expected 8 (the Sweep component is eight <i>): ' + res.html);
      if (res.icon) problems.push('phase ' + name + ' renders the .kspin Kosmos ICON instead of the loading dots (the exact #11 wrong-asset defect): ' + res.html);
    }
    // Control: the user-action wait must render NEITHER a spinner nor an icon.
    if (r.signinBrowserOpen.threw) problems.push('phase signin-browser-open threw: ' + r.signinBrowserOpen.threw);
    else {
      if (r.signinBrowserOpen.sweep) problems.push('phase signin-browser-open should NOT have a spinner (it waits on the person to sign in, not the system): ' + r.signinBrowserOpen.html);
      if (r.signinBrowserOpen.icon) problems.push('phase signin-browser-open should NOT render the .kspin icon: ' + r.signinBrowserOpen.html);
    }
    // The OpenAI "Adding..." validate state.
    if (!r.openaiAdding) problems.push('the OpenAI Adding probe did not run');
    else if (r.openaiAdding.threw) problems.push('the OpenAI Adding probe threw: ' + r.openaiAdding.threw);
    else if (r.openaiAdding.error) problems.push('the OpenAI Adding probe could not run: ' + r.openaiAdding.error);
    else {
      if (!r.openaiAdding.sweep) problems.push('the OpenAI "Adding..." validate state (#fr-openai-msg) has no .spin.spin-sweep spinner: text="' + r.openaiAdding.text + '"');
      else if (r.openaiAdding.dots !== 8) problems.push('the OpenAI "Adding..." spinner has ' + r.openaiAdding.dots + ' dots, expected 8: text="' + r.openaiAdding.text + '"');
      if (r.openaiAdding.icon) problems.push('the OpenAI "Adding..." validate state renders the .kspin Kosmos ICON instead of the loading dots: text="' + r.openaiAdding.text + '"');
    }
  }

  console.log('  ' + JSON.stringify(r));
  console.log('  orb ' + JSON.stringify(orb) + ' reduced-motion ' + JSON.stringify(calm));
  if (problems.length) {
    console.error('render-model-spinners-2365: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-model-spinners-2365: the Choose-a-Model system-working waiting states (download/install/sign-in-completing + the OpenAI Adding validate) show Mona\'s .spin-sweep loading dots (8 dots, no Kosmos icon); the user-action wait (browser sign-in) correctly shows neither.');
})().catch((e) => { console.error('FAIL  render-model-spinners-2365 threw: ' + ((e && e.message) || e)); process.exit(1); });
