/**
 * #4944 (Josh, 0.7.16): "as soon as i hit POST, it shows in both places for a second and then shifts
 * around". The pending bubble (render-dm-send-shows-now) was drawn at the press while the box kept the
 * words until the POST answered.
 *
 * What this asserts, with the POST held open: the box is empty in the SAME task as the press (no frame
 * shows the words twice), the line under the box says nothing, a send that did not arrive puts the words
 * back (and never over words typed since, and into the parked draft when the person moved to another
 * agent), and the kept row takes the pending bubble's exact place, a reply included.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-dm-send-clears-4944.js
 *
 * The harness below is render-dm-send-shows-now's, which this extends.
 *
 * Its original header, kept for the harness's sake:
 * send-lag (Josh, Windows 0.7.02): "when I type a message, it is sitting forever
 * before it posts to my dialog". The DM thread drew the person's own message only
 * after the POST had answered AND the thread had been read again, so on a slow
 * Windows board the thread showed nothing of what they had sent for over a minute.
 *
 * Now sendTalk draws the message the moment Send is pressed, marked "Sending…";
 * a send that fails stays drawn, marked "Not sent." with the reason; a send the
 * board kept hands over to the kept row with no second copy.
 *
 * This check loads the page over file:// with fetch stubbed (the render-agentdm-3414
 * pattern) and HOLDS the POST open, which is the only way to see the screen while
 * the board is still thinking. Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-dm-send-shows-now.js
 */
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');

const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

const now = () => new Date().toISOString();
const BASE = {
  messages: [
    { from: 'april', at: now(), text: 'ready when you are.' },
  ],
  olderCount: 0, historyBecause: null, historyUnfilable: false,
  presence: 'on', presenceBecause: null, asking: false, question: null, questionBecause: null, options: null,
};

/* What the thread shows about one message: whether it is drawn, as a pending
   bubble, with which pill, and whether it is the last message and on screen. */
