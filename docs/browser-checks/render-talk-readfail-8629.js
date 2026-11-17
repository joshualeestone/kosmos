'use strict';
/**
 * kosmos#8629 (Josh, 2026-11-17 09:02): "I can read it for a while but if it's long and I'm reading it slowly,
 * then it jumps around and tries to jump down to the bottom or somewhere different."
 *
 * The path that moved him: ONE FAILED POLL. paintTalk's failure arm used to replace the whole thread with
 * "We could not read this conversation just now", which collapses the box (the reader's place is gone for a
 * poll), and the next good poll put the reader back by a PIXEL offset, because a note carries no anchor
 * (setThread's #1037 rule). With a message arriving meanwhile, that offset is on different words. Measured on
 * a real 200-message DM in WebKit and Chromium: back 534 px off. A board on this computer almost never fails a
 * poll, so every local check held still; a board reached over the network fails one now and then.
 *
 * This drives the REAL paintTalk (fetch answered here, the page's own code otherwise) through three arms:
 *   A. a reader in the middle of a long older message: good poll, FAILED poll, good poll with a new message
 *      that pushes the oldest row out (the board sends only the newest 200).
 *      The message must not move on screen at any step, its rows must stay during the failure, and the
 *      failure must still be SAID (one line at the thread's end) and be gone once a read works.
 *   B. CONTROL, a reader at the floor: the failure line is in view, and a new message still brings them down.
 *   C. the standing refusal (`because: 'borrowed'`) still paints its sentence alone, as before.
 * Red-capable: with the #8629 change reverted, arm A fails (rows gone during the failure, then on different
 * words). Run both ways before this landed.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-talk-readfail-8629.js
 * HEADED by default like its siblings; HEADED=0 on a no-console machine. Asserts layout, not pixels.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-talk-readfail-8629: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-talk-readfail-8629: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
  await page.addInitScript(() => {
    const now = Date.now();
    const long = Array.from({ length: 60 }, (_, i) => 'Line ' + i + ' of a long report the person is reading slowly, with enough words to wrap.').join('\n');
    const msgs = [];
    for (let i = 0; i < 30; i += 1) {
      const agent = i % 2 === 1;
      msgs.push({ id: 'm' + i, at: new Date(now - (60 - i) * 60000).toISOString(), text: i === 25 ? long : ('message ' + i),
        from: agent ? 'april' : null, delivery: agent ? null : { state: 'placed', because: null, paneState: 'idle', paneNote: null } });
    }
    window.__fx = { messages: msgs, olderCount: 0, historyBecause: null, historyUnfilable: false, presence: 'on', presenceBecause: null,
      asking: false, question: null, questionBecause: null, options: null };
    window.__answer = 'ok';
    const enc = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json' } });
    window.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/thread')) {
        if (window.__answer === 'fail') return enc({ error: 'the board did not answer' }, 502);
        if (window.__answer === 'borrowed') return enc({ error: 'no agent by that name', because: 'borrowed' }, 404);
        return enc(window.__fx);
      }
      if (u.includes('/api/status')) return enc({ agents: [{ sessionName: 'april', name: 'April', state: 'idle', status: 'idle', isNamedOurs: true }] });
      return enc({});
    };
  });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(async () => {
    const th = document.getElementById('d-dmthread');
    if (!th || typeof paintTalk !== 'function') return { error: 'paintTalk or #d-dmthread is gone from the page' };
    CURRENT = { sessionName: 'april', name: 'April' };
    document.getElementById('panel-detail').hidden = false;
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
    const settle = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const paint = async (answer) => { window.__answer = answer; await paintTalk('april', 'April'); await settle(); };
    const rowY = (mid) => { const row = th.querySelector('[data-mid="' + mid + '"]'); return row ? Math.round(row.getBoundingClientRect().top) : null; };
    const failLine = () => { const l = th.querySelector(':scope > p.dm-readfail'); return l ? l.textContent : null; };
    const gap = () => th.scrollHeight - th.scrollTop - th.clientHeight;
    const out = {};

    // A. scrolled back into the middle of the long message m25.
    await paint('ok');
    const row = th.querySelector('[data-mid="m25"]');
    if (!row) return { error: 'm25 was not painted' };
    th.scrollTop = row.offsetTop - th.offsetTop + Math.round(row.offsetHeight / 2);
    th.dispatchEvent(new Event('scroll'));
    await settle();
    await paint('ok');   // a list paint while scrolled back, so the page holds that posture
    out.aGap = gap();
    out.aY0 = rowY('m25');
    await paint('fail');
    out.aYFail = rowY('m25');
    out.aRowsFail = th.querySelectorAll('[data-mid]').length;
    out.aLineFail = failLine();
    const ms = window.__fx.messages;
    // as the board's 200-message window does: the new message pushes the oldest row out, above the reader
    window.__fx = { ...window.__fx, olderCount: 1, messages: [...ms.slice(1), { id: 'm30', at: new Date().toISOString(), text: 'a new agent message', from: 'april', delivery: null }] };
    await paint('ok');
    out.aYBack = rowY('m25');
    out.aLineBack = failLine();

    // B. CONTROL: at the floor.
    th.scrollTop = th.scrollHeight;
    th.dispatchEvent(new Event('scroll'));
    await settle();
    await paint('ok');
    await paint('fail');
    out.bGapFail = gap();
    out.bLineFail = failLine();
    window.__fx = { ...window.__fx, messages: [...window.__fx.messages, { id: 'm31', at: new Date().toISOString(), text: 'another agent message', from: 'april', delivery: null }] };
    await paint('ok');
    out.bGapBack = gap();
    out.bNewestY = rowY('m31');
    out.boxBottom = Math.round(th.getBoundingClientRect().bottom);

    // C. the standing refusal replaces the rows with its sentence, as before.
    await paint('borrowed');
    out.cRows = th.querySelectorAll('[data-mid]').length;
    out.cText = th.textContent.trim().slice(0, 80);
    window.__answer = 'ok';
    return out;
  });

  await browser.close();

  const problems = [];
  const near = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 3;
  if (r.error) problems.push(r.error);
  else {
    if (!(r.aGap > 200)) problems.push('setup: the reader was not scrolled back into m25 (gap to the floor ' + r.aGap + 'px)');
    if (!(r.aRowsFail > 0)) problems.push('A: a failed poll took the conversation off the screen (' + r.aRowsFail + ' rows left): the #8629 jump is back');
    if (!near(r.aYFail, r.aY0)) problems.push('A: the failed poll moved the reader: m25 at ' + r.aY0 + 'px, then ' + r.aYFail + 'px');
    if (!near(r.aYBack, r.aY0)) problems.push('A: the next good poll put the reader somewhere else: m25 at ' + r.aY0 + 'px, back at ' + r.aYBack + 'px');
    if (!/could not read this conversation just now/.test(String(r.aLineFail))) problems.push('A: the failure is no longer said under the kept rows (line: ' + JSON.stringify(r.aLineFail) + ')');
    if (r.aLineBack !== null) problems.push('A: the failure line stayed after a read worked: ' + JSON.stringify(r.aLineBack));
    if (!(r.bGapFail <= 4)) problems.push('B (control): a reader at the floor was left ' + r.bGapFail + 'px above it, with the failure line below the fold');
    if (!/could not read/.test(String(r.bLineFail))) problems.push('B (control): no failure line for a reader at the floor');
    if (!(r.bGapBack <= 4) || !(typeof r.bNewestY === 'number' && r.bNewestY < r.boxBottom)) problems.push('B (control): a new message did not bring a reader at the floor down (gap ' + r.bGapBack + 'px, newest at ' + r.bNewestY + ' vs box bottom ' + r.boxBottom + ')');
    if (r.cRows !== 0 || !/cannot show a conversation for this name/.test(String(r.cText))) problems.push('C: the standing refusal changed (rows ' + r.cRows + ', text ' + JSON.stringify(r.cText) + ')');
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-talk-readfail-8629: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-talk-readfail-8629: a failed poll keeps a scrolled-back reader on the same words, says so under the rows and clears it on the next read; at the floor new messages still bring them down; the standing refusal is unchanged.');
})();
