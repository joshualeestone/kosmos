'use strict';
// Browser-check-scope: page  (kosmos#6616: the one Sign in again ask, reached through the page's own fetch wrapper)

/*
 * kosmos#6616 (R01b): a remote session's step-up refusal that says this computer's connector serves a fresh sign-in
 * (code remote_step_up, signInAgain true) shows one ask at the foot of the page, whose button submits a POST to /_kosmos/signin?fresh=1.
 * The page is a real board; the refusals are answered in the browser (the board itself is local here, so it would never
 * refuse), and the request is made through the page's own window.fetch, which is the wrapper every page call uses.
 *   CONTROL  a 403 remote_step_up WITHOUT signInAgain leaves the ask hidden (so SHOWN below is the flag, not any 403).
 *   SHOWN    a 403 with signInAgain shows the ask with the reply's sentence, and its button submits a POST to the fixed
 *            address (the gate's route is POST only; a GET would be 405).
 *   ON TOP   the topmost element at the button's centre is the button itself, above the first-run cover, which makes the
 *            rest of the page inert (the ask is exempt, so it can still be pressed there).
 *   UNDER    hidden while the restart, update or account-switch screen is up (the board is going away), shown after.
 *   PHONE    at 390 px the ask fits inside the screen, and Not now (below) is pressed there.
 *   CLOSE    Not now hides it, and it takes no space (the [hidden] rule wins over the ask's display: flex).
 *
 *   KOSMOS_URL=http://127.0.0.1:17372 NODE_PATH=~/work/pw-runtime/node_modules node docs/browser-checks/render-stepupask-6616.js
 */

const { chromium } = require('playwright');

