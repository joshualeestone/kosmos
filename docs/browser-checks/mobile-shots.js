'use strict';
/* #718: phone screenshots of the board, for everyone working on the mobile apps.
 *
 * Both native apps are shells around the board's web UI, so "does it fit on a
 * phone" is a question about web/index.html at phone sizes. This boots a
 * THROWAWAY board with seeded sample data, drives it to named screens, and
 * shoots every screen at four phone sizes by default, in light and dark, in
 * Chromium and WebKit. --sizes replaces that list and also accepts `desktop`
 * (1280x800). It flags horizontal overflow on the way.
 *
 *   NODE_PATH=$HOME/work/pw-runtime/node_modules \
 *     node docs/browser-checks/mobile-shots.js [--out DIR] [--screens a,b]
 *       [--sizes se,iphone15,promax,android,desktop] [--themes light,dark]
 *       [--engines chromium,webkit] [--strict] [--list] [--keep]
 *       [--data sample|store] [--scale css|device]
 *
 * Output: DIR/<screen>--<size>--<theme>--<engine>.png plus DIR/report.md (every
 * shot, and every overflow found). Default DIR is a new temp folder, printed at
 * the end. --strict exits 1 when anything overflows. --list prints the screens.
 * --keep leaves the throwaway board running afterwards (address printed) so you
 * can explore it by hand; Ctrl-C stops it and deletes its data.
 * --data store seeds a clean fleet for App Store and Play screenshots instead
 * of the stress-test sample (no stopped agent, no overlong names, no code
 * block); --scale device saves at the device's pixels, not CSS pixels. The
 * App Store size is `appstore` (440x956 at 3x, which is 1320x2868): it is not in
 * the default sweep. ios/store/shoot.sh is the one command for the iOS set.
 *
 * 🛑 NEVER THE LIVE BOARD, AND NEVER THIS MAC'S ACCOUNTS. The board below is
 * started here, on a free port, with every data root in a temp dir and a fake
 * tmux. Its HOME and every home/config root the engine reads are temp dirs too:
 * the accounts modules read `AGENT_WORKFORCE_HOME || os.homedir()`, so a board
 * sandboxed on data roots alone still lists this Mac's real Claude emails and an
 * OpenAI key suffix in Settings (found and measured by Sonya, #718). Before every
 * screenshot a LEAK GUARD reads the page and stops the whole run, writing nothing
 * more, if it finds an email the board injected (not example.com / .org / .net, and
 * not one that ships in web/index.html), an API key (sk-, AIza, xai-), or this Mac's
 * home path, user name or host name (exit 3). The report is checked the same way. Screenshots end up on
 * GitHub; a real account must not. THIS IS THE ONLY SANCTIONED WAY TO TAKE
 * SCREENSHOTS FOR A PR OR #718: other checks here do not set these roots.
 *
 * ⚠️ WEBKIT IS NOT SAFARI. Playwright's WebKit is an engine approximation of
 * iOS Safari / WKWebView, not the real thing (no iOS simulator on this Mac yet),
 * and Chromium with a phone viewport is not an Android phone. Say so in reports.
 *
 * ADDING YOUR SCREENS: append to SCREENS below. Each entry is
 *   { name, owner, go: async (page, data) => { ...navigate to the screen... } }
 * plus `noServiceWorker: true` if `go` stubs a request with page.route, and
 * `phoneOnly: true` if the screen exists only at a phone width (the desktop size skips it), and
 * `desktopOnly: true` if it exists only at a desktop width (the phone sizes skip it; the consolidated
 * view, for one, starts at 960px).
 * One board serves every screen of a run, so a `go` that writes to the board's server store (a PUT, a
 * saved setting) must undo it in `after` (settings-recommender does, #4545), or it changes every screen
 * shot after it; the consolidated screens stub the READ instead (kosmos#4594).
 * `after: async (page, data) => {}` runs after the shot, whatever happened, to put back what `go` changed.
 * `verify: async (page, data) => {}` runs right after the shot to check it is the screen meant: a throw
 * DELETES the shot and makes the row an ERROR (consAgentsStill), so a wrong picture never reaches a review.
 * `go` starts on a freshly loaded board at the size and theme (data has
 * `projectId`, and `chatAgent` / `askAgent`: use those, never a literal agent id,
 * so the screen works under --data store too); leave the page showing the screen. Keep names short and unique
 * (they are file names). Sample data: 5 agents (working, idle, needs you,
 * stopped; one very long name and task), Ada's DM with a long reply and a code
 * block, a project room with posts and reactions, Cleo's pending ask. The
 * allow-card screen stubs one phone asking to connect (see it below).
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts (the board below also gets its own roots)
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..', '..');

/* The four phone sizes from the #718 plan, the App Store size, and a desktop size. `dpr` is the
   device's pixel ratio; by default shots are saved at CSS pixels so files stay
   small and every size compares one to one (--scale device for store images). */
const SIZES = {
  se: { width: 375, height: 667, dpr: 2, label: 'iPhone SE' },
  iphone15: { width: 393, height: 852, dpr: 3, label: 'iPhone 15' },
  promax: { width: 430, height: 932, dpr: 3, label: 'iPhone Pro Max' },
  android: { width: 412, height: 915, dpr: 2.625, label: 'mid Android' },
  // The 6.9-inch iPhone screenshot App Store Connect requires: 1320x2868 at --scale device.
  appstore: { width: 440, height: 956, dpr: 3, label: 'App Store 6.9-inch' },
  // claude-setup#100 (/design-shots): a computer screen, so one sanctioned run shoots a change at
  // desktop and phone. No touch and no mobile viewport, and the tap and field-font audits (phone
  // rules) are skipped for it. Not in the default sweep.
  desktop: { width: 1280, height: 800, dpr: 1, label: 'desktop', desktop: true },
};
const DEFAULT_SIZES = ['se', 'iphone15', 'promax', 'android'];
const THEMES = ['light', 'dark'];
const ENGINES = ['chromium', 'webkit'];

/* Containers whose own horizontal overflow is flagged, besides the page itself.
   Missing selectors are skipped. Extend this list for your screen's scroller. */
const OVERFLOW_SELECTORS = ['html', 'body', 'main', '.view', '.panel', '[role="main"]'];

/* ------------------------------------------------------------------ screens */
/* The shared helpers the screens use. */
/* On a phone the areas sit behind the ☰ (#burger, controls #tabs): open it
   first when it is showing, then choose the area. */
async function openTab(page, tab) {
  if (await page.isVisible('#burger')) {
    await page.click('#burger');
    await page.waitForSelector(`[data-tab="${tab}"]`, { state: 'visible', timeout: 5000 });
  }
  await page.click(`[data-tab="${tab}"]`);
  // Arrived, or the shot fails: a click that stops switching must not photograph the last screen.
  await page.waitForSelector(`#panel-${tab}`, { state: 'visible', timeout: 5000 });
}

/* Deep links (web/index.html's ?tab / ?agent / ?project routing) reach a
   screen without depending on phone navigation; the frame shots use the ☰. */
/* 'load', not 'networkidle': some screens hold a connection open (live
   updates), so the network never goes idle there. */
const at = async (page, qs) => {
  await page.goto(page.url().split('?')[0] + qs, { waitUntil: 'load' });
  await page.waitForTimeout(900);
};
/* #4470: the new look, as the hidden switch (Settings > Advanced > Try the new look) turns it on: the page reads
   localStorage 'kosmos-look' before paint. Set it, reload, and wait for the attribute the new look keys on. */
