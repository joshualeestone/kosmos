'use strict';
// Browser-check-surface: worldsw-computers worldsw-computers-list worldsw-sec worldsw-state
// (#2518) the distinctive web/index.html tokens this check asserts: the "Your computers"
// section of the top-left Kosmos menu (kosmos#4648). A change to them must update this check.
/* kosmos#4648 (weekend goal #4647): "Your computers" in the top-left Kosmos menu.
 * Opens the menu through the SHIPPED worldswOpen, which reads /api/remote/computers
 * (stubbed here with a four-computer answer, then a not-signed-in answer), and asserts
 * in the real page, both themes:
 *   - the section shows under the Kosmoses, with its heading;
 *   - this computer is marked and is NOT a link; an ONLINE computer IS a link to its own
 *     https address in a new window; a not-connected or updating one is a plain row; every
 *     row says its state in words;
 *   - nothing is clipped: every row fits the menu, and each state word is fully inside it;
 *   - the control that can return the dangerous answer: a board that is not signed in
 *     (the route's { ok: false }) shows NO section at all;
 *   - #6406: in the Kosmos app (its bridge present) an online computer is a same-window link,
 *     still noreferrer, and the phone menu's copy of it too (the app keeps it in its window).
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-computers-4648.js
 *      (HEADED=0 on a machine with no console session)
 */
const path = require('node:path');
const playwright = require('playwright');
/* The Mac app renders in WebKit (WKWebView), so WebKit is not optional here. */
const ENGINES = ['chromium', 'webkit'];
const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');

const problems = [];
let pass = 0;
function ok(name, cond, detail) { if (cond) pass += 1; else problems.push(name + (detail ? ' -- ' + detail : '')); }

const FOUR = {
  ok: true,
  domain: 'kosmosplus.example',
  computers: [
    { name: 'studio-laptop', address: 'studio-laptop.kosmosplus.example', this: true, online: true },
    { name: 'desk-mini', address: 'desk-mini.kosmosplus.example', this: false, online: true },
    { name: 'render-box', address: 'render-box.kosmosplus.example', this: false, online: true, updating: true },
    { name: 'garage-pc', address: 'garage-pc.kosmosplus.example', this: false, online: false },
  ],
};

