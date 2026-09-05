'use strict';
/**
 * kosmos#1926: the agent talk thread flashed and JUMPED every 5 seconds when the
 * reader had scrolled back. Josh: "it jumps to different spots." Angel's fix
 * (PR #1931) anchors a scrolled-back reader to the MESSAGE they were on, not a
 * pixel: content ABOVE the reader can change height between polls (a relative
 * timestamp ticks, a late image loads), so restoring the same scrollTop lands
 * them on a different message. `setThread` now captures `threadAnchor` (the
 * message + its offset below the viewport top) before the repaint and
 * `restoreThreadAnchor`s it after.
 *
 * ⚠️ WHY A BROWSER, AND WHY THIS ONE DID NOT EXIST. web.thread-scroll.test.js
 * drives setThread against a STUB box whose querySelectorAll returns [], so
 * threadAnchor returns null and only the PIXEL-fallback arithmetic (#1037) is
 * exercised. The #1926 MESSAGE-anchor -- the actual fix for "jumps to different
 * spots" -- needs real rows with real heights and a real scroll box, so nothing
 * automated covered it; it was parked needs-browser. This drives the REAL
 * setThread + threadAnchor + restoreThreadAnchor against real `data-mid` rows in
 * a real scroll container, with content above the reader GROWING between the two
 * paints, and asserts the reader stays on the same message.
 *
 * Load-bearing CONTROL: it also computes where a pixel-restore WOULD have left
 * the reader and asserts that would have jumped (the above-content genuinely
 * grew), so a green "stayed on the message" is not a scenario that never moved.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-talk-anchor-1926.js
 *
 * ⚠️ HEADED by default like its siblings; HEADED=0 on a no-console machine. It
 * asserts computed layout (offsets/scrollTop), not pixels.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-talk-anchor-1926: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-talk-anchor-1926: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(() => {
    const thread = document.getElementById('d-dmthread');
    if (!thread) return { error: '#d-dmthread is gone from the page' };
    if (typeof setThread !== 'function' || typeof threadAnchor !== 'function' || typeof restoreThreadAnchor !== 'function') {
      return { error: 'the #1926 anchor functions are not on the page (setThread/threadAnchor/restoreThreadAnchor)' };
    }
    // The thread lives under a normally-hidden detail panel; unhide every
    // ancestor so it gets real layout, then make it a fixed-height scroll box.
    for (let el = thread; el && el !== document.body; el = el.parentElement) {
      el.hidden = false;
      if (getComputedStyle(el).display === 'none') el.style.display = 'block';
    }
    thread.style.height = '300px';
    thread.style.overflowY = 'auto';
    thread.style.display = 'block';

    // 40 message rows; when `growAbove` is set the 15 rows ABOVE the reader
    // (m0..m14) are much taller, modelling content above the reader gaining
    // height between two polls (a ticking timestamp, a late image).
    const rowsHtml = (growAbove) => {
      let h = '';
      for (let i = 0; i < 40; i += 1) {
        const tall = growAbove && i < 15 ? ' style="min-height:80px"' : ' style="min-height:24px"';
        h += '<div class="dm theirs" data-mid="m' + i + '"' + tall + '>'
          + '<div class="dm-b">message number ' + i + '</div></div>';
      }
      return h;
    };

    // First paint: establishes __lastCount + __lastThread; no anchor on a first list.
    setThread(thread, rowsHtml(false), 'k1');
    const midOf = (m) => [...thread.querySelectorAll('[data-mid]')].find((r) => r.getAttribute('data-mid') === m);

    // Scroll so a MIDDLE message (m20) sits ~40px below the viewport top: content
    // both above it (to grow) and below it (so the reader is NOT at the bottom).
    const target = midOf('m20');
    if (!target) return { error: 'm20 did not render' };
    thread.scrollTop = target.offsetTop - 40;
    const beforeTop = thread.scrollTop;
    const beforeDelta = target.offsetTop - thread.scrollTop; // ~40
    const atBottomBefore = (thread.scrollHeight - thread.scrollTop - thread.clientHeight) <= 24;

    // Second paint: the same 40 messages, but the 15 rows ABOVE the reader are now taller.
    setThread(thread, rowsHtml(true), 'k2');

    const after = midOf('m20');
    if (!after) return { error: 'm20 disappeared after the repaint' };
    const afterDelta = after.offsetTop - thread.scrollTop;      // where the anchor left the reader
    const pixelDelta = after.offsetTop - beforeTop;             // where a pixel-restore WOULD have left them

    // Also prove dmRow stamps the stable data-mid the anchor reads.
    let dmRowStampsMid = null;
    try {
      const html = dmRow({ from: 'agent1', at: 1710000000000, id: 'MSG-ABC', text: 'hi', words: 'hi', preview: null }, 'Agent One');
      dmRowStampsMid = /data-mid="MSG-ABC"/.test(html);
    } catch (e) { dmRowStampsMid = 'threw: ' + (e && e.message ? e.message.split('\n')[0] : e); }

    return { atBottomBefore, beforeDelta, afterDelta, pixelDelta, dmRowStampsMid };
  });

  await browser.close();

  const problems = [];
  if (r.error) problems.push(r.error);
  else {
    if (r.atBottomBefore !== false) {
      problems.push('setup: the reader was not actually scrolled back before the repaint (atBottom=' + r.atBottomBefore + ')');
    }
    // The anchor must keep m20 at the same offset below the viewport top (within a couple px).
    if (!(Math.abs(r.afterDelta - r.beforeDelta) <= 3)) {
      problems.push('the reader was NOT held on message m20 across the repaint: before-delta ' + r.beforeDelta
        + 'px, after-delta ' + r.afterDelta + 'px (the #1926 jump is back)');
    }
    // CONTROL: a pixel-restore would have jumped, so the scenario genuinely moved content above the reader.
    if (!(Math.abs(r.pixelDelta - r.beforeDelta) > 20)) {
      problems.push('CONTROL FAILED: a pixel-restore would NOT have jumped here (pixel-delta ' + r.pixelDelta
        + 'px vs before ' + r.beforeDelta + 'px), so the above-content did not grow and the anchor was never tested');
    }
    if (r.dmRowStampsMid !== true) {
      problems.push('dmRow no longer stamps the stable data-mid the anchor reads (got ' + JSON.stringify(r.dmRowStampsMid) + ')');
    }
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-talk-anchor-1926: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-talk-anchor-1926: a scrolled-back reader stays on the same message across a repaint that grows content above them; a pixel-restore would have jumped; dmRow stamps the stable data-mid.');
})();