const newLook = async (page) => {
  await page.evaluate(() => localStorage.setItem('kosmos-look', 'new'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-look') === 'new', null, { timeout: 8000 });
  if (await page.$('#firstrun:not([hidden])')) await page.keyboard.press('Escape');   // as the render check does after a reload
  await page.waitForTimeout(900);
};

/* #4594: the consolidated view without writing it. The page reads its layout from GET /api/style (paintStyles, also
   on later polls), so a page-only applyLayout was undone mid-shot; saving it with PUT /api/style would change the
   one board every later screen of this run is shot on. So the READ is stubbed in this screen's own context (gone
   with it) to say consolidated, and the page reloads. Screens that call this set noServiceWorker. */
async function openConsAgents(page) {
  await page.route('**/api/style', async (r) => {
    if (r.request().method() !== 'GET') return r.continue();
    let resp;
    try { resp = await r.fetch(); } catch { return r.continue(); }   // never leave the request hanging
    const j = await resp.json().catch(() => null);
    if (!j) return r.fulfill({ response: resp });
    return r.fulfill({ response: resp, json: { ...j, layout: 'consolidated' } });
  });
  await page.reload({ waitUntil: 'load' });   // 'load', per this file's rule; the next line is the real readiness signal
  await page.waitForFunction(() => document.documentElement.getAttribute('data-layout') === 'consolidated', null, { timeout: 8000 });
  /* The board's own boot can activate a project AFTER this opens Agents, which closes the Agents view
     (iteration 7: shots of a project passed). So open it, then require it to STAY open for a while,
     opening it again if the board took it back. */
  const shown = () => page.evaluate(() => {
    const p = document.getElementById('panel-cons-agents'); const sw = document.querySelector('#panel-cons-agents .cons-agents-lay');
    return !!(p && !p.hidden && p.getClientRects().length && sw && sw.getClientRects().length);
  });
  if (await page.isVisible('#firstrun')) await page.keyboard.press('Escape');   // the reload can bring it back
  // Stable = open on 4 samples in a row, 250 ms apart: a signal, not a fixed sleep.
  const stable = async () => { for (let i = 0; i < 4; i++) { if (!(await shown())) return false; await page.waitForTimeout(250); } return true; };
  let last = null;
  for (let tries = 0; tries < 6; tries++) {
    try {
      await page.click('#tabs .tab[data-tab="agents"]', { timeout: 5000 });
      await page.waitForSelector('#panel-cons-agents .cons-agents-lay', { state: 'visible', timeout: 5000 });
    } catch (e) { last = e; continue; }   // taken back before it showed (or never there): try again
    if (await stable()) return;
  }
  throw new Error('cons-agents: the Agents view did not stay open' + (last ? ' (last: ' + String(last.message || last).split('\n')[0] + ')' : ''));
}
/* A SCREENS `verify` hook, run right after the shot: the Agents view and its switch must still be on screen with
   the expected segment chosen, or the shot is deleted and the row is an ERROR, never a picture of something else. */
const consAgentsStill = (want) => async (page) => {
  const got = await page.evaluate(() => {
    const p = document.getElementById('panel-cons-agents'); const sw = document.querySelector('#panel-cons-agents .cons-agents-lay');
    const r = sw ? sw.getBoundingClientRect() : null;
    const on = sw ? sw.querySelector('[aria-checked="true"]') : null;
    return { panel: !!(p && !p.hidden && p.getClientRects().length), inView: !!(r && r.width && r.bottom > 0 && r.top < innerHeight), on: on ? on.dataset.conslay : null };
  });
  if (!got.panel || !got.inView || got.on !== want) throw new Error('the shot is not the Agents view with ' + want + ' chosen: ' + JSON.stringify(got));
};

/* #4637: two waiting requests for the connect screens, and an Allow that answers. */
async function connectPending(page) {
  let devices = [
    { device_id: 'd-sample-pc', name: 'windowsbox', code: '482 915', first_seen: Math.floor(Date.now() / 1000) - 30, denied_at: 0, joining_computer: 'windowsbox' },
    { device_id: 'd-sample-ph', name: 'iPhone', code: 'K7-4M', first_seen: Math.floor(Date.now() / 1000) - 90, denied_at: 0, joining_computer: null }];
  await page.route('**/api/remote/pending', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'owner@example.com', snapshot: true, devices }) }));
  await page.route('**/api/remote/devices/allow', (r) => { devices = devices.filter((d) => d.device_id !== 'd-sample-pc'); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
}
/* #4794: the computer WAITING to be allowed (Settings > Kosmos+), with the pairing code worked out. */
async function joinWaiting(page) {
  const remote = { configured: true, on: true, ok: true, enrolled: true, email: 'owner@example.com', status: { state: 'waiting-allow', because: 'waiting for one of your computers to allow this one' } };
  await page.route('**/api/remote', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r.request().method() === 'GET' ? remote : { ok: true }) }));
  /* The devices list reads its own answer; unfaked, the throwaway board says on:false and the shot showed "Plus is off"
     beside a switch that is on. A computer waiting to be allowed has its switch on and no devices yet. */
  await page.route('**/api/remote/devices', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pending: [], allowed: [], email: 'owner@example.com', on: true }) }));
  await page.route('**/api/remote/join', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ supported: true, held: true, join_code: '482 915', on: 'homemac', asked_of: ['homemac'], failed: false, confirmed: false, confirm_expired: false }) }));
}
const SCREENS = [
  // Raiden: the app frame on a phone (top bar, navigation, agents list, home).
  { name: 'home', owner: 'Raiden', go: async () => {} },
  /* #5018: the login-expiry notice floating over the page under the header, with its account line, the agents'
     given names and its X. The advisory is stubbed onto this screen's own /api/status reads (gone with it). */
  { name: 'login-notice', owner: 'Angel', noServiceWorker: true, go: async (page) => {
    const adv = [{ agents: ['roo-lane', 'pixel-moss', 'cleo-park'], names: ['Roo', 'Pixel', 'Cleo'], provider: 'Claude', service: 'Claude Code-credentials',
      email: 'owner@example.com', daysLeft: 5, severity: 'notice', expired: false }];
    await page.route('**/api/status', async (route) => {
      let res, data;
      try { res = await route.fetch(); data = await res.json(); } catch { await route.abort().catch(() => {}); return; }
      data.loginAdvisories = adv;
      await route.fulfill({ response: res, body: JSON.stringify(data), headers: { ...res.headers(), 'content-type': 'application/json' } });
    });
    await at(page, '');
    await page.waitForSelector('#login-adv-slot .login-adv', { state: 'visible', timeout: 12000 });
  } },
  /* Both assert they got there: a renamed control must fail the shot, not
     quietly photograph the home screen again. */
  // phoneOnly: the menu button (#burger) exists only at phone widths, so the desktop size skips it.
  { name: 'nav-menu', owner: 'Raiden', phoneOnly: true, go: async (page) => {
    await page.click('#burger');
    await page.waitForSelector('#burger[aria-expanded="true"]', { timeout: 5000 });
  } },
  // #4470: the new look (the hidden switch), on the Agents page as a grid and as a list, and on the project room.
  { name: 'nl-home', owner: 'Mona Lisa', go: async (page) => { await newLook(page); } },
  { name: 'nl-agents-list', owner: 'Mona Lisa', go: async (page) => {
    await newLook(page);
    await page.click('button.vt[data-layout="list"][aria-label="Show agents as a list"]');
    await page.waitForSelector('button.vt[data-layout="list"][aria-pressed="true"][aria-label="Show agents as a list"]', { timeout: 5000 });
  } },
  { name: 'nl-project-room', owner: 'Mona Lisa', go: async (page, data) => {
    await newLook(page);
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.waitForSelector('#pj-one-view', { state: 'visible', timeout: 8000 });
  } },
  { name: 'agents-list', owner: 'Raiden', go: async (page) => {
    await page.click('button.vt[data-layout="list"][aria-label="Show agents as a list"]');
    await page.waitForSelector('button.vt[data-layout="list"][aria-pressed="true"][aria-label="Show agents as a list"]', { timeout: 5000 });
  } },
  { name: 'agent-page', owner: 'Raiden', go: async (page, data) => {
    await at(page, '?agent=' + data.chatAgent);
    await page.waitForSelector('#panel-detail', { state: 'visible', timeout: 5000 });
  } },
  // Scorpion: an agent's chat.
  { name: 'agent-chat', owner: 'Scorpion', go: async (page, data) => {
    await at(page, '?agent=' + data.chatAgent);
    await page.locator('#d-nav button[data-go="talk"]').first().click({ timeout: 5000 });
    await page.waitForSelector('#d-sec-talk', { state: 'visible', timeout: 5000 });
  } },
  // Kano: projects, a room, and the waiting-on-you ask.
  { name: 'projects', owner: 'Kano', go: async (page) => openTab(page, 'projects') },
  { name: 'project-room', owner: 'Kano', go: async (page, data) => {
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.waitForSelector('#pj-one-view', { state: 'visible', timeout: 8000 });
    await page.evaluate(() => { const r = document.querySelector('#pj-room'); if (r) r.scrollIntoView({ block: 'start' }); });
  } },
  { name: 'ask-waiting', owner: 'Kano', go: async (page, data) => {
    // The board re-renders cards on its tick, so scroll inside the page.
    await page.waitForSelector(`.acard[data-agent="${data.askAgent}"]`, { timeout: 5000 });
    await page.evaluate((a) => document.querySelector(`.acard[data-agent="${a}"]`).scrollIntoView({ block: 'start' }), data.askAgent);
  } },
  /* Where a push tap lands: the needs-you agent's page, shot once it has
     settled (the conversation scrolls to the top after load). */
  { name: 'push-landing', owner: 'Kano', go: async (page, data) => {
    await at(page, '?tab=detail&agent=' + data.askAgent);
    await page.waitForSelector('#panel-detail', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(1600);
  } },
  /* The Allow card (#askcard): one phone asking to connect. The throwaway
     board has Plus off and no tunnel, so /api/remote/pending is always empty;
     turning Plus on for real would start the tunnel. Instead the answer is
     stubbed IN THIS PAGE ONLY, in server.js's shape, and the page's own poll
     paints it. The email is example.com so the leak guard still judges it.
     ⚠️ noServiceWorker: the board's sw.js claims the page, and in WebKit a
     page.route never sees a controlled page's fetches (measured: the stub was
     never hit and the card stayed hidden), so this screen's context blocks it.
     #4524: since #3829's addendum the full card, with Allow, renders only on Settings > Kosmos Plus; every other view
     shows one compact line linking there. So this screen opens that view. Plus is off on the throwaway board (no
     connected panel), so the full card is the top card there; with a connected panel it sits above the panel
     (#plus-asks). The wait accepts either, and fails unless an Allow button is rendered visible and is itself what sits
     at its own centre point (below). */
  { name: 'allow-card', owner: 'Kano', noServiceWorker: true, go: async (page) => {
    /* #4568: a device's match code is always two symbols, a dash, two symbols (kosmos-relay's match_code, e.g. K7-3M).
       This stub said '482 913', a sign-in code's shape, and its seven boxes ran past the card (every phone size in the
       #4561 shots; 24px at se, measured by the check below).
       MSHOTS_COVER_CONTROL=spill plants a code that cannot fit, so the fit check below can be seen to fail. Since
       #4637 the code is one large line that wraps at a space, so '482 913' (the old control) fits and stopped firing
       (#4893); this one has no break point and is wider than the card at every phone size. */
    const code = COVER_CONTROL === 'spill' ? 'K7M3K7M3K7M3K7M3K7M3' : 'K7-3M';
    const pending = { email: 'owner@example.com', snapshot: true, devices: [
      { device_id: 'd-sample-0001', name: 'iPhone', code, first_seen: Math.floor(Date.now() / 1000) - 40, denied_at: 0 }] };
    await page.route('**/api/remote/pending', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pending) }));
    await at(page, '?tab=settings&sec=plus');
    const allow = '#askcard:not([hidden]) [data-ask="allow"], #plus-asks:not([hidden]) [data-ask="allow"]';
    await page.waitForSelector(allow, { state: 'visible', timeout: 8000 });
    // MSHOTS_COVER_CONTROL=overlay: a planted full-page layer, so the check below can be seen to fail.
    if (COVER_CONTROL === 'overlay') {
      await page.evaluate(() => { const d = document.createElement('div'); d.id = 'cover-control';
        d.style.cssText = 'position:fixed;inset:0;z-index:2147483647'; document.body.appendChild(d); });
    }
    /* Visible is not seen (#4524: the Community notice covered the whole card and this wait passed). The
       point at the first laid-out Allow button's centre must be that button (or inside it), so anything drawn
       over it, or the button being outside the viewport, fails the shot. Polled for up to 3 s, so a repaint
       between two reads is not a red. */
    const whatIsAt = (sel) => {
      const b = [...document.querySelectorAll(sel)].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      if (!b) return 'gone (no Allow button is laid out)';
      const r = b.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return 'outside the viewport (its centre is at ' + Math.round(x) + ',' + Math.round(y) + ')';
      const top = document.elementFromPoint(x, y);
      if (top && b.contains(top)) return '';
      const named = top && (top.id ? top : top.closest('[id]'));   // the nearest element with an id names the layer
      return 'covered by ' + (named ? named.tagName.toLowerCase() + '#' + named.id : top ? top.tagName.toLowerCase() : 'nothing readable');
    };
    let hit = await page.evaluate(whatIsAt, allow);
    for (const until = Date.now() + 3000; hit && Date.now() < until; hit = await page.evaluate(whatIsAt, allow)) {
      await page.waitForTimeout(200);
    }
    if (hit) throw new Error('the Allow button is not seen: ' + hit);
    /* #4568: every laid-out request card's (.askreq) code boxes must sit inside that card's padding. The page-level
       overflow audit cannot see this: the row runs past the card, not past the page. */
    const fits = (sel) => {
      const laidOut = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
      const cards = [...new Set([...document.querySelectorAll(sel)].filter(laidOut).map((b) => b.closest('.askreq')))];
      if (!cards.length || cards.includes(null)) return 'no .askreq card around a laid-out Allow button';
      for (const card of cards) {
        const cs = getComputedStyle(card), r = card.getBoundingClientRect();
        const left = r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
        const right = r.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
        const cells = [...card.querySelectorAll('.askcodebig')];   // #4637: one large code line, was a box per character
        if (!cells.length) return 'no code in a request card';   // the stub's request always has a code
        const over = cells.map((c) => { const b = c.getBoundingClientRect(); return Math.max(b.right - right, left - b.left); });
        const out = over.filter((d) => d > 0.5);
        if (out.length) return out.length + ' of ' + cells.length + ' codes leave the card, the farthest by ' + Math.round(Math.max(...out)) + 'px';
      }
      return '';
    };
    // Polled for up to 3 s, like the hit-test.
    let spill = await page.evaluate(fits, allow);
    for (const until = Date.now() + 3000; spill && Date.now() < until; spill = await page.evaluate(fits, allow)) {
      await page.waitForTimeout(200);
    }
    if (spill) throw new Error('the code does not fit its card: ' + spill);
  } },
  /* #4637: the "wants to connect" sheet (Mona Lisa's flow outline, #4754). Two requests: another of the person's
     computers joining (#4773's joining_computer) and a phone. connect-connected is after Allow on the computer;
     connect-notice is the strip on another page. Each asserts its words, so a wrong screen fails the shot. */
  { name: 'connect-sheet', owner: 'PigeonPete', noServiceWorker: true, go: async (page) => { await connectPending(page); await at(page, '?tab=settings&sec=plus');
    await page.waitForFunction(() => /Your computer "windowsbox" wants to join/.test((document.getElementById('plus-ask-rows') || {}).innerText || ''), null, { timeout: 8000 });
  } },
  /* #4794: a joining computer whose code is not worked out yet: the quiet line in the code's place, Allow disabled. */
  { name: 'connect-wait', owner: 'PigeonPete', noServiceWorker: true, go: async (page) => {
    await page.route('**/api/remote/pending', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'owner@example.com', snapshot: true,
      devices: [{ device_id: 'd-sample-wait', name: 'laptop', code: '', first_seen: Math.floor(Date.now() / 1000) - 20, denied_at: 0, joining_computer: 'laptop', code_wait: null }] }) }));
    await at(page, '?tab=settings&sec=plus');
    await page.waitForFunction(() => /Working out the code with laptop/.test((document.getElementById('plus-ask-rows') || {}).innerText || ''), null, { timeout: 8000 });
  } },
  /* #4794: the computer waiting to be allowed shows the same code and "The codes match". */
  { name: 'plus-join', owner: 'PigeonPete', noServiceWorker: true, go: async (page) => { await joinWaiting(page); await at(page, '?tab=settings&sec=plus');
    await page.waitForFunction(() => /Check that homemac shows this same code/.test((document.getElementById('plus-join') || {}).innerText || ''), null, { timeout: 10000 });
  } },
  { name: 'connect-connected', owner: 'PigeonPete', noServiceWorker: true, go: async (page) => { await connectPending(page); await at(page, '?tab=settings&sec=plus');
    await page.waitForSelector('#plus-ask-rows [data-ask="allow"][data-id="d-sample-pc"]', { state: 'visible', timeout: 8000 });
    await page.click('#plus-ask-rows [data-ask="allow"][data-id="d-sample-pc"]');
    await page.waitForFunction(() => /windowsbox is connected\./.test((document.getElementById('plus-ask-rows') || {}).innerText || ''), null, { timeout: 8000 });
  } },
  { name: 'connect-notice', owner: 'PigeonPete', noServiceWorker: true, go: async (page) => { await connectPending(page); await at(page, '');
    await page.evaluate(() => { if (typeof pollAsk === 'function') return pollAsk(); });
    await page.waitForFunction(() => /want to connect to your Kosmos/.test((document.getElementById('askcard') || {}).innerText || ''), null, { timeout: 8000 });
  } },
  // Sonya: settings.
  { name: 'settings', owner: 'Sonya', go: async (page) => {
    await at(page, '?tab=settings');
    await page.waitForSelector('#panel-settings', { state: 'visible', timeout: 5000 });
  } },
  /* #5206: Settings > Advanced, where every row is an on/off switch whose 44px target is a ::after past its 42x24
     box: the tap audit must count it as the finger reaches it. */
  { name: 'settings-advanced', owner: 'Mona Lisa', go: async (page) => {
    await at(page, '?tab=settings&sec=advanced');
    await page.waitForSelector('#look-toggle', { state: 'visible', timeout: 8000 });
  } },
  { name: 'settings-accounts', owner: 'Sonya', go: async (page) => {
    await at(page, '?tab=settings&sec=accounts');
    await page.waitForSelector('#s-sec-accounts', { state: 'visible', timeout: 5000 });
  } },
  /* #4545: Settings > Automation with the Recommender ON, so its guards list shows, scrolled to
     that box. Turning it on is stored on this run's throwaway board (so asking twice is fine).
     This board runs server.js's real start, which arms live execution, so the Recommender's
     sweep would act on the seeded agents while it is on: `after` turns it off once the shot is
     taken, before any other screen. */
  { name: 'settings-recommender', owner: 'Mona Lisa', go: async (page) => {
    const put = await page.request.put(page.url().split('?')[0].replace(/\/$/, '') + '/api/recommender-setting',
      { data: { on: true }, headers: { 'sec-fetch-site': 'same-origin' } });
    if (put.status() !== 200) throw new Error('settings-recommender: could not turn the Recommender on (' + put.status() + ')');
    await at(page, '?tab=settings&sec=automation');
    await page.waitForSelector('#rec-guards-row', { state: 'visible', timeout: 5000 });
    await page.evaluate(() => document.getElementById('rec-guards-row').closest('.dbox').scrollIntoView({ block: 'center' }));
    await page.mouse.move(1, 1);
    await page.waitForTimeout(300);
  }, after: async (page) => {
    const put = await page.request.put(page.url().split('?')[0].replace(/\/$/, '') + '/api/recommender-setting',
      { data: { on: false }, headers: { 'sec-fetch-site': 'same-origin' } });
    if (put.status() !== 200) throw new Error('settings-recommender: could not turn the Recommender back off (' + put.status() + ')');
  } },
  /* The #718 phone-ready sweep's remaining screens (Raiden, 2026-09-25). Each
     asserts it arrived, for the same reason as the frame shots above. */
  { name: 'org-chart', owner: 'unowned', go: async (page) => {
    await page.click('button.vt[data-layout="org"]');
    await page.waitForSelector('button.vt[data-layout="org"][aria-pressed="true"]', { timeout: 5000 });
  } },
  /* #4594: the consolidated view's Agents column and its Grid / Org chart segmented control. The
     consolidated view exists only at >= 960px, so these are desktop-only. */
  { name: 'cons-agents', owner: 'Ice Cream Kitty', desktopOnly: true, noServiceWorker: true, go: async (page) => {
    await openConsAgents(page);
    await page.waitForSelector('#panel-cons-agents .cons-agents-lay [data-conslay="grid"][aria-checked="true"]', { timeout: 5000 });
  }, verify: consAgentsStill('grid') },
  { name: 'cons-agents-org', owner: 'Ice Cream Kitty', desktopOnly: true, noServiceWorker: true, go: async (page) => {
    await openConsAgents(page);
    await page.click('#panel-cons-agents [data-conslay="org"]', { timeout: 5000 });
    await page.waitForSelector('#panel-cons-agents [data-conslay="org"][aria-checked="true"]', { timeout: 5000 });
  }, verify: consAgentsStill('org') },
  // The design review's ask (kosmos#4594): the keyboard focus ring on a segment. A real key press, so :focus-visible shows (a scripted
  // .focus() alone may not): focus Grid, ArrowRight moves to Org chart, chooses it and keeps focus there.
  { name: 'cons-agents-focus', owner: 'Ice Cream Kitty', desktopOnly: true, noServiceWorker: true, go: async (page) => {
    await openConsAgents(page);
    await page.focus('#panel-cons-agents [data-conslay="grid"]');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.activeElement && document.activeElement.dataset.conslay === 'org'
      && document.activeElement.matches(':focus-visible'), null, { timeout: 5000 });
  }, verify: async (page) => {
    await consAgentsStill('org')(page);
    const focused = await page.evaluate(() => !!document.activeElement && document.activeElement.dataset.conslay === 'org'
      && document.activeElement.matches(':focus-visible'));
    if (!focused) throw new Error('the focus shot lost its focus ring (Org chart is not focused-visible)');
  } },
  { name: 'create-agent', owner: 'unowned', go: async (page) => {
    // A real tap (visible, not covered), the way a phone user reaches it; a hidden button fails the shot.
    await page.click('#new-agent', { timeout: 5000 });
    await page.waitForSelector('#panel-create', { state: 'visible', timeout: 5000 });
  } },
  // #4556: New Agent's second screens, each reached by a real tap on its card from the first screen.
  { name: 'create-single', owner: 'Angel', go: async (page) => {
    await page.click('#new-agent', { timeout: 5000 });
    await page.click('#cstep-kind [data-path="single"]', { timeout: 5000 });
    await page.waitForSelector('#cstep-role', { state: 'visible', timeout: 5000 });
  } },
  /* #4470: Create an agent in the new look, for the side by side with 'create-single'. */
  { name: 'nl-create-single', owner: 'Mona Lisa', go: async (page) => {
    await newLook(page);
    await page.click('#new-agent', { timeout: 5000 });
    await page.click('#cstep-kind [data-path="single"]', { timeout: 5000 });
    await page.waitForSelector('#cstep-role', { state: 'visible', timeout: 5000 });
  } },
  { name: 'create-team', owner: 'Angel', go: async (page) => {
    await page.click('#new-agent', { timeout: 5000 });
    await page.click('#cstep-kind [data-path="team"]', { timeout: 5000 });
    await page.waitForSelector('#cstep-team', { state: 'visible', timeout: 5000 });
  } },
  /* #4470: Create a Team in the new look, for the side by side with 'create-team'. */
  { name: 'nl-create-team', owner: 'Mona Lisa', go: async (page) => {
    await newLook(page);
    await page.click('#new-agent', { timeout: 5000 });
    await page.click('#cstep-kind [data-path="team"]', { timeout: 5000 });
    await page.waitForSelector('#cstep-team', { state: 'visible', timeout: 5000 });
  } },
  { name: 'create-swarm', owner: 'Angel', go: async (page) => {
    // Shown only when the board can run swarms; a board that cannot fails this shot (the card is hidden).
    await page.click('#new-agent', { timeout: 5000 });
    await page.click('#cstep-kind [data-path="swarm"]', { timeout: 5000 });
    await page.waitForSelector('#cstep-role', { state: 'visible', timeout: 5000 });
  } },
  { name: 'first-run', owner: 'unowned', go: async (page) => {
    await at(page, '?first-run=1');
    await page.waitForSelector('#firstrun', { state: 'visible', timeout: 5000 });
  } },
  { name: 'agent-files', owner: 'unowned', go: async (page, data) => {
    await at(page, '?tab=detail&agent=' + data.chatAgent);
    /* On a phone the agent page opens on its conversation, which hides this short Files list
       by design (it shows under Profile and the other sections), so step into Profile first. */
    await page.locator('#d-nav button[data-go="profile"]').first().click({ timeout: 5000 });
    await page.waitForSelector('#d-files-list .pj-doc', { state: 'visible', timeout: 8000 });
    await page.evaluate(() => document.getElementById('d-files').scrollIntoView({ block: 'start' }));
  } },
  { name: 'agent-files-all', owner: 'unowned', go: async (page, data) => {
    await at(page, '?tab=detail&agent=' + data.chatAgent);
    // View All sits under the same short list, so the same step into Profile.
    await page.locator('#d-nav button[data-go="profile"]').first().click({ timeout: 5000 });
    await page.waitForSelector('#d-files-all', { state: 'visible', timeout: 8000 });
    await page.click('#d-files-all');
    await page.waitForSelector('#d-filesall-list .pj-doc', { state: 'visible', timeout: 5000 });
  } },
  { name: 'agent-profile', owner: 'unowned', go: async (page, data) => {
    await at(page, '?tab=detail&agent=' + data.chatAgent);
    await page.locator('#d-nav button[data-go="profile"]').first().click({ timeout: 5000 });
    await page.waitForSelector('#d-sec-profile', { state: 'visible', timeout: 5000 });
  } },
  /* #5153 slice 3: Profile's Recent work. Only this page's read of the agent's receipts is faked (the throwaway board
     has no transcripts); nothing on the board changes. Task names and numbers are invented. */
  { name: 'agent-recent-work', owner: 'Angel', noServiceWorker: true, go: async (page, data) => {
    const b = (i, o, cw, cr) => ({ input_tokens: i, output_tokens: o, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, rows: 20 });
    const day = (d) => new Date(Date.now() - d * 86400e3).toISOString();
    const mine = (files, commands, models) => ({ who: data.chatAgent, provider: 'claude', available: true, transcriptsWithWork: 1, files, filesMore: 0, commands, models });
    const receipts = [
      { project: data.projectId, projectName: 'Launch the spring catalogue', number: 1, sentence: 'Draft the product copy for every page', closedAt: day(0.2),
        receipt: mine(['copy/home.md', 'copy/linen.md', 'copy/checkout.md'], 14, { 'claude-fable-5': b(48210, 21877, 310224, 4180552) }) },
      { project: data.projectId, projectName: 'Launch the spring catalogue', number: 2, sentence: 'Check the prices against the spreadsheet', closedAt: day(1),
        receipt: mine(['prices/spring.csv'], 3, { 'claude-fable-5': b(9120, 2210, 40500, 610000) }) },
      { project: data.projectId, projectName: 'Launch the spring catalogue', number: 3, sentence: 'Book the photographer', closedAt: day(3),
        receipt: { who: data.chatAgent, provider: 'claude', available: true, transcriptsWithWork: 0, files: [], commands: 0, models: {} } },
    ];
    await page.route('**/api/agent/*/receipts**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, receipts, more: true }) }));
    await at(page, '?tab=detail&agent=' + data.chatAgent);
    await page.locator('#d-nav button[data-go="profile"]').first().click({ timeout: 5000 });
    /* The Tasks tab, as a board past its threshold has it (the sample board has three tasks): "Open the Tasks page"
       shows only while that tab is in the bar, read when Recent work is drawn, so it is drawn again after. */
    await page.evaluate(() => { tskTabGate(true); return paintAgentWork(CURRENT.sessionName); });
    await page.waitForSelector('#d-work-more:not([hidden])', { state: 'visible', timeout: 8000 });
    await page.evaluate(() => document.getElementById('d-work').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
  }, verify: async (page) => {
    /* Compared without case: innerText follows text-transform, and the heading is an uppercase kicker. */
    const t = (await page.evaluate(() => document.getElementById('d-work').innerText)).toLowerCase();
    for (const want of ['Recent work', '3 files · 14 commands', 'at API prices', 'no activity found', 'Open the Tasks page']) {
      if (!t.includes(want.toLowerCase())) throw new Error('Recent work does not say "' + want + '": ' + JSON.stringify(t.slice(0, 400)));
    }
  } },
  { name: 'agent-instructions', owner: 'unowned', go: async (page, data) => {
    await at(page, '?tab=detail&agent=' + data.chatAgent);
    await page.locator('#d-nav button[data-go="profile"]').first().click({ timeout: 5000 });
    await page.waitForSelector('#d-sec-instr', { state: 'visible', timeout: 5000 });
    // #4550: Instructions is inside Profile now, below the profile block; the shot is of it.
    await page.evaluate(() => document.getElementById('d-sec-instr').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(200);
  } },
  // #4550: AI Settings (Runs on, Memory and Fresh start, the terminal, Remove).
  { name: 'agent-ai-settings', owner: 'Mona Lisa', go: async (page, data) => {
    await at(page, '?tab=detail&agent=' + data.chatAgent);
    await page.locator('#d-nav button[data-go="model"]').first().click({ timeout: 5000 });
    await page.waitForSelector('#d-sec-term', { state: 'visible', timeout: 5000 });
    await page.mouse.move(1, 1);
  } },
  // Tasks is Mona Lisa and April's lane: shot and reported on #3559, not fixed here.
  { name: 'tasks', owner: 'Mona Lisa / April', go: async (page) => {
    await at(page, '?tab=tasks');
    await page.waitForSelector('#panel-tasks', { state: 'visible', timeout: 5000 });
  } },
  /* #5053: one project's Tasks view, with its back chevron beside the title. The built-in seed's project name is long
     enough to wrap on a phone, so the shot shows the title wrapping beside the chevron (a store data set's may not). */
  { name: 'project-tasks', owner: 'PigeonPete', go: async (page, data) => {
    await at(page, '?tab=tasks');
    await page.waitForSelector('#panel-tasks', { state: 'visible', timeout: 5000 });
    await page.evaluate((id) => openProjectTasks(id), data.projectId);
    await page.waitForSelector('#tsk-back:not([hidden])', { state: 'visible', timeout: 5000 });
  } },
  /* #5200: one open task's page (the seed's task 1), with its parts' Change who and Done links, for the phone tap
     audit: every control there should be a 44px target on a touch screen. */
  { name: 'task-page', owner: 'Mona Lisa', go: async (page, data) => {
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.waitForSelector('#pj-one-view', { state: 'visible', timeout: 8000 });
    await page.evaluate(async () => { await pjReload(); openTaskPage(1); });
    await page.waitForSelector('#pj-task-view:not([hidden]) #tk-say', { state: 'visible', timeout: 8000 });
  } },
  /* kosmos#4787 slice 1b: the task page's Repeats control with a rule set (every Tuesday at 10:30am), scrolled to it. */
  { name: 'task-repeat', owner: 'Mona Lisa', go: async (page, data) => {
    const st = await page.evaluate((id) => fetch('/api/project/' + encodeURIComponent(id) + '/task/1/repeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ every: 'week', on: 'tue', at: '10:30' }) }).then((r) => r.status), data.projectId);
    if (st !== 200) throw new Error('could not set the repeat rule (' + st + ')');
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.waitForSelector('#pj-one-view', { state: 'visible', timeout: 8000 });
    await page.evaluate(async () => { await pjReload(); openTaskPage(1); });
    await page.waitForSelector('#tk-repeat-line:not([hidden])', { timeout: 8000 });
    await page.evaluate(() => document.getElementById('tk-repeat-row').scrollIntoView({ block: 'center' }));
  }, after: async (page, data) => {   // put the task back to a one-off, so no later screen shows the rule
    const st = await page.evaluate((id) => fetch('/api/project/' + encodeURIComponent(id) + '/task/1/repeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clear: true }) }).then((r) => r.status), data.projectId);
    if (st !== 200) throw new Error('could not clear the repeat rule after the shot (' + st + ')');
  } },
  /* #4470: the Tasks view in the new look, for the side by side with 'tasks'. */
  { name: 'nl-tasks', owner: 'Mona Lisa', go: async (page) => {
    await newLook(page);
    await at(page, '?tab=tasks');
    await page.waitForSelector('#panel-tasks', { state: 'visible', timeout: 5000 });
  } },
  /* #4470, the Projects list in the new look: its grid (the default) and its roadmap, and the roadmap with the look off
     to set beside it. */
  { name: 'nl-projects', owner: 'Mona Lisa', go: async (page) => { await newLook(page); await openTab(page, 'projects'); } },
  { name: 'projects-roadmap', owner: 'Mona Lisa', go: async (page) => {
    await openTab(page, 'projects');
    await page.click('#pj-list-view button.vt[data-layout="roadmap"]');
    await page.waitForSelector('#pj-list-view button.vt[data-layout="roadmap"][aria-pressed="true"]', { timeout: 5000 });
  } },
  { name: 'nl-projects-roadmap', owner: 'Mona Lisa', go: async (page) => {
    await newLook(page);
    await openTab(page, 'projects');
    await page.click('#pj-list-view button.vt[data-layout="roadmap"]');
    await page.waitForSelector('#pj-list-view button.vt[data-layout="roadmap"][aria-pressed="true"]', { timeout: 5000 });
  } },
  /* #4470, a project's Documents screen (opened from the project page's Files), with the look off and on. */
  { name: 'project-docs', owner: 'Mona Lisa', go: async (page, data) => {
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.waitForSelector('#pj-one-view', { state: 'visible', timeout: 8000 });
    await page.click('#pj-docs-all');
    await page.waitForSelector('#pj-docs-view', { state: 'visible', timeout: 8000 });
    /* Shown by hand, as in nl-project-docs, so the pair compares the switch like for like. */
    await page.evaluate(() => { const sw = document.getElementById('docs-seg'); if (sw) sw.hidden = false; });
  } },
  { name: 'nl-project-docs', owner: 'Mona Lisa', go: async (page, data) => {
    await newLook(page);
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.waitForSelector('#pj-one-view', { state: 'visible', timeout: 8000 });
    await page.click('#pj-docs-all');
    await page.waitForSelector('#pj-docs-view', { state: 'visible', timeout: 8000 });
    /* The sample room has no files, so the folder / conversation switch is hidden; shown by hand for the shot. */
    await page.evaluate(() => { const sw = document.getElementById('docs-seg'); if (sw) sw.hidden = false; });
  } },
  /* #4470: an agent's page in the new look, for the side by side with 'agent-chat' and 'agent-profile'. */
  { name: 'nl-agent-chat', owner: 'Mona Lisa', go: async (page, data) => {
    await newLook(page);
    await at(page, '?agent=' + data.chatAgent);
    await page.locator('#d-nav button[data-go="talk"]').first().click({ timeout: 5000 });
    await page.waitForSelector('#d-sec-talk', { state: 'visible', timeout: 5000 });
  } },
  /* #4470: Settings in the new look, for the side by side with 'settings'. */
  { name: 'nl-settings', owner: 'Mona Lisa', go: async (page) => {
    await newLook(page);
    await at(page, '?tab=settings');
    await page.waitForSelector('#panel-settings', { state: 'visible', timeout: 5000 });
  } },
  { name: 'nl-agent-profile', owner: 'Mona Lisa', go: async (page, data) => {
    await newLook(page);
    await at(page, '?tab=detail&agent=' + data.chatAgent);
    await page.locator('#d-nav button[data-go="profile"]').first().click({ timeout: 5000 });
    await page.waitForSelector('#d-sec-profile', { state: 'visible', timeout: 5000 });
  } },
  /* #4994: what deleting an agent does to its community account, on the three screens that say it.
     leftover-delete is the REAL engine's plan (engine/delete-leftover.js), for the removed agent `rex` that seedFiles
     writes when this screen is asked for (folder, auto-start file, removed record, a community key, and a Trash). The
     two Community lists are stubbed READS in this screen's own context, in the routes' shapes
     (communitystore.moderationQueue rows; communitymine.mine() rows), so nothing on the board is written. */
  { name: 'leftover-delete', owner: 'Angel', go: async (page) => {
    await page.waitForSelector('#removed-toggle', { state: 'visible', timeout: 8000 });
    if ((await page.getAttribute('#removed-toggle', 'aria-expanded')) !== 'true') await page.click('#removed-toggle');
    await page.click(`[data-delete-leftover="${LEFTOVER.claim}"]`, { timeout: 5000 });
    await page.waitForSelector('#del-modal:not([hidden])', { state: 'visible', timeout: 8000 });
    await page.mouse.move(1, 1);
  }, verify: async (page) => {
    const t = await page.evaluate(() => { const m = document.getElementById('del-modal'); return m && !m.hidden ? m.innerText : ''; });
    for (const want of ['Its community account: anything it posted there stays up', 'Its community account does not come back']) {
      if (!t.includes(want)) throw new Error('the delete confirmation does not say "' + want + '": ' + JSON.stringify(t.slice(0, 400)));
    }
  } },
  { name: 'community-held-deleted', owner: 'Angel', noServiceWorker: true, go: async (page) => {
    const rows = [
      { id: 'c-ada-1', entry: 'comment', status: 'held', remotePostId: '1b2c3d4e-0000-4000-8000-000000004994', author: { type: 'agent', name: 'Ada' }, body: 'Same here, a template made the weekly report much quicker.', receivedAt: '2026-10-01T08:00:00Z' },
      { id: 'c-rex-1', entry: 'comment', status: 'held', remotePostId: '1b2c3d4e-0000-4000-8000-000000004994', notSent: true, author: { type: 'agent', name: LEFTOVER.name }, body: 'I tried this on the catalogue and it worked.', receivedAt: '2026-10-01T08:05:00Z' },
    ];
    await page.route('**/api/community/moderation**', (r) => {
      const status = new URL(r.request().url()).searchParams.get('status');
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ queue: rows.filter((x) => !status || x.status === status) }) });
    });
    await at(page, '?tab=settings&sec=automation');
    await page.waitForSelector('#community-held-list li[data-id="c-rex-1"]', { state: 'visible', timeout: 8000 });
    /* The heading at the top, unless that leaves the deleted agent's row cut off (a phone): then that row in the middle.
       Checked again after a pause and redone (up to 3 s), since the list repaints on its own poll. */
    const place = () => page.evaluate(() => {
      document.getElementById('community-held-head').scrollIntoView({ block: 'start' });
      const li = document.querySelector('#community-held-list li[data-id="c-rex-1"]');
      if (li && li.getBoundingClientRect().bottom > innerHeight) li.scrollIntoView({ block: 'center' });
    });
    const whole = () => page.evaluate(() => {
      const li = document.querySelector('#community-held-list li[data-id="c-rex-1"]');
      const r = li ? li.getBoundingClientRect() : null;
      return !!(r && r.top >= 0 && r.bottom <= innerHeight);
    });
    await page.mouse.move(1, 1);
    for (const until = Date.now() + 3000; ;) {
      await place();
      await page.waitForTimeout(400);
      if (await whole() || Date.now() > until) break;
    }
  }, verify: async (page) => {
    const got = await page.evaluate(() => {
      const li = document.querySelector('#community-held-list li[data-id="c-rex-1"]');
      const r = li ? li.getBoundingClientRect() : null;
      return { text: li ? li.innerText : '', inView: !!(r && r.top >= 0 && r.bottom <= innerHeight),
        at: r ? [Math.round(r.top), Math.round(r.bottom), innerHeight, Math.round(scrollY)] : null };
    });
    if (!got.text.includes('Its agent was deleted, so releasing it never sends it to the public community.')) throw new Error('the deleted agent\'s held row does not say it is never sent: ' + JSON.stringify(got.text));
    if (!got.inView) throw new Error('the deleted agent\'s held row is not wholly on screen (top, bottom, viewport, scrollY): ' + JSON.stringify(got.at));
  } },
  { name: 'community-mine-deleted', owner: 'Angel', noServiceWorker: true, go: async (page) => {
    const base = { deleteRequested: false, takenDown: false, takeDownReason: null, agentRefused: false, agentNameUnclaimed: false, deleteRetrying: false };
    const posts = [
      { id: 'p-rex-2', title: 'Three tries at the weekly report template', agent: LEFTOVER.claim + ' (deleted agent)', postedAt: '2026-10-01T09:00:00.000Z', state: 'not_sent', ...base, canDelete: false },
      { id: 'p-rex-1', title: 'What I learned pricing the linen range', agent: LEFTOVER.claim + ' (deleted agent)', postedAt: '2026-09-30T15:00:00.000Z', state: 'sent', ...base, canDelete: true },
      { id: 'p-ada-1', title: 'Writing captions before the photos arrive', agent: 'Ada', postedAt: '2026-09-29T11:00:00.000Z', state: 'sent', ...base, canDelete: true },
    ];
    await page.route('**/api/community/mine', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ posts, comments: [] }) }));
    await at(page, '?tab=settings&sec=automation');
    await page.waitForSelector('#community-mine-list li[data-id="p-rex-2"]', { state: 'visible', timeout: 8000 });
    await page.evaluate(() => document.getElementById('community-mine-head').scrollIntoView({ block: 'start' }));
    await page.mouse.move(1, 1);
    await page.waitForTimeout(300);
  }, verify: async (page) => {
    const t = await page.evaluate(() => { const l = document.getElementById('community-mine-list'); return l && !l.hidden ? l.innerText : ''; });
    for (const want of ['Not sent. It stayed on this computer.', LEFTOVER.claim + ' (deleted agent)']) {
      if (!t.includes(want)) throw new Error('the community list does not say "' + want + '": ' + JSON.stringify(t.slice(0, 400)));
    }
  } },  /* #5153: a closed task's change receipt. The board is NOT changed (review 4: a real close would show task 1 closed on
     every later pass of every other screen): this page's own read of the projects marks task 1 closed, and the receipt's
     answer is faked, since the throwaway board has no agent transcripts to read. The folder is invented, never this Mac's. */
  { name: 'task-receipt', owner: 'Angel', noServiceWorker: true, go: async (page, data) => {
    const b = (i, o, cw, cr) => ({ input_tokens: i, output_tokens: o, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, rows: 40 });
    const receipt = { version: 1, closedAt: new Date(Date.now() - 3600e3).toISOString(), retries: { reopened: 1, handoffs: 1 }, agents: [
      { who: data.chatAgent, provider: 'claude', available: true, transcriptsWithWork: 2, commands: 14, filesMore: 0,
        folder: '/Users/ada/Kosmos/spring-catalogue', models: { 'claude-fable-5': b(48210, 21877, 310224, 4180552) },
        files: ['copy/home.md', 'copy/linen-range.md', 'copy/checkout.md', 'prices/spring.csv'] },
      { who: data.askAgent, provider: 'codex', available: false, because: 'provider' },
    ] };
    await page.route('**/api/project/*/task/*/receipt', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(receipt) }));
    await page.route('**/api/projects', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      let res, body;
      try { res = await route.fetch(); body = await res.json(); } catch { await route.abort().catch(() => {}); return; }
      for (const proj of body.projects || []) {
        if (proj.id !== data.projectId) continue;
        for (const t of proj.tasks || []) {
          if (t.number !== 1) continue;
          t.closedAt = receipt.closedAt;
          if (t.progress) t.progress.closed = true;
        }
      }
      await route.fulfill({ response: res, body: JSON.stringify(body), headers: { ...res.headers(), 'content-type': 'application/json' } });
    });
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.waitForSelector('#pj-one-view', { state: 'visible', timeout: 8000 });
    await page.evaluate(async () => { await pjReload(); openTaskPage(1); });
    await page.waitForSelector('#tk-receipt:not([hidden]) .tkr-agent', { state: 'visible', timeout: 8000 });
    await page.evaluate(() => {
      const b = document.querySelector('#tk-receipt .tkr-files-btn');
      if (b) b.click();   // the files list open, as a person would have it
      document.getElementById('tk-receipt').scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(300);
  }, verify: async (page) => {
    /* Compared without case: innerText follows text-transform, and the heading is the column's uppercase kicker. */
    const t = (await page.evaluate(() => document.getElementById('tk-receipt').innerText)).toLowerCase();
    for (const want of ['Receipt', 'ran 14 commands', 'at API prices', 'not available for Codex agents yet', 'put back 1 time']) {
      if (!t.includes(want.toLowerCase())) throw new Error('the receipt does not say "' + want + '": ' + JSON.stringify(t.slice(0, 400)));
    }
  } },  /* #5153 slice 4: the undo list under a closed task's receipt, opened, with each kind of row. Only this page's reads
     are faked (the receipt screen's, plus the undo plan); the board is not changed. Paths are invented. */
  { name: 'task-undo', owner: 'Angel', noServiceWorker: true, go: async (page, data) => {
    const f = (name, extra) => ({ path: '/Users/ada/Kosmos/spring-catalogue/' + name, shown: name, agent: data.chatAgent, action: 'restore', copyId: 'x', ok: true, ...extra });
    const plan = { on: true, ready: true, savedRoot: '/Users/ada/Library/Application Support/Kosmos/undo-saved', files: [
      f('copy/home.md'), f('copy/linen-range.md'), f('copy/new-page.md', { action: 'move-aside' }),
      f('prices/spring.csv', { ok: false, why: 'shared' }), f('copy/checkout.md', { ok: false, why: 'changed-since' }) ] };
    await page.route('**/api/project/*/task/*/undo', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(plan) }));
    await SCREENS.find((x) => x.name === 'task-receipt').go(page, data);
    await page.waitForSelector('#tk-undo:not([hidden]) [data-undo="open"]', { state: 'visible', timeout: 8000 });
    await page.click('#tk-undo [data-undo="open"]');
    await page.waitForSelector('#tk-undo .tku-list', { state: 'visible', timeout: 5000 });
    await page.evaluate(() => document.getElementById('tk-undo').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
  }, verify: async (page) => {
    const t = (await page.evaluate(() => document.getElementById('tk-undo').innerText)).toLowerCase();
    for (const want of ['undo', 'goes back to how it was before this task', 'moved into kosmos’s undo folder', 'another agent also edited it', 'changed after the task closed', 'undo the chosen files']) {
      if (!t.includes(want)) throw new Error('the undo list does not say "' + want + '": ' + JSON.stringify(t.slice(0, 400)));
    }
  } },
  /* #5153 slice 4: the undo switch in Settings > Advanced, shown on (only this page's read of the setting is faked). */
  { name: 'settings-undo', owner: 'Angel', noServiceWorker: true, go: async (page) => {
    await page.route('**/api/undo-setting', (r) => (r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ on: true, ok: true }) }) : r.continue()));
    await at(page, '?tab=settings&sec=advanced');
    await page.waitForSelector('#undo-toggle:not([hidden])', { state: 'visible', timeout: 8000 });
    await page.evaluate(() => document.getElementById('undo-row').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
  }, verify: async (page) => {
    const t = (await page.evaluate(() => document.getElementById('undo-row').innerText)).toLowerCase();
    for (const want of ['keep a copy before an agent edits a file', 'turning this off deletes them', 'private files such as .env included']) {
      if (!t.includes(want)) throw new Error('the undo switch row does not say "' + want + '": ' + JSON.stringify(t.slice(0, 400)));
    }
  } },
];

