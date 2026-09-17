/**
 * #3208: the direct-agent "Talk to X" composer must accept multi-line messages.
 *
 * Josh (6.72): in direct agent messaging his own messages did not respect
 * formatting -- paragraph breaks compressed to one line. Root cause: the composer
 * #d-say was an <input type="text">, which strips newlines by construction, so a
 * paragraph break never reached the store. The rest of the pipeline already
 * supported multi-line: the send handler only .trim()s (keeps internal newlines),
 * the store keeps paragraph breaks (#1927), and the .dm-b bubble renders them
 * (white-space: pre-wrap + pjRich). The fix makes #d-say a <textarea rows=1>
 * mirroring the room's #pj-post: Enter sends, Shift+Enter inserts a newline
 * (preserving the IME rule), and the box autosizes via pjGrowComposer.
 *
 * This check boots its own seeded server (self-contained; run directly with
 *   HEADED=0 NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-dm-multiline-3208.js
 * ), opens an agent's Talk view, and asserts the composer is a textarea that keeps
 * newlines and grows, the Enter/Shift+Enter split, and that a multi-line message
 * renders as multiple lines in the bubble.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dm3208-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dm3208-w-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dm3208-p-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dm3208-l-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dm3208-c-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra !== undefined ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

(async () => {
  fleet.install([
    fleet.agent('april', { state: 'working', displayName: 'April', role: 'Research Assistant' }),
  ]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: 'light' });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(URL + '/?tab=agents', { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    // Open the agent's Talk view.
    await page.evaluate(() => { const el = document.querySelector('#alist .lrow .namego') || document.querySelector('#alist .lrow'); if (el) el.click(); });
    await page.waitForSelector('#d-say', { timeout: 10000 });
    await page.waitForTimeout(300);

    const out = await page.evaluate(() => {
      const say = document.getElementById('d-say');
      const r = {};
      r.tag = say.tagName;
      const oneLine = Math.round(say.getBoundingClientRect().height);
      /* Enter behaviour, tested on an EMPTY box so no message is actually sent:
         a bare Enter is prevented (it sends, so it must not also insert a newline),
         Shift+Enter is NOT prevented (it inserts a newline). */
      const fire = (shift) => { const e = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: shift, bubbles: true, cancelable: true }); say.value = ''; say.dispatchEvent(e); return e.defaultPrevented; };
      r.enterPrevented = fire(false);
      r.shiftEnterPrevented = fire(true);
      /* Multi-line value survives in the box (an <input> would have stripped the \n). */
      say.value = 'First paragraph.\n\nSecond paragraph.';
      say.dispatchEvent(new Event('input', { bubbles: true }));
      r.newlinesKept = (say.value.match(/\n/g) || []).length;
      r.grewHeight = Math.round(say.getBoundingClientRect().height);
      r.oneLine = oneLine;
      /* Clearing through pjComposerReset returns the box to one line (the #1303-C
         rule: a programmatic value write regrows; the reset shrinks it back). */
      pjComposerReset(say);
      r.afterResetHeight = Math.round(say.getBoundingClientRect().height);
      /* #3208: a disabled composer (agent off/unreachable) must still look closed.
         The .dmbar disabled-dimming rule was input-only; the textarea arm keeps the
         box at opacity .5 when disabled. Read it, then re-enable. */
      r.enabledOpacity = getComputedStyle(say).opacity;
      say.disabled = true;
      r.disabledOpacity = getComputedStyle(say).opacity;
      say.disabled = false;
      /* The bubble renders the paragraph break: pjRich fast path keeps the literal
         \n and .dm-b is white-space: pre-wrap, so a two-paragraph message is >1 line. */
      const probe = document.createElement('div'); probe.className = 'dm mine';
      probe.innerHTML = '<div class="dm-b">' + pjRich('Line one.\n\nLine three.') + '</div>';
      document.body.appendChild(probe);
      const dmb = probe.querySelector('.dm-b');
      const cs = getComputedStyle(dmb);
      r.dmbWhiteSpace = cs.whiteSpace;
      r.dmbKeepsNewline = dmb.innerHTML.indexOf('\n') !== -1;
      r.dmbLines = Math.round(dmb.getBoundingClientRect().height / (parseFloat(cs.lineHeight) || 18));
      return r;
    });

    console.log('  measured: ' + JSON.stringify(out));
    chk(out.tag === 'TEXTAREA', 'the Talk composer #d-say is a <textarea> (not a single-line <input>)', out.tag);
    chk(out.newlinesKept === 2, 'a multi-line message keeps its paragraph breaks in the box (an <input> would strip them)', 'newlines=' + out.newlinesKept);
    chk(out.enterPrevented === true, 'a bare Enter is intercepted (it sends, not inserts a newline)', String(out.enterPrevented));
    chk(out.shiftEnterPrevented === false, 'Shift+Enter is NOT intercepted (it inserts a newline)', String(out.shiftEnterPrevented));
    chk(out.grewHeight > out.oneLine + 5, 'the composer autosizes: a multi-line message grows the box', 'one=' + out.oneLine + ' grown=' + out.grewHeight);
    chk(out.afterResetHeight <= out.oneLine + 2, 'pjComposerReset returns the box to one line', 'one=' + out.oneLine + ' afterReset=' + out.afterResetHeight);
    chk(parseFloat(out.enabledOpacity) === 1 && Math.abs(parseFloat(out.disabledOpacity) - 0.5) < 0.05, 'a disabled composer stays dimmed (a closed box looks closed)', 'enabled=' + out.enabledOpacity + ' disabled=' + out.disabledOpacity);
    chk(out.dmbWhiteSpace === 'pre-wrap', 'the message bubble .dm-b is white-space: pre-wrap', out.dmbWhiteSpace);
    chk(out.dmbKeepsNewline === true, 'pjRich keeps the literal newline for a plain multi-line message', String(out.dmbKeepsNewline));
    chk(out.dmbLines >= 3, 'a two-paragraph message renders as multiple lines in the bubble', 'lines=' + out.dmbLines);
    chk(errs.length === 0, 'no page errors', errs.join(' | '));
    await page.close();
  } finally {
    await browser.close();
    server.close();
    fleet.restore();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
