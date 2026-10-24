// Browser-check-surface: dm-failed dm-retry d-dmthread d-say-msg d-reply-say
/**
 * kosmos#6720 (Josh 2026-10-20 08:49: "lets make a nicer message formatting for a message that didnt get delivered
 * like "Message failed to deliver, try again.""): a message of the person's that did not go shows one quiet line
 * UNDER its bubble, "Message failed to deliver, try again.", with the reason only as the line's tooltip, and no red
 * box inside the bubble. "try again" posts the same words with the row's own `at` (retry_of), once, even pressed
 * twice; the row then repaints as it now is. A refused retry leaves the line, with the button ready again. A reply or
 * a menu answer says the first half alone (it cannot be sent again from here). A new send the board answers failed
 * and kept does not also put the words back in the box (two ways to send one message is how it goes twice). Other
 * verdicts keep their pill. Light and dark.
 *
 * Loads the page over file:// with fetch stubbed (render-dm-held-5805's pattern). Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-dm-retry-6720.js [shots-dir]
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const SHOTS = process.argv[2] || null;

const fail = [];
let pass = 0;
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (ok) pass++; else fail.push(label);
};

const t = (s) => new Date(Date.now() - s * 1000).toISOString();
const OLDER_AT = t(300), REPLY_AT = t(240), MENU_AT = t(200), UNSURE_AT = t(150), OK_AT = t(100), FAILED_AT = t(50);
const REASON = 'its input box already holds text that was not sent, so this was not typed behind it';
const BASE = {
  messages: [
    { from: 'april', at: t(400), text: 'ready when you are.' },
    { at: OLDER_AT, text: 'an older one', delivery: { state: 'could_not', because: REASON, retryable: true } },
    { at: REPLY_AT, text: 'yes that one', replyTo: t(400), delivery: { state: 'could_not', because: REASON } },
    { at: MENU_AT, text: 'Yes', wire: '1', delivery: { state: 'could_not', because: REASON } },
    { at: UNSURE_AT, text: 'maybe it went', delivery: { state: 'unconfirmed', because: 'we typed it and could not tell whether it arrived' } },
    { at: OK_AT, text: 'all good', delivery: { state: 'placed', paneState: 'idle' } },
    { at: FAILED_AT, text: 'ship it tonight', delivery: { state: 'could_not', because: REASON, retryable: true } },
  ],
  olderCount: 0, historyBecause: null, historyUnfilable: false,
  presence: 'on', presenceBecause: null, asking: false, question: null, questionBecause: null, options: null,
};

function readRow(page, words) {
  return page.evaluate((w) => {
    const th = document.getElementById('d-dmthread');
    const r = [...th.querySelectorAll('.msg.you')].filter((x) => x.querySelector('.msg-bd') && x.querySelector('.msg-bd').textContent.includes(w)).pop() || null;
    if (!r) return null;
    const bd = r.querySelector('.msg-bd'), line = r.querySelector('.dm-failed'), btn = r.querySelector('.dm-retry'), pill = r.querySelector('.delivery');
    const lb = line ? line.getBoundingClientRect() : null, bb = bd.getBoundingClientRect();
    return {
      line: line ? line.textContent : null, title: line ? line.title : null,
      lineInBubble: !!(line && bd.contains(line)), below: !!(lb && lb.top >= bb.bottom - 0.5),
      rightAligned: !!(lb && Math.abs(lb.right - bb.right) < 2),
      pill: pill ? pill.textContent : null,
      button: btn ? btn.textContent : null, disabled: btn ? btn.disabled : null, buttonTitle: btn ? btn.title : null,
      color: line ? getComputedStyle(line).color : null, bg: getComputedStyle(document.body).backgroundColor,
    };
  }, words);
}

async function open(browser, scheme) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, colorScheme: scheme });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/ERR_FILE_NOT_FOUND|Failed to load resource/.test(m.text())) return;   // avatar fetch over file:// has no server
    errs.push('console ' + m.text());
  });
  await page.addInitScript(() => {
    window.__fx = null;
    window.__posts = [];
    window.__answer = null;   // { status, body, then } for the next POST /thread
    window.__gate = null;     // a promise the POST waits on, so a second press lands mid-flight
    const enc = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json' } });
    window.setInterval = () => 0;
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (opts && opts.method === 'POST' && /\/thread$/.test(u)) {
        const body = JSON.parse(opts.body);
        window.__posts.push(body);
        if (window.__gate) await window.__gate;
        const a = window.__answer || { status: 200, body: { delivery: { state: 'placed' }, recorded: true } };
        if (a.then) window.__fx = a.then(window.__fx, body);
        return enc(a.body, a.status);
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
  return { page, errs };
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const scheme of ['light', 'dark']) {
      const T = '[' + scheme + '] ';
      const { page, errs } = await open(browser, scheme);

      /* R1: the failed row: one line under the bubble, the reason only as its tooltip, no box inside the bubble. */
      const f = await readRow(page, 'ship it tonight');
      console.log('  failed row: ' + JSON.stringify(f));
      chk(f && f.line === 'Message failed to deliver, try again.', T + 'R1 the failed row reads "Message failed to deliver, try again."', f && f.line);
      chk(f && !f.lineInBubble && f.below && f.rightAligned, T + 'R1 the line sits under the bubble, at its right edge, not inside it', JSON.stringify(f));
      chk(f && f.pill === null, T + 'R1 no delivery box inside the bubble', f && f.pill);
      chk(f && f.title === 'Its input box already holds text that was not sent, so this was not typed behind it.', T + 'R1 the reason is the line\'s tooltip', f && f.title);
      chk(f && f.button === 'try again' && f.disabled === false, T + 'R1 "try again" is a button, ready', JSON.stringify(f));
      chk(f && f.color && f.color !== f.bg, T + 'R1 the line is drawn in a colour of its own', JSON.stringify({ c: f && f.color, bg: f && f.bg }));

      /* R2: rows that cannot be sent again from here say the first half alone; CONTROLS for the other verdicts. */
      const o = await readRow(page, 'an older one');
      chk(o && o.line === 'Message failed to deliver.' && o.button === null, T + 'R2 a failed row with a newer message after it says the first half alone (it would arrive out of order)', JSON.stringify(o));
      const r = await readRow(page, 'yes that one'), m = await readRow(page, 'Yes'), u = await readRow(page, 'maybe it went'), ok = await readRow(page, 'all good');
      chk(r && r.line === 'Message failed to deliver.' && r.button === null, T + 'R2 a failed reply says the first half alone, no button', JSON.stringify(r));
      chk(m && m.line === 'Message failed to deliver.' && m.button === null, T + 'R2 a failed menu answer says the first half alone, no button', JSON.stringify(m));
      chk(u && u.line === null && /^Could not confirm/.test(u.pill || ''), T + 'R2 CONTROL: an unconfirmed send keeps its pill (it may have arrived)', JSON.stringify(u));
      chk(ok && ok.line === null && ok.pill === null, T + 'R2 CONTROL: a message that went says nothing', JSON.stringify(ok));
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.locator('#d-dmthread').screenshot({ path: path.join(SHOTS, 'dm-failed-' + scheme + '.png') }); }

      if (scheme === 'light') {
        /* R3: a refused retry: the line stays, the button is ready again, and the refusal is its tooltip. */
        await page.evaluate(() => { window.__answer = { status: 409, body: { error: 'its screen is asking a question now, so this was not sent again. Answer it first.' } }; });
        await page.click('.dm-retry[data-retry-at="' + FAILED_AT + '"]');
        await page.waitForTimeout(400);
        const refused = await readRow(page, 'ship it tonight');
        const p3 = await page.evaluate(() => window.__posts);
        chk(p3.length === 1 && p3[0].retry_of === FAILED_AT && p3[0].text === 'ship it tonight' && Object.keys(p3[0]).length === 2, 'R3 try again posts the row\'s own words and at, nothing else', JSON.stringify(p3));
        chk(refused && refused.line === 'Message failed to deliver, try again.' && refused.disabled === false && /asking a question now/.test(refused.buttonTitle || ''), 'R3 a refused retry leaves the line, ready, with why on the button', JSON.stringify(refused));
        const r3 = await page.evaluate(() => ({ under: document.getElementById('d-say-msg').textContent, quiet: document.getElementById('d-reply-say').textContent }));
        chk(r3.under === 'Its screen is asking a question now, so this was not sent again. Answer it first.' && r3.quiet === r3.under, 'R3 the refusal is said under the box and announced, not "failed to deliver"', JSON.stringify(r3));

        /* R4: pressed twice mid-flight, it posts once; when it went, the row repaints as sent. */
        await page.evaluate((at) => {
          window.__posts = [];
          let open; window.__gate = new Promise((res) => { open = res; }); window.__open = open;
          window.__answer = { status: 200, body: { delivery: { state: 'placed' }, recorded: true, retried: true },
            then: (fx) => Object.assign({}, fx, { messages: fx.messages.map((x) => (x.at === at ? Object.assign({}, x, { delivery: { state: 'placed', paneState: 'idle' } }) : x)) }) };
        }, FAILED_AT);
        await page.click('.dm-retry[data-retry-at="' + FAILED_AT + '"]');
        /* What the real board serves mid-flight (review 3): retryDmBegin has turned the row "being sent again". */
        await page.evaluate((at) => { window.__fx = Object.assign({}, window.__fx, { messages: window.__fx.messages.map((x) => (x.at === at
          ? Object.assign({}, x, { delivery: { state: 'unconfirmed', retrying: true, because: 'it was being sent again when Kosmos last looked, so it may have arrived; check its window before sending it again' } }) : x)) }); }, FAILED_AT);
        await page.evaluate(() => paintTalk('april', 'April'));   // the poll's repaint, mid-flight
        const mid = await readRow(page, 'ship it tonight');
        await page.evaluate((at) => { const b = document.querySelector('.dm-retry[data-retry-at="' + at + '"]'); if (b) { b.disabled = false; b.click(); } }, FAILED_AT);
        chk(mid && mid.disabled === true && mid.button === 'sending…' && mid.pill === null, 'R4 a repaint mid-flight (the row served "being sent again") draws the button pressed, not a warning', JSON.stringify(mid));
        await page.evaluate(() => window.__open());
        await page.waitForTimeout(500);
        const p4 = await page.evaluate(() => window.__posts);
        chk(p4.length === 1, 'R4 two presses during one flight post once', JSON.stringify(p4));
        const went = await readRow(page, 'ship it tonight');
        chk(went && went.line === null && went.pill === null, 'R4 when it went, the row reads as an ordinary sent message', JSON.stringify(went));
        const quiet = await page.evaluate(() => document.getElementById('d-reply-say').textContent);
        chk(quiet === 'Sent.', 'R4 the quiet live region says Sent.', quiet);

        /* R4b CONTROL: the same "being sent again" row with no retry running on this page (a board that stopped
           mid-send) shows the warning pill and no button. */
        await page.evaluate((at) => { window.__fx = Object.assign({}, window.__fx, { messages: window.__fx.messages.concat([{ at: new Date(Date.parse(at) + 1).toISOString(), text: 'left mid-send',
          delivery: { state: 'unconfirmed', retrying: true, because: 'it was being sent again when Kosmos last looked, so it may have arrived; check its window before sending it again' } }]) }); return paintTalk('april', 'April'); }, OK_AT);
        const stuck = await readRow(page, 'left mid-send');
        chk(stuck && stuck.line === null && stuck.button === null && /^Could not confirm/.test(stuck.pill || ''), 'R4b CONTROL: a row left "being sent again" by a stopped board keeps its warning, no button', JSON.stringify(stuck));
        await page.evaluate(() => { window.__fx = Object.assign({}, window.__fx, { messages: window.__fx.messages.filter((x) => x.text !== 'left mid-send') }); return paintTalk('april', 'April'); });

        /* R5: a NEW send the board answers failed and kept: the words stay in the row, not back in the box. */
        await page.evaluate(() => {
          window.__gate = null; window.__posts = [];
          window.__answer = { status: 200, body: { delivery: { state: 'could_not', because: 'we could not reach them', at: new Date().toISOString() }, recorded: true, recordedBecause: null, retryable: true },
            then: (fx, b) => Object.assign({}, fx, { messages: fx.messages.concat([{ at: new Date().toISOString(), text: b.text, delivery: { state: 'could_not', because: 'we could not reach them', retryable: true } }]) }) };
          const s = document.getElementById('d-say'); s.value = 'and the notes'; sendTalk('and the notes');
        });
        await page.waitForTimeout(600);
        const r5 = await page.evaluate(() => ({ box: document.getElementById('d-say').value, line: document.getElementById('d-say-msg').textContent, quiet: document.getElementById('d-reply-say').textContent }));
        const newRow = await readRow(page, 'and the notes');
        chk(r5.box === '' && r5.line === '', 'R5 a kept failed send leaves the box empty and the line under it empty', JSON.stringify(r5));
        chk(r5.quiet === 'Message failed to deliver.', 'R5 the quiet live region says it once', r5.quiet);
        chk(newRow && newRow.line === 'Message failed to deliver, try again.', 'R5 its row offers try again', JSON.stringify(newRow));

        /* R6 CONTROL: a failed send that was NOT kept still puts the words back in the box (#4944): no row to retry. */
        await page.evaluate(() => {
          window.__answer = { status: 200, body: { delivery: { state: 'could_not', because: 'we could not reach them', at: new Date().toISOString() }, recorded: false, recordedBecause: 'we could not keep it' } };
          const s = document.getElementById('d-say'); s.value = 'not kept'; sendTalk('not kept');
        });
        await page.waitForTimeout(600);
        const r6 = await page.evaluate(() => ({ box: document.getElementById('d-say').value, line: document.getElementById('d-say-msg').textContent }));
        chk(r6.box === 'not kept' && /^We could not get that to April/.test(r6.line), 'R6 CONTROL: not kept, the words go back in the box with the sentence under it', JSON.stringify(r6));

        /* R7 CONTROL (review 2): kept, but the board did not say its row is retryable (a masked guide row, say): no
           try again would work, so the words go back in the box as before. */
        await page.evaluate(() => {
          document.getElementById('d-say').value = '';
          window.__answer = { status: 200, body: { delivery: { state: 'could_not', because: 'we could not reach them', at: new Date().toISOString() }, recorded: true, recordedBecause: null } };
          const s = document.getElementById('d-say'); s.value = 'kept unmarked'; sendTalk('kept unmarked');
        });
        await page.waitForTimeout(600);
        const r7 = await page.evaluate(() => ({ box: document.getElementById('d-say').value, line: document.getElementById('d-say-msg').textContent }));
        chk(r7.box === 'kept unmarked' && /^We could not get that to April/.test(r7.line), 'R7 CONTROL: kept but not retryable, the words go back in the box', JSON.stringify(r7));
      }

      chk(errs.length === 0, T + 'no page errors', errs.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall dm-retry checks passed (' + pass + ')');
})().catch((e) => { console.error(e); process.exit(2); });