/* ------------------------------------------------------------------ args */
function parseArgs(argv) {
  const a = { out: null, screens: null, sizes: DEFAULT_SIZES, themes: THEMES, engines: ENGINES, strict: false, list: false, keep: false, data: 'sample', scale: 'css' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === '--out') a.out = v();
    else if (k === '--screens') a.screens = v().split(',');
    else if (k === '--sizes') a.sizes = v().split(',');
    else if (k === '--themes') a.themes = v().split(',');
    else if (k === '--engines') a.engines = v().split(',');
    else if (k === '--strict') a.strict = true;
    else if (k === '--list') a.list = true;
    else if (k === '--keep') a.keep = true;
    else if (k === '--data') a.data = v();
    else if (k === '--scale') a.scale = v();
    else throw new Error('unknown argument ' + k);
  }
  for (const s of a.sizes) if (!SIZES[s]) throw new Error('unknown size ' + s + ' (have ' + Object.keys(SIZES).join(', ') + ')');
  for (const t of a.themes) if (!THEMES.includes(t)) throw new Error('unknown theme ' + t);
  for (const e of a.engines) if (!ENGINES.includes(e)) throw new Error('unknown engine ' + e);
  if (!DATA_SETS[a.data]) throw new Error('unknown data set ' + a.data + ' (have ' + Object.keys(DATA_SETS).join(', ') + ')');
  if (!['css', 'device'].includes(a.scale)) throw new Error('unknown scale ' + a.scale + ' (have css, device)');
  if (a.screens) for (const s of a.screens) if (!SCREENS.find((x) => x.name === s)) throw new Error('unknown screen ' + s);
  return a;
}

