// Browser-check-surface: login-adv-go acct-expiring acct-expiring-line acct-reauth-main acct-ended adv-covered acct-add-modal
'use strict';

/**
 * kosmos#5407 (Josh, 2026-10-06), kosmos#7198 (Josh, 2026-10-26): the login-expiry notice's "Refresh login" button
 * opens that account's Sign in again dialog where the person is; and the AI Models list marks every Claude sign-in whose
 * login is inside the notice's window (or has ended with its agents on borrowed time) with a warning edge, one line,
 * and Sign in again as the row's main action. A login outside the window keeps its green "good until" (the control).
 *
 * Drives the page's own paintLoginAdvisories and paintAccounts against stubbed data (no board needed):
 *   N1  the expiring, the "stops working" and the "has expired" notice each carry Refresh login, naming their row
 *   D1  kosmos#7198: pressing it opens that account's Sign in again dialog over the board; Settings stays shut, and
 *       closing it leaves the board as it was
 *   D3  while the dialog is open, Refresh login can be reached neither by the pointer nor by the keyboard (inert)
 *   D4  closing gives focus back to the notice's button; one repainted away while the dialog was open gives it to a
 *       Refresh login still showing; with no notice left, focus is never on a hidden element; the notices are no
 *       longer inert
 *   R1  the expiring row: warning edge, "Expires in 2 days." (#6520), badge
 *       "login expires in 2 days", Sign in again first in its actions and gold
 *   R2  the ended row: its line says when its agents stop, Sign in again is its main action
 *   C1  CONTROL: a login good for 20 days stays green with no line, and Sign in again is the plain link, not first
 *   C2  CONTROL: a notice for a folder with no row opens AI Models, and no dialog
 *   C3  a folder the page's loaded account list no longer has opens AI Models, and no dialog
 *   C4  a page that has not read its account list trusts the board's naming: the dialog opens
 *   R3  an ended login whose agents have stopped: "Login expired", its line, Sign in again first
 *   K1  the one-screen layout, on a project: the dialog opens there, Settings stays shut
 *   D2  on an agent's own page: the dialog opens there
 *   N2  on AI Models a notice steps aside when its row carries the warning; CONTROL: back on the board they show again
 *   N3  a notice with no warned row on AI Models (a folder with no row) stays
 *   P1  on a phone (touch), Refresh login and the dialog's Start the sign-in are at least 44px tall
 * Light and dark.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-refreshlogin-5407.js [shotsdir]
 * HEADED by default; HEADED=0 on a machine with no console session.
 */

const nodePath = require('node:path');
const fs = require('node:fs');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-refreshlogin-5407: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const OUT = process.argv[2] || '';
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}
/* Review 3: every page this check opens says if the page threw, not only the first one. */
function errsOf(pg) { const e = []; pg.on('pageerror', (x) => e.push(x.message)); return (label) => chk(!e.length, label + ': no page errors', e.join(' | ')); }

const DAY = 86400000;
function row(email, dir, conn) {
  return {
    provider: 'anthropic', providerName: 'Anthropic / Claude', email, label: email, dir,
    organization: null, isDefault: false, keyTail: null, memoryShared: true, offerable: true, apiKey: false,
    connection: { state: 'connected', badge: 'working', observedFrom: 'login', checkedLive: true, plan: null, ...conn },
  };
}
/* Review 1: the soon row is what the server sends for an account whose agents ARE working (the one the notice is about):
   a working badge from an agent's request, no loginValidUntil, and the window's days with the date. */
