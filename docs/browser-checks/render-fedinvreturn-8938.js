// Browser-check-surface: fedinv-modal fedinv-label fedinv-kind-agent fedinv-make fedinv-msg stepup-ask noteFedInviteReturn resumeFedInviteReturn fedInviteReturnWait FEDINV_RETURN_LINE STEPUP_RETURN_FED_FOR
'use strict';
/**
 * kosmos#8938 item 4: Sign in again brings a company member back to the invite sheet. HERMETIC (file://, fetch
 * stubbed). Asserts, in the browser:
 *   R1  on the invite sheet, Make refused with remote_step_up + signInAgain shows the step-up ask for
 *       POST /api/federation/invite and leaves a tab note holding the project, the label and the kind only;
 *   R2  after Sign in again is pressed for it and the page loads again (the fresh sign-in navigating back), the page
 *       opens Projects, that project and its invite sheet with "Dana" and "Their agent" filled in, focus on Make, and
 *       the line "Your invitation is filled in again. Press Make an invite code."; nothing is sent (no code is made);
 * The press is the ask's own #stepup-form submit (navigation stopped), so the key the ask records is the key the mark
 * accepts. And the CONTROLS, each its own page: a reload with NO press opens no sheet; a press on the page after the
 * reload, before the return can act, opens no sheet and drops the note; a press, then a reload where the project is
 * gone, opens no sheet and drops the note; a 403 that offers no Sign in again leaves no note.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-fedinvreturn-8938.js [shots-dir]
 */
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-fedinvreturn-8938: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const SHOTS = process.argv[2] || null;
const fail = [];
const chk = (label, ok, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};
const KEY = 'kosmos-stepup-return';
const FED = { sourceChannel: 'prod', federationLive: true, kosmos_plus: true };
const STEPUP = { code: 'remote_step_up', signInAgain: true, error: 'For this, sign in to Kosmos+ again on this device.' };

/* sessionStorage keeps the project list for the page that loads next (a reload starts every window global over), so
   one arm can say "the project is gone after the sign-in". */
function initStub(cfg) {
  window.__posts = [];
  const enc = (status, o) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  const project = { id: 'k', name: 'Spring launch', parent: null, archived: false, description: '', agents: [], summary: {}, unread: 0 };
  window.fetch = async (url, opts) => {
    const u = String(url);
    const method = String((opts && opts.method) || 'GET').toUpperCase();
    if (u.includes('/api/federation/invite')) {
      let body = null;
      try { body = JSON.parse(String((opts && opts.body) || 'null')); } catch { body = 'unreadable'; }
      window.__posts.push(body);
      const refuse = sessionStorage.getItem('check-refuse') || 'stepup';
      const res = refuse === 'plain' ? enc(403, { error: 'Forbidden' }) : enc(403, cfg.stepup);
      // A constructed Response has no url; a real board's reply carries its own address, which the step-up ask records
      // as the refused request (requestKey: method and path). Given here so the ask records what it records live.
      Object.defineProperty(res, 'url', { value: new URL('/api/federation/invite', location.href).href });
      return res;
    }
    if (u.includes('/api/federation/members')) return enc(200, { owner: true, sealed: false, invites: [], checked_at: 1791115200 });
    if (/\/api\/projects(\?|$)/.test(u) && method === 'GET') {
      const gone = sessionStorage.getItem('check-gone') === '1';
      return enc(200, { ok: true, projects: gone ? [] : [project] });
    }
    if (/\/api\/project\/[^/]+\/room(\?|$)/.test(u)) return enc(200, { ok: true, rows: [], olderCount: 0, olderCursor: null });
    if (/\/api\/accounts(\?|$)/.test(u)) return enc(200, { accounts: [] });
    if (u.includes('/api/history')) return enc(200, { readable: false });
    return enc(200, Object.assign({ ok: true, agents: [] }, cfg.fed));
  };
}

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('kosmos.switcherTipSeen', '1'); } catch {} });
  await ctx.addInitScript(initStub, { fed: FED, stepup: STEPUP });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(PAGE);
  if (await page.isVisible('#firstrun')) await page.keyboard.press('Escape');
  return { ctx, page, errs };
}