/* ------------------------------------------------------------------ board */
function freePort() {
  return Number(execFileSync(process.execPath,
    ['-e', "const s=require('node:net').createServer();s.listen(0,()=>{console.log(s.address().port);s.close();});"]).toString().trim());
}

/* Sample agents, as fake tmux panes. Names are invented; none is a real agent.
   A Braille spinner in the title reads as working; a non-Claude command reads as
   stopped; the shared fake screen reads as idle; cleo's ask comes from a
   self-report (engine/status.js). */
const AGENTS = [
  { claim: 'ada', title: '⠋ Drafting the release notes for the spring catalogue', name: 'Ada', role: 'Writer' },
  { claim: 'basil', title: '', name: 'Basil', role: 'Researcher' },
  { claim: 'cleo', title: '', name: 'Cleo', role: 'Project manager' },
  { claim: 'dmitri', title: '⠙ Reviewing a very long pull request title that should wrap or truncate cleanly on a small phone', name: 'Dmitri Alexandrovich-Longname', role: 'Senior reviewer and release coordinator' },
  { claim: 'esme', title: '', name: 'Esme', role: 'Bookkeeper', command: '-zsh' },
];

const LONG_REPLY = 'Here is the plan for tomorrow, in order. First I will finish the product copy for the '
  + 'twelve catalogue pages, then check every price against the spreadsheet you shared, and finally '
  + 'book the photographer for Thursday morning if the studio is free. A very long unbroken word to '
  + 'test wrapping: supercalifragilisticexpialidocious-and-then-some-more-characters-without-spaces.\n\n'
  + 'The script I will run:\n\n```js\nconst prices = await loadSheet(\'catalogue-2026.xlsx\');\n'
  + 'for (const row of prices) { if (row.price !== row.listed) console.log(\'mismatch\', row.sku, row.price, row.listed); }\n```\n\n'
  + 'Tell me if you want the photographer on a different day.';

