// Browser-check-surface: data-start-at-sign-in set-machine set-machine-msg startAtSignIn
/**
 * win32-installer-native (#3010): the "Start Kosmos when I sign in to Windows" switch on
 * Settings > This computer, rendered and clicked, with a Mac page as the control.
 *
 * 🛑 WHAT THIS EXISTS TO CATCH. The switch is a `.toggle` whose position is COMPUTED: the knob
 * slides by a CSS transform on `.toggle.on i`. A markup test can see `aria-checked` flip while the
 * knob a person looks at stays put. It also cannot see a click that repaints from the click
 * instead of from what the engine read back. So this drives the real page, answers /api/machine
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
 * ⚠️ HTTP, NOT file:// (#3010). The earlier hermetic file:// version could not CLICK the switch in
 * CI: `page.click` timed out on a hit-test/actionability check over `file://` (measured: it fixes
 * clean over http, ~63ms, with the switch's own knob at the click point). So this runs against the
 * served board (KOSMOS_URL) and controls only /api/machine, /api/machine/start-at-sign-in and
 * /api/first-run with `page.route` (the render-token-usage-2617 pattern); every other request hits
 * the real board. The switch's runtime state comes from the mocked /api/machine, its platform from
 * the page's own kosmos-platform meta + applyPlatformCopy, exactly as a win32 board would render it.
 *
 * Run (booted board on PORT):
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-win32-start-at-sign-in.js http://127.0.0.1:PORT
 *   (HEADED by default; HEADED=0 on a console-less machine, as run_one sets it.)
 */
'use strict';

let playwright;
try { playwright = require('playwright'); }
catch {
  console.log('render-win32-start-at-sign-in: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const BASE = process.argv[2] || process.env.KOSMOS_URL || 'http://127.0.0.1:4399';
const ENGINES = ['chromium', 'webkit'];
const LABEL = 'Start Kosmos when I sign in to Windows';
const REFUSAL = 'we could not set the board to start at logon again (ERROR: Access is denied.)';
const SWITCH = '#set-machine [data-start-at-sign-in]';
const UNREAD_MSG = 'We could not read whether Kosmos starts when you sign in just now.';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

// The /api/machine body for a given remembered state. Mirrors the engine's own row shapes.
function machineJson(st) {
  let row;
  if (st.platform !== 'win32') row = { key: 'autostart', state: 'ok', title: 'Kosmos starts itself when you log in', detail: 'Its login job is in place.' };
  else if (!st.known) row = { key: 'autostart', state: 'unknown', title: 'We could not check whether Kosmos starts when you sign in', detail: 'Not the same as it being wrong.' };
  else row = { key: 'autostart', state: st.on ? 'ok' : 'attention', title: st.on ? 'Kosmos starts itself when you sign in' : 'It is turned off', detail: 'D', startAtSignIn: st.on };
  return { checks: [row], attention: 0, unknown: 0, appLocation: null };
}

/* Open the page against the served board. State lives HERE (node side); the routes read and mutate
   it, so a click's POST and the /api/machine re-read stay consistent across the whole arm sequence.
   Only the three machine/first-run routes are stubbed; everything else hits the real board. */
async function openPage(browser, platform) {
  const st = { platform, on: true, known: true, readable: true, postStatus: 200, postError: '' };
  const posts = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.route('**/api/machine/start-at-sign-in', async (route) => {
    const body = JSON.parse((route.request().postData()) || '{}');
    posts.push(body);
    if (st.postStatus !== 200) return route.fulfill({ status: st.postStatus, contentType: 'application/json', body: JSON.stringify({ error: st.postError }) });
    st.on = body.on;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, on: st.on }) });
  });
  await page.route('**/api/machine', async (route) => {
    if (!st.readable) return route.abort('failed'); // the reader throws -> the page's "could not read" path
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(machineJson(st)) });
  });
  await page.route('**/api/first-run*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ done: true }) }));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const ready = await page.evaluate((plat) => {
    if (typeof refreshMachineRows !== 'function' || typeof showTab !== 'function' || typeof settingsOpen !== 'function') return false;
    if (plat === 'win32') {
      const meta = document.querySelector('meta[name="kosmos-platform"]');
      if (meta) meta.setAttribute('content', 'win32');
      if (typeof applyPlatformCopy === 'function') applyPlatformCopy(document);
    }
    /* Open "This computer" the way the app does (showTab('settings') then settingsOpen('mac')),
       so #set-machine is the visible, hit-testable top view rather than one stacked under others. */
    showTab('settings');
    settingsOpen('mac', { focus: false });
    return true;
  }, platform);
  return { ctx, page, errors, ready, st, posts };
}