(async () => {
  for (const engine of ENGINES) {
  const browser = await playwright[engine].launch(engine === 'chromium' ? { headless: process.env.HEADED === '0', ignoreDefaultArgs: ['--hide-scrollbars'] } : { headless: process.env.HEADED === '0' });
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, colorScheme: theme });
    // kosmos#4815: several Kosmoses are switched off by default; this check pins the kept structure, so it turns them on.
    await page.addInitScript(() => { try { localStorage.setItem('kosmos.multiKosmos', '1'); } catch {} });
    /* The page's own startup fetches cannot load at file://. Chromium says ERR_FILE_NOT_FOUND;
       WebKit throws a pageerror "... due to access control checks" and logs "Cross origin
       requests are only supported for HTTP" (the same filter as render-mention-blue-2922's).
       Anything else is a real error from the code under test. */
    const HARNESS = /ERR_FILE_NOT_FOUND|URL scheme "file"|Failed to (fetch|load)|access control checks|Cross origin requests are only supported for HTTP|Not allowed to load local resource: file:///;
    page.on('pageerror', (e) => { if (!HARNESS.test(e.message)) problems.push(`[${engine} ${theme}] pageerror: ${e.message}`); });
    await page.addInitScript((four) => {
      window.setInterval = () => 0;
      /* Only /api/remote/computers is answered; everything else keeps the page's own
         file:// behaviour. window.__computers is switched between arms. */
      window.__computers = four;
      const real = window.fetch;
      window.fetch = (url, opts) => {
        /* kosmos#6406 step 2: the ticket this computer would make; window.__ticket is set by arm 4. */
        if (String(url).indexOf('/api/remote/open-ticket') !== -1) {
          window.__ticketAsked = (window.__ticketAsked || []).concat([JSON.parse((opts && opts.body) || '{}')]);
          // kosmos#6585: a ticket still being made, so the switching screen can be looked at.
          if (window.__ticketHang) return new Promise(() => {});
          return Promise.resolve(new Response(JSON.stringify(window.__ticket ? { ticket: window.__ticket } : { error: 'no' }), { status: window.__ticket ? 200 : 400, headers: { 'content-type': 'application/json' } }));
        }
        if (String(url).indexOf('/api/remote/computers') !== -1) {
          window.__computersServed = (window.__computersServed || 0) + 1;
          return Promise.resolve(new Response(JSON.stringify(window.__computers), { status: 200, headers: { 'content-type': 'application/json' } }));
        }
        return real(url, opts);
      };
    }, FOUR);
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const x = m.text();
      if (HARNESS.test(x)) return;
      problems.push(`[${engine} ${theme}] console: ${x}`);
    });
    // kosmos#6406: arriving with a ticket in the fragment (a window already signed in here), the page takes it out.
    // No query: the view router then leaves the address alone, so only the page's own strip can take the ticket out.
    await page.goto(PAGE + '#' + 'kpt=TkT_left_over_abcdefghijklmnop');   // split: a fragment, not an id for browser-checks-selectors
    const t = `[${engine} ${theme}]`;
    const leftOver = await page.evaluate(() => location.hash + '|' + location.search);
    ok(`${t} #6406: a ticket in the address on arrival is taken out of it`, !/kpt=/.test(leftOver), leftOver);

    const openAndRead = async () => page.evaluate(async () => {
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      document.getElementById('worldsw').hidden = false;
      worldswClose();
      worldswOpen();
      // Let the stubbed read resolve and paint.
      for (let i = 0; i < 20 && document.getElementById('worldsw-computers').hidden; i++) await new Promise((r) => setTimeout(r, 25));
      const box = document.getElementById('worldsw-computers');
      const menu = document.getElementById('worldsw-menu').getBoundingClientRect();
      const rows = Array.from(document.querySelectorAll('#worldsw-computers-list .worldsw-row')).map((r) => {
        const st = r.querySelector('.worldsw-state');
        const sr = st ? st.getBoundingClientRect() : null;
        return {
          tag: r.tagName.toLowerCase(), current: r.getAttribute('aria-current'),
          href: r.getAttribute('href'), target: r.getAttribute('target'), rel: r.getAttribute('rel'),
          name: (r.querySelector('.worldsw-rowname') || {}).textContent, state: st ? st.textContent : null,
          overflow: r.scrollWidth - r.clientWidth,
          stateInside: !!sr && sr.width > 0 && sr.left >= menu.left && sr.right <= menu.right + 0.5,
        };
      });
      const head = document.getElementById('worldsw-computers-h');
      const newBtn = document.getElementById('worldsw-new').getBoundingClientRect();
      return {
        hidden: box.hidden, display: getComputedStyle(box).display, head: head ? head.textContent : null,
        belowNew: box.getBoundingClientRect().top >= newBtn.bottom - 0.5, rows,
      };
    });

    // ---- Arm 1: four computers on the account ----
    const a = await openAndRead();
    ok(`${t} the section shows`, a.hidden === false && a.display !== 'none', JSON.stringify({ hidden: a.hidden, display: a.display }));
    ok(`${t} its heading says Your computers`, a.head === 'Your computers', a.head);
    ok(`${t} it sits under the Kosmoses (below New Kosmos)`, a.belowNew === true);
    ok(`${t} four rows`, a.rows.length === 4, String(a.rows.length));
    const [me, ...others] = a.rows;
    ok(`${t} this computer is first, marked, and not a link`, me && me.tag === 'div' && me.current === 'true' && me.href === null && me.state === 'This computer', JSON.stringify(me));
    const want = { 'desk-mini': ['Online', true], 'render-box': ['Updating', false], 'garage-pc': ['Not connected', false] };
    for (const r of others) {
      const [state, link] = want[r.name] || [];
      ok(`${t} ${r.name} says its state in words`, r.state === state, r.state);
      if (link) {
        ok(`${t} ${r.name} (online) is a link to its own address`, r.tag === 'a' && r.href === 'https://' + r.name + '.kosmosplus.example/', JSON.stringify(r));
        ok(`${t} ${r.name} opens in a new window, not over this computer`, r.target === '_blank' && r.rel === 'noopener noreferrer', JSON.stringify(r));
      } else {
        ok(`${t} ${r.name} (${state}) is NOT a link: it would open a browser error page`, r.tag === 'div' && r.href === null, JSON.stringify(r));
      }
    }
    for (const r of a.rows) {
      ok(`${t} ${r.name}: the row is not clipped`, r.overflow <= 1, String(r.overflow));
      ok(`${t} ${r.name}: the state word is fully inside the menu`, r.stateInside === true);
    }

    // ---- Arm 2 (the control): not signed in, so NO section ----
    await page.evaluate(() => { window.__computers = { ok: false, because: 'this computer is not signed in to Kosmos+' }; });
    const b = await page.evaluate(async () => {
      /* Wait for the stubbed { ok: false } to be SERVED and rendered, not just for the hide at the
         read's start (which is synchronous): otherwise this control could not see a render that
         wrongly shows the section (round 3 measured exactly that). */
      const before = window.__computersServed || 0;
      worldswClose();
      worldswOpen();
      for (let i = 0; i < 40 && (window.__computersServed || 0) <= before; i++) await new Promise((r) => setTimeout(r, 25));
      await new Promise((r) => setTimeout(r, 100));   // the render runs after the answer's json()
      const box = document.getElementById('worldsw-computers');
      return { hidden: box.hidden, display: getComputedStyle(box).display, rows: document.querySelectorAll('#worldsw-computers-list .worldsw-row').length, served: (window.__computersServed || 0) > before };
    });
    ok(`${t} not signed in: the read was really served before this was checked`, b.served === true, JSON.stringify(b));
    ok(`${t} not signed in: the section is gone`, b.hidden === true && b.display === 'none' && b.rows === 0, JSON.stringify(b));

    // ---- #6406 CONTROL, in a browser (no bridge): the phone menu's copy keeps the row's new tab ----
    const pnavBrowser = await page.evaluate(async (four) => {
      window.__computers = four;
      const before = window.__computersServed || 0;
      worldswClose(); worldswOpen();
      for (let i = 0; i < 40 && (window.__computersServed || 0) <= before; i++) await new Promise((r) => setTimeout(r, 25));
      await new Promise((r) => setTimeout(r, 100));
      if (!document.getElementById('pnav-computer-list')) { const ul = document.createElement('ul'); ul.id = 'pnav-computer-list'; document.body.appendChild(ul); }
      pnavFill('computers');
      const p = document.querySelector('#pnav-computer-list a');
      worldswClose();
      return p ? p.getAttribute('target') : 'missing';
    }, FOUR);
    ok(`${t} #6406 CONTROL: in a browser the phone menu's copy of an online computer opens a new tab`, pnavBrowser === '_blank', String(pnavBrowser));

    // ---- Arm 3, #6406: in the Kosmos app (its bridge present) an online computer opens in THIS window ----
    const inApp = await page.evaluate(async (four) => {
      try { Object.defineProperty(window, 'webkit', { value: { messageHandlers: { kosmosBadge: { postMessage() {} } } }, configurable: true, writable: true }); } catch {}   // the Mac app's bridge
      window.__computers = four;
      const before = window.__computersServed || 0;
      worldswClose(); worldswOpen();
      for (let i = 0; i < 40 && (window.__computersServed || 0) <= before; i++) await new Promise((r) => setTimeout(r, 25));
      await new Promise((r) => setTimeout(r, 100));
      const a = document.querySelector('#worldsw-computers-list a.worldsw-row');
      const out = a ? { inApp: computersInApp(), href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel'), marked: a.getAttribute('data-computer-open') } : null;
      // The phone menu's copy of the list (#4823) keeps the row's own target, so it stays in the window too.
      if (typeof pnavFill === 'function') {
        if (!document.getElementById('pnav-computer-list')) { const ul = document.createElement('ul'); ul.id = 'pnav-computer-list'; document.body.appendChild(ul); }   // built only on a phone over Kosmos+
        pnavFill('computers'); const p = document.querySelector('#pnav-computer-list a'); if (out) { out.pnavTarget = p ? p.getAttribute('target') : 'missing'; out.pnavMarked = p ? p.getAttribute('data-computer-open') : 'missing'; } }
      delete window.webkit;
      worldswClose();
      return out;
    }, FOUR);
    ok(`${t} #6406: in the app, an online computer is a same-window link (no new tab), still noreferrer`,
      !!inApp && inApp.inApp === true && /^https:\/\//.test(inApp.href) && inApp.target === null && inApp.rel === 'noopener noreferrer', JSON.stringify(inApp));
    ok(`${t} #6406: the phone menu's copy of an online computer also opens in the window`, !!inApp && inApp.pnavTarget === null, JSON.stringify(inApp));
    ok(`${t} #6406 step 2: every link to another computer is marked for the ticket click, the phone menu's copy too`,
      !!inApp && inApp.marked === '1' && inApp.pnavMarked === '1', JSON.stringify(inApp));

    // ---- Arm 4, #6406 step 2: in the app, a real click asks this computer for a ticket and opens the other computer
    //      with it in the fragment. LAST: it navigates away from the page. ----
    let landed = null;
    let landedReferer = null;
    await page.route('https://desk-mini.kosmosplus.example/**', (route) => { landed = route.request().url(); landedReferer = route.request().headers().referer || ''; return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>desk-mini</title>' }); });
    await page.evaluate(async (four) => {
      try { Object.defineProperty(window, 'webkit', { value: { messageHandlers: { kosmosBadge: { postMessage() {} } } }, configurable: true, writable: true }); } catch {}
      window.__ticket = 'TkT_abcdefghijklmnopqrstuvwxyz-0123456789';
      window.__ticketAsked = [];
      window.__computers = four;
      const before = window.__computersServed || 0;
      worldswClose(); worldswOpen();
      for (let i = 0; i < 40 && (window.__computersServed || 0) <= before; i++) await new Promise((r) => setTimeout(r, 25));
      await new Promise((r) => setTimeout(r, 100));
    }, FOUR);
    let goRel = null;
    await page.exposeFunction('__noteGo', (rel) => { goRel = rel; }).catch(() => {});
    await page.evaluate(() => { const real = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { try { window.__noteGo(this.rel + '|' + this.hasAttribute('data-computer-open')); } catch {} return real.call(this); }; });
    const asked = page.waitForURL(/desk-mini\.kosmosplus\.example/, { timeout: 5000 }).catch(() => null);
    await page.click('#worldsw-computers-list a.worldsw-row[href="https://desk-mini.kosmosplus.example/"]');
    await asked;
    const url = page.url();
    ok(`${t} #6406 step 2: in the app, clicking another computer opens it with this computer's ticket (#kpt=)`,
      url === 'https://desk-mini.kosmosplus.example/#kpt=TkT_abcdefghijklmnopqrstuvwxyz-0123456789' && !!landed, JSON.stringify({ url, landed }));
    /* Review 4: no Referer reaches the other computer. (This page is a file:// one, which sends none anyway; what the
       arm adds is that the navigation went through a link that says noreferrer.) */
    ok(`${t} #6406 step 2: no Referer reaches the other computer, and the navigation goes through an unmarked noreferrer link`,
      landedReferer === '' && goRel === 'noreferrer|false', JSON.stringify({ landedReferer, goRel }));

    // ---- Arm 5, kosmos#6585 (Josh 2026-10-19 09:12): back on the page (arm 4 left it). In the app, a computer the
    //      board measured as unable to switch instantly says so and stays; any other shows the animated K and its name
    //      from the click, over the whole window, while the ticket is made. ----
    await page.goto(PAGE);
    const FIVE = { ok: true, domain: FOUR.domain, computers: FOUR.computers.map((c) => (c.name === 'desk-mini' ? Object.assign({}, c, { instant: true }) : c))
      .concat([{ name: 'old-mini', address: 'old-mini.kosmosplus.example', this: false, online: true, instant: false }]) };
    await page.evaluate(async (five) => {
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      try { Object.defineProperty(window, 'webkit', { value: { messageHandlers: { kosmosBadge: { postMessage() {} } } }, configurable: true, writable: true }); } catch {}
      window.__ticketHang = true;
      window.__ticketAsked = [];
      window.__computers = five;
      document.getElementById('worldsw').hidden = false;
      const before = window.__computersServed || 0;
      worldswClose(); worldswOpen();
      for (let i = 0; i < 40 && (window.__computersServed || 0) <= before; i++) await new Promise((r) => setTimeout(r, 25));
      await new Promise((r) => setTimeout(r, 100));
    }, FIVE);
    await page.click('#worldsw-computers-list a.worldsw-row[href="https://old-mini.kosmosplus.example/"]');
    await page.waitForTimeout(200);
    const refused = await page.evaluate(() => ({ url: location.href, screen: !!document.getElementById('cswitch-screen'), asked: (window.__ticketAsked || []).length,
      toast: (document.getElementById('msg-toast') || {}).textContent || '' }));
    ok(`${t} #6585: an older Kosmos is not opened: no screen, no ticket, the page stays`,
      !refused.screen && refused.asked === 0 && refused.url.startsWith('file:'), JSON.stringify(refused));
    ok(`${t} #6585: and says why and what to do`,
      refused.toast === 'old-mini is on an older Kosmos, so it cannot switch instantly yet. Update Kosmos on old-mini, then try again.', refused.toast);
    await page.evaluate(() => { worldswClose(); worldswOpen(); });
    await page.waitForTimeout(150);
    await page.click('#worldsw-computers-list a.worldsw-row[href="https://desk-mini.kosmosplus.example/"]');
    await page.waitForTimeout(400);
    const shown = await page.evaluate(() => {
      const s = document.getElementById('cswitch-screen');
      if (!s) return null;
      const r = s.getBoundingClientRect();
      const cv = s.querySelector('canvas.cswitch-k');
      let inked = 0;
      try { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) inked += 1; } catch {}
      const top = document.elementFromPoint(innerWidth / 2, 20);
      return { text: s.textContent, role: s.getAttribute('role'), covers: r.left <= 0 && r.top <= 0 && r.right >= innerWidth && r.bottom >= innerHeight,
        onTop: !!top && s.contains(top), inked, bg: getComputedStyle(s).backgroundColor, asked: (window.__ticketAsked || []).length };
    });
    ok(`${t} #6585: from the click, the switching screen covers the window, on top, and names the computer`,
      !!shown && shown.covers && shown.onTop && shown.text === 'Opening desk-mini' && shown.role === 'status' && shown.asked === 1, JSON.stringify(shown));
    ok(`${t} #6585: the animated K is drawn (not a blank canvas) on an opaque ground`,
      !!shown && shown.inked > 50 && !/rgba\(0, 0, 0, 0\)|transparent/.test(shown.bg), JSON.stringify(shown && { inked: shown.inked, bg: shown.bg }));
    if (process.env.SHOTS_DIR) await page.screenshot({ path: path.join(process.env.SHOTS_DIR, `switching-${engine}-${theme}-desktop.png`) });

    await page.close();
  }
  await browser.close();
  }
  if (problems.length) {
    console.log('problems:\n  ' + problems.join('\n  '));
    console.log('\n' + pass + ' passed, ' + problems.length + ' FAILED');
    process.exit(1);
  }
  console.log(pass + ' passed, problems: none');
})().catch((e) => { console.error(e); process.exit(1); });