function readThread(page, words) {
  return page.evaluate((w) => {
    const th = document.getElementById('d-dmthread');
    const rows = [...th.querySelectorAll('.msg')];
    const mine = rows.filter((r) => r.textContent.includes(w));
    const r = mine[mine.length - 1] || null;
    const pill = r ? r.querySelector('.delivery') : null;
    const box = r ? r.getBoundingClientRect() : null;
    return {
      copies: mine.length,
      pending: Boolean(r && r.classList.contains('dm-pending')),
      you: Boolean(r && r.classList.contains('you')),
      last: Boolean(r && rows[rows.length - 1] === r),
      pill: pill ? pill.textContent : null,
      pillClass: pill ? pill.className : null,
      pillBorder: pill ? getComputedStyle(pill).borderTopStyle : null,
      drawn: Boolean(box && box.height > 0 && box.width > 0),
    };
  }, words);
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, colorScheme: 'light' });
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      if (/ERR_FILE_NOT_FOUND|Failed to load resource/.test(m.text())) return; // avatar fetch over file:// has no server
      errs.push('console ' + m.text());
    });
    await page.addInitScript(() => {
      window.__fx = null;
      window.__post = null;
      const enc = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json' } });
      window.setInterval = () => 0;
      window.fetch = async (url, opts) => {
        const u = String(url);
        if (opts && opts.method === 'POST' && /\/thread$/.test(u)) {
          /* HELD: answered only when the check says so. */
          return new Promise((resolve, reject) => { window.__post = { resolve: (o) => resolve(enc(o)), reject }; });
        }
        if (u.includes('/thread')) return enc(window.__fx);
        if (u.includes('/api/status')) return enc({ agents: [], version: '0.0.0' });
        return enc({});
      };
    });
    await page.goto(PAGE);
    await page.evaluate((f) => {
      window.__fx = f;
      CURRENT = { sessionName: 'april', name: 'April' };
      document.getElementById('panel-detail').hidden = false;
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
    }, BASE);
    await page.evaluate(() => paintTalk('april', 'April'));


    /* Every case starts from the same screen: april's thread, nothing in flight. */
    const reset = (base) => page.evaluate((b) => {
      window.__fx = b; window.__post = null;
      for (const k of Object.keys(TALK_PENDING)) delete TALK_PENDING[k];
      for (const k of Object.keys(TALK_DRAFTS)) delete TALK_DRAFTS[k];
      for (const k of Object.keys(DM_REPLY)) delete DM_REPLY[k];
      CURRENT = { sessionName: 'april', name: 'April' };
      document.getElementById('d-say').value = '';
      document.getElementById('d-say-msg').textContent = '';
    }, base).then(() => page.evaluate(() => paintTalk('april', 'April')));
    /* Press Send on `words`, and read the screen in the same task, before anything can paint again. */
    const press = (words, typed) => page.evaluate(([w, t]) => {
      const s = document.getElementById('d-say');
      s.value = t == null ? w : t;
      sendTalk(w);
      const rows = [...document.querySelectorAll('#d-dmthread .msg')].filter((r) => r.textContent.includes(w));
      return { box: s.value, bubbles: rows.length, pending: rows.some((r) => r.classList.contains('dm-pending')),
        line: document.getElementById('d-say-msg').textContent };
    }, [words, typed]);
    const rowRect = (words) => page.evaluate((w) => {
      const th = document.getElementById('d-dmthread');
      const rows = [...th.querySelectorAll('.msg')].filter((r) => r.textContent.includes(w));
      const r = rows[rows.length - 1];
      if (!r) return null;
      const a = r.getBoundingClientRect(); const t = th.getBoundingClientRect();
      return { top: Math.round((a.top - t.top + th.scrollTop) * 10) / 10, height: Math.round(a.height * 10) / 10,
        pending: r.classList.contains('dm-pending'), copies: rows.length, scrollTop: th.scrollTop,
        head: Boolean(r.querySelector('.msg-replyto, .vh')) };
    }, words);
    const box = () => page.evaluate(() => document.getElementById('d-say').value);
    const line = () => page.evaluate(() => document.getElementById('d-say-msg').textContent);
    const keptWith = (base, extra) => Object.assign({}, base, { messages: base.messages.concat([extra]) });

    /* 1. The press: in the thread once, out of the box, nothing under it. */
    await reset(BASE);
    const at = await press('is the report done?');
    console.log('  at the press: ' + JSON.stringify(at));
    chk(at.bubbles === 1 && at.pending, 'the pending bubble is drawn at the press', JSON.stringify(at));
    chk(at.box === '', 'the box is empty in the same task the bubble is drawn (never in both places)', JSON.stringify(at.box));
    chk(at.line === '', 'the line under the box does not repeat "Sending…"', JSON.stringify(at.line));
    await page.waitForFunction(() => window.__post !== null);

    /* 2. Kept: the kept row takes the bubble's place exactly, and the box stays empty. */
    const before = await rowRect('is the report done?');
    await page.evaluate((fx) => { window.__fx = fx; window.__post.resolve({ delivery: { state: 'placed', paneState: 'idle' }, recorded: true, recordedBecause: null }); },
      keptWith(BASE, { at: new Date().toISOString(), text: 'is the report done?', delivery: { state: 'placed', paneState: 'idle' } }));
    await page.waitForTimeout(400);
    const after = await rowRect('is the report done?');
    console.log('  pending ' + JSON.stringify(before) + '  kept ' + JSON.stringify(after));
    chk(before && before.pending && after && !after.pending && after.copies === 1, 'the kept row replaces the bubble, one copy', JSON.stringify(after));
    chk(before && after && Math.abs(after.top - before.top) <= 1 && Math.abs(after.height - before.height) <= 1,
      'in place: same top and height within 1px', JSON.stringify({ before, after }));
    chk((await box()) === '' && (await line()) === '', 'the box and the line are still empty once kept');

    /* 3. The board could not be reached: the words go back in the box. */
    await reset(BASE);
    await press('can you check the logs?');
    await page.waitForFunction(() => window.__post !== null);
    await page.evaluate(() => window.__post.reject(new TypeError('Failed to fetch')));
    await page.waitForTimeout(300);
    chk((await box()) === 'can you check the logs?', 'a failed send puts the words back in the box', JSON.stringify(await box()));
    const failedRow = await rowRect('can you check the logs?');
    chk(failedRow && failedRow.pending && failedRow.copies === 1, 'and the bubble stays, marked not sent', JSON.stringify(failedRow));

    /* 4. Words typed during the flight are never overwritten by the failed send's. */
    await reset(BASE);
    await press('first thing');
    await page.waitForFunction(() => window.__post !== null);
    await page.evaluate(() => { document.getElementById('d-say').value = 'second thing, half typed'; window.__post.reject(new TypeError('Failed to fetch')); });
    await page.waitForTimeout(300);
    chk((await box()) === 'second thing, half typed', 'words typed during the flight survive a failed send', JSON.stringify(await box()));

    /* 5. Unconfirmed and not kept: back in the box, and the line says so truthfully. */
    await reset(BASE);
    await press('did that land?');
    await page.waitForFunction(() => window.__post !== null);
    await page.evaluate(() => window.__post.resolve({ delivery: { state: 'unconfirmed', because: 'we typed it and could not tell whether it arrived' }, recorded: false, recordedBecause: null }));
    await page.waitForTimeout(300);
    chk((await box()) === 'did that land?', 'unconfirmed and not kept: the words are back in the box', JSON.stringify(await box()));
    chk(/back in the box below/.test(await line()), 'and the line says they are back in the box', await line());

    /* 6. Unconfirmed but kept: the thread holds it, so the box stays empty. */
    await reset(BASE);
    await press('kept but unsure');
    await page.waitForFunction(() => window.__post !== null);
    await page.evaluate((fx) => { window.__fx = fx; window.__post.resolve({ delivery: { state: 'unconfirmed', because: 'we typed it and could not tell whether it arrived' }, recorded: true, recordedBecause: null }); },
      keptWith(BASE, { at: new Date().toISOString(), text: 'kept but unsure', delivery: { state: 'unconfirmed' } }));
    await page.waitForTimeout(300);
    chk((await box()) === '', 'unconfirmed but kept: the box stays empty', JSON.stringify(await box()));

    /* 7. could_not: nothing was typed, so the words go back for the retry. */
    await reset(BASE);
    await press('try this one');
    await page.waitForFunction(() => window.__post !== null);
    await page.evaluate(() => window.__post.resolve({ delivery: { state: 'could_not', because: 'April is not running' }, recorded: false, recordedBecause: null }));
    await page.waitForTimeout(300);
    chk((await box()) === 'try this one', 'could not deliver: the words are back in the box', JSON.stringify(await box()));

    /* 8. The person opened another agent during the flight: the words go to april's parked draft, not
       into the other agent's box. */
    await reset(BASE);
    await press('for april only');
    await page.waitForFunction(() => window.__post !== null);
    await page.evaluate(() => { CURRENT = { sessionName: 'mara', name: 'Mara' }; document.getElementById('d-say').value = ''; window.__post.reject(new TypeError('Failed to fetch')); });
    await page.waitForTimeout(300);
    const moved = await page.evaluate(() => ({ box: document.getElementById('d-say').value, draft: TALK_DRAFTS.april || null }));
    chk(moved.box === '' && moved.draft === 'for april only', 'moved during the flight: the words are parked under april, not put in the open box', JSON.stringify(moved));

    /* 9. A send that did not take the box (its words were never in it) leaves the box alone. */
    await reset(BASE);
    const other = await press('the files', 'something else entirely');
    chk(other.box === 'something else entirely', 'a send whose words were not in the box does not empty it', JSON.stringify(other.box));
    await page.waitForFunction(() => window.__post !== null);
    await page.evaluate(() => window.__post.reject(new TypeError('Failed to fetch')));
    await page.waitForTimeout(300);
    chk((await box()) === 'something else entirely', 'nor overwrite it when that send fails', JSON.stringify(await box()));

    /* 10. A reply: the bubble carries what the kept row will, so it too swaps in place. */
    const aprilAt = BASE.messages[0].at;
    await reset(BASE);
    await page.evaluate((a) => dmReplyStart(a), aprilAt);
    await press('yes, go ahead');
    await page.waitForFunction(() => window.__post !== null);
    const rBefore = await rowRect('yes, go ahead');
    await page.evaluate((fx) => { window.__fx = fx; window.__post.resolve({ delivery: { state: 'placed', paneState: 'idle' }, recorded: true, recordedBecause: null }); },
      keptWith(BASE, { at: new Date().toISOString(), text: 'yes, go ahead', replyTo: aprilAt, delivery: { state: 'placed', paneState: 'idle' } }));
    await page.waitForTimeout(400);
    const rAfter = await rowRect('yes, go ahead');
    console.log('  reply pending ' + JSON.stringify(rBefore) + '  kept ' + JSON.stringify(rAfter));
    chk(rBefore && rBefore.head && rAfter && rAfter.head, 'the pending reply carries its header, as the kept one does', JSON.stringify({ rBefore, rAfter }));
    chk(rBefore && rAfter && !rAfter.pending && Math.abs(rAfter.top - rBefore.top) <= 1 && Math.abs(rAfter.height - rBefore.height) <= 1,
      'a reply swaps in place too', JSON.stringify({ rBefore, rAfter }));

    chk(errs.length === 0, 'no page errors', errs.join(' | '));
    await page.close();
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
