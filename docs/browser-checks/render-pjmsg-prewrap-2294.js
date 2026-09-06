'use strict';

/**
 * kosmos#2294: a PLAIN marker-less multi-line message renders its paragraph breaks on the
 * project message list (`.pj-msg-text`) instead of collapsing to one line. pjRich's fast
 * path returns `esc(raw)` with the literal `\n`, which `white-space: normal` collapsed --
 * the bug. The fix is `white-space: pre-wrap` on `.pj-msg-text` (matching `.dm-b`).
 *
 * The load-bearing check on a real render, using the page's own pjRich:
 *  - `.pj-msg-text` computes `white-space: pre-wrap`;
 *  - a plain two-line message renders TALLER than a one-line message (the break renders --
 *    the fix; on the pre-fix `normal` surface the two collapse to the same height);
 *  - a MARKDOWN two-line message (which takes pjRich's slow path, joining with `<br>`)
 *    renders at essentially the SAME height as the plain two-line message -- proving
 *    pre-wrap does not DOUBLE a markdown message's breaks (its output carries no literal
 *    `\n`), which is the interaction the fix had to be safe against.
 *
 * CONTROL: on the pre-fix page (`.pj-msg-text` is `white-space: normal`) the plain two-line
 * message collapses to one line, so its height equals the one-line height and the
 * "taller" assertion reds.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-pjmsg-prewrap-2294.js
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-pjmsg-prewrap-2294: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-pjmsg-prewrap-2294: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(() => {
    if (typeof pjRich !== 'function') return { error: 'pjRich is not a function' };
    // Build a real .pj-msg > .pj-msg-text node and measure its rendered height. A wide,
    // fixed container so the two lines are a break, never a soft-wrap of one long line.
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-9999px;top:0;width:600px;';
    document.body.appendChild(host);
    const render = (raw) => {
      const wrap = document.createElement('div');
      wrap.className = 'pj-msg';
      const span = document.createElement('span');
      span.className = 'pj-msg-text';
      span.innerHTML = pjRich(raw);
      wrap.appendChild(span);
      host.appendChild(wrap);
      const mdcb = span.querySelector('.mdcb');
      return {
        h: span.getBoundingClientRect().height,
        ws: getComputedStyle(span).whiteSpace,
        html: span.innerHTML,
        mdcb: mdcb ? { h: mdcb.getBoundingClientRect().height, ws: getComputedStyle(mdcb).whiteSpace } : null,
      };
    };
    const one = render('one line here');
    const plainTwo = render('line one\nline two');
    const mdTwo = render('**line one**\n**line two**');   // markers -> slow path (<br>)
    // A fenced code block: the slow path emits esc(body.join('\n')) inside a .mdcb span, the
    // one place its output carries a literal \n. .mdcb has its OWN pre-wrap, so those
    // newlines render there; the parent pre-wrap must not change that.
    const codeFence = render('```\ncode one\ncode two\n```');
    host.remove();
    return { one, plainTwo, mdTwo, codeFence };
  });

  await browser.close();

  const problems = [];
  if (r.error) problems.push(r.error);
  if (!r.error) {
    if (r.plainTwo.ws !== 'pre-wrap') problems.push('.pj-msg-text should compute white-space: pre-wrap, got "' + r.plainTwo.ws + '"');
    // The break renders: two lines are meaningfully taller than one.
    if (!(r.plainTwo.h > r.one.h * 1.5)) problems.push('a plain two-line message did not render as two lines -- height ' + r.plainTwo.h + ' vs one-line ' + r.one.h + ' (the paragraph break collapsed -- the #2294 bug)');
    // The markdown two-line message (slow path, <br>) renders the SAME as the plain one,
    // not doubled: its height is within ~35% of the plain two-line height.
    if (Math.abs(r.mdTwo.h - r.plainTwo.h) > r.one.h * 0.5) problems.push('a markdown two-line message renders a different number of lines than the plain one (height ' + r.mdTwo.h + ' vs ' + r.plainTwo.h + ') -- pre-wrap may be doubling the <br> breaks');
    // Sanity: the plain fast path kept the literal newline (no <br> injected).
    if (/<br>/i.test(r.plainTwo.html)) problems.push('the plain message unexpectedly went through the slow path (contains <br>): ' + r.plainTwo.html);
    if (!/<br>/i.test(r.mdTwo.html)) problems.push('the markdown message did not take the slow path (no <br>): ' + r.mdTwo.html);
    // Fenced code: the .mdcb span exists, keeps its OWN pre-wrap, and renders its two code
    // lines as two lines -- so the literal \n inside it is unaffected by the parent pre-wrap.
    if (!r.codeFence.mdcb) problems.push('a fenced code block did not render a .mdcb span: ' + r.codeFence.html);
    else {
      if (r.codeFence.mdcb.ws !== 'pre-wrap') problems.push('the .mdcb fenced-code span should keep its own white-space: pre-wrap, got "' + r.codeFence.mdcb.ws + '"');
      if (!(r.codeFence.mdcb.h > r.one.h * 1.5)) problems.push('the fenced code block did not render its two code lines (mdcb height ' + r.codeFence.mdcb.h + ' vs one-line ' + r.one.h + ')');
    }
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-pjmsg-prewrap-2294: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-pjmsg-prewrap-2294: a plain multi-line message renders its breaks on .pj-msg-text (white-space: pre-wrap), and a markdown message (slow-path <br>) renders the same, not doubled.');
})();
