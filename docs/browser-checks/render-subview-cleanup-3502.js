'use strict';
// Browser-check-surface: docs-back pj-settings-back docs-finder pj-docs-view pj-settings-view
// (#2518) the distinctive web/index.html tokens this check asserts: the three consolidated
// project sub-view "Back to ..." buttons that #3502 hides, the Documents/Settings sub-view
// containers whose consolidated insets #3502/#3503 set, and the Finder button #3504 restyles.
// A change to any of them must update this check at PR time.
/* #3502/#3503/#3504 (Josh, 2026-09-23, consolidated project sub-views):
 *  - #3502: the redundant "Back to <project>" buttons (#docs-back, #pj-settings-back; the
 *    all-tasks screen's #alltasks-back went with that screen in #3703) are hidden in the CONSOLIDATED view (kept in the tab view), and
 *    with the back button gone the headings must keep a top inset so they do not jump
 *    against the top rule (Josh flagged Settings by name).
 *  - #3503: Documents (and the all-tasks screen, retired in #3703) get a LEFT inset matching the right one (content was
 *    flush against the left rule). Settings is centered, so it is excluded.
 *  - #3504: "Open this folder in Finder" (#docs-finder) is the gold primary button, not a
 *    plain text link.
 *
 * 🔑 WHAT ONLY A BROWSER CAN SAY: these are computed-style + rendered-geometry facts
 * (display:none, paddingLeft, a heading's top offset, a background colour) that a source
 * grep cannot verify. The consolidated conditions are set the way the app sets them
 * (data-layout=consolidated + body.consolidated at >=960px), and each assertion is paired
 * with a tab-view CONTROL so a rule that hid the back button everywhere, or that never
 * applied at all, would fail.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-subview-cleanup-3502.js
 *      (HEADED=0 on a machine with no console session)
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const WEB_DIR = path.resolve(__dirname, '..', '..', 'web');
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname === '/' ? '/index.html' : u.pathname;
  const fp = path.join(WEB_DIR, p);
  if (fp.startsWith(WEB_DIR) && fs.existsSync(fp) && fs.statSync(fp).isFile()) {
    res.writeHead(200, { 'content-type': 'text/html' }); fs.createReadStream(fp).pipe(res);
  } else { res.writeHead(404); res.end('nf'); }
});

let failures = 0, ran = 0;
const say = (n, cond, note) => { ran++; if (cond) console.log('PASS  ' + n); else { failures++; console.log('FAIL  ' + n + '  --  ' + (note || 'assertion failed')); } };


(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}`;
  const agents = [{ sessionName: 'a1', name: 'Agent One', status: 'idle' }];
  const project = { id: 'p1', name: 'Frontier AI Investments thesis research', agents: [{ sessionName: 'a1', name: 'Agent One' }] };
  const browser = await chromium.launch({ headless: process.env.HEADED === '0', ignoreDefaultArgs: ['--hide-scrollbars'] });

  // Boot the app at a given layout, open project p1, and return a probe of each sub-view.
  async function boot(layout) {
    // 1280px clears the 960px consolidated floor; consolidated only when layout says so.
    const width = 1280;
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: 'light' });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.route('**/api/**', async (route) => {
      const pth = new URL(route.request().url()).pathname; let body = {};
      if (pth === '/api/style') body = { layout, tokens: {}, theme: 'light', themes: [{ key: 'light', label: 'Light' }] };
      else if (pth === '/api/status') body = { agents };
      else if (pth === '/api/projects') body = { projects: [project] };
      else body = {};
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(`${BASE}/index.html?project=p1`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const probe = (viewId) => page.evaluate((vId) => {
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      ['pj-one-view', 'pj-docs-view', 'pj-settings-view', 'pj-add-view']
        .forEach((v) => { const el = document.getElementById(v); if (el) el.hidden = (v !== vId); });
      const view = document.getElementById(vId);
      if (!view) return { missing: true };
      const back = view.querySelector('.back');
      const cs = getComputedStyle(view);
      const heading = view.querySelector('h2, .dname, .dlab, h3');
      const vr = view.getBoundingClientRect();
      const hr = heading ? heading.getBoundingClientRect() : null;
      const finder = document.getElementById('docs-finder');
      return {
        backDisplay: back ? getComputedStyle(back).display : 'no-back',
        padLeft: parseFloat(cs.paddingLeft) || 0,
        padTop: parseFloat(cs.paddingTop) || 0,
        headingGap: hr ? Math.round(hr.top - vr.top) : null,
        finderClass: finder ? finder.className : null,
        finderBg: finder ? getComputedStyle(finder).backgroundColor : null,
      };
    }, viewId);
    const out = {};
    // #3502 focus behaviour: click the REAL settings cog and read where focus lands. This runs
    // BEFORE the force-show probes below (which hide #pj-one-view where the cog lives). In the
    // consolidated view the back button is hidden, so the handler must focus the settings heading
    // rather than the (unfocusable) back button; in the tab view the back button is still shown and
    // is the target. Done first so the cog is in its natural state.
    out.focus = await page.evaluate(() => {
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      // The first-run overlay marks the background panels `inert` while it is up (an inert
      // ancestor blocks ALL descendant focus). The real app clears that on dismissal; this
      // hermetic boot bypasses the dismissal, so clear it here to reproduce the dismissed state.
      // Without this, focus can land nowhere in the settings view and the assertion is meaningless.
      document.querySelectorAll('[inert]').forEach((e) => e.removeAttribute('inert'));
      const cog = document.getElementById('pj-settings-link');
      if (!cog) return { noCog: true };
      cog.click();
      const ae = document.activeElement;
      const back = document.getElementById('pj-settings-back');
      return {
        backHidden: back ? getComputedStyle(back).display === 'none' : 'no-back',
        activeIsHeading: !!(ae && ae.matches && ae.matches('#pj-settings-view .dname')),
        activeIsBack: !!(ae && ae.id === 'pj-settings-back'),
        activeIsBody: ae === document.body,
      };
    });
    for (const v of ['pj-docs-view', 'pj-settings-view']) out[v] = await probe(v);
    out.errs = errs;
    await ctx.close();
    return out;
  }

  const cons = await boot('consolidated');
  const tabs = await boot('tabs');

  // #3502: back buttons hidden in consolidated, for both remaining sub-views (the all-tasks
  // screen went in #3703: its door opens the Tasks view, which has no back button of its own).
  say('#3502 consolidated Documents back button is hidden', cons['pj-docs-view'].backDisplay === 'none', JSON.stringify(cons['pj-docs-view']));
  say('#3502 consolidated Settings back button is hidden', cons['pj-settings-view'].backDisplay === 'none', JSON.stringify(cons['pj-settings-view']));
  // CONTROL: the back buttons still render in the TAB view (the rule is consolidated-scoped, not a blanket removal).
  say('#3502 CONTROL: Documents back button still shows in the tab view', tabs['pj-docs-view'].backDisplay !== 'none', JSON.stringify(tabs['pj-docs-view']));
  say('#3502 CONTROL: Settings back button still shows in the tab view', tabs['pj-settings-view'].backDisplay !== 'none', JSON.stringify(tabs['pj-settings-view']));

  // #3502: with the back gone, each heading keeps a top inset (does not touch the top rule).
  say('#3502 Documents heading keeps a top inset (>=16px, not jumped to the rule)', cons['pj-docs-view'].headingGap >= 16, JSON.stringify(cons['pj-docs-view']));
  say('#3502 Settings heading keeps a top inset (>=16px, Josh flagged Settings by name)', cons['pj-settings-view'].headingGap >= 16, JSON.stringify(cons['pj-settings-view']));

  // #3503: Documents gets a left inset in consolidated; Settings (centered) does not.
  say('#3503 consolidated Documents has a left inset (>0)', cons['pj-docs-view'].padLeft > 0, JSON.stringify(cons['pj-docs-view']));
  say('#3503 consolidated Settings has NO left inset (it is centered, correctly excluded)', cons['pj-settings-view'].padLeft === 0, JSON.stringify(cons['pj-settings-view']));

  // #3504: the Finder button is the gold primary button, not a plain text link.
  say('#3504 the Finder button carries the gold primary class (btn uprime)', /\buprime\b/.test(cons['pj-docs-view'].finderClass || ''), cons['pj-docs-view'].finderClass);
  say('#3504 the Finder button paints a non-transparent gold background', !!cons['pj-docs-view'].finderBg && cons['pj-docs-view'].finderBg !== 'rgba(0, 0, 0, 0)', cons['pj-docs-view'].finderBg);

  // #3502 focus fix: opening Settings via the cog must land keyboard focus INSIDE the view, not
  // strand it on the cog/body. In consolidated the back button is hidden, so focus goes to the
  // settings heading; the tab-view control proves the back button is still the target there. This
  // fails on the pre-fix markup, where the handler focused the (now display:none) back button and
  // focus fell to <body>.
  say('#3502 consolidated: opening Settings focuses the settings heading (back hidden, focus not stranded on body)',
    cons.focus.backHidden === true && cons.focus.activeIsHeading === true && cons.focus.activeIsBody === false, JSON.stringify(cons.focus));
  // Tab-view focus is NOT asserted here: the fix's tab-view branch (`if backShown: back.focus()`)
  // preserves the pre-fix handler's focus behaviour (focus the back button when visible), and the tab-view back button's visibility is already
  // controlled by the "back button still shows in the tab view" assertions above -- so the
  // consolidated arm is the only behavioural change, and it is the one guarded (positive-controlled:
  // it fails on the pre-fix markup, where the handler focused the now-hidden back button).

  say('no page errors (consolidated boot)', cons.errs.length === 0, cons.errs.join(' | '));
  say('no page errors (tab boot)', tabs.errs.length === 0, tabs.errs.join(' | '));

  await browser.close();
  server.close();
  console.log('\n' + (ran - failures) + ' passed, ' + failures + ' FAILED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); try { server.close(); } catch { /* noop */ } process.exit(1); });