/* The store set: a tidy fleet for App Store and Play screenshots, which people
   buying the app see. Same claims as the sample, so every screen's `go` works
   unchanged; four agents, each in a state a customer should see (two working,
   one needing you, one idle), nothing stopped and nothing overlong. */
/* Cleo, the agent waiting on you, must lead the first store shot. Nothing on the
   store screens is overlong; the Files folder below is shared with the sample
   set and is not in a store shot. */
const STORE_AGENTS = [
  { claim: 'cleo', title: '', name: 'Cleo', role: 'Project manager' },
  { claim: 'dana', title: '⠋ Writing the product copy for the spring catalogue', name: 'Dana', role: 'Writer' },
  { claim: 'eli', title: '⠙ Comparing supplier prices for the linen range', name: 'Eli', role: 'Researcher' },
  { claim: 'farah', title: '', name: 'Farah', role: 'Bookkeeper' },
];
const DATA_SETS = {
  sample: {
    agents: AGENTS,
    chatAgent: 'ada',   // the DM, files and profile screens
    askAgent: 'cleo',   // the needs-you question and the push landing
    projectAgents: ['ada', 'basil', 'cleo'],
    room: [['cleo', [], 'Kick-off: the catalogue goes to print on the 3rd. Ada has copy, Basil has research, I have the printer.'],
      ['basil', [], 'Competitor prices are in the shared sheet, tab "March". Two of them undercut us on the linen range by about 8%.'],
      ['ada', ['cleo'], 'Copy for pages 1-8 is done. Pages 9-12 need the new photos before I can caption them, so I am parked on those until Thursday.']],
    chat: [
      ['you', 'Morning Ada. What is left on the catalogue?'],
      ['ada', 'Morning! Three things, and none of them are blocked.'],
      ['you', 'Can you write it up properly so I can read it on my phone later?'],
      ['ada', LONG_REPLY],
    ],
    ask: 'The printer quoted two prices for the spring catalogue. May I accept the cheaper one (£1,240, five working days) or do you want the faster one (£1,610, two days)?',
    secondProject: { name: 'Quarterly accounts', agents: ['esme'] },
  },
  store: {
    agents: STORE_AGENTS,
    chatAgent: 'dana',
    askAgent: 'cleo',
    projectAgents: ['dana', 'eli', 'cleo'],
    room: [['cleo', [], 'Kick-off: the catalogue goes to print on the 3rd. Dana has copy, Eli has research, I have the printer.'],
      ['eli', [], 'Competitor prices are in the shared sheet, tab "March". Two of them undercut us on the linen range by about 8%.'],
      ['dana', ['cleo'], 'Copy for pages 1 to 8 is done. Pages 9 to 12 need the new photos before I can caption them, so I am parked on those until Thursday.']],
    chat: [
      ['you', 'Morning Dana. How is the catalogue copy coming along?'],
      ['dana', 'Pages 1 to 8 are written and checked against the price sheet.'],
      ['you', 'Great. What is left?'],
      ['dana', 'Pages 9 to 12 need the new photos before I can caption them. The shoot is on Thursday, so I will have the full draft to you on Friday morning.'],
      ['you', 'Perfect, thank you.'],
    ],
    ask: 'The printer sent two quotes for the catalogue: $1,240 in five working days, or $1,610 in two. Shall I accept the cheaper one?',
    secondProject: { name: 'Quarterly accounts', agents: ['farah'], description: 'Close the quarter and send the accounts to the accountant.' },
    projectDescription: 'Get the spring catalogue written, priced, photographed and to the printer by the 3rd.',
    /* A Mac that is set up, which the empty sandbox is not: each agent gets a
       launch job and its own folder with instructions, and your messages were
       delivered. Without these the shots carry setup warnings no customer with
       a working Mac would see ("will not come back if you restart", "made
       before Kosmos recorded this", "could not deliver"). */
    setUp: true,
    askInProject: true,
    /* Made from the screen, as a person makes a project, so the room does not open on
       "Made by an agent or another program". And the chat agent's replies already read: the chat
       screen marks them read on the board, so otherwise whichever theme is shot first
       shows an unread count and the other does not. */
    madeOnScreen: true,
    dmRead: true,
    /* The sandbox has no Claude account on purpose (the leak guard insists),
       so the board truthfully says it cannot reach one. A customer's Mac can.
       In the PAGE only, the status answer's `connection` is set to connected;
       every other field is the board's own. */
    connected: true,
  },
};
let DATA = DATA_SETS.sample;   // run() picks the set before the board is seeded
/* #4994: the removed agent the leftover-delete screen opens the delete confirmation for. Invented. Seeded only when
   that screen is asked for (run() sets SEED_LEFTOVER), so every other screen's board has no "Show removed agents". */
const LEFTOVER = { claim: 'rex', name: 'Rex', role: 'Writer' };
let SEED_LEFTOVER = false;

/* Everything that can be written before the board starts, through the engine's
   own writers, so the files are the shapes the real producers make. The data
   roots are set in THIS process first: several engine modules resolve their
   paths once, at require time. */
