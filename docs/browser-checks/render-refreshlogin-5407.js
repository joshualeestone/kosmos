// Browser-check-surface: login-adv-go acct-expiring acct-expiring-line acct-reauth-main acct-land
'use strict';

/**
 * kosmos#5407 (Josh, 2026-10-06): the login-expiry notice's "Refresh login" button opens Settings > AI Models at that
 * account's row, highlighted, with its Sign in again focused; and the AI Models list marks every Claude sign-in whose
 * login is inside the notice's window (or has ended with its agents on borrowed time) with a warning edge, one line,
 * and Sign in again as the row's main action. A login outside the window keeps its green "good until" (the control).
 *
 * Drives the page's own paintLoginAdvisories and paintAccounts against stubbed data (no board needed):
 *   N1  the expiring, the "stops working" and the "has expired" notice each carry Refresh login, naming their row
 *   L1  pressing it opens AI Models; the matching row is ringed (acct-land), in view, and its Sign in again has focus
 *   R1  the expiring row: warning edge, "Expires in 2 days: sign in again to keep its agents running.", badge
 *       "login expires in 2 days", Sign in again first in its actions and gold
 *   R2  the ended row: its line says when its agents stop, Sign in again is its main action
 *   C1  CONTROL: a login good for 20 days stays green with no line, and Sign in again is the plain link, not first
 *   C2  CONTROL: a notice for a folder with no row opens AI Models and rings nothing
 *   R3  an ended login whose agents have stopped: "Login expired", its line, Sign in again first
 *   K1  the one-screen layout (Settings last on another section): opens AI Models, rings the row, focuses Sign in
 *       again, the notices step aside; CONTROL: leaving brings them back
 *   T1  the ring goes when its time is up, with no repaint
 *   N2  on AI Models the login notices step aside; CONTROL: back on the board they show again
 *   P1  on a phone (touch), Refresh login and the main Sign in again are at least 44px tall
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
];
const ADV_SOON = { agents: ['mona'], names: ['Mona'], daysLeft: 2, severity: 'warn', expired: false, service: 's-soon',
  provider: 'Claude', email: 'soon@example.com', dir: '/home/.claude-soon' };
const ADV_ENDED = { agents: ['echo'], names: ['Echo'], daysLeft: -1, severity: 'urgent', expired: true, service: 's-ended',
  worksUntil: Date.now() + 5 * 3600000, provider: 'Claude', email: 'ended@example.com', dir: '/home/.claude-ended' };
const ADV_GONE = { agents: ['leo'], names: ['Leo'], daysLeft: -2, severity: 'urgent', expired: true, service: 's-gone2',
  worksUntil: null, provider: 'Claude', email: 'gone@example.com', dir: '/home/.claude-gone2' };
const ADV_NOROW = { ...ADV_SOON, service: 's-norow', email: 'gone@example.com', dir: '/home/.claude-gone' };

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

    // L1: press the warn notice's button.
    await page.click('#login-adv-slot button.login-adv-go[data-adv-dir="/home/.claude-soon"]');
    await page.waitForSelector('#set-accounts .acct-box[data-acct-dir]', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    const land = await page.evaluate(() => {
      const sec = document.getElementById('s-sec-accounts');
      const ringed = [...document.querySelectorAll('#set-accounts .acct-box.acct-land')].map((r) => r.getAttribute('data-acct-dir'));
      const row = document.querySelector('#set-accounts .acct-box[data-acct-dir="/home/.claude-soon"]');
      const r = row ? row.getBoundingClientRect() : null;
      const f = document.activeElement;
      return {
        open: !!(sec && !sec.hidden && sec.getClientRects().length),
        ringed,
        inView: !!(r && r.top >= 0 && r.bottom <= innerHeight),
        /* Not merely inside the viewport: nothing floats over its Sign in again (the notices did, before they stepped
           aside on this screen). */
        uncovered: (() => { const b = row && row.querySelector('.acct-reauth'); if (!b) return false; const q = b.getBoundingClientRect();
          const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return !!hit && (hit === b || b.contains(hit)); })(),
        noticesShown: [...document.querySelectorAll('#login-adv-slot .login-adv')].some((n) => n.getClientRects().length),
        focus: f && f.matches('.acct-reauth') && row && row.contains(f),
        ring: row ? getComputedStyle(row).boxShadow : '',
      };
    });
    chk(land.open, theme + ' L1: AI Models is open', JSON.stringify(land));
    chk(land.ringed.length === 1 && land.ringed[0] === '/home/.claude-soon', theme + ' L1: exactly that row is ringed', JSON.stringify(land.ringed));
    chk(land.ring && land.ring !== 'none', theme + ' L1: the ring is drawn', land.ring);
    chk(land.inView, theme + ' L1: the row is in view');
    chk(land.uncovered, theme + ' L1: nothing covers its Sign in again', JSON.stringify(land));
    chk(!land.noticesShown, theme + ' N2: on AI Models the login notices step aside');
    chk(land.focus, theme + ' L1: its Sign in again has focus');

    const rows = await readRows(page);
    const soon = rows['soon@example.com'] || {};
    chk(/acct-expiring/.test(soon.cls || ''), theme + ' R1: the expiring row has the warning edge', soon.cls);
    chk(soon.line === 'Expires in 2 days: sign in again to keep its agents running.', theme + ' R1: its line', JSON.stringify(soon.line));
    chk(/login expires in 2 days/.test(soon.badge || ''), theme + ' R1: its badge', soon.badge);
    chk(soon.firstIsReauth && soon.reauthCount === 1, theme + ' R1: Sign in again is first, and only once', JSON.stringify(soon));
    const gold = await page.evaluate(() => {
      const probe = document.createElement('button'); probe.className = 'uprime'; document.body.append(probe);
      const c = getComputedStyle(probe).backgroundColor; probe.remove(); return c;
    });
    chk(soon.mainGold === gold, theme + ' R1: it is the gold primary', soon.mainGold + ' vs ' + gold);
    chk(soon.describedBy, theme + ' R1: the line describes the main Sign in again (screen readers)');
    const gone = rows['gone@example.com'] || {};
    chk(gone.line === 'Its login has ended, and its agents have stopped. Sign in again to bring them back.', theme + ' R3: the ended-and-stopped row says so', JSON.stringify(gone.line));
    chk(/Login expired/.test(gone.badge || '') && gone.firstIsReauth && /acct-expiring/.test(gone.cls || ''), theme + ' R3: its badge, and Sign in again is its main action', JSON.stringify(gone));

    const ended = rows['ended@example.com'] || {};
    chk(/^Its login has ended, and its agents stop working (tomorrow )?at about .+\. Sign in again to keep them running\.$/.test(ended.line || ''), theme + ' R2: the ended row says when its agents stop', JSON.stringify(ended.line));
    chk(ended.firstIsReauth && /acct-expiring/.test(ended.cls || ''), theme + ' R2: Sign in again is its main action', JSON.stringify(ended));

    const fine = rows['fine@example.com'] || {};
    chk(!/acct-expiring|acct-land/.test(fine.cls || '') && !fine.line, theme + ' C1 CONTROL: a login good for 20 days has no warning and no line', JSON.stringify(fine));
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
    await setUp(p2, theme);
    await p2.evaluate((a) => paintLoginAdvisories([a]), ADV_NOROW);
    await p2.click('#login-adv-slot button.login-adv-go');
    await p2.waitForSelector('#set-accounts .acct-box[data-acct-dir]', { timeout: 5000 }).catch(() => {});
    await p2.waitForTimeout(300);
    const c2 = await p2.evaluate(() => ({
      open: !document.getElementById('s-sec-accounts').hidden,
      ringed: document.querySelectorAll('#set-accounts .acct-box.acct-land').length,
      rows: document.querySelectorAll('#set-accounts .acct-box[data-acct-dir]').length,
      focusInSection: document.getElementById('s-sec-accounts').contains(document.activeElement),
    }));
    chk(c2.open && c2.rows === 4 && c2.ringed === 0, theme + ' C2 CONTROL: no row for that folder: AI Models opens, nothing ringed', JSON.stringify(c2));
    chk(c2.focusInSection, theme + ' C2: focus stays in AI Models, not lost to the page', JSON.stringify(c2));
    await p2.close();
  }

  // K1 (review 1): the one-screen layout, with Settings last left on another section.
  {
    const pk = await browser.newPage({ viewport: { width: 1280, height: 900 } });
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
    await pk.waitForSelector('#set-accounts .acct-box.acct-land', { timeout: 5000 }).catch(() => {});
    const k = await pk.evaluate(() => {
      const row = document.querySelector('#set-accounts .acct-box[data-acct-dir="/home/.claude-soon"]');
      const f = document.activeElement;
      return {
        settings: !document.getElementById('panel-settings').hidden,
        accounts: !document.getElementById('s-sec-accounts').hidden,
        ringed: !!(row && row.classList.contains('acct-land')),
        focus: !!(f && f.matches('.acct-reauth') && row && row.contains(f)),
        notices: [...document.querySelectorAll('#login-adv-slot .login-adv')].filter((n) => n.getClientRects().length).length,
      };
    });
    chk(k.settings && k.accounts, 'K1: Refresh login opens AI Models in the one-screen layout', JSON.stringify(k));
    chk(k.ringed && k.focus, 'K1: the row is ringed and its Sign in again has focus', JSON.stringify(k));
    chk(k.notices === 0, 'K1: the login notices step aside there too', JSON.stringify(k));
    await pk.evaluate(() => { if (typeof pjView === 'function') pjView('one'); });
    const kb = await pk.evaluate(() => [...document.querySelectorAll('#login-adv-slot .login-adv')].filter((n) => n.getClientRects().length).length);
    chk(kb === 1, 'K1 CONTROL: leaving Settings there brings the notice back', String(kb));
    await pk.close();
  }

  // T1 (review 1): the ring is taken off when its time is up, with no repaint.
  {
    const pt = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await pt.clock.install();
    await setUp(pt, 'light');
    await pt.evaluate((a) => paintLoginAdvisories([a]), ADV_SOON);
    await pt.click('#login-adv-slot button.login-adv-go');
    await pt.clock.runFor(500);
    await pt.waitForSelector('#set-accounts .acct-box.acct-land', { timeout: 5000 }).catch(() => {});
    const before = await pt.evaluate(() => document.querySelectorAll('#set-accounts .acct-box.acct-land').length);
    await pt.clock.runFor(21000);
    const after = await pt.evaluate(() => document.querySelectorAll('#set-accounts .acct-box.acct-land').length);
    chk(before === 1 && after === 0, 'T1: ringed on arrival, and the ring goes after its time with no repaint', before + ' -> ' + after);
    await pt.close();
  }

  // P1: a phone (touch): both controls at finger size.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const ph = await ctx.newPage();
  await setUp(ph, 'light');
  await ph.evaluate((a) => paintLoginAdvisories([a]), ADV_SOON);
  const goH = await ph.evaluate(() => { const b = document.querySelector('#login-adv-slot button.login-adv-go'); return b ? b.getBoundingClientRect().height : 0; });
  chk(goH >= 44, 'P1: Refresh login is at least 44px on a phone', String(goH));
  await ph.tap('#login-adv-slot button.login-adv-go');
  await ph.waitForSelector('#set-accounts .acct-reauth-main', { timeout: 5000 }).catch(() => {});
  const mainH = await ph.evaluate(() => { const b = document.querySelector('#set-accounts .acct-box.acct-land .acct-reauth-main'); return b ? b.getBoundingClientRect().height : 0; });
  chk(mainH >= 44, 'P1: the landed row\'s Sign in again is at least 44px on a phone', String(mainH));
  const sideways = await ph.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  chk(sideways <= 0, 'P1: no sideways scroll', String(sideways));
  if (OUT) await ph.screenshot({ path: nodePath.join(OUT, 'refreshlogin-5407-phone.png') });
  await ctx.close();

  await browser.close();
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall checks passed');
})();
