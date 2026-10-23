// Browser-check-surface: reviewer-slot topnotes plus-org-reviewers panel-settings
'use strict';
/**
 * #6817 item 1: the board tells a member that someone in their company (or family) was made a reviewer. Drives the
 * real page, file://, fetch stubbed, on chromium and webkit:
 *   - a grant this browser has not seen (last 30 days, not removed) shows ONE notice in the floating stack, in the
 *     company's words, with See who and a close; two unseen grants still make one notice;
 *   - its x (from the keyboard) closes it, focus stays on the board, and a repaint keeps it closed; a newer grant later shows it again (CONTROL: the x is not a
 *     permanent mute);
 *   - See who opens Settings at Kosmos+, the reviewers list is on screen, and the notice is gone;
 *   - a grant undone a minute later raises nothing; a family's notice says "your family"; a computer in no company gets
 *     none; a failed read keeps the notice;
 *   - kosmos#6955: a reviewer made an admin raises nothing, and the Settings list says "now an admin since" for them and
 *     "no longer a reviewer since" for one set back to member;
 *   - at 375 x 667 (both themes) the notice is on screen with See who and its x at least 44 px tall.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-reviewerptr-6817.js [shots-dir]
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
    // What /api/org/grants answers; the check sets it. /api/org answers the same grants, joined, for the Settings list.
    window.GRANTS = { enrolled: false, kind: null, reviewerGrants: [] };
    window.GRANTS_STATUS = 200;
    window.ORG_READS = 0;
    window.fetch = async (url) => {
      const u = String(url);
      if (u.startsWith('/api/org/grants')) return enc(window.GRANTS, window.GRANTS_STATUS);
      if (u === '/api/org') {
        window.ORG_READS += 1;
        return enc({ enrolled: true, org: { name: 'Acme', slug: 'acme', kind: window.GRANTS.kind || 'company' }, role: 'member',
          enrolledAt: 1, reporting: true, reviewerGrants: window.GRANTS.reviewerGrants });
      }
      // Settings' Kosmos+ section reads /api/remote (paintPlus) and opens the company block only for an enrolled computer.
      if (u === '/api/remote') return enc({ enrolled: true, on: true, configured: true, status: { state: 'up' } });
      if (u.startsWith('/api/history')) return enc({ readable: false });   // Settings' own history panel, in its could-not-read shape
      return enc({ ok: true });
    };
  });
  await page.goto(PAGE);
  await page.evaluate(() => {
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
    document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
    try { localStorage.removeItem('kosmos.reviewerGrantsSeen'); } catch { /* none */ }
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
    const slot = document.getElementById('reviewer-slot');
    const notes = slot.querySelectorAll('.utoast.reviewer-note');
    const b = notes[0] && notes[0].querySelector('.utxt b');
    return { count: notes.length, words: b ? b.textContent : null,
      see: !!slot.querySelector('button[data-reviewer-see]'), x: !!slot.querySelector('button.ux[data-reviewer-hide]'),
      inStack: !!slot.closest('#topnotes') };
  }, [answer, status]);
}