function seedFiles(roots) {
  process.env.AGENT_WORKFORCE_DATA = roots.DATA;
  process.env.AGENT_WORKFORCE_WORKERS = roots.WORKERS;
  // All four, not only the two the writers below read today: a module that goes back to
  // capturing LAUNCH or PROJECTS at require time would otherwise write into the real ones.
  process.env.AGENT_WORKFORCE_LAUNCH = roots.LAUNCH;
  process.env.AGENT_WORKFORCE_PROJECTS = roots.PROJECTS;
  const fleet = require(path.join(REPO, 'test-support', 'fleet'));
  const AGENTS = DATA.agents;
  fs.writeFileSync(path.join(roots.DATA, 'fake-panes'), AGENTS.map((a) => fleet.line({
    session: a.claim + '-discord', claim: a.claim, title: a.title, ...(a.command ? { command: a.command } : {}),
  })).join('\n') + '\n');
  fs.writeFileSync(path.join(roots.DATA, 'fake-sessions'), AGENTS.map((a) => a.claim + '-discord').join('\n') + '\n');
  fs.writeFileSync(path.join(roots.DATA, 'fake-screen'), fleet.SCREEN && fleet.SCREEN.idle ? fleet.SCREEN.idle : 'Worked for 1m 02s\n> \n');
  const store = require(path.join(REPO, 'engine', 'store'));
  for (const a of AGENTS) {
    const role = a.claim === DATA.chatAgent && LEAK_CONTROL === 'page' ? a.role + ', ' + PLANTED_EMAIL : a.role;
    store.writeProfile(a.claim, { displayName: a.name, role });
  }
  require(path.join(REPO, 'engine', 'firstrun')).complete();
  /* #4820: an existing install no longer owes a one-time Community notice (#4524 marked it seen here so it
     could not cover the first shot), so there is nothing to mark. */
  try { require(path.join(REPO, 'engine', 'tips')).set({ off: true }); } catch { /* tips optional */ }
  const chat = require(path.join(REPO, 'engine', 'chat'));
  const t0 = Date.now() - 3600e3;
  const stamp = (min) => new Date(t0 + min * 60e3).toISOString();
  /* These writers report a failure as { recorded: false, because } rather than throwing;
     a seed that silently did not land would be photographed as if it had. */
  const landed = (r, what) => { if (r && r.recorded === false) throw new Error('the seed could not write ' + what + ': ' + r.because); };
  DATA.chat.forEach(([who, text], i) => {
    const mine = who === 'you' ? (DATA.setUp ? { delivery: { state: 'placed' } } : {}) : { from: who };
    landed(chat.appendMessage(chat.DIRECT, DATA.chatAgent, { text, at: stamp(i + 1), ...mine }), 'the DM');
  });
  if (DATA.setUp) {
    const create = require(path.join(REPO, 'engine', 'create'));
    for (const a of AGENTS) {
      fs.mkdirSync(path.dirname(create.plistPath(a.claim)), { recursive: true });
      // Only what readPlistJob reads is real: the agent CLI at 4, tmux at 5, the model at 7.
      // The other slots are placeholders, not a runnable job.
      fs.writeFileSync(create.plistPath(a.claim), '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>'
        + '<key>Label</key><string>' + create.serviceLabel(a.claim) + '</string>'
        + '<key>ProgramArguments</key><array>' + ['/bin/bash', '-lc', 'start', a.claim, '/usr/local/bin/claude', '/usr/local/bin/tmux', a.claim, 'sonnet']
          .map((x) => '<string>' + x + '</string>').join('') + '</array>'
        + '<key>RunAtLoad</key><true/></dict></plist>\n');
      fs.mkdirSync(create.workerDir(a.claim), { recursive: true });
      fs.writeFileSync(path.join(create.workerDir(a.claim), 'CLAUDE.md'), '# ' + a.name + '\n\nYou are ' + a.name + ', the ' + a.role.toLowerCase() + '.\n');
    }
  }
  if (SEED_LEFTOVER) seedLeftover(landed);
  /* The chat agent's Files folder, for the agent-files screens: more rows than the
     agent page shows (AGENT_FILES_SHOWN, 10, so the list is capped; View All shows with any file), one with
     a long name. */
  const chatFiles = require(path.join(REPO, 'engine', 'dmfiles')).filesDir(DATA.chatAgent);
  fs.mkdirSync(chatFiles, { recursive: true });
  const fileNames = ['catalogue-copy-pages-1-to-8-final-reviewed-by-cleo.docx', 'prices.xlsx', 'photographer-brief.pdf',
    'notes.md', 'cover.png', 'linen-range.csv', 'spring-2026-print-schedule.pdf', 'draft-2.docx',
    'invoice-0412.pdf', 'studio-quote.pdf', 'page-9-layout.png', 'captions.md'];
  fileNames.forEach((f, i) => {
    fs.writeFileSync(path.join(chatFiles, f), 'x'.repeat(1024 * (i + 1)));
    const t = new Date(t0 + i * 60e3);
    fs.utimesSync(path.join(chatFiles, f), t, t);
  });
  // The store set records this after the project exists, naming it (seed below).
  if (!DATA.askInProject) {
    landed(require(path.join(REPO, 'engine', 'selfreport')).record(DATA.askAgent, {
      state: 'needs_you', because: DATA.ask,
    }), "the ask agent's needs-you state");
  }
}

/* #4994: a removed agent with something left on disk, as remove.js leaves one: its folder, its auto-start file and
   its removed record (the fields recordRemoval writes). Plus a community key in the community folder the board uses
   (communitysend's own path, so hasAccount finds it) and a Trash on the sandboxed home, so the plan is the Trash
   case. The key is invented, and the board's community address is a dead one (startBoard), so nothing is sent. */
function seedLeftover(landed) {
  const create = require(path.join(REPO, 'engine', 'create'));
  const store = require(path.join(REPO, 'engine', 'store'));
  const communitysend = require(path.join(REPO, 'engine', 'communitysend'));
  const { claim, name, role } = LEFTOVER;
  fs.mkdirSync(create.workerDir(claim), { recursive: true });
  fs.writeFileSync(path.join(create.workerDir(claim), 'CLAUDE.md'), '# ' + name + '\n\nYou are ' + name + ', the ' + role.toLowerCase() + '.\n');
  fs.writeFileSync(path.join(create.workerDir(claim), 'notes.md'), 'Catalogue notes.\n'.repeat(200));
  fs.mkdirSync(path.dirname(create.plistPath(claim)), { recursive: true });
  fs.writeFileSync(create.plistPath(claim), '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>'
    + '<key>Label</key><string>' + create.serviceLabel(claim) + '</string>'
    + '<key>ProgramArguments</key><array>' + ['/bin/bash', '-lc', 'start', claim, '/usr/local/bin/claude', '/usr/local/bin/tmux', claim, 'sonnet']
      .map((x) => '<string>' + x + '</string>').join('') + '</array>'
    + '<key>RunAtLoad</key><true/></dict></plist>\n');
  const removedAt = new Date(Date.now() - 2 * 86400e3).toISOString();
  fs.mkdirSync(store.ROOT, { recursive: true });
  fs.writeFileSync(path.join(store.ROOT, 'removed.json'), JSON.stringify([{ name: claim, shownAs: name, removedAt, stopped: true,
    leftRunningByChoice: false, label: create.serviceLabel(claim), plist: create.plistPath(claim), ours: true }], null, 2) + '\n');
  const keysFile = communitysend._paths.keysFile();
  fs.mkdirSync(path.dirname(keysFile), { recursive: true });
  fs.writeFileSync(keysFile, JSON.stringify({ [claim]: { apiKey: 'sample-community-key-4994' } }, null, 2) + '\n', { mode: 0o600 });
  fs.mkdirSync(path.join(process.env.AGENT_WORKFORCE_HOME, '.Trash'), { recursive: true });
  if (!communitysend.hasAccount(claim)) landed({ recorded: false, because: 'hasAccount does not see the seeded key' }, 'the leftover agent\'s community key');
}

async function waitForBoard(base, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const r = await fetch(base + '/'); if (r.ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

async function startBoard() {
  const early = Object.keys(require.cache).filter((f) => f.startsWith(path.join(REPO, 'engine') + path.sep));
  if (early.length) throw new Error('an engine module was loaded before the sandbox was set: ' + early[0]);
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) {
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'mshots-' + k.toLowerCase() + '-'));
  }

  /* Every home and config root the engine reads, sandboxed. HOME covers
     os.homedir(); the named ones cover code that reads them first.
     🛑 Set in THIS process too, BEFORE seedFiles requires any engine module:
     several resolve AGENT_WORKFORCE_HOME once, at require time (#3675). */
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mshots-home-'));
  roots.HOME = home;
  if (LEAK_CONTROL === 'account') {
    fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: PLANTED_EMAIL } }));
  }
  const sealed = {
    HOME: home, AGENT_WORKFORCE_HOME: home, AGENT_WORKFORCE_CONFIG_ROOT: path.join(home, 'config'),
    AGENT_WORKFORCE_CLAUDE_CONFIG: path.join(home, '.claude.json'), AGENT_WORKFORCE_CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    AGENT_WORKFORCE_CLAUDE_SETTINGS: path.join(home, '.claude', 'settings.json'),
    AGENT_WORKFORCE_GEMINI_HOME: path.join(home, '.gemini'), AGENT_WORKFORCE_GROK_HOME: path.join(home, '.grok'),
    /* Not named here: CODEX_HOME, AGENT_WORKFORCE_CODEX_HOME, GEMINI_CLI_HOME, GROK_HOME and
       CLAUDE_CONFIG_DIR. lib-sandbox-home (required at the top) removes them, and naming them
       would put the board in the "operator named a home" mode (#1488), which no user runs; left
       unset they resolve under the sandboxed home above. */
    AGENT_WORKFORCE_SCAN_ROOTS: path.join(home, 'scan'),
    /* The board installs its agent browser (a ~100MB download) on start unless
       it is told it is a sandbox; every other self-booting check sets this. */
    AGENT_WORKFORCE_DRY_RUN: '1', AGENT_WORKFORCE_RUNNERS_DIR: path.join(home, 'runners'),
    /* #4632: the catalogue the picker downloads. The harness passes its local copy; run alone,
       a dead port, so this board never asks installkosmos.com (#4253). */
    KOSMOS_CATALOGUE_BASE: process.env.KOSMOS_CATALOGUE_BASE || 'http://127.0.0.1:9/',
    /* #4994: the community the board sends to, a dead address as tools/browser-checks.sh sets it. A throwaway board
       reads the switch as on (no file is Josh's default), and leftover-delete seeds a community key. */
    AGENT_WORKFORCE_COMMUNITY_URL: process.env.AGENT_WORKFORCE_COMMUNITY_URL || 'http://127.0.0.1:9/',
  };
  /* HOME is sealed in this process too (an engine writer can fall back to os.homedir()), and
     Playwright finds its browsers under the home. Pin its cache to the REAL one first, so the
     launches below do not depend on Playwright having been required before this point. */
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
    const realHome = os.homedir();
    process.env.PLAYWRIGHT_BROWSERS_PATH = process.platform === 'darwin' ? path.join(realHome, 'Library', 'Caches', 'ms-playwright')
      : process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || path.join(realHome, 'AppData', 'Local'), 'ms-playwright')
        : path.join(process.env.XDG_CACHE_HOME || path.join(realHome, '.cache'), 'ms-playwright');
  }
  Object.assign(process.env, sealed);
  const dropRoots = () => { for (const d of Object.values(roots)) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } };
  try { seedFiles(roots); } catch (e) { dropRoots(); throw e; }   // a failed seed leaves no sandboxed HOME behind
  let port;
  try { port = freePort(); } catch (e) { dropRoots(); throw e; }
  const base = `http://127.0.0.1:${port}`;
  // Outside DATA, so a board that dies after boot still leaves its stderr to read (printed at the end).
  const stderrLog = path.join(os.tmpdir(), `mobile-shots-board-${process.pid}.log`);
  const stderrFd = fs.openSync(stderrLog, 'w');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: REPO,
    env: { ...process.env, ...sealed, PORT: String(port), AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_DATA: roots.DATA, AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH, AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh'),
      AGENT_WORKFORCE_FAKE_PANES: path.join(roots.DATA, 'fake-panes'),
      AGENT_WORKFORCE_FAKE_SESSIONS: path.join(roots.DATA, 'fake-sessions'),
      AGENT_WORKFORCE_FAKE_SCREEN: path.join(roots.DATA, 'fake-screen') },
    stdio: ['ignore', 'ignore', stderrFd],
  });
  fs.closeSync(stderrFd);
  if (!(await waitForBoard(base, 20000))) {
    srv.kill();
    let tail = '';
    try { tail = fs.readFileSync(stderrLog, 'utf8').trim().split('\n').slice(-5).join('\n'); } catch { /* none */ }
    try { fs.rmSync(stderrLog, { force: true }); } catch { /* best effort */ }
    dropRoots();
    throw new Error('the throwaway board did not come up on ' + base + (tail ? '; its stderr ended:\n' + tail : ''));
  }
  return { base, srv, roots, stderrLog };
}

/* After start: a project through the board's own API, then its room posts and
   reactions as message-log lines in the real writer's shape (engine/messages.js
   rowShaped); the agent-side /api/post route needs an agent's token. */
