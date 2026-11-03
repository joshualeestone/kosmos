'use strict';
// Browser-check-surface: whatsnew wnOnPhone kapptabs

/**
 * kosmos#7839 (Josh, iPhone build 29): the board inside the iPhone app showed the desktop "Kosmos has been updated"
 * window. Loads the real page at phone size the way the app loads it: the app's own mark script (read from
 * ios/Kosmos/ShellLogic.swift, AppTabs.markScript) runs at document start, as its WKUserScript does. /api/whats-new is
 * stubbed to say the board moved from 0.7.84 to 0.7.85 with this release's highlights (web/whats-new.json). No board,
 * in Chromium and WebKit:
 *  - CONTROL, the same page not marked: the window opens and the version is recorded as seen;
 *  - marked by the app: no window, nothing recorded (so the computer's own window still shows it);
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
    for (const marked of [false, true]) {
      const tag = '[' + engine + (marked ? ' in the iPhone app' : ' not marked') + ']';
      const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
      const errs = []; page.on('pageerror', (e) => { if (!/due to access control checks/.test(e.message)) errs.push(e.message); });
      await page.addInitScript(() => { window.setInterval = () => 0; });
      await page.addInitScript(STUB, { version: NEWS.version, highlights: NEWS.highlights || [] });
      if (marked) await page.addInitScript(MARK);
      await page.goto('file://' + PAGE);
      await page.waitForFunction(() => typeof whatsNewCheck === 'function');
      // The load's own check can wait behind the first-run tour or the boot cover on a file:// page; clear them and
      // ask again, as the next load would.
      const r = await page.evaluate(async () => {
        for (const id of ['firstrun', 'boot-cover']) { const e = document.getElementById(id); if (e) e.hidden = true; }
        if (typeof TIP_OPEN !== 'undefined') { try { TIP_OPEN = null; } catch { /* const in some builds */ } }
        await whatsNewCheck();
        await new Promise((res) => setTimeout(res, 50));
        const w = document.getElementById('whatsnew');
        return { marked: document.documentElement.classList.contains('kapptabs'), shown: !!w && !w.hidden && getComputedStyle(w).display !== 'none', seen: window.__wnSeen };
      });
      say(r.marked === marked, tag + ' the page is marked as the app marks it: ' + marked, JSON.stringify(r));
      if (marked) {
        say(!r.shown, tag + ' no "Kosmos has been updated" window', JSON.stringify(r));
        say(r.seen === 0, tag + ' the version is not recorded as seen, so the computer still shows it', JSON.stringify(r));
      } else {
        say(r.shown, tag + ' CONTROL: the window opens', JSON.stringify(r));
        say(r.seen >= 1, tag + ' CONTROL: the version is recorded as seen', JSON.stringify(r));
      }
      say(errs.length === 0, tag + ' no page error', errs.join(' | '));
      await page.close();
    }
    await browser.close();
  }
  console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall good');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