const ACCOUNTS = [
  row('soon@example.com', '/home/.claude-soon', { observedFrom: 'agent', observedAgeMs: 30000, loginExpiresInDays: 2, loginExpiresAt: Date.now() + 2 * DAY + 3600000 }),
  row('gone@example.com', '/home/.claude-gone2', { badge: 'signed_in_unverified', observedFrom: null, loginEnded: true }),
  row('ended@example.com', '/home/.claude-ended', { badge: 'signed_in_unverified', observedFrom: null, loginStopsAt: Date.now() + 5 * 3600000 }),
  row('fine@example.com', '/home/.claude-fine', { loginValidUntil: Date.now() + 20 * DAY }),
  // Review 4: both flags at once (agents still working on the access token): it is the amber "stops working" row.
  row('both@example.com', '/home/.claude-both', { badge: 'signed_in_unverified', observedFrom: null, loginEnded: true, loginStopsAt: Date.now() + 4 * 3600000 }),
];
const ADV_SOON = { agents: ['mona'], names: ['Mona'], daysLeft: 2, severity: 'warn', expired: false, service: 's-soon',
  provider: 'Claude', email: 'soon@example.com', dir: '/home/.claude-soon' };
const ADV_ENDED = { agents: ['echo'], names: ['Echo'], daysLeft: -1, severity: 'urgent', expired: true, service: 's-ended',
  worksUntil: Date.now() + 5 * 3600000, provider: 'Claude', email: 'ended@example.com', dir: '/home/.claude-ended' };
const ADV_GONE = { agents: ['leo'], names: ['Leo'], daysLeft: -2, severity: 'urgent', expired: true, service: 's-gone2',
  worksUntil: null, provider: 'Claude', email: 'gone@example.com', dir: '/home/.claude-gone2' };
// kosmos#7198: the board names no folder for a notice whose folder AI Models does not list (status.js dirOf).
const ADV_NOROW = { ...ADV_SOON, service: 's-norow', email: 'gone@example.com', dir: '' };
// The page's own guard: a folder the board named, but the account list this page holds no longer has.
const ADV_GONEROW = { ...ADV_SOON, service: 's-gonerow', email: 'gone@example.com', dir: '/home/.claude-removed' };