async function seed(base, roots) {
  const post = async (p, body) => {
    /* sec-fetch-site is what a browser sends and what server.js isViaScreen reads to tell
       the person's screen from another program. */
    const headers = { 'content-type': 'application/json', ...(DATA.madeOnScreen ? { 'sec-fetch-site': 'same-origin' } : {}) };
    const r = await fetch(base + p, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    if (!r.ok) throw new Error('seed ' + p + ' answered ' + r.status);
    return r.json().catch(() => ({}));
  };
  const made = await post('/api/projects', { name: 'Launch the spring catalogue', agents: DATA.projectAgents,
    ...(DATA.projectDescription ? { description: DATA.projectDescription } : {}) });
  const pid = made.project && made.project.id;
  if (!pid) throw new Error('seed: the board made no project');
  for (const s2 of ['Draft the product copy for every page', 'Check the prices against the spreadsheet', 'Book the photographer']) {
    await post('/api/project/' + pid + '/tasks', { sentence: s2, who: DATA.chatAgent });
  }
  await post('/api/projects', DATA.secondProject);
  const t0 = Date.now() - 1800e3;
  const stamp = (min) => new Date(t0 + min * 60e3).toISOString();
  const lines = [
    // A data set's `room` is exactly three posts: the times and the two reactions below name them.
    ...DATA.room.map(([from, to, text], i) => ({ kind: 'post', id: 'm' + (i + 1), project: pid, from, to, text, at: stamp([1, 4, 9][i]), outcomes: {} })),
    { kind: 'reaction', project: pid, of: 'm3', emoji: '👍', op: 'add', from: DATA.askAgent, at: stamp(10) },
    { kind: 'reaction', project: pid, of: 'm2', emoji: '🔥', op: 'add', from: DATA.chatAgent, at: stamp(11) },
  ];
  /* The log lives in the store's own root (engine/messages.js: store.ROOT, which is
     DATA/<app>), not at the top of DATA: written there, the room showed no posts at all. */
  const storeRoot = require(path.join(REPO, 'engine', 'store')).ROOT;
  fs.appendFileSync(path.join(storeRoot, 'messages.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  if (DATA.dmRead) await post('/api/agent/' + DATA.chatAgent + '/seen');
  /* The store set's question names its project, as an agent on a project would, so it
     lights that project rather than counting as a needs-you with no project. */
  if (DATA.askInProject) {
    const r = require(path.join(REPO, 'engine', 'selfreport')).record(DATA.askAgent, { state: 'needs_you', because: DATA.ask, project: pid });
    if (r && r.recorded === false) throw new Error('the seed could not write the ask agent\'s needs-you state: ' + r.because);
  }
  return { projectId: pid, chatAgent: DATA.chatAgent, askAgent: DATA.askAgent };
}

/* Before ANY screenshot: a sealed board must have no accounts at all. The page
   guard below cannot see a bare key suffix; the accounts list can. */
async function preflight(base) {
  /* An unread list is not an empty one: a refused or unparseable answer stops
     the run exactly as a listed account does. */
  const r = await fetch(base + '/api/accounts');
  const body = r.ok ? await r.json().catch(() => null) : null;
  const rows = body && body.accounts;
  if (!Array.isArray(rows) || rows.length) {
    const err = new Error('LEAK GUARD: the throwaway board lists ' + (Array.isArray(rows) ? rows.length + ' account(s)' : 'accounts it would not show (HTTP ' + r.status + ')')
      + '; a sealed board must list none. No screenshots taken.');
    err.leak = true;
    throw err;
  }
}

/* ------------------------------------------------------------------ leak guard */
/* What must never appear in a shot: see lib-leak-guard.js, which holds the checks. */
/* The two controls tools/browser-checks.sh runs, each of which must exit 3:
   `account` plants a signed-in Claude account in the sandboxed home (the
   preflight must stop it), `page` puts an address in an agent's role (the page
   scan must stop it). The address is invented and not example.com. */
const LEAK_CONTROL = process.env.MSHOTS_LEAK_CONTROL || '';
const COVER_CONTROL = process.env.MSHOTS_COVER_CONTROL || '';
const PLANTED_EMAIL = 'planted.leak@leak-control.test';
const { hitsIn } = require('./lib-leak-guard.js');
async function leaksOn(page) {
  const text = await page.evaluate(() => {
    if (!document.body) return '';
    const parts = [document.body.innerText];
    for (const el of document.querySelectorAll('input, textarea, select')) if (el.value && el.checkVisibility()) parts.push(el.value);
    for (const el of document.querySelectorAll('[title], [aria-label], [alt], [placeholder]')) {
      if (!el.checkVisibility()) continue;
      for (const a of ['title', 'aria-label', 'alt', 'placeholder']) { const v = el.getAttribute(a); if (v) parts.push(v); }
    }
    return parts.join(' ');
  });
  return hitsIn(text);
}
/* ------------------------------------------------------------------ capture */
async function overflowOf(page) {
  return page.evaluate((sels) => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (el.scrollWidth > el.clientWidth + 1) out.push({ sel, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
      }
    }
    /* The widest thing sticking out past the viewport, to say WHAT overflows.
       Skipped: anything wholly off screen (a drawer parked with a transform)
       and anything inside a sideways scroller (a chip row), which are laid out
       that way on purpose. Content cut off at the edge still counts. */
    const inScroller = (el) => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (/^(auto|scroll)$/.test(getComputedStyle(a).overflowX)) return true;
      }
      return false;
    };
    let worst = null;
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.left >= vw || getComputedStyle(el).visibility === 'hidden' || inScroller(el)) continue;
      if (r.right > vw + 1 && (!worst || r.right > worst.right)) {
        worst = { right: Math.round(r.right), tag: el.tagName.toLowerCase(), id: el.id || '', cls: String(el.className || '').slice(0, 60) };
      }
    }
    return { vw, containers: out, worst };
  }, OVERFLOW_SELECTORS);
}

/* The other two #718 phone-ready rules, measured on the whole page (not only
   the part on screen). A tap target is anything a finger presses; under 44 CSS
   px either way is Apple's floor. A checkbox or radio is judged by its label
   when it has one, since that is what the finger lands on. A link inside a
   sentence is exempt (WCAG 2.5.8's inline exception). A typing field under
   16px makes iOS Safari zoom the page on focus.
   #5206: a control whose BOX is under 44 can still be a 44 target, the standard way: a ::after (or ::before) laid
   past it, or padding taken back by a negative margin. What counts is where a finger lands, so a small box is probed:
   scrolled into view, each edge of a 44x44 square centred on it must hit the control (document.elementFromPoint).
   Only a control every probe reaches passes; a probe that hits something else, or an off-screen point, fails it. */
