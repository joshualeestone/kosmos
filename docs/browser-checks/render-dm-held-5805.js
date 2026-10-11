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
    chk(/^Held: April is out of usage until .+\. Kosmos sends it after the reset\.$/.test(held.pill || ''), 'the held row says it is held, until when, and that it goes after the reset', held.pill);
    chk(/ held/.test(' ' + (held.pillClass || '')) && !/ failed/.test(' ' + (held.pillClass || '')), 'as held, not as a failed delivery', held.pillClass);
    chk(held.button === 'Send now anyway' && held.buttonShown, 'Send now anyway is on the row, visible', JSON.stringify(held));
    chk(held.buttonAt === HELD_AT, 'the button carries this row\'s own at', held.buttonAt);

    /* 2. A new message the board answers held: the box empties and the line under it says why. */
    await page.evaluate((u) => {
      window.__sendAnswer = { delivery: { state: 'held', heldUntil: u, because: 'held: out of usage', at: new Date().toISOString() }, recorded: true, recordedBecause: null };
      const s = document.getElementById('d-say'); s.value = 'and the notes'; sendTalk('and the notes');
    }, UNTIL);
    await page.waitForTimeout(400);
    const under = await page.evaluate(() => ({ line: document.getElementById('d-say-msg').textContent, box: document.getElementById('d-say').value }));
    console.log('  after a held send: ' + JSON.stringify(under));
    chk(/^Held: April is out of usage until .+\. Kosmos sends it after the reset\. To send it now, use Send now anyway on the message\.$/.test(under.line), 'the line under the box says it is held and how to send it now', under.line);
    chk(under.box === '', 'the words are not put back in the box (the message is kept, a second send would be a copy)', JSON.stringify(under.box));

    /* 3. Send now anyway: the row's at is posted, and the row repaints as sent. */
    await page.evaluate((at) => { window.__fx = Object.assign({}, window.__fx, { messages: window.__fx.messages.filter((m) => m.text !== 'and the notes') }); document.querySelector('.dm-held-send[data-held-at="' + at + '"]').click(); }, HELD_AT);
    await page.waitForTimeout(500);
    const posted = await page.evaluate(() => window.__heldPosts);
    chk(posted.length === 1 && posted[0].at === HELD_AT, 'Send now anyway posts that row\'s at, once', JSON.stringify(posted));
    const after = await readRow(page, 'ship it tonight');
    console.log('  after Send now anyway: ' + JSON.stringify(after));
    chk(after.button === null && !/^Held/.test(after.pill || ''), 'the row then reads as sent, with no button', JSON.stringify(after));

    chk(errs.length === 0, 'no page errors', errs.join(' | '));
    await page.close();
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