/* A check that hangs holds the machine for everyone: four minutes, then it fails naming the step it was on. */
let STEP = 'start';
const WATCHDOG = setTimeout(() => { console.log('FAIL  render-reviewerptr-6817 did not finish in 4 minutes (stuck at: ' + STEP + ')'); process.exit(3); }, 240000);
(async () => {
  const engines = (process.env.ENGINES || 'chromium,webkit').split(',').filter(Boolean);
  for (const eng of engines) {
    const browser = await pw[eng].launch();
    const t = `[${eng}]`;
    STEP = eng + ' 1280';
    const now = Math.floor(Date.now() / 1000);
    const company = (grants) => ({ enrolled: true, kind: 'company', reviewerGrants: grants });
    const g = (ago) => ({ who: 'Pat Lee', grantedAt: now - ago, effectiveAt: now - ago + DAY });
    const { ctx, page, errs } = await open(browser, 1280, 800, 'light', eng);

    const first = await read(page, company([g(3 * DAY), g(DAY)]));
    chk(first.count === 1 && first.see && first.x && first.inStack && first.words === 'Someone was made a reviewer for your company.',
      `${t} two new grants show one notice in the floating stack, with See who and a close, in the company's words`, JSON.stringify(first));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `reviewerptr-${eng}-light.png`) });

    STEP = eng + ' x from the keyboard';
    await page.focus('#reviewer-slot button.ux');
    await page.keyboard.press('Enter');
    const focusAfter = await page.evaluate(() => { const a = document.activeElement; return !!a && a !== document.body && a.getClientRects().length > 0; });
    const closed = await read(page, company([g(3 * DAY), g(DAY)]));
    chk(closed.count === 0 && focusAfter, `${t} its x (from the keyboard) closes it, focus lands on something visible (not the page), and the next read keeps it closed`, JSON.stringify({ ...closed, focusAfter }));
    const again = await read(page, company([g(3 * DAY), g(DAY), g(60)]));
    chk(again.count === 1, `${t} a newer grant shows it again (CONTROL: the x is not a permanent mute)`, JSON.stringify(again));

    STEP = eng + ' see who';
    await page.click('#reviewer-slot button[data-reviewer-see]');
    await page.waitForTimeout(800);
    // The page's 5 s tick is off in this check; in the app it repaints Settings, which marks the list seen once in view.
    await page.evaluate(() => plusOrgPaint());
    const went = await page.evaluate(() => {
      const box = document.getElementById('plus-org-reviewers');
      const r = box && box.getBoundingClientRect();
      return { settings: !document.getElementById('panel-settings').hidden, sec: typeof SETTINGS_SEC !== 'undefined' ? SETTINGS_SEC : null,
        listShown: !!box && !box.hidden, listOnScreen: !!r && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight,
        notice: document.querySelectorAll('#reviewer-slot .utoast').length };
    });
    chk(went.settings && went.sec === 'plus' && went.listShown && went.listOnScreen && went.notice === 0,
      `${t} See who opens Settings at Kosmos+ with the reviewers list on screen, and the notice is gone`, JSON.stringify(went));

    await page.evaluate(() => { showTab('agents'); localStorage.removeItem('kosmos.reviewerGrantsSeen'); });
    STEP = eng + ' removed grant';
    const removed = await read(page, company([{ ...g(DAY / 2), removedAt: now - DAY / 2 + 60 }]));
    chk(removed.count === 0, `${t} a grant undone a minute later raises nothing`, JSON.stringify(removed));
    /* kosmos#6955: a reviewer made an admin is not a new reviewer (no notice), and the Settings list says what they are
       now; set back to member reads as no longer a reviewer. */
    STEP = eng + ' made an admin';
    const promoted = { ...g(3 * DAY), removedAt: now - DAY, roleNow: 'admin', roleChangedAt: now - DAY, leftAt: null };
    const adminNote = await read(page, company([promoted]));
    chk(adminNote.count === 0, `${t} a reviewer made an admin raises no notice`, JSON.stringify(adminNote));
    const lines = await page.evaluate(([a, b]) => {
      plusOrgReviewers({ enrolled: true, org: { kind: 'company' }, reviewerGrants: [a, b] });
      return [...document.querySelectorAll('#plus-org-reviewers-list p')].map((x) => x.textContent);
    }, [promoted, { ...g(2 * DAY), who: 'Lee Park', removedAt: now - DAY, roleNow: 'member', roleChangedAt: now - DAY }]);
    chk(lines.length === 2 && /^Lee Park, no longer a reviewer since /.test(lines[0]) && /^Pat Lee, now an admin since .+ \(made a reviewer .+\)$/.test(lines[1]),
      `${t} the Settings list says "now an admin" for one made an admin, and "no longer a reviewer" for one set back to member`, JSON.stringify(lines));
    // Its own grant: the x above marked g(DAY) seen in the page's memory, which clearing storage does not reset.
    const fam = await read(page, { enrolled: true, kind: 'family', reviewerGrants: [{ ...g(DAY), who: 'Sam Ortiz' }] });
    chk(fam.count === 1 && fam.words === 'Someone was made a reviewer for your family.', `${t} a family's notice says "your family"`, JSON.stringify(fam));
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
      await read(p.page, company([g(DAY)]));
      const fit = await p.page.evaluate(() => {
        const r = (sel) => document.querySelector(sel).getBoundingClientRect();
        const on = (b) => b.top >= 0 && b.left >= 0 && b.bottom <= innerHeight && b.right <= innerWidth;
        const see = r('#reviewer-slot button[data-reviewer-see]'), x = r('#reviewer-slot button.ux');
        return { note: on(r('#reviewer-slot .utoast')), see: on(see), x: on(x), seeH: Math.round(see.height), xH: Math.round(x.height), xW: Math.round(x.width) };
      });
      chk(fit.note && fit.see && fit.x && fit.seeH >= 44 && fit.xH >= 44 && fit.xW >= 44,
        `${t} 375x667 ${theme}: the notice is on screen, See who and its x at least 44 px`, JSON.stringify(fit));
      if (SHOTS) await p.page.screenshot({ path: path.join(SHOTS, `reviewerptr-${eng}-375-${theme}.png`) });
      chk(p.errs.length === 0, `${t} 375x667 ${theme}: no page errors`, p.errs.join(' | '));
      await p.ctx.close();
    }
    await browser.close();
  }
  if (engines.length === 0) chk(false, 'ENGINES named no engine, so nothing ran');
  const EXPECTED_PER_ENGINE = 15;
  if (RAN !== EXPECTED_PER_ENGINE * engines.length) chk(false, `ran ${RAN} checks, expected ${EXPECTED_PER_ENGINE * engines.length}`);
  clearTimeout(WATCHDOG);
  console.log(`render-reviewerptr-6817: ${RAN - fail.length} PASS, ${fail.length} FAIL`);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
