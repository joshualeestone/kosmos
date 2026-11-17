'use strict';
/**
 * kosmos#8629 (Josh, 2026-11-17 09:02): "I can read it for a while but if it's long and I'm reading it slowly,
 * then it jumps around and tries to jump down to the bottom or somewhere different."
 *
 * The path that moved him: ONE FAILED POLL. paintTalk's failure arm used to replace the whole thread with
 * "We could not read this conversation just now", which collapses the box (the reader's place is gone for a
 * poll), and the next good poll put the reader back by a PIXEL offset, because a note carries no anchor
 * (setThread's #1037 rule). With a message arriving meanwhile, that offset is on different words. Measured on
 * a real 200-message DM in WebKit and Chromium: back 534 px off. This check itself runs Chromium only. A board on this computer almost never fails a
 * poll, so every local check held still; a board reached over the network fails one now and then.
 *
 * This drives the REAL paintTalk (fetch answered here, the page's own code otherwise) through three arms:
 *   A. a reader in the middle of a long older message: good poll, FAILED poll, good poll with a new message
 *      that pushes the oldest row out (the board sends only the newest 200).
 *      The message must not move on screen at any step, its rows must stay during the failure, and the
 *      failure must still be SAID (one line at the thread's end) and be gone once a read works.
 *   Q. the same with the question box (#d-qask) showing above the thread: it stays put and goes inert.
 *   B. CONTROL, a reader at the floor: the failure line is in view, and a new message still brings them down.
 *   F. keyboard focus on a link in a kept row stays on it.
 *   K. a question's choice buttons are disabled while the read fails and given back after.
 *   D. a box with no rows yet ("Opening...") still paints the failure sentence alone.
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
      msgs.push({ id: 'm' + i, at: new Date(now - (60 - i) * 60000).toISOString(), text: i === 25 ? long : (i === 24 ? 'see https://example.com/page for the report' : ('message ' + i)),
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
    document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });   // the first-run screen leaves the rest inert
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
    out.aLineLast = !!(th.lastElementChild && th.lastElementChild.matches('p.dm-readfail[role="status"]'));
    await paint('fail');   // a network that keeps failing: still one line, the reader still where they were
    out.aLines2 = th.querySelectorAll(':scope > p.dm-readfail').length;
    out.aYFail2 = rowY('m25');
    const ms = window.__fx.messages;
    // as the board's 200-message window does: the new message pushes the oldest row out, above the reader
    window.__fx = { ...window.__fx, olderCount: 1, messages: [...ms.slice(1), { id: 'm30', at: new Date().toISOString(), text: 'a new agent message', from: 'april', delivery: null }] };
    await paint('ok');
    out.aYBack = rowY('m25');
    out.aLineBack = failLine();

    // Q. the same, with the question box (#d-qask) showing ABOVE the thread: a failed poll must not hide it
    //    (that slides the reader by its height) and the next good poll must not show it again under them.
    window.__fx = { ...window.__fx, asking: true, answerNote: 'Trust this folder to continue.' };
    await paint('ok');
    const qask = document.getElementById('d-qask');
    const qrow = th.querySelector('[data-mid="m25"]');
    th.scrollTop = qrow.offsetTop - th.offsetTop + Math.round(qrow.offsetHeight / 2);
    th.dispatchEvent(new Event('scroll'));
    await settle();
    await paint('ok');
    out.qShown = !qask.hidden;
    out.qY0 = rowY('m25');
    await paint('fail');
    out.qYFail = rowY('m25');
    out.qShownFail = !qask.hidden;
    out.qInertFail = qask.inert === true;
    await paint('ok');
    out.qYBack = rowY('m25');
    out.qInertBack = qask.inert === true;
    window.__fx = { ...window.__fx, asking: false, answerNote: null };
    await paint('ok');

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

    // F. focus on a link inside a kept row stays there through a failed poll (it is still on screen).
    const link = th.querySelector('[data-mid="m24"] a');
    out.fHasLink = !!link;
    if (link) { link.focus(); out.fWas = document.activeElement === link; await paint('fail'); out.fFocusKept = document.activeElement === link; await paint('ok'); }

    // K. the agent asks a question with choices: while a read fails its buttons are disabled (a press would do
    //    nothing), and the next good read gives back exactly the ones the failure disabled.
    const qmsgs = [...window.__fx.messages, { id: 'q1', at: new Date().toISOString(), text: 'Which one?', from: 'april', kind: 'question', delivery: null }];
    window.__fx = { ...window.__fx, messages: qmsgs, asking: true, asked: 'ask-1', options: [{ n: 1, label: 'Yes' }, { n: 2, label: 'No' }] };
    await paint('ok');
    const btns = () => [...th.querySelectorAll('button.dmchoice')];
    out.kCount = btns().length;
    out.kOnBefore = btns().every((b) => !b.disabled);
    await paint('fail');
    out.kOffFail = btns().length > 0 && btns().every((b) => b.disabled);
    await paint('ok');
    out.kOnBack = btns().length > 0 && btns().every((b) => !b.disabled);
    out.kMarksLeft = th.querySelectorAll('[data-readfail-off]').length;
    window.__fx = { ...window.__fx, asking: false, asked: null, options: null };
    await paint('ok');

    // D. a box with no rows yet (an agent just opened, its "Opening..." note up) still paints the failure alone:
    //    nothing is kept, so no earlier agent's rows can stand under this one's name.
    setThread(th, '<p class="dmnone">Opening&hellip;</p>', null);
    await paint('fail');
    out.dRows = th.querySelectorAll('[data-mid]').length;
    out.dText = th.textContent.trim().slice(0, 80);
    out.dLine = failLine();

    // C. the standing refusal replaces the rows with its sentence, as before.
    await paint('ok');
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
    if (r.aLineLast !== true) problems.push('A: the failure line is not the thread\'s last child with role=status, so it can sit above a reader');
    if (r.fHasLink !== true || r.fWas !== true) problems.push('setup F: no focused link in m24 (link ' + r.fHasLink + ', focused ' + r.fWas + '), so the focus arm tested nothing');
    else if (r.fFocusKept !== true) problems.push('F: a failed poll moved keyboard focus off a link that is still on screen');
    if (!(r.kCount >= 2) || r.kOnBefore !== true) problems.push('setup K: the question did not render live choice buttons (' + r.kCount + ', live ' + r.kOnBefore + ')');
    else {
      if (r.kOffFail !== true) problems.push('K: during a failed read the choice buttons stayed pressable, and a press would do nothing');
      if (r.kOnBack !== true || r.kMarksLeft !== 0) problems.push('K: the next good read did not give the choice buttons back (live ' + r.kOnBack + ', marks left ' + r.kMarksLeft + ')');
    }
    if (r.aLines2 !== 1 || !near(r.aYFail2, r.aY0)) problems.push('A: a second failed poll in a row stacked lines or moved the reader (lines ' + r.aLines2 + ', m25 at ' + r.aYFail2 + 'px vs ' + r.aY0 + 'px)');
    if (r.aLineBack !== null) problems.push('A: the failure line stayed after a read worked: ' + JSON.stringify(r.aLineBack));
    if (!(r.bGapFail <= 4)) problems.push('B (control): a reader at the floor was left ' + r.bGapFail + 'px above it, with the failure line below the fold');
    if (!/could not read/.test(String(r.bLineFail))) problems.push('B (control): no failure line for a reader at the floor');
    if (!(r.bGapBack <= 4) || !(typeof r.bNewestY === 'number' && r.bNewestY < r.boxBottom)) problems.push('B (control): a new message did not bring a reader at the floor down (gap ' + r.bGapBack + 'px, newest at ' + r.bNewestY + ' vs box bottom ' + r.boxBottom + ')');
    if (r.qShown !== true) problems.push('setup Q: the question box was not showing above the thread, so arm Q tested nothing');
    if (!near(r.qYFail, r.qY0)) problems.push('Q: with the question box up, the failed poll moved the reader: m25 at ' + r.qY0 + 'px, then ' + r.qYFail + 'px');
    if (r.qShownFail !== true || r.qInertFail !== true) problems.push('Q: during the failed poll the question box should stay where it is and be inert (shown ' + r.qShownFail + ', inert ' + r.qInertFail + ')');
    if (!near(r.qYBack, r.qY0)) problems.push('Q: the next good poll moved the reader: m25 at ' + r.qY0 + 'px, back at ' + r.qYBack + 'px');
    if (r.qInertBack !== false) problems.push('Q: the question box stayed inert after a read worked');
    if (r.dRows !== 0 || !/could not read this conversation just now/.test(String(r.dText)) || r.dLine !== null) problems.push('D: a failure on a box with no rows yet should paint the sentence alone (rows ' + r.dRows + ', text ' + JSON.stringify(r.dText) + ', line ' + JSON.stringify(r.dLine) + ')');
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
