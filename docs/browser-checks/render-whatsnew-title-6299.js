'use strict';

/**
 * kosmos#6299: the What's New window's title keeps its lines apart when it wraps.
 *
 * The body's line-height is an absolute 16px, and the 24px title inherited it, so on a phone "Kosmos has been updated
 * to" and the version drew on top of each other (seen on 0.7.51's staging build; there since #4077). Opens the real
 * window (wnOpen) with this release's own highlights (web/whats-new.json), no board, in Chromium and WebKit:
 *  - at 393 px the title wraps (so the next claim measures something), and its lines are at least one font size apart;
 *  - at 1280 px it is one line;
 *  - no page error.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-whatsnew-title-6299.js
 */

const nodePath = require('node:path');
const fs = require('node:fs');
let pw;
try { pw = require('playwright'); }
catch { console.log('render-whatsnew-title-6299: playwright is not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const NEWS = JSON.parse(fs.readFileSync(nodePath.join(__dirname, '..', '..', 'web', 'whats-new.json'), 'utf8'));
const fails = [];
const say = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fails.push(label); };

(async () => {
  for (const engine of ['chromium', 'webkit']) {
    let browser;
    try { browser = await pw[engine].launch({ headless: process.env.HEADED === '0' }); }
    catch (err) { say(false, '[' + engine + '] could not start a browser', err && err.message ? err.message.split('\n')[0] : String(err)); continue; }
    for (const w of [393, 1280]) {
      const tag = '[' + engine + ' ' + w + ']';
      const page = await browser.newPage({ viewport: { width: w, height: 850 } });
      const errs = []; page.on('pageerror', (e) => { if (!/due to access control checks/.test(e.message)) errs.push(e.message); });
      await page.goto('file://' + PAGE);
      const r = await page.evaluate((news) => {
        wnOpen(news.version, news.highlights || []);
        const t = document.getElementById('wn-title');
        if (!t) return { error: 'no #wn-title' };
        const range = document.createRange(); range.selectNodeContents(t);
        const tops = [...new Set([...range.getClientRects()].map((x) => Math.round(x.top)))].sort((a, b) => a - b);
        const gaps = tops.slice(1).map((v, i) => v - tops[i]);
        return { lines: tops.length, minGap: gaps.length ? Math.min(...gaps) : null, fontSize: parseFloat(getComputedStyle(t).fontSize), text: t.textContent };
      }, NEWS);
      if (r.error) { say(false, tag + ' ' + r.error); await page.close(); continue; }
      if (w === 393) {
        say(r.lines >= 2, tag + ' the title wraps at phone width (so the spacing is measured)', JSON.stringify(r));
        say(r.minGap !== null && r.minGap >= r.fontSize, tag + ' the title\'s lines are at least one font size apart', JSON.stringify(r));
      } else {
        say(r.lines === 1, tag + ' the title is one line on a computer', JSON.stringify(r));
      }
      say(errs.length === 0, tag + ' no page error', errs.join(' | '));
      await page.close();
    }
    await browser.close();
  }
  console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall good');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