/* What a person sees of the switch: whether it is there and visible, its state, its label, and
   where the knob sits. */
async function readSwitch(page) {
  return page.evaluate((sel) => {
    const sw = document.querySelector(sel);
    const msg = document.getElementById('set-machine-msg');
    const shown = (el) => Boolean(el) && !el.hidden && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
    if (!sw) return { present: false, msgShown: shown(msg), msg: msg ? msg.textContent : null };
    const knob = sw.querySelector('i');
    const row = sw.closest('.setrow');
    const tf = getComputedStyle(knob).transform;
    return {
      present: true,
      visible: shown(sw),
      checked: sw.getAttribute('aria-checked'),
      role: sw.getAttribute('role'),
      label: row && row.querySelector('b') ? row.querySelector('b').textContent : null,
      knobShift: new DOMMatrixReadOnly(tf === 'none' ? undefined : tf).m41,
      msgShown: shown(msg),
      msg: msg ? msg.textContent : null,
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
      await win.page.waitForSelector(SWITCH, { state: 'visible', timeout: 5000 }).catch(() => {});
      const on = await readSwitch(win.page);
      check(`${engine}: a row read as on draws a visible switch`, on.present && on.visible, JSON.stringify(on));
      check(`${engine}: the switch is a labelled switch, on`, on.role === 'switch' && on.checked === 'true' && on.label === LABEL, JSON.stringify(on));
      check(`${engine}: the knob sits at the on end`, on.knobShift > 10, String(on.knobShift));

      // click -> off, repainted from a fresh /api/machine read (not from the click).
      await win.page.click(SWITCH);
      await win.page.waitForFunction((sel) => document.querySelector(sel) && document.querySelector(sel).getAttribute('aria-checked') === 'false', SWITCH, { timeout: 5000 }).catch(() => {});
      const off = await readSwitch(win.page);
      check(`${engine}: the click asks for off`, JSON.stringify(win.posts) === '[{"on":false}]', JSON.stringify(win.posts));
      check(`${engine}: the switch repaints off from the engine's read, knob at rest`, off.present && off.checked === 'false' && Math.abs(off.knobShift) < 1, JSON.stringify(off));
      check(`${engine}: a change that worked shows no message`, !off.msgShown, off.msg);

      // Windows refuses (409): the sentence shows, the switch stays where the engine says.
      win.st.postStatus = 409; win.st.postError = REFUSAL;
      await win.page.click(SWITCH);
      await win.page.waitForFunction(() => { const m = document.getElementById('set-machine-msg'); return m && !m.hidden; }, null, { timeout: 5000 }).catch(() => {});
      const refused = await readSwitch(win.page);
      check(`${engine}: Windows refusing shows its sentence`, refused.msgShown && refused.msg === REFUSAL, JSON.stringify(refused));
      check(`${engine}: a refused click leaves the switch where the engine says (off)`, refused.present && refused.checked === 'false', JSON.stringify(refused));
      check(`${engine}: the refusal was a second POST`, win.posts.length === 2, JSON.stringify(win.posts));

      // The rows cannot be read again after a click: the switch is taken away and the page says so.
      win.st.postStatus = 200; win.st.readable = false;
      await win.page.click(SWITCH);
      await win.page.waitForFunction((sel) => !document.querySelector(sel), SWITCH, { timeout: 5000 }).catch(() => {});
      const unread = await readSwitch(win.page);
      check(`${engine}: rows that cannot be read again take the switch away and say so`,
        !unread.present && unread.msgShown && unread.msg === UNREAD_MSG, JSON.stringify(unread));

      // unknown: a row whose state the engine could not read draws no switch.
      win.st.readable = true; win.st.known = false;
      await win.page.evaluate(() => refreshMachineRows());
      const unknown = await readSwitch(win.page);
      const unknownRow = await win.page.evaluate(() => document.getElementById('set-machine').textContent);
      check(`${engine}: a state nobody could read draws no switch`, !unknown.present && /could not check whether Kosmos starts/.test(unknownRow), unknownRow.slice(0, 80));
    }
    check(`${engine}: the Windows page raised no errors`, win.errors.length === 0, win.errors.join(' | '));
    await win.ctx.close();

    // CONTROL: a Mac page draws the autostart row and carries no switch.
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
  console.log(`\nrender-win32-start-at-sign-in: ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('FAIL  render-win32-start-at-sign-in threw: ' + ((e && e.message) || e)); process.exit(1); });