const MIN_TAP_PX = 44;
const MIN_FIELD_FONT_PX = 16;
async function fitOf(page) {
  return page.evaluate(({ minTap, minFont }) => {
    const vw = document.documentElement.clientWidth;
    const shown = (el) => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const onPage = (r) => r.width > 0 && r.height > 0 && r.right > 0 && r.left < vw;
    const name = (el) => {
      const t = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 28);
      return el.tagName.toLowerCase() + (el.id ? '#' + el.id : (el.classList[0] ? '.' + el.classList[0] : '')) + (t ? ' "' + t + '"' : '');
    };
    const inSentence = (el) => {
      if (el.tagName !== 'A' || getComputedStyle(el).display !== 'inline') return false;
      const p = el.parentElement;
      return !!p && (p.textContent || '').trim().length > (el.textContent || '').trim().length + 10;
    };
    const taps = [];
    const seen = new Set();
    const sx = window.scrollX, sy = window.scrollY;
    // scrollIntoView moves every scrollable ancestor, not only the window: each one's place is kept and put back, so
    // nothing after the audit (a screen's verify, its after-step) sees a moved page.
    const moved = new Map();
    const remember = (el) => { for (let a = el.parentElement; a; a = a.parentElement) if (!moved.has(a) && (a.scrollTop || a.scrollLeft || a.scrollHeight > a.clientHeight || a.scrollWidth > a.clientWidth)) moved.set(a, [a.scrollLeft, a.scrollTop]); };
    /* Probes sit on the four edge midpoints of the 44x44 square, half a pixel in. Corners are not probed: a rounded
       hit area (border-radius clips hit-testing) would fail a corner a finger never needs. The far edges are
       half-open, so a 43px reach fails rather than passes. */
    const reaches = (target) => {
      remember(target);
      target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const r = target.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2, h = minTap / 2 - 0.5;
      const pts = [];
      if (r.height < minTap - 0.5) pts.push([cx, cy - h], [cx, cy + h]);
      if (r.width < minTap - 0.5) pts.push([cx - h, cy], [cx + h, cy]);
      return pts.every(([x, y]) => {
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return false;
        const hit = document.elementFromPoint(x, y);
        return !!hit && (hit === target || target.contains(hit));
      });
    };
    for (const el of document.querySelectorAll('button, a[href], select, summary, [role="button"], [role="tab"], [role="link"], input:not([type="hidden"]), textarea')) {
      if (el.disabled || !shown(el) || inSentence(el)) continue;
      let target = el;
      if (el.matches('input[type="checkbox"], input[type="radio"]')) target = el.closest('label') || el;
      if (seen.has(target)) continue;
      seen.add(target);
      const r = target.getBoundingClientRect();
      if (!onPage(r)) continue;
      if ((r.width < minTap - 0.5 || r.height < minTap - 0.5) && !reaches(target)) taps.push(name(target) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
    /* A hit area that reaches past its control (a ::after, padding taken back) paints above its neighbours, so it
       can take taps meant for them. That is the risk the reach probe above rewards, so it is measured too: inside
       every control's own box (every 3px, its edges included), a tap must land on that control. A point
       answered by ANOTHER control is a cover; a non-control ancestor (the row a button sits in) is not. */
    const covers = [];
    // The nearest ANCESTOR in its own layer: positioned out of the flow (fixed, absolute, sticky) or an
    // open dialog / popover. Two controls answer each other's points as STACKING only when they sit in different
    // layers (a menu over the page); two in the same layer overlapping is a hit area, however positioned (round 3).
    const layerOf = (n) => {
      if (n && n.nodeType === 1 && getComputedStyle(n).position === 'fixed') return n;   // a fixed control escapes its parent: its own layer (round 4)
      for (n = n && n.parentElement; n && n.nodeType === 1; n = n.parentElement) {   // otherwise ancestors only: an absolute control is in its container's layer
        const pos = getComputedStyle(n).position;
        if (pos === 'fixed' || pos === 'absolute' || pos === 'sticky') return n;
        try { if (n.matches('dialog[open]') || n.matches(':popover-open')) return n; } catch { /* an engine without :popover-open */ }
      }
      return null;
    };
    const layered = (top, under) => layerOf(top) !== layerOf(under);
    // label too: a label row takes a tap for its control, so it can be covered (Angel, #5218 review).
    const SEL = 'button, a[href], select, summary, label, [role="button"], [role="tab"], [role="link"], input:not([type="hidden"]), textarea';
    const controlOf = (n) => (n && n.closest ? n.closest(SEL) : null);
    for (const el of document.querySelectorAll(SEL)) {
      if (el.disabled || !shown(el) || !onPage(el.getBoundingClientRect())) continue;
      remember(el);
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      // Every 3px across the box (capped at 4000 points), half a pixel in from each edge: a neighbour's hit area
      // usually takes a thin strip along one edge, which a handful of sample points misses (a 15-point grid passed
      // the room's header at 44px where render-room-msgbox-2806's pixel scan found 64px taken; measured).
      const pts = [];
      const step = Math.max(3, Math.sqrt((r.width * r.height) / 4000));
      for (let x = r.left + 0.5; x < r.right - 0.5; x += step) for (let y = r.top + 0.5; y < r.bottom - 0.5; y += step) pts.push([x, y]);
      for (const x of [r.left + 0.5, r.right - 0.5]) for (let y = r.top + 0.5; y < r.bottom; y += step) pts.push([x, y]);
      for (const y of [r.top + 0.5, r.bottom - 0.5]) for (let x = r.left + 0.5; x < r.right; x += step) pts.push([x, y]);
      // Only the part of the box a finger can see: an ancestor that clips (overflow other than visible) hides the rest,
      // and a point there answers whatever is beyond the clip (round 4: a false red).
      // Only ancestors that really clip it: a fixed control escapes all of them; an absolute one escapes those between
      // it and its containing block (the nearest positioned ancestor). Round 5: clipping by every ancestor skipped an
      // escaped control entirely, a false green.
      let clip = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
      // transform, filter, perspective, will-change of those, and contain paint/layout/strict/content also make an
      // ancestor the containing block, for fixed descendants too (round 6). body's overflow belongs to the viewport and
      // clips nothing, so it is skipped (round 6).
      const containsAll = (cs) => cs.transform !== 'none' || cs.filter !== 'none' || cs.perspective !== 'none'
        || /transform|filter|perspective/.test(cs.willChange || '') || /paint|layout|strict|content/.test(cs.contain || '');
      let pos = getComputedStyle(el).position;
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const cs = getComputedStyle(a);
        const cb = containsAll(cs);
        if (pos === 'fixed' && !cb) continue;                             // a fixed control escapes this ancestor
        if (pos === 'absolute' && cs.position === 'static' && !cb) continue;   // neither its containing block nor a clip for it
        if (a === document.body) { pos = cb ? 'static' : pos; continue; }
        // contain paint/strict/content clips to the box like overflow does (round 6, T6).
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || /paint|strict|content/.test(cs.contain || '')) { const b = a.getBoundingClientRect(); clip = { left: Math.max(clip.left, b.left), top: Math.max(clip.top, b.top), right: Math.min(clip.right, b.right), bottom: Math.min(clip.bottom, b.bottom) }; }
        pos = (cs.position === 'fixed' || cs.position === 'absolute') ? cs.position : 'static';
      }
      for (const [x, y] of pts) {
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
        if (x < clip.left || x >= clip.right || y < clip.top || y >= clip.bottom) continue;
        const hit = document.elementFromPoint(x, y);
        const other = controlOf(hit);
        // An ANCESTOR answering inside this control is skipped (this control is part of it). A DESCENDANT is not: a
        // child's hit area reaching over its own card is a cover like any other (Angel, #5218 review).
        if (!other || other === el || other.contains(el)) continue;
        // A control and its own label answer for each other (a custom checkbox: an invisible input over its label).
        if ((other.labels && [...other.labels].includes(el)) || (el.labels && [...el.labels].includes(other))) continue;
        // A point OUTSIDE the other control's drawn box is a hit area reaching past it (a ::after). A point INSIDE
        // it is either a box grown over its neighbour (padding taken back by a negative margin: a hit area too) or a
        // control drawn on top in another layer (an open menu, a dialog): only the second is stacking, so it is told
        // apart by layer, not by geometry (review round 2: padding hit areas read clean before).
        const o = other.getBoundingClientRect();
        const inBox = x >= o.left - 1 && x < o.right + 1 && y >= o.top - 1 && y < o.bottom + 1;   // 1px: a snapped shared edge
        if (inBox && el.contains(other)) continue;   // a control inside this one, drawn where it is (a label's own input)
        if (inBox && layered(other, el)) continue;
        if (inBox && Math.abs(x - o.left) <= 1.5 || inBox && Math.abs(x - o.right) <= 1.5 || inBox && Math.abs(y - o.top) <= 1.5 || inBox && Math.abs(y - o.bottom) <= 1.5) continue;   // the shared edge itself
        covers.push(name(el) + ' covered by ' + name(other)); break;
      }
    }
    for (const [a, [l, t]] of moved) a.scrollTo({ left: l, top: t, behavior: 'instant' });   // instant: a smooth box would still be moving
    window.scrollTo({ left: sx, top: sy, behavior: 'instant' });
    const fields = [];
    for (const el of document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="color"]), textarea, select, [contenteditable="true"], [contenteditable=""]')) {
      if (el.disabled || !shown(el) || !onPage(el.getBoundingClientRect())) continue;
      const fontPx = parseFloat(getComputedStyle(el).fontSize);
      if (fontPx < minFont - 0.01) fields.push(name(el) + ' ' + fontPx + 'px');
    }
    return { taps, fields, covers };
  }, { minTap: MIN_TAP_PX, minFont: MIN_FIELD_FONT_PX });
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  // A control with a mistyped name would arm nothing and pass; refuse it instead.
  if (COVER_CONTROL && !['overlay', 'spill'].includes(COVER_CONTROL)) {
    throw new Error('MSHOTS_COVER_CONTROL must be overlay or spill, not ' + COVER_CONTROL);
  }
  if (args.list) { for (const s of SCREENS) console.log(s.name.padEnd(20) + s.owner); return 0; }
  const screens = args.screens ? SCREENS.filter((s) => args.screens.includes(s.name)) : SCREENS;
  // The overlay control is planted by allow-card only; on any other screen it would arm nothing and pass.
  if ((COVER_CONTROL === 'overlay' || COVER_CONTROL === 'spill') && !screens.some((s) => s.name === 'allow-card')) {
    throw new Error('MSHOTS_COVER_CONTROL=' + COVER_CONTROL + ' needs the allow-card screen');
  }
  // The long code is about 450px wide (1.9rem mono), inside the desktop card, so spill with no phone size would arm nothing and pass.
  if (COVER_CONTROL === 'spill' && args.sizes.every((sz) => SIZES[sz].desktop)) {
    throw new Error('MSHOTS_COVER_CONTROL=spill needs a phone size');
  }
  /* Nothing to shoot is not a pass: every requested screen is skipped at the sizes asked for (phone-only at desktop,
     desktop-only at a phone). Decided before any browser or board starts (tools.mobile-shots-desktop.test.js). */
  const planned = args.sizes.reduce((n, sz) => n + screens.filter((sc) => !(SIZES[sz].desktop ? sc.phoneOnly : sc.desktopOnly)).length, 0);
  if (!planned) throw new Error('no shot would be taken: every requested screen is skipped at these sizes (phone-only at desktop, desktop-only at a phone)');
  // Test hook (tools.mobile-shots-desktop.test.js): report the plan and stop, before any browser or board.
  if (process.env.MSHOTS_PLAN_ONLY === '1') { console.log(`planned ${planned} screen(s) per theme and engine`); return 0; }
  const { chromium, webkit } = require('playwright');
  const engines = { chromium, webkit };
  const out = args.out || fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-shots-'));
  fs.mkdirSync(out, { recursive: true });
  DATA = DATA_SETS[args.data];
  SEED_LEFTOVER = screens.some((s) => s.name === 'leftover-delete');

  const board = await startBoard();
  const rows = [];
  const skipped = [];   // phone-only screens at desktop, desktop-only ones at a phone size: listed in both reports, never silently absent
  let overflowCount = 0, errors = 0;
  try {
    const ctxData = await seed(board.base, board.roots);
    await preflight(board.base);
    for (const en of args.engines) {
      const browser = await engines[en].launch();
      try {
        for (const sz of args.sizes) {
          const s = SIZES[sz];
          for (const theme of args.themes) {
            for (const sc of screens) {
              if (s.desktop ? sc.phoneOnly : sc.desktopOnly) {
                const why = s.desktop ? 'phone-only screen' : 'desktop-only screen';
                // The same shape as a shot row, so report.json stays one kind of entry.
                skipped.push({ file: null, screen: sc.name, owner: sc.owner, size: sz, theme, engine: en, note: '', taps: [], fields: [], audited: false, skipped: why });
                console.log(`skip  ${sc.name}--${sz}--${theme}--${en}: a ${why}`);
                continue;
              }
              /* A fresh context per screen: the board remembers choices (layout,
                 open sections) in localStorage, and one screen's clicks must not
                 decide what the next screen looks like. */
              const ctx = await browser.newContext({
                viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.dpr,
                // isMobile is Chromium-only in Playwright (WebKit refuses it); both get touch on a phone.
                isMobile: !s.desktop && en === 'chromium', hasTouch: !s.desktop, colorScheme: theme,
                // A page.route stub needs the service worker off in WebKit (see allow-card).
                ...(sc.noServiceWorker || DATA.connected ? { serviceWorkers: 'block' } : {}),
              });
              if (DATA.connected) {
                await ctx.route('**/api/status', async (r) => {
                  const res = await r.fetch();
                  const body = await res.json().catch(() => null);
                  if (!body || typeof body !== 'object') return r.fulfill({ response: res });
                  body.connection = { ...(body.connection || {}), state: 'connected' };
                  return r.fulfill({ response: res, json: body });
                });
              }
              await ctx.addInitScript((t) => { try { localStorage.setItem('kosmos-theme', t); } catch { /* no storage */ } }, theme);
              const page = await ctx.newPage();
              const pageErrors = [];
              page.on('pageerror', (e) => pageErrors.push(String(e)));
              const file = `${sc.name}--${sz}--${theme}--${en}.png`;
              let note = '';
              let fit = { taps: [], fields: [], covers: [] };
              let audited = false;   // true only once the phone audits have actually run on this screen
              try {
                await page.goto(board.base + '/', { waitUntil: 'load' });
                await page.waitForTimeout(900);
                if (await page.isVisible('#firstrun')) await page.keyboard.press('Escape');
                await sc.go(page, ctxData);
                await page.waitForTimeout(250);
                const leaks = await leaksOn(page);
                if (leaks.length) {
                  const err = new Error('LEAK GUARD: this screen shows real data (' + leaks.length + ' hits, e.g. '
                    + leaks[0] + '). Stopping with no further shots.');
                  err.leak = true;
                  throw err;
                }
                await page.screenshot({ path: path.join(out, file), scale: args.scale });
                /* The page re-renders on its tick, so the scan above and the shot are two reads:
                   scan again, and a hit painted in between deletes the shot before anything
                   else can pick it up. */
                const late = await leaksOn(page);
                if (late.length) {
                  try { fs.rmSync(path.join(out, file), { force: true }); } catch { /* best effort */ }
                  const err = new Error('LEAK GUARD: this screen shows real data (' + late.length + ' hits after the shot, e.g. '
                    + late[0] + '). Its shot is deleted. Stopping with no further shots.');
                  err.leak = true;
                  throw err;
                }
                const ov = await overflowOf(page);
                if (ov.containers.length || ov.worst) {
                  overflowCount++;
                  note = 'OVERFLOW ' + ov.containers.map((c) => `${c.sel} ${c.scrollWidth}>${c.clientWidth}`).join(', ')
                    + (ov.worst ? ` widest: ${ov.worst.tag}${ov.worst.id ? '#' + ov.worst.id : ''}${ov.worst.cls ? '.' + ov.worst.cls.split(' ')[0] : ''} to ${ov.worst.right}px of ${ov.vw}` : '');
                }
                if (!s.desktop) { fit = await fitOf(page); audited = true; }
              } catch (e) {
                if (e.leak) { await ctx.close(); throw e; }
                errors++;
                note = 'ERROR ' + String(e.message || e).split('\n')[0];
              }
              // kosmos#4594: a screen's verify says the shot is the screen meant; if not, the shot goes and the row errors.
              let shotGone = false;
              if (sc.verify && !/ERROR/.test(note)) {
                try { await sc.verify(page, ctxData); } catch (e) {
                  try { fs.rmSync(path.join(out, file), { force: true }); } catch { /* best effort */ }
                  shotGone = true;
                  errors++;
                  note += (note ? '; ' : '') + 'ERROR verify (shot deleted): ' + String(e.message || e).split('\n')[0];
                }
              }
              /* A screen that changed the board's state puts it back here, whatever happened above,
                 so no later screen photographs it (#4545). A failure to is a flag on this row (counted
                 once: a row whose go() already errored is one errored screen, not two). */
              if (sc.after) {
                try { await sc.after(page, ctxData); } catch (e) { if (!/ERROR/.test(note)) errors++; note += (note ? '; ' : '') + 'ERROR after: ' + String(e.message || e).split('\n')[0]; }
              }
              if (pageErrors.length) note += (note ? '; ' : '') + 'page error: ' + pageErrors.splice(0).join(' | ').slice(0, 200);
              /* report.json and report.md travel with the shots: everything this row carries (the
                 tap-target names, overflow and ERROR notes, page errors) passes the same checks,
                 once the note is complete. */
              const inReport = hitsIn(JSON.stringify(fit) + ' ' + note);
              if (inReport.length) {
                try { fs.rmSync(path.join(out, file), { force: true }); } catch { /* best effort */ }
                await ctx.close();
                const err = new Error('LEAK GUARD: this screen\'s report would carry real data (' + inReport.length + ' hits, e.g. '
                  + inReport[0] + '). Its shot is deleted. Stopping with no further shots.');
                err.leak = true;
                throw err;
              }
              rows.push({ file: shotGone ? null : file, deleted: shotGone, screen: sc.name, owner: sc.owner, size: sz, theme, engine: en, note, taps: fit.taps, fields: fit.fields, covers: fit.covers || [], audited, skipped: null });
              console.log((note ? 'FLAG  ' : 'ok    ') + file + (note ? '  ' + note : '')
                + (!audited ? '  phone audits: n/a'
                  : `  taps<${MIN_TAP_PX}: ${fit.taps.length}  fields<${MIN_FIELD_FONT_PX}px: ${fit.fields.length}  covers: ${(fit.covers || []).length}`));
              await ctx.close();
            }
          }
        }
      } finally { await browser.close(); }
    }
    if (args.keep) {
      console.log(`\n--keep: the throwaway board stays up at ${board.base} (data in ${board.roots.DATA}); Ctrl-C to stop.`);
      await new Promise((r) => { process.once('SIGINT', r); process.once('SIGTERM', r); });
    }
  } finally {
    const died = board.srv.exitCode !== null || board.srv.signalCode !== null;   // the board went away on its own (exit or signal)
    board.srv.kill();
    for (const d of Object.values(board.roots)) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
    if (died || errors) {
      try {
        const tail = fs.readFileSync(board.stderrLog, 'utf8').trim().split('\n').slice(-10).join('\n');
        if (tail) console.log('\nthe throwaway board\'s stderr ended:\n' + tail);
      } catch { /* none */ }
    }
    try { fs.rmSync(board.stderrLog, { force: true }); } catch { /* best effort */ }
  }

  const md = ['# Mobile screenshots', '',
    `Throwaway board with the ${args.data} data set. WebKit is an engine approximation of iOS Safari, not Safari; Chromium at a phone size is not an Android phone. Phone audits read n/a where they did not run (the desktop size, or a screen that errored).`, '',
    `Shots: ${rows.filter((r) => r.file).length}${rows.some((r) => !r.file) ? ` (plus ${rows.filter((r) => !r.file).length} deleted by its verify)` : ''}. Flagged: ${rows.filter((r) => r.note).length} (overflow ${overflowCount}, errors ${errors}).`, '',
    `Skipped (phone-only at the desktop size, desktop-only at a phone size): ${skipped.length ? skipped.map((k) => `${k.screen}--${k.size}--${k.theme}--${k.engine}`).join(', ') : 'none'}.`, '',
    `| screen | owner | size | theme | engine | file | flag | taps<${MIN_TAP_PX} | fields<${MIN_FIELD_FONT_PX}px | covers |`, '|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.screen} | ${r.owner} | ${SIZES[r.size].label} ${SIZES[r.size].width}x${SIZES[r.size].height} | ${r.theme} | ${r.engine} | ${r.file || '(deleted)'} | ${r.note.replace(/\|/g, '/')} | ${r.audited ? r.taps.length : 'n/a'} | ${r.audited ? r.fields.length : 'n/a'} | ${r.audited ? (r.covers || []).length : 'n/a'} |`)];
  fs.writeFileSync(path.join(out, 'report.md'), md.join('\n') + '\n');
  // Every small target and field by name, for whoever fixes the screen.
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify([...rows, ...skipped], null, 1) + '\n');
  console.log(`\n${rows.length} shots, ${overflowCount} with overflow, ${errors} errors, ${skipped.length} skipped -> ${out}`);
  /* tools/browser-checks.sh quotes a red's reason from lines starting FAIL. */
  if (errors) { console.error(`FAIL  mobile-shots: ${errors} shot(s) could not be taken; see the ERROR lines above`); return 2; }
  if (args.strict && overflowCount) { console.error(`FAIL  mobile-shots: ${overflowCount} shot(s) overflow sideways; see the FLAG lines above`); return 1; }
  return 0;
}

if (require.main === module) {
  run().then((code) => process.exit(code), (e) => {
    console.error('FAIL  mobile-shots: ' + (e.leak ? e.message : (e.stack || e)));
    process.exit(e.leak ? 3 : 2);
  });
}