async function setUp(page, theme) {
  await page.goto('file://' + PAGE);
  await page.evaluate(({ accounts, theme }) => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.removeItem('kosmos.loginAdvDismissed'); } catch { /* a refused store is fine here */ }
    const realFetch = window.fetch;
    window.fetch = (u, opts) => (String(u).indexOf('/api/accounts') !== -1
      ? Promise.resolve({ ok: true, json: async () => ({ accounts }) })
      : realFetch(u, opts));
  }, { accounts: ACCOUNTS, theme });
}
// The rows as the person sees them, keyed by email.
function readRows(page) {
  return page.evaluate(() => {
    const out = {};
    for (const b of document.querySelectorAll('#set-accounts .acct-box[data-acct-dir]')) {
      const who = (b.querySelector('.acct-who b') || {}).textContent || '';
      const acts = b.querySelector('.acct-actions');
      const first = acts && acts.firstElementChild;
      const main = b.querySelector('.acct-reauth-main');
      out[who.trim()] = {
        cls: b.className,
        line: ((b.querySelector('.acct-expiring-line') || {}).textContent || '').trim(),
        badge: ((b.querySelector('.acct-box-top > span') || {}).textContent || '').trim(),
        firstIsReauth: !!(first && first.matches('.acct-reauth')),
        mainGold: main ? getComputedStyle(main).backgroundColor : '',
        describedBy: !!(main && main.getAttribute('aria-describedby') && document.getElementById(main.getAttribute('aria-describedby'))
          && document.getElementById(main.getAttribute('aria-describedby')).classList.contains('acct-expiring-line')),
        reauthCount: b.querySelectorAll('[data-reauth]').length,
      };
    }
    return out;
  });
}

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-refreshlogin-5407: could not start a browser' + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    process.exit(1);
  }
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await setUp(page, theme);
    await page.evaluate(({ a, b, c }) => paintLoginAdvisories([a, b, c]), { a: ADV_SOON, b: ADV_ENDED, c: ADV_GONE });
    const notices = await page.evaluate(() => [...document.querySelectorAll('#login-adv-slot .login-adv')].map((n) => ({
      head: ((n.querySelector('.utxt b') || {}).textContent || '').trim(),
      go: ((n.querySelector('button.login-adv-go') || {}).textContent || '').trim(),
      dir: (n.querySelector('button.login-adv-go') || { getAttribute: () => '' }).getAttribute('data-adv-dir'),
    })));
    chk(notices.length === 3 && notices.every((n) => n.go === 'Refresh login'), theme + ' N1: every notice carries Refresh login', JSON.stringify(notices));
    chk(notices.some((n) => /stops working/.test(n.head) && n.dir === '/home/.claude-ended'), theme + ' N1: the "stops working" notice, naming its row');
    chk(notices.some((n) => /has expired/.test(n.head) && n.dir === '/home/.claude-gone2'), theme + ' N1: the "has expired" notice, naming its row');

    /* D1 (kosmos#7198, Josh 08:32): pressing it opens that account's Sign in again dialog right here, over the board:
       Settings does not open, and closing the dialog leaves the board as it was. */
    await page.evaluate(() => { const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true; showTab('agents'); });
    await page.click('#login-adv-slot button.login-adv-go[data-adv-dir="/home/.claude-soon"]');
    await page.waitForTimeout(200);
    const dlg = await page.evaluate(() => {
      const m = document.getElementById('acct-add-modal');
      const box = document.getElementById('acct-add-dialog');
      const q = box ? box.getBoundingClientRect() : null;
      const hit = q ? document.elementFromPoint(q.left + q.width / 2, q.top + 20) : null;
      return {
        open: !!(m && !m.hidden && m.getClientRects().length),
        onTop: !!(hit && box && box.contains(hit)),
        title: ((document.getElementById('acct-add-t') || {}).textContent || '').trim(),
        intro: ((document.getElementById('acct-add-in') || {}).textContent || '').trim(),
        settings: !document.getElementById('panel-settings').hidden,
        tab: typeof URL_TAB === 'string' ? URL_TAB : '',
        reauthDir: typeof ACCT_REAUTH_DIR === 'string' ? ACCT_REAUTH_DIR : null,
      };
    });
    chk(dlg.open && dlg.onTop, theme + ' D1: Refresh login opens the Sign in again dialog over the page', JSON.stringify(dlg));
    chk(dlg.title === 'Sign in again' && /soon@example\.com/.test(dlg.intro), theme + ' D1: it is the Sign in again dialog for that account', JSON.stringify(dlg));
    chk(dlg.reauthDir === '/home/.claude-soon', theme + ' D1: it signs in again as that account\'s folder', JSON.stringify(dlg));
    chk(!dlg.settings && dlg.tab === 'agents', theme + ' D1: Settings does not open; the board stays where it was', JSON.stringify(dlg));
    // D3 (Mona Lisa's review; review 1 of the loop: the keyboard too): while the dialog is open, the notice's Refresh
    // login is under its backdrop AND inert, so neither a second press nor Tab reaches it.
    const again = await page.evaluate(() => {
      const b = document.querySelector('#login-adv-slot button.login-adv-go');
      if (!b) return { button: false };
      const q = b.getBoundingClientRect();
      const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
      const before = document.activeElement;
      b.focus();
      return { button: true, reachable: !!hit && (hit === b || b.contains(hit)), focusable: document.activeElement === b,
        focusKept: document.activeElement === before };
    });
    chk(again.button && !again.reachable, theme + ' D3: with the dialog open, Refresh login cannot be pressed again', JSON.stringify(again));
    chk(again.button && !again.focusable && again.focusKept, theme + ' D3: with the dialog open, the keyboard cannot reach Refresh login', JSON.stringify(again));
    if (OUT) await page.screenshot({ path: nodePath.join(OUT, 'refreshlogin-7198-dialog-' + theme + '.png'), fullPage: false });
    await page.evaluate(() => closeAcctAdd());
    const closed = await page.evaluate(() => ({ open: !document.getElementById('acct-add-modal').hidden, tab: URL_TAB,
      notices: [...document.querySelectorAll('#login-adv-slot .login-adv')].filter((n) => n.getClientRects().length).length }));
    chk(!closed.open && closed.tab === 'agents' && closed.notices === 3, theme + ' D1: closing it leaves the board, notices and all', JSON.stringify(closed));

    /* D4 (review 1 of the loop): where focus goes on close. */
    const focusOf = () => page.evaluate(() => {
      const a = document.activeElement;
      return { dir: a && a.getAttribute ? a.getAttribute('data-adv-dir') : null, go: !!(a && a.classList && a.classList.contains('login-adv-go')),
        body: a === document.body, shown: !!(a && a.offsetParent !== null), inert: !!document.getElementById('login-adv-slot').inert };
    });
    const pressSoon = async () => { await page.click('#login-adv-slot button.login-adv-go[data-adv-dir="/home/.claude-soon"]'); await page.waitForTimeout(150); };
    await pressSoon();
    await page.evaluate(() => closeAcctAdd());
    const returned = await focusOf();
    chk(returned.dir === '/home/.claude-soon' && !returned.inert, theme + ' D4: closing gives focus back to the notice\'s Refresh login, no longer inert', JSON.stringify(returned));
    await pressSoon();
    await page.evaluate(({ b, c }) => paintLoginAdvisories([b, c]), { b: ADV_ENDED, c: ADV_GONE });   // the sign-in worked
    await page.evaluate(() => closeAcctAdd());
    const moved = await focusOf();
    chk(moved.go && moved.shown && moved.dir !== '/home/.claude-soon', theme + ' D4: its notice gone, focus goes to a Refresh login still showing', JSON.stringify(moved));
    await page.evaluate(({ a, b, c }) => paintLoginAdvisories([a, b, c]), { a: ADV_SOON, b: ADV_ENDED, c: ADV_GONE });
    await pressSoon();
    await page.evaluate(() => paintLoginAdvisories([]));
    await page.evaluate(() => closeAcctAdd());
    const none = await focusOf();
    chk((none.body || none.shown) && !none.inert, theme + ' D4: with no notice left, focus is never on a hidden element', JSON.stringify(none));
    await page.evaluate(({ a, b, c }) => paintLoginAdvisories([a, b, c]), { a: ADV_SOON, b: ADV_ENDED, c: ADV_GONE });
    const restored = await page.evaluate(() => [...document.querySelectorAll('#login-adv-slot .login-adv')].filter((n) => n.getClientRects().length).length);
    chk(restored === 3, theme + ' D4 CONTROL: the three notices are back for the checks below', String(restored));

    // The AI Models rows (opened directly now): the warning edge, the line, and Sign in again as the main action.
    await page.evaluate(() => { showTab('settings'); settingsOpen('accounts'); });
    await page.waitForSelector('#set-accounts .acct-box[data-acct-dir]', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    const land = await page.evaluate(() => {
      const row = document.querySelector('#set-accounts .acct-box[data-acct-dir="/home/.claude-soon"]');
      return {
        /* Nothing floats over its Sign in again (the notices did, before they stepped aside on this screen). */
        uncovered: (() => { const b = row && row.querySelector('.acct-reauth'); if (!b) return false; b.scrollIntoView({ block: 'center' }); const q = b.getBoundingClientRect();
          const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return !!hit && (hit === b || b.contains(hit)); })(),
        noticesShown: [...document.querySelectorAll('#login-adv-slot .login-adv')].some((n) => n.getClientRects().length),
      };
    });
    chk(land.uncovered, theme + ' N2: nothing covers the row\'s Sign in again', JSON.stringify(land));
    chk(!land.noticesShown, theme + ' N2: on AI Models the login notices step aside');
    /* Review 3: the other order. Already on AI Models, the notice repaints (its count dropped): it steps aside too. */
    await page.evaluate(({ a, b, c }) => paintLoginAdvisories([{ ...a, daysLeft: 1, severity: 'urgent' }, b, c]), { a: ADV_SOON, b: ADV_ENDED, c: ADV_GONE });
    const later = await page.evaluate(() => [...document.querySelectorAll('#login-adv-slot .login-adv')].filter((n) => n.getClientRects().length).length);
    chk(later === 0, theme + ' N2: a notice repainted while AI Models shows steps aside too', String(later));

    const rows = await readRows(page);
    const soon = rows['soon@example.com'] || {};
    chk(/acct-expiring/.test(soon.cls || ''), theme + ' R1: the expiring row has the warning edge', soon.cls);
    chk(soon.line === 'Expires in 2 days.',   // #6520: the Sign in again button says the rest
       theme + ' R1: its line', JSON.stringify(soon.line));
    chk(/^Signed in until [A-Z][a-z]{2} \d{1,2}$/.test(soon.badge || ''), theme + ' R1: its badge gives the date (the line gives the days)', soon.badge);
    chk(!/acct-ended/.test(soon.cls || ''), theme + ' R1: an expiring row is not drawn as ended', soon.cls);
    chk(soon.firstIsReauth && soon.reauthCount === 1, theme + ' R1: Sign in again is first, and only once', JSON.stringify(soon));
    const gold = await page.evaluate(() => {
      const probe = document.createElement('button'); probe.className = 'uprime'; document.body.append(probe);
      const c = getComputedStyle(probe).backgroundColor; probe.remove(); return c;
    });
    chk(soon.mainGold === gold, theme + ' R1: it is the gold primary', soon.mainGold + ' vs ' + gold);
    chk(soon.describedBy, theme + ' R1: the line describes the main Sign in again (screen readers)');
    const gone = rows['gone@example.com'] || {};
    chk(gone.line === 'Sign in again to bring its agents back.', theme + ' R3: the ended row\'s line', JSON.stringify(gone.line));
    chk(/Login expired/.test(gone.badge || '') && gone.firstIsReauth && /acct-ended/.test(gone.cls || ''), theme + ' R3: its badge, and Sign in again is its main action', JSON.stringify(gone));
    const tones = await page.evaluate(() => {
      const edge = (sel) => { const r = document.querySelector(sel); return r ? getComputedStyle(r).borderTopColor : ''; };
      const probe = document.createElement('span'); probe.style.color = 'var(--danger)'; document.body.append(probe);
      const danger = getComputedStyle(probe).color; probe.remove();
      return { ended: edge('#set-accounts .acct-box[data-acct-dir="/home/.claude-gone2"]'), soon: edge('#set-accounts .acct-box[data-acct-dir="/home/.claude-soon"]'), danger };
    });
    chk(tones.ended === tones.danger && tones.soon !== tones.danger, theme + ' R3 (Mona Lisa): the ended row is the Issue red, the expiring one is not', JSON.stringify(tones));
    const gap = await page.evaluate(() => { const l = document.querySelector('#set-accounts .acct-expiring-line'); return l ? getComputedStyle(l).marginBottom : ''; });
    chk(gap === '0px', theme + ' R1 (Mona Lisa): no extra gap under the line', gap);

    const ended = rows['ended@example.com'] || {};
    chk(/^Its login has ended, and its agents stop working (tomorrow )?at about .+\. Sign in again to keep them running\.$/.test(ended.line || ''), theme + ' R2: the ended row says when its agents stop', JSON.stringify(ended.line));
    chk(ended.firstIsReauth && /acct-expiring/.test(ended.cls || ''), theme + ' R2: Sign in again is its main action', JSON.stringify(ended));
    const both = rows['both@example.com'] || {};
    chk(!/acct-ended/.test(both.cls || '') && /stops working/.test(both.badge || '') && /stop working/.test(both.line || ''), theme + ' R2 (review 4): ended AND still working reads as stops-working, not the red ended row', JSON.stringify(both));

    const fine = rows['fine@example.com'] || {};
    chk(!/acct-expiring/.test(fine.cls || '') && !fine.line, theme + ' C1 CONTROL: a login good for 20 days has no warning and no line', JSON.stringify(fine));
    chk(/login good until/.test(fine.badge || '') && !fine.firstIsReauth && fine.reauthCount === 1, theme + ' C1 CONTROL: green, and Sign in again is the plain link', JSON.stringify(fine));
    if (OUT) await page.screenshot({ path: nodePath.join(OUT, 'refreshlogin-5407-' + theme + '.png'), fullPage: false });
    // N2 CONTROL: leaving Settings brings them back.
    await page.evaluate(() => showTab('agents'));
    const back = await page.evaluate(() => [...document.querySelectorAll('#login-adv-slot .login-adv')].filter((n) => n.getClientRects().length).length);
    chk(back === 3, theme + ' N2 CONTROL: back on the board, the notices show again', String(back));
    chk(!errs.length, theme + ' no page errors', errs.join(' | '));
    await page.close();

    // C2: a notice for a folder with no row opens AI Models and rings nothing.
    const p2 = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const p2Errs = errsOf(p2);
    await setUp(p2, theme);
    await p2.evaluate((a) => paintLoginAdvisories([a]), ADV_NOROW);
    await p2.click('#login-adv-slot button.login-adv-go');
    await p2.waitForSelector('#set-accounts .acct-box[data-acct-dir]', { timeout: 5000 }).catch(() => {});
    await p2.waitForTimeout(300);
    const c2 = await p2.evaluate(() => ({
      open: !document.getElementById('s-sec-accounts').hidden,
      rows: document.querySelectorAll('#set-accounts .acct-box[data-acct-dir]').length - 1,   // the review-4 row is extra
      focusInSection: document.getElementById('s-sec-accounts').contains(document.activeElement),
      noticeStays: [...document.querySelectorAll('#login-adv-slot .login-adv')].filter((n) => n.getClientRects().length).length,
    }));
    chk(c2.open && c2.rows === 4, theme + ' C2 CONTROL: no row for that folder: AI Models opens (no dialog for an account it cannot name)', JSON.stringify(c2));
    chk(await p2.evaluate(() => document.getElementById('acct-add-modal').hidden), theme + ' C2 CONTROL: and the Sign in again dialog does not open');
    chk(c2.focusInSection, theme + ' C2: focus stays in AI Models, not lost to the page', JSON.stringify(c2));
    chk(c2.noticeStays === 1, theme + ' N3 (review 2): a notice with no warned row on screen stays, so the login is never left unwarned', JSON.stringify(c2));
    p2Errs(theme + ' C2');
    await p2.close();
    // C3 (kosmos#7198): the board named a folder, but this page's account list no longer has it: AI Models, no dialog.
    const p3 = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const p3Errs = errsOf(p3);
    await setUp(p3, theme);
    await p3.evaluate((accounts) => accountsRead(accounts), ACCOUNTS);
    await p3.evaluate((a) => paintLoginAdvisories([a]), ADV_GONEROW);
    await p3.click('#login-adv-slot button.login-adv-go');
    await p3.waitForTimeout(300);
    const c3 = await p3.evaluate(() => ({ dialog: !document.getElementById('acct-add-modal').hidden, accounts: !document.getElementById('s-sec-accounts').hidden }));
    chk(!c3.dialog && c3.accounts, theme + ' C3: a folder this page no longer lists opens AI Models, not the dialog', JSON.stringify(c3));
    p3Errs(theme + ' C3');
    await p3.close();
    // C4 (review 3, decided): a page that has not read its account list trusts the board's naming (status.js dirOf, which
    // requires the folder in accounts.list), so the same notice opens the dialog: the page fails open to the engine.
    const p4 = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const p4Errs = errsOf(p4);
    await setUp(p4, theme);
    const unread = await p4.evaluate(() => typeof ACCOUNTS_LOADED !== 'undefined' && ACCOUNTS_LOADED === false);
    await p4.evaluate((a) => paintLoginAdvisories([a]), ADV_GONEROW);
    await p4.click('#login-adv-slot button.login-adv-go');
    await p4.waitForTimeout(300);
    const c4 = await p4.evaluate(() => ({ dialog: !document.getElementById('acct-add-modal').hidden, dir: typeof ACCT_REAUTH_DIR === 'string' ? ACCT_REAUTH_DIR : null }));
    chk(unread, theme + ' C4 CONTROL: this page has not read its account list');
    chk(c4.dialog && !!c4.dir, theme + ' C4: with no list on the page, the board\'s naming stands and the dialog opens', JSON.stringify(c4));
    p4Errs(theme + ' C4');
    await p4.close();
  }

  // K1 (kosmos#7198): in the one-screen layout, on a project, the dialog opens over the project and Settings stays shut.
  {
    const pk = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const pkErrs = errsOf(pk);
    await setUp(pk, 'light');
    await pk.evaluate(() => {
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      PROJECTS = [{ id: 'k', name: 'K', parent: null, parentName: null, parentArchived: false, archived: false, summary: {}, agents: [], description: '', unread: 0 }];
      document.documentElement.setAttribute('data-layout', 'consolidated'); PJ_CURRENT = 'k'; showTab('projects');
      SETTINGS_SEC = 'you';
    });
    const isCons = await pk.evaluate(() => document.body.classList.contains('consolidated'));
    chk(isCons, 'K1: fixture: the one-screen layout is on');
    await pk.evaluate((a) => paintLoginAdvisories([a]), ADV_SOON);
    await pk.click('#login-adv-slot button.login-adv-go');
    await pk.waitForTimeout(200);
    const k = await pk.evaluate(() => ({
      dialog: !document.getElementById('acct-add-modal').hidden,
      settings: !document.getElementById('panel-settings').hidden,
      tab: URL_TAB,
    }));
    chk(k.dialog && !k.settings && k.tab === 'projects', 'K1: on a project, the dialog opens there and Settings stays shut', JSON.stringify(k));
    pkErrs('K1');
    await pk.close();
  }

  // D2 (kosmos#7198): on an agent's own page (its conversation), the dialog opens over it too.
  {
    const pd = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const pdErrs = errsOf(pd);
    await setUp(pd, 'light');
    await pd.evaluate(() => { const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true; showTab('detail'); });
    await pd.evaluate((a) => paintLoginAdvisories([a]), ADV_SOON);
    await pd.click('#login-adv-slot button.login-adv-go');
    await pd.waitForTimeout(200);
    const d = await pd.evaluate(() => ({ dialog: !document.getElementById('acct-add-modal').hidden, tab: URL_TAB,
      settings: !document.getElementById('panel-settings').hidden }));
    chk(d.dialog && d.tab === 'detail' && !d.settings, 'D2: on an agent\'s page, the dialog opens there', JSON.stringify(d));
    pdErrs('D2');
    await pd.close();
  }

  // P1: a phone (touch): Refresh login and the dialog's own button at finger size, and no sideways scroll.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const ph = await ctx.newPage();
  const phErrs = errsOf(ph);
  await setUp(ph, 'light');
  await ph.evaluate(() => { const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true; });
  await ph.evaluate((a) => paintLoginAdvisories([a]), ADV_SOON);
  const goH = await ph.evaluate(() => { const b = document.querySelector('#login-adv-slot button.login-adv-go'); return b ? b.getBoundingClientRect().height : 0; });
  chk(goH >= 44, 'P1: Refresh login is at least 44px on a phone', String(goH));
  await ph.tap('#login-adv-slot button.login-adv-go');
  await ph.waitForTimeout(200);
  const startH = await ph.evaluate(() => { const b = document.getElementById('acct-add'); return b && !document.getElementById('acct-add-modal').hidden ? b.getBoundingClientRect().height : 0; });
  chk(startH >= 44, 'P1: the dialog opens, and its Start the sign-in is at least 44px on a phone', String(startH));
  const sideways = await ph.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  chk(sideways <= 0, 'P1: no sideways scroll', String(sideways));
  if (OUT) await ph.screenshot({ path: nodePath.join(OUT, 'refreshlogin-7198-phone.png') });
  phErrs('P1');
  await ctx.close();

  await browser.close();
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall checks passed');
})();
