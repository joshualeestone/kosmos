'use strict';
// Browser-check-scope: page  (kosmos#6616: the one Sign in again ask, reached through the page's own fetch wrapper)

/*
 * kosmos#6616 (R01b): a remote session's step-up refusal that says this computer's connector serves a fresh sign-in
 * (code remote_step_up, signInAgain true) shows one ask at the foot of the page, with a link to /_kosmos/signin?fresh=1.
 * The page is a real board; the refusals are answered in the browser (the board itself is local here, so it would never
 * refuse), and the request is made through the page's own window.fetch, which is the wrapper every page call uses.
 *   CONTROL  a 403 remote_step_up WITHOUT signInAgain leaves the ask hidden (so SHOWN below is the flag, not any 403).
 *   SHOWN    a 403 with signInAgain shows the ask with the reply's sentence, and the link's href is the fixed address.
 *   ON TOP   the topmost element at the link's centre is the link itself, above the first-run cover, which makes the
 *            rest of the page inert (the ask is exempt, so it can still be pressed there).
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
    // A fresh sandboxed board shows the first-run cover, which makes the rest of the page inert: ON TOP is measured over it.
    say(await page.locator('#firstrun').isVisible(), 'the first-run cover is up (the hardest layer for the ask)');
    await page.evaluate(() => window.fetch('/api/check-6616/plain', { method: 'POST' }).then((r) => r.status));
    await page.waitForTimeout(300);
    say(!(await ask.isVisible()), 'control: a 403 without signInAgain shows no ask');
    const status = await page.evaluate(() => window.fetch('/api/check-6616/ask', { method: 'POST' }).then((r) => r.json().then((b) => r.status + ':' + b.code)));
    say(status === '403:remote_step_up', 'the caller still reads the refusal itself (the wrapper read only a copy)', status);
    await ask.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    say(await ask.isVisible(), 'shown: a 403 with signInAgain shows the ask');
    say((await page.locator('#stepup-words').textContent()) === WORDS, 'the ask says the reply\'s own sentence');
    const go = page.locator('#stepup-go');
    say((await go.getAttribute('href')) === '/_kosmos/signin?fresh=1', 'the link goes to the fixed address', await go.getAttribute('href'));
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
    say(top === 'stepup-go', 'on top: the link is the topmost thing where it is drawn', String(top) + (chain ? '  ask: ' + chain : ''));
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