const BASE = (process.env.KOSMOS_URL || 'http://127.0.0.1:16180').replace(/\/+$/, '');
const fail = [];
const say = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fail.push(label); };
const WORDS = 'From a remote session this needs a fresh sign-in. (check 6616)';

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' || !process.env.HEADED });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.route('**/api/check-6616/**', (route) => {
      const plain = route.request().url().endsWith('/plain');
      const body = plain ? { code: 'remote_step_up', error: WORDS } : { code: 'remote_step_up', error: WORDS, signInAgain: true };
      return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    const ask = page.locator('#stepup-ask');
    // ON TOP is measured over the first-run cover, which makes the rest of the page inert. The $B8 runner completes first
    // run at boot, so the check opens the cover itself with the page's own frOpen (it shows the cover and sets inert,
    // and posts nothing), and closes it again after (review iteration 5: without this the arm never ran there).
    const openedHere = await page.evaluate(() => {
      if (!document.getElementById('firstrun').hidden) return false;
      frOpen();   // eslint-disable-line no-undef
      return true;
    });
    const cover = await page.evaluate(() => ({ up: !document.getElementById('firstrun').hidden,
      inertBehind: [...document.querySelectorAll('body > *:not(#firstrun):not(#stepup-ask)')].some((n) => n.inert) }));
    say(cover.up && cover.inertBehind, 'the first-run cover is up and the page behind it is inert (ON TOP is measured over it)', JSON.stringify({ ...cover, openedHere }));
    await page.evaluate(() => window.fetch('/api/check-6616/plain', { method: 'POST' }).then((r) => r.status));
    await page.waitForTimeout(300);
    say(!(await ask.isVisible()), 'control: a 403 without signInAgain shows no ask');
    const status = await page.evaluate(() => window.fetch('/api/check-6616/ask', { method: 'POST' }).then((r) => r.json().then((b) => r.status + ':' + b.code)));
    say(status === '403:remote_step_up', 'the caller still reads the refusal itself (the wrapper read only a copy)', status);
    await ask.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    say(await ask.isVisible(), 'shown: a 403 with signInAgain shows the ask');
    await page.waitForFunction((w) => document.getElementById('stepup-words').textContent === w, WORDS, { timeout: 3000 }).catch(() => {});
    say((await page.locator('#stepup-words').textContent()) === WORDS, 'the ask says the reply\'s own sentence');
    const go = page.locator('#stepup-go');
    // A POST to the fixed address (the gate's route is POST only), as the browser itself resolves the form.
    const sub = await page.evaluate(() => { const f = document.getElementById('stepup-form'); const b = document.getElementById('stepup-go');
      return f && b ? f.method + ' ' + new URL(f.action).pathname + new URL(f.action).search + ' ' + (b.form === f) + ' ' + b.type : 'missing'; });
    say(sub === 'post /_kosmos/signin?fresh=1 true submit', 'the button submits a POST to the fixed address', sub);
    const box = await go.boundingBox();
    const top = box && await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && (e.id || e.className || e.tagName); },
      [box.x + box.width / 2, box.y + box.height / 2]);
    // On a miss, name the ask's ancestors that make a stacking context: a z-index only counts inside its own.
    const chain = top === 'stepup-go' ? '' : await page.evaluate(() => {
      const out = [];
      for (let e = document.getElementById('stepup-ask'); e && e !== document.documentElement; e = e.parentElement) {
        const c = getComputedStyle(e);
        out.push((e.id || e.tagName) + '[z=' + c.zIndex + ',pos=' + c.position + (c.transform !== 'none' ? ',transform' : '') + ']');
      }
      return out.join(' < ');
    }) + '  stack: ' + await page.evaluate(([x, y]) => document.elementsFromPoint(x, y).slice(0, 6).map((e) => e.id || e.tagName).join(','),
      [box.x + box.width / 2, box.y + box.height / 2]) + '  box: ' + JSON.stringify(box);
    if (top !== 'stepup-go' && process.env.SHOT_6616) await page.screenshot({ path: process.env.SHOT_6616 });
    say(top === 'stepup-go', 'on top: the button is the topmost thing where it is drawn', String(top) + (chain ? '  ask: ' + chain : ''));
    // NOT NOW OVER FIRST RUN (review iteration 11): focus goes back into the first-run screen, not to the K mark,
    // which is inert under the cover (focus would fall to the page). The ask is shown again afterwards for the rest.
    // By KEYBOARD: a mouse click need not move focus onto the button, and then focus never leaves where it was, which
    // would pass whatever the handler does. First run traps focus (Tab wraps in it, and a focusin backstop pulls focus
    // back to its heading), so the ask must be IN that cycle: Tab from first run's heading reaches Sign in again.
    await page.evaluate(() => { if (FR_ACTIVE_H2) FR_ACTIVE_H2.focus(); });   // eslint-disable-line no-undef
    let reached = '';
    for (let i = 0; i < 40 && reached !== 'stepup-go'; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => (document.activeElement && document.activeElement.id) || '');
    }
    say(reached === 'stepup-go', 'keyboard over first run: Tab reaches Sign in again (the trap lets it in)', reached);
    await page.keyboard.press('Tab');
    say(await page.evaluate(() => document.activeElement && document.activeElement.id === 'stepup-close'), 'precondition: Not now holds the keyboard focus');
    await page.keyboard.press('Enter');
    const fin = await page.evaluate(() => { const a = document.activeElement; return !!(a && a.closest && a.closest('#firstrun')) + ' ' + (a ? a.tagName : 'none'); });
    say(fin.startsWith('true'), 'not now over first run: focus goes back into the first-run screen', fin);
    await page.evaluate(() => window.fetch('/api/check-6616/ask', { method: 'POST' }));
    await ask.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    if (openedHere) await page.evaluate(() => frClose());   // eslint-disable-line no-undef
    // UNDER RESTART: the restart screen makes the page inert, so the ask is hidden while it is up and back after.
    for (const cls of ['restart-back', 'upd-back', 'cswitch-back']) {
      const under = await page.evaluate((c) => {
        const r = document.createElement('div'); r.className = c; document.body.appendChild(r);
        const during = getComputedStyle(document.getElementById('stepup-ask')).display;
        r.remove();
        return during + '/' + getComputedStyle(document.getElementById('stepup-ask')).display;
      }, cls);
      say(under === 'none/flex', 'under ' + cls + ': hidden while that screen is up, shown again after', under);
    }
    // PHONE: at 390 px wide the ask fits inside the screen with its 16 px gutter, and Not now is pressable there.
    await page.setViewportSize({ width: 390, height: 844 });
    const fit = await page.evaluate(() => { const r = document.getElementById('stepup-ask').getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.body.clientWidth }; });
    // Measured against the width the page lays out in, not 390. CI's browser reported the root at 390 (cw) while it laid
    // the page out at 375 (sw 375, the fixed ask's right edge at 359 = 375 - 16), so the smallest reported width is the
    // one the ask is laid out against (root, body, or the document's own scroll width). A box that does not use the
    // width (a 200 px one, say) still fails: none of the three is below the layout width.
    const w = Math.min(fit.cw, fit.bw, fit.sw);
    say(fit.l >= 16 && fit.r <= w - 16 && fit.r - fit.l >= w - 32 - 2 && fit.sw <= fit.cw, 'phone: the ask uses the 390 px screen\'s width inside its gutter (the sentence is long), and the page does not scroll sideways', JSON.stringify(fit));
    await page.locator('#stepup-close').click({ timeout: 5000 });
    const gone = await page.evaluate(() => { const e = document.getElementById('stepup-ask'); return e.hidden && getComputedStyle(e).display === 'none'; });
    say(gone, 'close: Not now hides the ask and it takes no space');
  } catch (e) {
    say(false, 'the check ran to the end', (e && e.message) || String(e));
  } finally {
    await browser.close();
  }
  console.log(fail.length ? 'FAIL render-stepupask-6616 (' + fail.length + ')' : 'PASS render-stepupask-6616');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
