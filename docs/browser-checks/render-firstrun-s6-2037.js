// Browser-check-surface: fr-s6-feedback fr-s6-community
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
 * #4820 (Josh, 2026-09-30): a second switch, #fr-s6-community, directly under the
 * feedback one: default ON, its label exactly "Let your agents join the Kosmos
 * community to help make Kosmos better.", a click PUTs {on:false} to
 * /api/community-setting, and a refused PUT puts it back ON (never a false Off).
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

    // #4820: the Community switch, read with the same instruments.
    const cm = document.getElementById('fr-s6-community');
    let community = null;
    if (cm) {
      const fbRow = fb.closest('.s6-switch-row');
      const cmRow = cm.closest('.s6-switch-row');
      const lbl = document.getElementById(cm.getAttribute('aria-labelledby') || '');
      // Over file:// the first-run overlay stays hidden, so neither switch has a box; show it to measure.
      const fr = document.getElementById('firstrun');
      const frWasHidden = fr ? fr.hidden : null;
      if (fr) fr.hidden = false;
      const box = cm.getBoundingClientRect();
      const fbBox = fb.getBoundingClientRect();
      if (fr) fr.hidden = frWasHidden;
      const cmCalls = [];
      // A click with a board that saves: the PUT it sends is recorded with its body.
      window.fetch = (url, opts) => {
        cmCalls.push({ url: String(url), method: (opts && opts.method) || 'GET', body: (opts && opts.body) || '' });
        let on = false;
        try { on = !!JSON.parse((opts && opts.body) || '{}').on; } catch { /* GET */ }
        return Promise.resolve({ ok: true, json: async () => ({ on, ok: true, share: null }) });
      };
      const initialCm = rd(cm);
      cm.click();
      await new Promise((res) => setTimeout(res, 0));
      const afterCmClick = rd(cm);
      const cmPut = cmCalls.find((c) => c.method === 'PUT') || null;
      // Back ON with Enter, then a click with a board that REFUSES the save: it must revert to ON.
      cm.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((res) => setTimeout(res, 0));
      const afterCmEnter = rd(cm);
      window.fetch = () => Promise.resolve({ ok: false, json: async () => ({ error: 'we could not save that setting' }) });
      cm.click();
      await new Promise((res) => setTimeout(res, 0));
      await new Promise((res) => setTimeout(res, 0));
      const afterRefused = rd(cm);
      window.fetch = realFetch;
      community = {
        role: cm.getAttribute('role'), tabindex: cm.getAttribute('tabindex'), initial: initialCm,
        nextRow: Boolean(fbRow && cmRow && fbRow.nextElementSibling === cmRow), samePane: Boolean(fb.closest('.fr-pane') === cm.closest('.fr-pane')),
        shown: box.width > 0 && box.height > 0, below: box.top >= fbBox.bottom, fbShown: fbBox.width > 0 && fbBox.height > 0,
        label: lbl ? lbl.textContent : null, lblClass: lbl ? lbl.className : null, swClass: cm.className,
        afterClick: afterCmClick, put: cmPut, afterEnter: afterCmEnter, afterRefused,
      };
    }
    return {
      roles, initial, pgGone, paneVisible, afterShow, afterFbClick, afterFbEnter,
      fbPut: put('/api/feedback-setting'), calls, community,
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
    // #4820: the Community switch.
    const c = r.community;
    if (!c) problems.push('the Community switch (#fr-s6-community) is missing from Screen 6');
    else {
      if (c.role !== 'switch' || c.tabindex !== '0' || c.swClass !== 's6-sw') problems.push('the Community switch is not the same role=switch control as the feedback one: ' + JSON.stringify([c.role, c.tabindex, c.swClass]));
      if (!c.samePane || !c.nextRow) problems.push('the Community switch is not the row directly under the diagnostics switch: ' + JSON.stringify([c.samePane, c.nextRow]));
      if (!c.shown || !c.fbShown || !c.below) problems.push('the Community switch is not laid out under the diagnostics switch on Screen 6: ' + JSON.stringify([c.shown, c.fbShown, c.below]));
      if (c.initial !== 'true') problems.push('the Community switch is not default-ON: aria-checked=' + c.initial);
      if (c.label !== 'Let your agents join the Kosmos+ community to help make Kosmos better.' || c.lblClass !== 's6-lbl') problems.push('the Community switch label is not Josh\'s line, exactly: ' + JSON.stringify([c.label, c.lblClass]));
      if (c.afterClick !== 'false') problems.push('clicking the Community switch did not turn it off: aria-checked=' + c.afterClick);
      if (!c.put || !/\/api\/community-setting$/.test(c.put.url) || c.put.body !== JSON.stringify({ on: false })) problems.push('clicking the Community switch did not PUT {"on":false} to /api/community-setting: ' + JSON.stringify(c.put));
      if (c.afterEnter !== 'true') problems.push('Enter on the Community switch did not turn it back on: aria-checked=' + c.afterEnter);
      if (c.afterRefused !== 'true') problems.push('a refused save left the Community switch Off (it must revert to ON): aria-checked=' + c.afterRefused);
    }
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-firstrun-s6-2037: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-firstrun-s6-2037: OK (Screen 6 feedback switch default-ON, click + Enter toggle and PUT /api/feedback-setting; create-ping switch removed per #11; #4820 Community switch under it, default-ON, exact label, click PUTs {on:false} to /api/community-setting, a refused save reverts)');
  process.exit(0);
})();
