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
 *     (the route's { ok: false }) shows NO section at all.
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
        if (String(url).indexOf('/api/remote/computers') !== -1) {
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
    await page.goto(PAGE);
    const t = `[${engine} ${theme}]`;

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
      worldswClose();
      worldswOpen();
      for (let i = 0; i < 20 && !document.getElementById('worldsw-computers').hidden; i++) await new Promise((r) => setTimeout(r, 25));
      const box = document.getElementById('worldsw-computers');
      return { hidden: box.hidden, display: getComputedStyle(box).display, rows: document.querySelectorAll('#worldsw-computers-list .worldsw-row').length };
    });
    ok(`${t} not signed in: the section is gone`, b.hidden === true && b.display === 'none' && b.rows === 0, JSON.stringify(b));

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
