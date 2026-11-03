'use strict';
// Browser-check-surface: pb-files-last pb-files-msg

/**
 * kosmos#7801: the restore screen's end line is a polite live region that stays in the page while empty, and only its
 * text changes, so a screen reader announces the end of a restore. The page's `.fhint:empty` rule is display:none,
 * which takes an empty region out of the accessibility tree as `hidden` did; `#pb-files-last:empty` must win over it.
 * The node test reads that rule's text; only a browser can say which rule wins. Page loaded from disk, no board, the
 * shipped pbfPaint and pbfRead driven with fetch stubbed, in Chromium and WebKit (the Mac app's engine):
 *  - CONTROL: an empty `.fhint` beside it computes display:none (so the next claim measures the override);
 *  - while a restore runs, the end line is shown, empty, display block, no height (no band);
 *  - at the end, the same element, still shown, carries the end words;
 *  - a refusal on screen is cleared by the read that sees the restore end;
 *  - kosmos#7816: aria-live is off in the markup and still off in the task of the first paint with the board's answer,
 *    polite only after a callback of its own, and polite when the end is written (a switch and a write in one task
 *    go unannounced);
 *  - no page error.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-pbrestore-end-7801.js
 */

const nodePath = require('node:path');
let pw;
try { pw = require('playwright'); }
catch { console.log('render-pbrestore-end-7801: playwright is not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const fails = [];
const say = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fails.push(label); };

(async () => {
  for (const engine of ['chromium', 'webkit']) {
    const tag = '[' + engine + ']';
    let browser;
    try { browser = await pw[engine].launch({ headless: process.env.HEADED === '0' }); }
    catch (err) { say(false, tag + ' could not start a browser', err && err.message ? err.message.split('\n')[0] : String(err)); continue; }
    const page = await browser.newPage({ viewport: { width: 393, height: 850 } });
    const errs = []; page.on('pageerror', (e) => { if (!/due to access control checks/.test(e.message)) errs.push(e.message); });
    await page.addInitScript(() => { window.setInterval = () => 0; });
    await page.goto('file://' + PAGE);
    await page.waitForFunction(() => typeof pbfPaint === 'function' && typeof pbfRead === 'function');
    const r = await page.evaluate(async () => {
      const el = document.getElementById('pb-files-last');
      if (!el) return { error: 'no #pb-files-last' };
      for (let a = el; a && a !== document.body; a = a.parentElement) a.hidden = false;
      const liveMarkup = el.getAttribute('aria-live');
      const ctl = document.createElement('p'); ctl.className = 'fhint'; el.parentElement.appendChild(ctl);
      PBF.status = { running: true, startedAt: Date.now(), last: null }; PBF.at = Date.now(); pbfPaint();
      const cs = getComputedStyle(el);
      const empty = { hidden: el.hidden, display: cs.display, h: el.getBoundingClientRect().height, text: el.textContent, ctl: getComputedStyle(ctl).display };
      const liveFill = el.getAttribute('aria-live');
      await new Promise((res) => setTimeout(res, 20));
      const liveAfter = el.getAttribute('aria-live');
      let liveAtEnd = null;
      // Read at the write itself, inside its task: the element's own setter, wrapped (an observer runs after the task).
      const tc = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
      Object.defineProperty(el, 'textContent', { configurable: true, get() { return tc.get.call(this); },
        set(v) { if (v && liveAtEnd === null) liveAtEnd = this.getAttribute('aria-live'); tc.set.call(this, v); } });
      document.getElementById('pb-files-msg').textContent = 'Confirm it is you on this device first.';
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ running: false, last: { ok: true, restored: 3, world: { id: 'w', name: 'Copy' } } }) });
      pbfRead();
      for (let i = 0; i < 20 && !el.textContent; i++) await new Promise((res) => setTimeout(res, 25));
      const filled = { same: document.getElementById('pb-files-last') === el, hidden: el.hidden, display: getComputedStyle(el).display, text: el.textContent,
        msg: document.getElementById('pb-files-msg').textContent };
      return { empty, filled, live: { markup: liveMarkup, fill: liveFill, after: liveAfter, end: liveAtEnd } };
    });
    if (r.error) { say(false, tag + ' ' + r.error); await browser.close(); continue; }
    const d = JSON.stringify(r);
    say(r.empty.ctl === 'none', tag + ' CONTROL: an empty .fhint is display:none here', d);
    say(!r.empty.hidden && r.empty.display === 'block' && r.empty.text === '', tag + ' running: the end line is shown and empty, rendered (display block, not hidden)', d);
    say(r.empty.h === 0, tag + ' running: the empty end line leaves no band', d);
    say(r.filled.same && !r.filled.hidden && r.filled.display === 'block' && /^Restored 3 files/.test(r.filled.text), tag + ' ended: the same line, shown, says the end', d);
    say(r.filled.msg === '', tag + ' ended: the old refusal is gone', d);
    say(r.live.markup === 'off', tag + ' aria-live: off in the markup', d);
    say(r.live.fill === 'off', tag + ' aria-live: still off in the task of the first paint with the answer', d);
    say(r.live.after === 'polite', tag + ' aria-live: polite after its own callback', d);
    say(r.live.end === 'polite', tag + ' aria-live: polite when the end is written', d);
    say(errs.length === 0, tag + ' no page error', errs.join(' | '));
    await browser.close();
  }
  console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall good');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
