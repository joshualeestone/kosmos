'use strict';
// Browser-check-surface: whatsnew wnOnPhone kapptabs

/**
 * kosmos#7839 (Josh, iPhone build 29): the board inside the iPhone app showed the desktop "Kosmos has been updated"
 * window. Loads the real page at phone size the way the app loads it: the app's own mark script (read from
 * ios/Kosmos/ShellLogic.swift, AppTabs.markScript) runs at document start, as its WKUserScript does. /api/whats-new is
 * stubbed to say the board moved from 0.7.84 to 0.7.85 with this release's highlights (web/whats-new.json). No board,
 * in Chromium and WebKit:
 *  - CONTROL, the same page not marked (on the computer, and over Kosmos+ at desktop width): the window opens and the
 *    version is recorded as seen;
 *  - marked by the app, or over a Kosmos+ address at phone width (the Android app, a phone browser): the load itself
 *    shows no window and records nothing (so the computer's own window still shows it), judged after 1.5 s;
 *  - no page error.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-whatsnew-phone-7839.js
 */

const nodePath = require('node:path');
const fs = require('node:fs');
let pw;
try { pw = require('playwright'); }
catch { console.log('render-whatsnew-phone-7839: playwright is not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const ROOT = nodePath.join(__dirname, '..', '..');
const PAGE = nodePath.join(ROOT, 'web', 'index.html');
const NEWS = JSON.parse(fs.readFileSync(nodePath.join(ROOT, 'web', 'whats-new.json'), 'utf8'));
const SWIFT = fs.readFileSync(nodePath.join(ROOT, 'ios', 'Kosmos', 'ShellLogic.swift'), 'utf8');
const MARK = (SWIFT.match(/static let markScript = """\n([\s\S]*?)\n\s*"""/) || [])[1];
const REMOTE_HOST = 'https://sample.kosmosplus.com';
const REMOTE = REMOTE_HOST + '/';
const HTML = fs.readFileSync(PAGE, 'utf8');
const fails = [];
const say = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fails.push(label); };

// /api/whats-new answers an update to this release; the seen POST is counted.
const STUB = (news) => {
  window.__wnSeen = 0;
  const real = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = (url, opts) => {
    const u = String(url);
    if (u.endsWith('/api/whats-new/seen')) { window.__wnSeen++; return Promise.resolve(new Response('', { status: 200 })); }
    if (u.endsWith('/api/whats-new')) return Promise.resolve(new Response(JSON.stringify({ current: news.version, seen: '0.7.84', highlights: news.highlights }), { status: 200, headers: { 'content-type': 'application/json' } }));
    return real ? real(url, opts) : Promise.reject(new Error('no fetch'));
  };
};

(async () => {
  say(!!MARK && /classList\.add\('kapptabs'\)/.test(MARK), 'CONTROL: the iPhone app\'s mark script was read from ShellLogic.swift');
  for (const engine of ['chromium', 'webkit']) {
    let browser;
    try { browser = await pw[engine].launch({ headless: process.env.HEADED === '0' }); }
    catch (err) { say(false, '[' + engine + '] could not start a browser', err && err.message ? err.message.split('\n')[0] : String(err)); continue; }
    // Each arm: how the page is loaded, and whether the window should show. The "none" arms are judged on the
    // load's OWN call (nothing is called by hand), after more than one tick of its held loop.
    const arms = [
      { name: 'not marked, on the computer', url: 'file://' + PAGE, mark: false, width: 393, show: true },
      { name: 'in the iPhone app', url: 'file://' + PAGE, mark: true, width: 393, show: false },
      { name: 'Kosmos+ address at phone width (Android, a phone browser)', url: REMOTE, mark: false, width: 393, show: false },
      { name: 'Kosmos+ address at desktop width', url: REMOTE, mark: false, width: 1280, show: true },
    ];
    for (const arm of arms) {
      const tag = '[' + engine + ' ' + arm.name + ']';
      const page = await browser.newPage({ viewport: { width: arm.width, height: 852 } });
      const errs = []; page.on('pageerror', (e) => { if (!/due to access control checks/.test(e.message)) errs.push(e.message); });
      // A Kosmos+ address: the page itself at that host; anything else it asks for is refused (fetch is stubbed).
      await page.route(REMOTE_HOST + '/**', (r) => (r.request().url() === REMOTE ? r.fulfill({ status: 200, contentType: 'text/html', body: HTML }) : r.abort()));
      await page.addInitScript(() => { window.setInterval = () => 0; });
      await page.addInitScript(STUB, { version: NEWS.version, highlights: NEWS.highlights || [] });
      if (arm.mark) await page.addInitScript(MARK);
      await page.goto(arm.url);
      await page.waitForFunction(() => typeof whatsNewCheck === 'function');
      const base = await page.evaluate(() => new Promise((res) => setTimeout(() => {
        const w = document.getElementById('whatsnew');
        res({ remote: typeof kplusRemote === 'function' && kplusRemote(), marked: document.documentElement.classList.contains('kapptabs'),
          shown: !!w && !w.hidden, seen: window.__wnSeen });
      }, 1500)));
      say(base.marked === arm.mark && base.remote === (arm.url === REMOTE), tag + ' loaded as meant (marked ' + arm.mark + ', Kosmos+ ' + (arm.url === REMOTE) + ')', JSON.stringify(base));
      if (!arm.show) {
        say(!base.shown, tag + ' the load shows no "Kosmos has been updated" window', JSON.stringify(base));
        say(base.seen === 0, tag + ' the load records nothing, so the computer still shows it', JSON.stringify(base));
      } else {
        // CONTROL: the load's own call can wait behind the first-run tour or the boot cover; clear them and ask again.
        const r = await page.evaluate(async () => {
          for (const id of ['firstrun', 'boot-cover']) { const e = document.getElementById(id); if (e) e.hidden = true; }
          await whatsNewCheck(); await new Promise((res) => setTimeout(res, 50));
          const w = document.getElementById('whatsnew');
          return { shown: !!w && !w.hidden, seen: window.__wnSeen };
        });
        say(r.shown && r.seen >= 1, tag + ' CONTROL: the window opens and the version is recorded', JSON.stringify(r));
      }
      say(errs.length === 0, tag + ' no page error', errs.join(' | '));
      await page.close();
    }
    await browser.close();
  }
  console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall good');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