// The first view: the project open, the sheet filled in ("Dana", their agent), Make pressed and refused.
async function refusedMake(page) {
  await page.evaluate(() => { const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true; showTab('projects'); });
  await page.waitForFunction(() => typeof PJ_LOADED_ONCE !== 'undefined' && PJ_LOADED_ONCE && typeof pjById === 'function' && !!pjById('k'), null, { timeout: 8000 })
    .catch(() => console.log('NOTE  the projects read had not landed in 8 s'));
  await page.evaluate((fed) => {
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
    document.querySelectorAll('body > [inert]').forEach((el) => el.removeAttribute('inert'));
    fedGateStamp(fed);
    showTab('projects');
    openProject('k');
    fedInviteOpen(null);
    window.__state = { fed: document.documentElement.getAttribute('data-fed-ui'), current: PJ_CURRENT, modal: !document.getElementById('fedinv-modal').hidden };
  }, FED);
  console.log('NOTE  first view: ' + JSON.stringify(await page.evaluate(() => window.__state)));
  await page.waitForFunction(() => !document.getElementById('fedinv-modal').hidden, null, { timeout: 5000 }).catch(() => {});
  await page.fill('#fedinv-label', 'Dana');
  await page.click('label:has(#fedinv-kind-agent)');   // the label is what a person presses
  await page.click('#fedinv-make');
  await page.waitForFunction(() => document.getElementById('fedinv-msg').textContent && !/Making/.test(document.getElementById('fedinv-msg').textContent), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  return page.evaluate((k) => {
    const box = document.getElementById('stepup-ask');
    return { posts: window.__posts.length, note: sessionStorage.getItem(k), askShown: !!box && !box.hidden, askFor: box ? box.stepUpFor : null };
  }, KEY);
}
// Sign in again, pressed: the ask's own form is submitted, so the page's capture listener marks the note from the key
// the ask recorded. Only the navigation is stopped (a bubbling listener on the window, after the page's own), since the
// fresh sign-in page does not exist on file://; the reload below stands in for coming back from it.
const press = (page) => page.evaluate(() => {
  window.addEventListener('submit', (e) => e.preventDefault());
  document.getElementById('stepup-form').requestSubmit();
});
async function afterReload(page, beforeGate) {
  await page.reload();
  // First run comes up on this stubbed board; the return waits behind it (and keeps the note) until it goes.
  if (await page.isVisible('#firstrun')) { await page.waitForTimeout(700); await page.keyboard.press('Escape'); }
  // The gate, stamped as /api/status's tick stamps it (this stub's status reply is too thin for the tick to get there;
  // render-federation-invite-4649 stamps it the same way). Until then inviting is off, and the return waits.
  await page.waitForTimeout(700);
  if (beforeGate) await beforeGate(page);
  await page.evaluate((fed) => fedGateStamp(fed), FED);
  await page.waitForFunction(() => { const m = document.getElementById('fedinv-modal'); return m && !m.hidden; }, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  return page.evaluate((k) => {
    const m = document.getElementById('fedinv-modal');
    return {
      open: !!m && !m.hidden && m.getClientRects().length > 0,
      label: document.getElementById('fedinv-label').value,
      agent: document.getElementById('fedinv-kind-agent').checked,
      msg: document.getElementById('fedinv-msg').textContent,
      focus: document.activeElement ? document.activeElement.id : null,
      current: typeof PJ_CURRENT !== 'undefined' ? PJ_CURRENT : null,
      posts: window.__posts.length,
      note: sessionStorage.getItem(k),
    };
  }, KEY);
}

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) { console.error('FAIL  render-fedinvreturn-8938: could not start a browser. ' + (err && err.message ? err.message.split('\n')[0] : err)); process.exit(1); }
  try {
    // R1, R2
    {
      const { ctx, page, errs } = await newPage(browser);
      const r1 = await refusedMake(page);
      const note = r1.note ? JSON.parse(r1.note) : null;
      chk('R1 Make was sent once and refused for a fresh sign-in; the ask is up for POST /api/federation/invite', r1.posts === 1 && r1.askShown && r1.askFor === 'POST /api/federation/invite', JSON.stringify(r1));
      chk('R1 the tab note holds the project, the label and the kind, and nothing else',
        !!note && note.kind === 'fed-invite' && note.project === 'k' && note.label === 'Dana' && note.invitedKind === 'agent'
        && Object.keys(note).sort().join() === 'at,invitedKind,kind,label,project', r1.note);
      await press(page);
      const r2 = await afterReload(page);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'fedinvreturn-8938-back.png') }).catch(() => {});
      chk('R2 back from Sign in again: the project and its invite sheet are open', r2.open && r2.current === 'k', JSON.stringify(r2));
      chk('R2 "Dana" and "Their agent" are filled in, focus on Make an invite code', r2.label === 'Dana' && r2.agent && r2.focus === 'fedinv-make', JSON.stringify(r2));
      chk('R2 the sheet says what to do, and claims no sign-in', r2.msg === 'Your invitation is filled in again. Press Make an invite code.', JSON.stringify(r2.msg));
      chk('R2 nothing was sent after the return (no code is made by itself), and the note is gone', r2.posts === 0 && r2.note === null, JSON.stringify(r2));
      chk('R1/R2 no page error', errs.length === 0, errs.join(' | '));
      await ctx.close();
    }
    // CONTROL: a reload with no press opens nothing and keeps the note.
    {
      const { ctx, page } = await newPage(browser);
      await refusedMake(page);
      const r = await afterReload(page);
      chk('CONTROL a reload without Sign in again opens no sheet, and keeps the note', !r.open && r.note !== null, JSON.stringify(r));
      await ctx.close();
    }
    // CONTROL: back from Sign in again, the person presses something on the page before the return can act (inviting is
    // not on yet): they have moved on, so no sheet opens and the note goes.
    {
      const { ctx, page } = await newPage(browser);
      await refusedMake(page);
      await press(page);
      const r = await afterReload(page, (pg) => pg.mouse.click(640, 40));
      chk('CONTROL a press on the page before the return acts opens no sheet, and the note goes', !r.open && r.note === null, JSON.stringify(r));
      await ctx.close();
    }
    // CONTROL: the project is gone after the sign-in.
    {
      const { ctx, page } = await newPage(browser);
      await refusedMake(page);
      await press(page);
      await page.evaluate(() => sessionStorage.setItem('check-gone', '1'));
      const r = await afterReload(page);
      chk('CONTROL a project gone after the sign-in opens no sheet, and the note goes', !r.open && r.note === null, JSON.stringify(r));
      await ctx.close();
    }
    // CONTROL: a 403 with no Sign in again leaves no note.
    {
      const { ctx, page } = await newPage(browser);
      await page.evaluate(() => sessionStorage.setItem('check-refuse', 'plain'));
      const r = await refusedMake(page);
      chk('CONTROL a refusal that offers no Sign in again leaves no note', r.posts === 1 && r.note === null, JSON.stringify(r));
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(fail.length ? 'FAIL  render-fedinvreturn-8938: ' + fail.length + ' failing' : 'PASS  render-fedinvreturn-8938: all arms');
  process.exit(fail.length ? 1 : 0);
})();
