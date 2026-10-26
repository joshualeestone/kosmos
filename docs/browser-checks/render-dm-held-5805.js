/**
 * #5805 slice 2b: a person's own message to an agent out of usage is held (not typed into its limit screen). The row
 * says so, with Send now anyway beside it; a send the board answers held empties the box and says why under it; Send
 * now anyway posts the row's own `at` to .../thread/held and the thread repaints with the row as sent.
 *
 * Loads the page over file:// with fetch stubbed (the render-dm-send-shows-now pattern). Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-dm-held-5805.js
 */
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');

const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

const HELD_AT = new Date(Date.now() - 60e3).toISOString();
const UNTIL = new Date(Date.now() + 3 * 3600e3).toISOString();
const HELD = { state: 'held', heldUntil: UNTIL, because: 'held: it is out of usage until ' + UNTIL + '; Kosmos sends it after the reset' };
const BASE = {
  messages: [
    { from: 'april', at: new Date(Date.now() - 120e3).toISOString(), text: 'ready when you are.' },
    { at: HELD_AT, text: 'ship it tonight', delivery: HELD },
  ],
  olderCount: 0, historyBecause: null, historyUnfilable: false,
  presence: 'on', presenceBecause: null, asking: false, question: null, questionBecause: null, options: null,
};

function readRow(page, words) {
  return page.evaluate((w) => {
    const th = document.getElementById('d-dmthread');
    const r = [...th.querySelectorAll('.msg')].filter((x) => x.textContent.includes(w)).pop() || null;
    const pill = r ? r.querySelector('.delivery') : null;
    const btn = r ? r.querySelector('.dm-held-send') : null;
    const box = btn ? btn.getBoundingClientRect() : null;
    return {
      pill: pill ? pill.textContent : null,
      pillClass: pill ? pill.className : null,
      button: btn ? btn.textContent : null,
      buttonAt: btn ? btn.dataset.heldAt : null,
      buttonShown: Boolean(box && box.width > 0 && box.height > 0),
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
      window.__heldPosts = [];
      window.__sendAnswer = null;
      const enc = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json' } });
      window.setInterval = () => 0;
      window.fetch = async (url, opts) => {
        const u = String(url);
        if (opts && opts.method === 'POST' && /\/thread\/held$/.test(u)) {
          window.__heldPosts.push(JSON.parse(opts.body));
          // The board typed it: the thread now holds the row as sent.
          window.__fx = Object.assign({}, window.__fx, { messages: window.__fx.messages.map((m) => (m.delivery && m.delivery.state === 'held'
            ? Object.assign({}, m, { delivery: { state: 'placed', paneState: 'idle' } }) : m)) });
          return enc({ delivery: { state: 'placed', paneState: 'idle' } });
        }
        if (opts && opts.method === 'POST' && /\/thread$/.test(u)) return enc(window.__sendAnswer);
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

    /* 1. A held row: why, until when, and the way through. */
    const held = await readRow(page, 'ship it tonight');
    console.log('  held row: ' + JSON.stringify(held));
    // kosmos#7208: plain words, no "Held:" (Josh read it as an error), and when it goes.
    chk(/^April is out of usage until .+\. This delivers when April is back\.$/.test(held.pill || ''), 'the held row says April is out of usage, until when, and that it delivers when she is back', held.pill);
    chk(/ held/.test(' ' + (held.pillClass || '')) && !/ failed/.test(' ' + (held.pillClass || '')), 'as held, not as a failed delivery', held.pillClass);
    chk(held.button === 'Send now anyway' && held.buttonShown, 'Send now anyway is on the row, visible', JSON.stringify(held));
    chk(held.buttonAt === HELD_AT, 'the button carries this row\'s own at', held.buttonAt);

    /* 2. A new message the board answers held: the box empties, and (kosmos#7208) the reason is said once, on the
       row, not again under the box. */
    await page.evaluate((u) => {
      window.__sendAnswer = { delivery: { state: 'held', heldUntil: u, because: 'held: out of usage', at: new Date().toISOString() }, recorded: true, recordedBecause: null };
      const s = document.getElementById('d-say'); s.value = 'and the notes'; sendTalk('and the notes');
    }, UNTIL);
    await page.waitForTimeout(400);
    const under = await page.evaluate(() => ({ line: document.getElementById('d-say-msg').textContent, box: document.getElementById('d-say').value }));
    console.log('  after a held send: ' + JSON.stringify(under));
    chk(under.line.trim() === '', 'kosmos#7208: nothing under the box repeats the row', JSON.stringify(under.line));
    chk(under.box === '', 'the words are not put back in the box (the message is kept, a second send would be a copy)', JSON.stringify(under.box));
    // Review 3: the row is not announced, so the quiet region says it once.
    const heard = await page.evaluate(() => (document.getElementById('d-reply-say') || {}).textContent || '');
    chk(/^April is out of usage until .+\. This delivers when April is back\.$/.test(heard), 'a screen reader hears why the message waits', heard);

    /* 2b. Review 3: with a search the new row does not match, the row is out of sight, so one line says where it went. */
    await page.evaluate((u) => {
      TALK_QUERY = 'zzz-no-match';
      window.__sendAnswer = { delivery: { state: 'held', heldUntil: u, because: 'held: out of usage', at: new Date().toISOString() }, recorded: true, recordedBecause: null };
      const s = document.getElementById('d-say'); s.value = 'one more'; sendTalk('one more');
    }, UNTIL);
    await page.waitForTimeout(400);
    const searching = await page.evaluate(() => document.getElementById('d-say-msg').textContent);
    chk(searching === 'Your message is kept to send later. Clear the search to see it.', 'while searching, the line under the box says where the message went', searching);
    await page.evaluate(() => { TALK_QUERY = ''; document.getElementById('d-say-msg').textContent = ''; window.__fx = Object.assign({}, window.__fx, { messages: window.__fx.messages.filter((m) => m.text !== 'one more') }); paintTalk('april', 'April'); });
    await page.waitForTimeout(300);

    /* 3. Send now anyway: the row's at is posted, and the row repaints as sent. */
    await page.evaluate((at) => { window.__fx = Object.assign({}, window.__fx, { messages: window.__fx.messages.filter((m) => m.text !== 'and the notes') }); document.querySelector('.dm-held-send[data-held-at="' + at + '"]').click(); }, HELD_AT);
    await page.waitForTimeout(500);
    const posted = await page.evaluate(() => window.__heldPosts);
    chk(posted.length === 1 && posted[0].at === HELD_AT, 'Send now anyway posts that row\'s at, once', JSON.stringify(posted));
    const after = await readRow(page, 'ship it tonight');
    console.log('  after Send now anyway: ' + JSON.stringify(after));
    chk(after.button === null && !/out of usage/.test(after.pill || ''), 'the row then reads as sent, with no button', JSON.stringify(after));

    /* 4. kosmos#7208: each reason in its own words, the real one first. */
    const wordsFor = async (delivery, card) => {
      await page.evaluate(({ dl, c }) => {
        window.__fx = Object.assign({}, window.__fx, { messages: [{ at: new Date(Date.now() - 30e3).toISOString(), text: 'the words row', delivery: dl }] });
        CURRENT = Object.assign({ sessionName: 'april', name: 'April' }, c || {});
      }, { dl: delivery, c: card });
      await page.evaluate(() => paintTalk('april', 'April'));
      await page.waitForTimeout(200);
      return (await readRow(page, 'the words row')).pill || '';
    };
    const BOX = "Waiting to deliver: April's message box has unsent text in it. Yours goes through as soon as that is cleared.";
    /* 4a. Review 3: the poll's card, not the card as it was when the chat was opened. */
    const stale = await page.evaluate(async () => {
      CURRENT = { sessionName: 'april', name: 'April', state: 'idle', running: true };
      LAST = [{ sessionName: 'april', name: 'April', state: 'rate_limited', limitUntil: new Date(Date.now() + 2 * 3600e3).toISOString() }];
      window.__fx = Object.assign({}, window.__fx, { messages: [{ at: new Date(Date.now() - 30e3).toISOString(), text: 'the words row', delivery: { state: 'held', heldFor: 'input' } }] });
      paintTalk('april', 'April');
      await new Promise((r) => setTimeout(r, 200));
      const row = [...document.querySelectorAll('#d-dmthread .msg')].find((x) => /the words row/.test(x.textContent));
      const pill = row && row.querySelector('.delivery');
      return pill ? pill.textContent : '';
    });
    chk(/^April is out of usage until .+ This delivers once April is back and its message box is clear\.$/.test(stale), 'the row reads the polled card (out of usage), not the one from when the chat opened (idle)', stale);
    await page.evaluate(() => { LAST = []; });
    const seen = [];
    let w = await wordsFor({ state: 'held', heldFor: 'input' }); seen.push(w);
    chk(w === BOX, 'held for the message box: says so, and that nothing is wrong', w);
    w = await wordsFor({ state: 'held', heldFor: 'input' }, { state: 'rate_limited', limitUntil: UNTIL }); seen.push(w);
    chk(/^April is out of usage until .+\. This delivers once April is back and its message box is clear\.$/.test(w), 'held for the box but April is out of usage: the usage is said first, and the box still counts', w);
    w = await wordsFor({ state: 'held', heldFor: 'input' }, { running: false, state: 'stopped' }); seen.push(w);
    chk(w === 'April is not running. This delivers when April is running again.', 'held for the box but April is stopped: says she is not running', w);
    w = await wordsFor({ state: 'held', behind: true, behindFor: 'input' }); seen.push(w);
    chk(w === 'Queued behind earlier messages to April.', 'a later message: queued behind the earlier one', w);
    w = await wordsFor({ state: 'held', heldFor: 'signin' }); seen.push(w);
    chk(w === 'April is signed out. This delivers once April is signed in again.', 'signed out: says so', w);
    chk(seen.length === 5 && seen.every((x) => !/Held:|input box|your earlier message/.test(x)), 'CONTROL: none of the old words, on every row', JSON.stringify(seen));

    chk(errs.length === 0, 'no page errors', errs.join(' | '));
    await page.close();
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
