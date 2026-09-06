'use strict';

/**
 * kosmos#2037 + #2020 (PR-C2): the first-run wizard SCREEN 6 ("self improving")
 * consent switches must be real, keyboard-operable, default-ON opt-OUT controls.
 *
 * Renet's markup ships two static role=switch spans (#fr-s6-feedback daily report,
 * #fr-s6-createping create ping), and PR-C2 wired the behavior: click AND Space/
 * Enter flip aria-checked and PUT the existing backends (/api/feedback-setting,
 * /api/ping-setting), the frGo step-6 branch refreshes on show, and a could-not-
 * read leaves the switch at its default-ON position (never a false Off).
 *
 * ⚠️ WHY A BROWSER. The node test (web.firstrun-consent-prc2.test.js) lifts the S6
 * block and runs it against a DOM stub. THIS drives the REAL page: the real bound
 * click/keydown listeners on the real markup, in a real browser, with the real
 * frGo(6) showing the pane. It reds on a page where the wiring is absent (the
 * spans render but a click does nothing and no PUT is sent) -- the exact regression
 * a source-grep or a stubbed unit test cannot catch.
 *
 * Run (HERMETIC -- loads web/index.html over file://, boots no server):
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-firstrun-s6-2037.js
 *
 * ⚠️ HEADED by default; HEADED=0 on a console-less machine. Asserts rendered DOM.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-firstrun-s6-2037: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-firstrun-s6-2037: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(async () => {
    const fb = document.getElementById('fr-s6-feedback');
    const pg = document.getElementById('fr-s6-createping');
    if (!fb || !pg) return { error: 'S6 switch spans (#fr-s6-feedback / #fr-s6-createping) are missing' };
    const rd = (el) => el.getAttribute('aria-checked');
    const roles = { fb: fb.getAttribute('role'), pg: pg.getAttribute('role') };
    const initial = { fb: rd(fb), pg: rd(pg) };

    // Show step 6 (the pane is hidden until then) so we prove it is reachable and
    // visible. frGo(6) also runs the refreshers, which fetch on file:// and fail
    // -- their catch must leave the default-ON markup untouched (never a false Off).
    let paneVisible = null;
    if (typeof frGo === 'function') {
      try { frGo(6); } catch (e) { /* keep going; the click arms are the core */ }
      await new Promise((res) => setTimeout(res, 0));
      const pane = fb.closest('.fr-pane');
      paneVisible = pane ? (!pane.hidden && getComputedStyle(pane).display !== 'none') : null;
    }
    const afterShow = { fb: rd(fb), pg: rd(pg) };   // still default-ON after a failed refresh

    // Stub fetch AFTER the refresh, so we measure the toggle's own PUT. Capture the
    // calls and confirm the new state so the optimistic flip is not reverted.
    const calls = [];
    const realFetch = window.fetch;
    window.fetch = (url, opts) => {
      calls.push({ url: String(url), method: (opts && opts.method) || 'GET' });
      // Echo the requested state, like the real backend: a PUT {on:X} confirms {on:X}.
      // (A canned constant would fight the optimistic flip on a toggle back to ON.)
      let on = false;
      try { on = !!JSON.parse((opts && opts.body) || '{}').on; } catch { /* GET: default */ }
      return Promise.resolve({ ok: true, json: async () => ({ on, ok: true }) });
    };

    // Real bound CLICK on the feedback switch.
    fb.click();
    await new Promise((res) => setTimeout(res, 0));
    const afterFbClick = rd(fb);

    // Real bound KEYDOWN (Space) on the create-ping switch (role=switch a11y).
    pg.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    await new Promise((res) => setTimeout(res, 0));
    const afterPgSpace = rd(pg);

    // Cover the OTHER modality on EACH switch (both are bound by the same wire()
    // helper, but a regression could break one modality on one switch). Toggle each
    // back: feedback via Enter keydown, create-ping via a real click.
    fb.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((res) => setTimeout(res, 0));
    const afterFbEnter = rd(fb);          // back to "true"
    pg.click();
    await new Promise((res) => setTimeout(res, 0));
    const afterPgClick = rd(pg);          // back to "true"

    window.fetch = realFetch;
    const put = (u) => calls.some((c) => c.url.indexOf(u) !== -1 && c.method === 'PUT');
    return {
      roles, initial, paneVisible, afterShow, afterFbClick, afterPgSpace, afterFbEnter, afterPgClick,
      fbPut: put('/api/feedback-setting'), pgPut: put('/api/ping-setting'), calls,
    };
  });

  await browser.close();

  const problems = [];
  if (r.error) {
    problems.push(r.error);
  } else {
    if (r.roles.fb !== 'switch' || r.roles.pg !== 'switch') problems.push('a S6 consent control is not role=switch (' + JSON.stringify(r.roles) + ')');
    if (r.initial.fb !== 'true') problems.push('the feedback switch is not default-ON (#2037): aria-checked=' + r.initial.fb);
    if (r.initial.pg !== 'true') problems.push('the create-ping switch is not default-ON (#2020): aria-checked=' + r.initial.pg);
    if (r.paneVisible === false) problems.push('frGo(6) did not show the Screen 6 pane (it stayed hidden)');
    if (r.afterShow.fb !== 'true' || r.afterShow.pg !== 'true') problems.push('a switch flipped to Off after the on-show refresh failed to read -- a false Off (' + JSON.stringify(r.afterShow) + ')');
    if (r.afterFbClick !== 'false') problems.push('clicking the feedback switch did not toggle it (wiring absent?): aria-checked=' + r.afterFbClick);
    if (!r.fbPut) problems.push('clicking the feedback switch sent no PUT to /api/feedback-setting');
    if (r.afterPgSpace !== 'false') problems.push('Space on the create-ping switch did not toggle it (keydown wiring absent?): aria-checked=' + r.afterPgSpace);
    if (!r.pgPut) problems.push('Space on the create-ping switch sent no PUT to /api/ping-setting');
    if (r.afterFbEnter !== 'true') problems.push('Enter on the feedback switch did not toggle it back (the OTHER modality is unwired): aria-checked=' + r.afterFbEnter);
    if (r.afterPgClick !== 'true') problems.push('clicking the create-ping switch did not toggle it back (the OTHER modality is unwired): aria-checked=' + r.afterPgClick);
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-firstrun-s6-2037: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-firstrun-s6-2037: OK (Screen 6 consent switches default-ON, click + Space toggle and PUT their backends)');
  process.exit(0);
})();
