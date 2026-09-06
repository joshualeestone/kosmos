'use strict';

/**
 * kosmos#2037 (+ #11, 0.6.39): the first-run wizard SCREEN 6 ("self improving")
 * consent switch must be a real, keyboard-operable, default-ON opt-OUT control.
 *
 * The markup ships a static role=switch span (#fr-s6-feedback, the daily report),
 * and the behavior is wired: click AND Space/Enter flip aria-checked and PUT the
 * backend (/api/feedback-setting), the frGo step-6 branch refreshes on show, and a
 * could-not-read leaves the switch at its default-ON position (never a false Off).
 * #11 (0.6.39) removed the second switch (#fr-s6-createping) from this screen per
 * Josh; the create-agent-ping feature lives on the Create-an-Agent screen (#2020).
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
    if (!fb) return { error: 'S6 switch span (#fr-s6-feedback) is missing' };
    // #11 (0.6.39): the create-ping switch was removed from this screen; it must be gone.
    const pgGone = !document.getElementById('fr-s6-createping');
    const rd = (el) => el.getAttribute('aria-checked');
    const roles = { fb: fb.getAttribute('role') };
    const initial = { fb: rd(fb) };

    // Show step 6 (the pane is hidden until then) so we prove it is reachable and
    // visible. frGo(6) also runs the refresher, which fetches on file:// and fails
    // -- its catch must leave the default-ON markup untouched (never a false Off).
    let paneVisible = null;
    if (typeof frGo === 'function') {
      try { frGo(6); } catch (e) { /* keep going; the click arms are the core */ }
      await new Promise((res) => setTimeout(res, 0));
      const pane = fb.closest('.fr-pane');
      paneVisible = pane ? (!pane.hidden && getComputedStyle(pane).display !== 'none') : null;
    }
    const afterShow = { fb: rd(fb) };   // still default-ON after a failed refresh

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

    // Real bound CLICK on the feedback switch (role=switch, mouse modality).
    fb.click();
    await new Promise((res) => setTimeout(res, 0));
    const afterFbClick = rd(fb);          // -> "false"

    // The OTHER modality (keyboard) on the same switch: Enter toggles it back.
    fb.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((res) => setTimeout(res, 0));
    const afterFbEnter = rd(fb);          // back to "true"

    window.fetch = realFetch;
    const put = (u) => calls.some((c) => c.url.indexOf(u) !== -1 && c.method === 'PUT');
    return {
      roles, initial, pgGone, paneVisible, afterShow, afterFbClick, afterFbEnter,
      fbPut: put('/api/feedback-setting'), calls,
    };
  });

  await browser.close();

  const problems = [];
  if (r.error) {
    problems.push(r.error);
  } else {
    if (r.roles.fb !== 'switch') problems.push('the S6 consent control is not role=switch (' + JSON.stringify(r.roles) + ')');
    if (!r.pgGone) problems.push('the create-ping switch (id fr-s6-createping) is still present -- #11 removed it from this screen');
    if (r.initial.fb !== 'true') problems.push('the feedback switch is not default-ON (#2037): aria-checked=' + r.initial.fb);
    if (r.paneVisible === false) problems.push('frGo(6) did not show the Screen 6 pane (it stayed hidden)');
    if (r.afterShow.fb !== 'true') problems.push('the switch flipped to Off after the on-show refresh failed to read -- a false Off (' + JSON.stringify(r.afterShow) + ')');
    if (r.afterFbClick !== 'false') problems.push('clicking the feedback switch did not toggle it (wiring absent?): aria-checked=' + r.afterFbClick);
    if (!r.fbPut) problems.push('clicking the feedback switch sent no PUT to /api/feedback-setting');
    if (r.afterFbEnter !== 'true') problems.push('Enter on the feedback switch did not toggle it back (the OTHER modality is unwired): aria-checked=' + r.afterFbEnter);
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-firstrun-s6-2037: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-firstrun-s6-2037: OK (Screen 6 feedback switch default-ON, click + Enter toggle and PUT /api/feedback-setting; create-ping switch removed per #11)');
  process.exit(0);
})();
