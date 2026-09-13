// Browser-check-surface: data-start-at-sign-in set-machine set-machine-msg startAtSignIn
/**
 * win32-installer-native (W-21a): the "Start Kosmos when I sign in to Windows" switch on
 * Settings > This computer, rendered and clicked, with a Mac page as the control.
 *
 * 🛑 WHAT THIS EXISTS TO CATCH. The switch is a `.toggle` whose position is COMPUTED: the knob
 * slides by a CSS transform on `.toggle.on i`. A markup test can see `aria-checked` flip while the
 * knob a person looks at stays put. It also cannot see a click that repaints from the click
 * instead of from what the engine read back. So this loads the real page, answers its fetches
 * with a scheduler that remembers the switch, clicks, and reads what a person would see.
 *
 * Arms, in chromium and webkit:
 *   - on: drawn, visible, labelled, aria-checked true, knob slid right;
 *   - click: POST {on:false}, then a fresh /api/machine read repaints it off, knob at rest;
 *   - Windows refuses (409): the sentence is shown, and the switch stays where the engine says;
 *   - the rows cannot be read again after a click: the switch is taken away and the page says so;
 *   - unknown: a row whose state the engine could not read draws no switch;
 *   - CONTROL, a Mac page: the Mac autostart row renders and carries no switch;
 *   - no page errors on either page (an unfiltered `pageerror` listener).
 *
 * ⚠️ HERMETIC: loads web/index.html over file://, boots no server. The page's fetches are stubbed
 * before it loads, render-autohello-2686.js's `addInitScript` shape (as render-win32-board-copy.js
 * does), so WebKit's file:// access-control refusals never surface as page errors and nothing is
 * filtered.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-win32-start-at-sign-in.js
 *   (HEADED by default; HEADED=0 on a console-less machine, as run_one sets it.)
 */
'use strict';
const nodePath = require('node:path');

let playwright;
try { playwright = require('playwright'); }
catch {
  console.log('render-win32-start-at-sign-in: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const ENGINES = ['chromium', 'webkit'];
const LABEL = 'Start Kosmos when I sign in to Windows';
const REFUSAL = 'we could not set the board to start at logon again (ERROR: Access is denied.)';
const SWITCH = '#set-machine [data-start-at-sign-in]';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

/* Installed before any page script runs. A small scheduler that remembers the switch: the POST
   changes it (or refuses), and /api/machine reports it, or cannot be read. Every other request
   gets the benign answer render-autohello-2686.js uses. */
function stubPageFetches() {
  window.__posts = [];
  window.__machine = { platform: 'win32', on: true, known: true, readable: true, postStatus: 200, postError: '' };
  const enc = (o, status) => new Response(JSON.stringify(o), {
    status: status || 200, headers: { 'content-type': 'application/json' },
  });
  window.fetch = async (url, init) => {
    const u = String(url);
    const st = window.__machine;
    if (u === '/api/machine/start-at-sign-in') {
      const body = JSON.parse((init && init.body) || '{}');
      window.__posts.push(body);
      if (st.postStatus !== 200) return enc({ error: st.postError }, st.postStatus);
      st.on = body.on;
      return enc({ ok: true, on: st.on });
    }
    if (u === '/api/machine') {
      if (!st.readable) throw new TypeError('Failed to fetch');
      let row;
      if (st.platform !== 'win32') row = { key: 'autostart', state: 'ok', title: 'Kosmos starts itself when you log in', detail: 'Its login job is in place.' };
      else if (!st.known) row = { key: 'autostart', state: 'unknown', title: 'We could not check whether Kosmos starts when you sign in', detail: 'Not the same as it being wrong.' };
      else row = { key: 'autostart', state: st.on ? 'ok' : 'attention', title: st.on ? 'Kosmos starts itself when you sign in' : 'It is turned off', detail: 'D', startAtSignIn: st.on };
      return enc({ checks: [row], attention: 0, unknown: 0, appLocation: null });
    }
    return enc({ agents: [] });
  };
}

async function openPage(browser, platform) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.addInitScript(stubPageFetches);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + PAGE);
  const ready = await page.evaluate((plat) => {
    if (typeof refreshMachineRows !== 'function' || typeof applyPlatformCopy !== 'function'
      || typeof showTab !== 'function' || typeof settingsOpen !== 'function') return false;
    window.__machine.platform = plat;
    if (plat === 'win32') {
      document.querySelector('meta[name="kosmos-platform"]').setAttribute('content', 'win32');
      applyPlatformCopy(document);
    }
    /* Open "This computer" the way the app does (index.html: showTab('settings') then
       settingsOpen('mac')), so #set-machine is the visible, hit-testable top view.
       Merely stripping `hidden`/`display:none` off its ancestors left the other
       top-level views stacked over it, so page.click hit a covering element and timed
       out on a target it could never reach. */
    showTab('settings');
    settingsOpen('mac', { focus: false });
    return true;
  }, platform);
  return { ctx, page, errors, ready };
}

/* What a person sees of the switch: whether it is there and visible, its state, its label, and
   where the knob sits. */
