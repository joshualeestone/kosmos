// Browser-check-surface: plus-org-recoveries panel-settings
'use strict';
/**
 * kosmos#5536 (#5529: every recovery is shown to the affected employee): Settings at Kosmos+ lists the times this
 * member's own backup key was given to someone, and the files then opened, from /api/org (kosmos-relay #781's
 * `recoveries`). Drives the real page, file://, fetch stubbed, on chromium and webkit:
 *   - the list is on screen under the heading, newest first, a key given said as given and files opened with the count;
 *   - recoveriesMore adds the "Older ones" line; none, a family, and a computer in no company show nothing;
 *   - at 375 x 667 in both themes a long unbroken name wraps inside the list (nothing wider than the screen).
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-recoveries-5536.js [shots-dir]
 */
const path = require('node:path');
const pw = require('playwright');

const PAGE = 'file://' + (process.env.KOSMOS_PAGE || path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html'));
const SHOTS = process.argv[2] || '';
const fail = [];
let RAN = 0;
const chk = (ok, label, extra) => {
  RAN += 1;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

async function open(browser, w, h, theme, eng) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, hasTouch: w < 700, isMobile: w < 700 && eng === 'chromium' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => {
    window.setInterval = () => 0;   // no poll of the page's own: the check paints the block itself
    const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    window.ORG = { enrolled: false };
    window.fetch = async (url) => {
      const u = String(url);
      if (u === '/api/org') return enc(window.ORG);
      if (u.startsWith('/api/org/grants')) return enc({ enrolled: !!window.ORG.enrolled, kind: null, reviewerGrants: [] });
      if (u === '/api/remote') return enc({ enrolled: true, on: true, configured: true, status: { state: 'up' } });
      if (u.startsWith('/api/history')) return enc({ readable: false });
      return enc({ ok: true });
    };
  });
  await page.goto(PAGE);
  await page.evaluate(() => {
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
    document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
    showTab('settings'); settingsGo('plus');
  });
  return { ctx, page, errs };
}

/* Sets what /api/org answers, paints the Kosmos+ block from it, and returns what the recoveries block shows. */
async function show(page, org) {
  return page.evaluate(async (o) => {
    window.ORG = o;
    PLUS_ORG.at = 0;
    if (typeof plusOrgMaybe === 'function') plusOrgMaybe();
    for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 25));
    // No direct call: only the page's own refresh and paint (plusOrgMaybe, then plusOrgPaint) may fill the block.
    const box = document.getElementById('plus-org-recoveries');
    const list = document.getElementById('plus-org-recoveries-list');
    const r = box.getBoundingClientRect();
    const lines = [...list.querySelectorAll('p')];
    return {
      shown: !box.hidden && r.height > 0,
      head: document.getElementById('plus-org-recoveries-head').textContent,
      lines: lines.map((p) => p.textContent),
      more: !document.getElementById('plus-org-recoveries-more').hidden,
      wideLine: lines.some((p) => p.scrollWidth > p.clientWidth + 1),
      widePage: document.documentElement.scrollWidth > innerWidth + 1,
      lineW: lines.map((p) => [p.scrollWidth, p.clientWidth]),
    };
  }, org);
}

let STEP = 'start';
const WATCHDOG = setTimeout(() => { console.log('FAIL  render-recoveries-5536 did not finish in 4 minutes (stuck at: ' + STEP + ')'); process.exit(3); }, 240000);
(async () => {
  const engines = (process.env.ENGINES || 'chromium,webkit').split(',').filter(Boolean);
  for (const eng of engines) {
    const browser = await pw[eng].launch();
    const t = `[${eng}]`;
    const now = Math.floor(Date.now() / 1000);
    const org = (recs, extra) => ({ enrolled: true, org: { name: 'Acme', slug: 'acme', kind: 'company' }, role: 'member', enrolledAt: 1,
      reporting: true, recoveries: recs, recoveriesAt: Date.now(), ...(extra || {}) });
    const RECS = [
      { what: 'files_opened', who: 'Pat Lee', at: now - 3600, epoch: 3, count: 7 },
      { what: 'key_released', who: 'Pat Lee', at: now - 7200, epoch: 3 },
    ];
    STEP = eng + ' 1280';
    const { ctx, page, errs } = await open(browser, 1280, 800, 'light', eng);
    const a = await show(page, org(RECS));
    chk(a.shown && a.head === 'Who was given access to your backup in the last 30 days:',
      `${t} the list is on screen under its heading`, JSON.stringify(a));
    chk(a.lines.length === 2 && /^Pat Lee opened 7 files from your backup, /.test(a.lines[0]) && /^Pat Lee was given your backup key, /.test(a.lines[1]),
      `${t} newest first: files opened with the count, then the key given, said as given`, JSON.stringify(a.lines));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `recoveries-${eng}-1280-light.png`) });
    const m = await show(page, org(RECS, { recoveriesMore: true }));
    chk(m.shown && m.more, `${t} recoveriesMore adds the "Older ones" line`, JSON.stringify(m));
    STEP = eng + ' none';
    const none = await show(page, org([]));
    const fam = await show(page, { ...org(RECS), org: { name: 'Lee family', slug: 'lee', kind: 'family' } });
    const out = await show(page, { enrolled: false });
    chk(!none.shown && !fam.shown && !out.shown, `${t} none, a family, and a computer in no company show nothing`,
      JSON.stringify({ none: none.shown, fam: fam.shown, out: out.shown }));
    chk(errs.length === 0, `${t} 1280x800: no page errors`, errs.join(' | '));
    await ctx.close();

    for (const theme of ['light', 'dark']) {
      STEP = eng + ' 375 ' + theme;
      const p = await open(browser, 375, 667, theme, eng);
      const long = await show(p.page, org([{ what: 'key_released', who: 'Averyveryveryverylongnamewithnospacesatall-reviewer', at: now - 60 }, ...RECS]));
      chk(long.shown && long.lines.length === 3 && !long.wideLine && !long.widePage, `${t} 375x667 ${theme}: a long name wraps inside the list, nothing wider than the screen`, JSON.stringify(long));
      if (SHOTS) {
        await p.page.evaluate(() => document.getElementById('plus-org-recoveries').scrollIntoView({ block: 'center' }));
        await p.page.screenshot({ path: path.join(SHOTS, `recoveries-${eng}-375-${theme}.png`) });
      }
      chk(p.errs.length === 0, `${t} 375x667 ${theme}: no page errors`, p.errs.join(' | '));
      await p.ctx.close();
    }
    await browser.close();
  }
  if (engines.length === 0) chk(false, 'ENGINES named no engine, so nothing ran');
  const EXPECTED_PER_ENGINE = 9;
  if (RAN !== EXPECTED_PER_ENGINE * engines.length) chk(false, `ran ${RAN} checks, expected ${EXPECTED_PER_ENGINE * engines.length}`);
  clearTimeout(WATCHDOG);
  console.log(`render-recoveries-5536: ${RAN - fail.length} PASS, ${fail.length} FAIL`);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
