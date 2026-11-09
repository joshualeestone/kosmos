'use strict';
// Browser-check-surface: invitestep istep-copy istep-later istep-line inviteStepCheck

/**
 * kosmos#6255: the once-only "Help Kosmos grow" step, on the real page with /api/invite-step stubbed. No board.
 *  - not due: no window (the control for everything below);
 *  - due with no reward: the plain words, nothing about a month;
 *  - due with a reward: the month, as the board worded it;
 *  - Copy puts the link on the clipboard, says so and records the answer; Not now closes and records the answer.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-invitestep-6255.js
 */
const nodePath = require('node:path');
let pw;
try { pw = require('playwright'); }
catch { console.log('render-invitestep-6255: playwright is not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const LINK = 'https://login.example.test/signup?invite=abc';
const fails = [];
const say = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fails.push(label); };
const PLAIN = { show: true, link: LINK, reward: false, headline: 'Help Kosmos grow', line: 'Know someone who would use this? Send them your link.', fine: '' };
const PAID = { show: true, link: LINK, reward: true, headline: 'Help Kosmos grow', line: 'Invite someone, and when they start paying for Kosmos+, you get a month free.', fine: 'Share it however you like.' };

const STUB = (step) => {
  window.__done = 0;
  const real = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = (url, opts) => {
    const u = String(url);
    if (u.endsWith('/api/invite-step/done')) { window.__done++; return Promise.resolve(new Response('{"ok":true}', { status: 200 })); }
    if (u.endsWith('/api/invite-step')) return Promise.resolve(new Response(JSON.stringify(step), { status: 200 }));
    return real ? real(url, opts) : Promise.reject(new Error('no fetch'));
  };
};

(async () => {
  const browser = await pw.chromium.launch({ headless: process.env.HEADED === '0' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const open = async (step) => {
    const page = await context.newPage();
    await page.addInitScript(STUB, step);
    await page.goto('file://' + PAGE);
    await page.evaluate(() => { const c = document.querySelector('.fr-back'); if (c) c.hidden = true; });
    await page.evaluate(() => inviteStepCheck());
    return page;
  };

  let page = await open({ show: false });
  say(await page.locator('#invitestep').count() === 0, 'CONTROL: not due, no window');
  await page.close();

  page = await open(PLAIN);
  say(await page.locator('#invitestep').count() === 1, 'due: the window opens');
  const words = await page.locator('#invitestep').innerText();
  say(/Know someone who would use this/.test(words) && !/month|free/i.test(words), 'no reward: the plain words, nothing about a month', JSON.stringify(words));
  await page.click('#istep-later');
  say(await page.locator('#invitestep').count() === 0, 'Not now closes it');
  await page.waitForFunction(() => window.__done === 1, null, { timeout: 3000 }).catch(() => {});
  say(await page.evaluate(() => window.__done) === 1, 'Not now records the answer');
  await page.close();

  page = await open(PAID);
  const paid = await page.locator('#invitestep').innerText();
  say(/a month free/.test(paid) && /Share it however you like/.test(paid), 'reward on: the month, in the board\'s words', JSON.stringify(paid));
  await page.click('#istep-copy');
  await page.waitForFunction(() => window.__done === 1, null, { timeout: 3000 }).catch(() => {});
  say(await page.evaluate(() => window.__done) === 1, 'Copy records the answer');
  say((await page.locator('#istep-msg').innerText()).startsWith('Copied'), 'Copy says so');
  say(await page.evaluate(() => navigator.clipboard.readText()).catch(() => '') === LINK, 'the link is on the clipboard');
  say(await page.locator('#istep-later').innerText() === 'Done', 'the quiet button now reads Done');
  await page.close();
  await browser.close();
  console.log(fails.length ? 'FAILED: ' + fails.length : 'ALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