async function readSwitch(page) {
  return page.evaluate((sel) => {
    const sw = document.querySelector(sel);
    const msg = document.getElementById('set-machine-msg');
    const shown = (el) => Boolean(el) && !el.hidden && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
    if (!sw) return { present: false, msgShown: shown(msg), msg: msg.textContent };
    const knob = sw.querySelector('i');
    const row = sw.closest('.setrow');
    return {
      present: true,
      visible: shown(sw),
      checked: sw.getAttribute('aria-checked'),
      role: sw.getAttribute('role'),
      label: row ? row.querySelector('b').textContent : null,
      knobShift: new DOMMatrixReadOnly(getComputedStyle(knob).transform === 'none' ? undefined : getComputedStyle(knob).transform).m41,
      msgShown: shown(msg),
      msg: msg.textContent,
    };
  }, SWITCH);
}

(async () => {
  for (const engine of ENGINES) {
    let browser;
    try {
      browser = await playwright[engine].launch({ headless: process.env.HEADED === '0' });
    } catch (e) {
      check(`${engine}: a browser starts`, false, String((e && e.message) || e).split('\n')[0]);
      continue;
    }

    const win = await openPage(browser, 'win32');
    check(`${engine}: the page has refreshMachineRows and the platform layer`, win.ready);
    if (win.ready) {
      await win.page.evaluate(() => refreshMachineRows());
      const on = await readSwitch(win.page);
      check(`${engine}: a row read as on draws a visible switch`, on.present && on.visible, JSON.stringify(on));
      check(`${engine}: the switch is a labelled switch, on`, on.role === 'switch' && on.checked === 'true' && on.label === LABEL, JSON.stringify(on));
      check(`${engine}: the knob sits at the on end`, on.knobShift > 10, String(on.knobShift));

      await win.page.waitForSelector(SWITCH, { state: 'visible' });
      await win.page.click(SWITCH);
      await win.page.waitForFunction((sel) => window.__posts.length === 1 && document.querySelector(sel)
        && document.querySelector(sel).getAttribute('aria-checked') === 'false', SWITCH, { timeout: 5000 }).catch(() => {});
      const posts = await win.page.evaluate(() => window.__posts);
      const off = await readSwitch(win.page);
      check(`${engine}: the click asks for off`, JSON.stringify(posts) === '[{"on":false}]', JSON.stringify(posts));
      check(`${engine}: the switch repaints off from the engine's read, knob at rest`, off.present && off.checked === 'false' && Math.abs(off.knobShift) < 1, JSON.stringify(off));
      check(`${engine}: a change that worked shows no message`, !off.msgShown, off.msg);

      await win.page.evaluate((error) => { window.__machine.postStatus = 409; window.__machine.postError = error; }, REFUSAL);
      await win.page.waitForSelector(SWITCH, { state: 'visible' });
      await win.page.click(SWITCH);
      await win.page.waitForFunction(() => window.__posts.length === 2 && !document.getElementById('set-machine-msg').hidden, null, { timeout: 5000 }).catch(() => {});
      const refused = await readSwitch(win.page);
      check(`${engine}: Windows refusing shows its sentence`, refused.msgShown && refused.msg === REFUSAL, JSON.stringify(refused));
      check(`${engine}: a refused click leaves the switch where the engine says (off)`, refused.present && refused.checked === 'false', JSON.stringify(refused));

      await win.page.evaluate(() => { window.__machine.postStatus = 200; window.__machine.readable = false; });
      await win.page.waitForSelector(SWITCH, { state: 'visible' });
      await win.page.click(SWITCH);
      await win.page.waitForFunction((sel) => window.__posts.length === 3 && !document.querySelector(sel), SWITCH, { timeout: 5000 }).catch(() => {});
      const unread = await readSwitch(win.page);
      check(`${engine}: rows that cannot be read again take the switch away and say so`,
        !unread.present && unread.msgShown && unread.msg === 'We could not read whether Kosmos starts when you sign in just now.', JSON.stringify(unread));

      await win.page.evaluate(() => { window.__machine.readable = true; window.__machine.known = false; });
      await win.page.evaluate(() => refreshMachineRows());
      const unknown = await readSwitch(win.page);
      const unknownRow = await win.page.evaluate(() => document.getElementById('set-machine').textContent);
      check(`${engine}: a state nobody could read draws no switch`, !unknown.present && /could not check whether Kosmos starts/.test(unknownRow), unknownRow.slice(0, 80));
    }
    check(`${engine}: the Windows page raised no errors`, win.errors.length === 0, win.errors.join(' | '));
    await win.ctx.close();

    const mac = await openPage(browser, 'darwin');
    if (mac.ready) {
      await mac.page.evaluate(() => refreshMachineRows());
      const macSwitch = await readSwitch(mac.page);
      const macRow = await mac.page.evaluate(() => document.getElementById('set-machine').textContent);
      check(`${engine}: CONTROL a Mac autostart row renders`, /Kosmos starts itself when you log in/.test(macRow), macRow.slice(0, 80));
      check(`${engine}: CONTROL a Mac autostart row carries no switch`, !macSwitch.present, JSON.stringify(macSwitch));
    } else {
      check(`${engine}: CONTROL the Mac page loaded`, false);
    }
    check(`${engine}: the Mac page raised no errors`, mac.errors.length === 0, mac.errors.join(' | '));
    await mac.ctx.close();

    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
