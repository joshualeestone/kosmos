// Browser-check-surface: recovery-slot reviewer-slot topnotes plus-org-recoveries panel-settings
'use strict';
/**
 * kosmos#5536 (#5529): the board tells a member their own backup was opened to someone. Drives the real page, file://,
 * fetch stubbed, on chromium and webkit:
 *   - rows this browser has not seen show ONE notice in the floating stack, with See who and a close, naming nobody;
 *   - its x (from the keyboard) closes it, focus stays on the board, the next read keeps it closed, and a newer row shows
 *     it again (CONTROL: the x is not a permanent mute);
 *   - the reviewer notice beside it closes apart: closing one leaves the other;
 *   - See who opens Settings at Kosmos+ with the recoveries list on screen, and the notice is gone;
 *   - a family and a computer in no company get none; a failed read keeps the notice;
 *   - a list taller than the screen lands on its top with the newest row in view, then counts as seen;
 *   - at 375 x 667 (both themes) the notice is on screen with See who and its x at least 44 px tall.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-recoverynote-5536.js [shots-dir]
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
const DAY = 86400;

async function open(browser, w, h, theme, eng) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, hasTouch: w < 700, isMobile: w < 700 && eng === 'chromium' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => {
    window.setInterval = () => 0;   // no poll of the page's own: the check calls the notice itself
    const enc = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json' } });
    window.GRANTS = { enrolled: false, kind: null, reviewerGrants: [] };
    window.GRANTS_STATUS = 200;
    window.fetch = async (url) => {
      const u = String(url);
      if (u.startsWith('/api/org/grants')) return enc(window.GRANTS, window.GRANTS_STATUS);
      if (u === '/api/org') {
        return enc({ enrolled: true, org: { name: 'Acme', slug: 'acme', kind: window.GRANTS.kind || 'company' }, role: 'member',
          enrolledAt: 1, reporting: true, reviewerGrants: window.GRANTS.reviewerGrants, recoveries: window.GRANTS.recoveries || [] });
      }
      if (u === '/api/remote') return enc({ enrolled: true, on: true, configured: true, status: { state: 'up' } });
      if (u.startsWith('/api/history')) return enc({ readable: false });
      return enc({ ok: true });
    };
  });
  await page.goto(PAGE);
  await page.evaluate(() => {
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
    document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
    try { localStorage.removeItem('kosmos.recoveriesSeen'); localStorage.removeItem('kosmos.reviewerGrantsSeen'); } catch { /* none */ }
    if (typeof showTab === 'function') showTab('agents');
  });
  return { ctx, page, errs };
}

/* Sets the grants answer, lets the notice read it now, and returns what the slot shows. */
async function read(page, answer, status) {
  return page.evaluate(async ([a, s]) => {
    window.GRANTS = a; window.GRANTS_STATUS = s || 200;
    REVIEWER_NOTE.at = 0;
    reviewerNoteMaybe();
    for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 25));
    const slot = document.getElementById('recovery-slot');
    const notes = slot.querySelectorAll('.utoast.recovery-note');
    const b = notes[0] && notes[0].querySelector('.utxt b');
    return { count: notes.length, words: b ? b.textContent : null, text: slot.textContent,
      see: !!slot.querySelector('button[data-recovery-see]'), x: !!slot.querySelector('button.ux[data-recovery-hide]'),
      inStack: !!slot.closest('#topnotes'), reviewerNotes: document.querySelectorAll('#reviewer-slot .utoast').length };
  }, [answer, status]);
}

let STEP = 'start';
const WATCHDOG = setTimeout(() => { console.log('FAIL  render-recoverynote-5536 did not finish in 4 minutes (stuck at: ' + STEP + ')'); process.exit(3); }, 240000);
(async () => {
  const engines = (process.env.ENGINES || 'chromium,webkit').split(',').filter(Boolean);
  for (const eng of engines) {
    const browser = await pw[eng].launch();
    const t = `[${eng}]`;
    STEP = eng + ' 1280';
    const now = Math.floor(Date.now() / 1000);
    const company = (recoveries, reviewerGrants) => ({ enrolled: true, kind: 'company', reviewerGrants: reviewerGrants || [], recoveries });
    const given = (ago) => ({ what: 'key_released', at: now - ago, who: 'Pat Lee', epoch: 2 });
    const opened = (ago) => ({ what: 'files_opened', at: now - ago, who: 'Pat Lee', epoch: 2, count: 7 });
    const { ctx, page, errs } = await open(browser, 1280, 800, 'light', eng);

    const first = await read(page, company([opened(DAY), given(2 * DAY)]));
    chk(first.count === 1 && first.see && first.x && first.inStack && first.words === 'Someone was given access to your backup.' && !first.text.includes('Pat Lee'),
      `${t} two new rows show one notice in the floating stack, with See who and a close, naming nobody`, JSON.stringify(first));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `recoverynote-${eng}-light.png`) });

    STEP = eng + ' x from the keyboard';
    await page.focus('#recovery-slot button.ux');
    await page.keyboard.press('Enter');
    const focusAfter = await page.evaluate(() => { const a = document.activeElement; return !!a && a !== document.body && a.getClientRects().length > 0; });
    const closed = await read(page, company([opened(DAY), given(2 * DAY)]));
    chk(closed.count === 0 && focusAfter, `${t} its x (from the keyboard) closes it, focus lands on something visible, and the next read keeps it closed`, JSON.stringify({ ...closed, focusAfter }));
    const again = await read(page, company([opened(60), opened(DAY), given(2 * DAY)]));
    chk(again.count === 1, `${t} a newer row shows it again (CONTROL: the x is not a permanent mute)`, JSON.stringify(again));

    STEP = eng + ' closes apart';
    const grant = { who: 'Sam Ortiz', grantedAt: now - DAY, effectiveAt: now };
    const both = await read(page, company([opened(60), opened(DAY), given(2 * DAY)], [grant]));
    chk(both.count === 1 && both.reviewerNotes === 1, `${t} it and the reviewer notice show together`, JSON.stringify(both));
    await page.click('#reviewer-slot button.ux');
    const after = await read(page, company([opened(60), opened(DAY), given(2 * DAY)], [grant]));
    chk(after.count === 1 && after.reviewerNotes === 0, `${t} closing the reviewer notice leaves this one up`, JSON.stringify(after));

    STEP = eng + ' see who';
    await page.click('#recovery-slot button[data-recovery-see]');
    await page.waitForTimeout(800);
    // Stands in for the page's 5 s tick, off in this check: in the app that repaint marks the list seen once in view.
    await page.evaluate(() => plusOrgPaint());
    const went = await page.evaluate(() => {
      const box = document.getElementById('plus-org-recoveries');
      const r = box && box.getBoundingClientRect();
      return { settings: !document.getElementById('panel-settings').hidden, sec: typeof SETTINGS_SEC !== 'undefined' ? SETTINGS_SEC : null,
        listShown: !!box && !box.hidden, listOnScreen: !!r && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight,
        notice: document.querySelectorAll('#recovery-slot .utoast').length, focus: document.activeElement && document.activeElement.id };
    });
    chk(went.settings && went.sec === 'plus' && went.listShown && went.listOnScreen && went.notice === 0 && went.focus === 'plus-org-recoveries-head',
      `${t} See who opens Settings at Kosmos+ with the list on screen and its heading focused, and the notice is gone`, JSON.stringify(went));

    await page.evaluate(() => { showTab('agents'); });
    STEP = eng + ' family';
    const fam = await read(page, { enrolled: true, kind: 'family', reviewerGrants: [], recoveries: [given(30)] });
    chk(fam.count === 0, `${t} a family gets no notice, whatever the answer holds`, JSON.stringify(fam));
    const back = await read(page, company([given(30)]));
    chk(back.count === 1, `${t} the same row shows for a company (CONTROL)`, JSON.stringify(back));
    STEP = eng + ' failed read';
    const failed = await read(page, null, 500);
    chk(failed.count === 1, `${t} a failed read keeps the notice on screen`, JSON.stringify(failed));
    const none = await read(page, { enrolled: false, kind: null, reviewerGrants: [] });
    chk(none.count === 0, `${t} a computer in no company gets no notice`, JSON.stringify(none));
    chk(errs.length === 0, `${t} 1280x800: no page errors`, errs.join(' | '));
    await ctx.close();

    for (const theme of ['light', 'dark']) {
      STEP = eng + ' 375 ' + theme;
      const p = await open(browser, 375, 667, theme, eng);
      await read(p.page, company([given(DAY)]));
      const fit = await p.page.evaluate(() => {
        const r = (sel) => document.querySelector(sel).getBoundingClientRect();
        const on = (b) => b.top >= 0 && b.left >= 0 && b.bottom <= innerHeight && b.right <= innerWidth;
        const see = r('#recovery-slot button[data-recovery-see]'), x = r('#recovery-slot button.ux');
        return { note: on(r('#recovery-slot .utoast')), see: on(see), x: on(x), seeH: Math.round(see.height), xH: Math.round(x.height), xW: Math.round(x.width) };
      });
      chk(fit.note && fit.see && fit.x && fit.seeH >= 44 && fit.xH >= 44 && fit.xW >= 44,
        `${t} 375x667 ${theme}: the notice is on screen, See who and its x at least 44 px`, JSON.stringify(fit));
      if (SHOTS) await p.page.screenshot({ path: path.join(SHOTS, `recoverynote-${eng}-375-${theme}.png`) });
      chk(p.errs.length === 0, `${t} 375x667 ${theme}: no page errors`, p.errs.join(' | '));
      await p.ctx.close();
    }
    STEP = eng + ' long list';
    const long = await open(browser, 375, 667, 'light', eng);
    const rows = Array.from({ length: 50 }, (_, i) => ({ ...given(600 + i * 3600), who: 'Reviewer with a long name ' + i }));
    await read(long.page, company(rows));
    await long.page.click('#recovery-slot button[data-recovery-see]');
    await long.page.waitForTimeout(800);
    await long.page.evaluate(() => plusOrgPaint());
    const top = await long.page.evaluate(() => {
      const box = document.getElementById('plus-org-recoveries').getBoundingClientRect();
      const first = document.querySelector('#plus-org-recoveries-list p').getBoundingClientRect();
      return { tall: box.height > innerHeight, firstOn: first.top >= 0 && first.bottom <= innerHeight, seen: JSON.parse(localStorage.getItem('kosmos.recoveriesSeen') || '[]').length };
    });
    chk(top.tall && top.firstOn && top.seen === 50, `${t} a list taller than the screen lands with its newest row in view, and counts as seen`, JSON.stringify(top));
    await long.ctx.close();
    await browser.close();
  }
  if (engines.length === 0) chk(false, 'ENGINES named no engine, so nothing ran');
  const EXPECTED_PER_ENGINE = 16;
  if (RAN !== EXPECTED_PER_ENGINE * engines.length) chk(false, `ran ${RAN} checks, expected ${EXPECTED_PER_ENGINE * engines.length}`);
  clearTimeout(WATCHDOG);
  console.log(`render-recoverynote-5536: ${RAN - fail.length} PASS, ${fail.length} FAIL`);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
