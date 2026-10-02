/**
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
      // #4944: the in-flight "Sending…" is plain text in the time's slot (.msg-t), no pill, so the kept row swaps
      // in at the same height.
      slot: (() => { const t = r ? r.querySelector('.msg-t') : null; return t ? t.textContent.trim() : null; })(),
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

    /* 1. Pressed Send; the board has not answered. */
    await page.evaluate(() => { const s = document.getElementById('d-say'); s.value = 'is the report done?'; sendTalk('is the report done?'); });
    await page.waitForFunction(() => window.__post !== null);
    await page.waitForTimeout(150);
    const flying = await readThread(page, 'is the report done?');
    console.log('  while sending: ' + JSON.stringify(flying));
    chk(flying.copies === 1 && flying.drawn, 'the message is in the thread while the POST is still open', JSON.stringify(flying));
    chk(flying.you && flying.pending && flying.last, 'as the person\'s own bubble, at the bottom');
    chk(flying.slot === 'Sending…' && flying.pill === null, 'marked "Sending…" in the time\'s slot, with no delivery pill (#4944: so it swaps in place), not as delivered', JSON.stringify({ slot: flying.slot, pill: flying.pill, pillClass: flying.pillClass }));

    /* 2. The board could not be reached. */
    await page.evaluate(() => window.__post.reject(new TypeError('Failed to fetch')));
    await page.waitForTimeout(300);
    const failed = await readThread(page, 'is the report done?');
    console.log('  after a failure: ' + JSON.stringify(failed));
    chk(failed.copies === 1 && failed.drawn, 'a failed send does not vanish from the thread');
    chk(/^Not sent\. Failed to fetch/.test(failed.pill || '') && / failed/.test(' ' + failed.pillClass), 'it says plainly it was not sent, and why', failed.pill);

    /* 3. A send the board kept: the kept row replaces the drawn one. */
    await page.evaluate(() => { window.__post = null; sendTalk('second try'); });
    await page.waitForFunction(() => window.__post !== null);
    await page.evaluate((base) => {
      window.__fx = Object.assign({}, base, { messages: base.messages.concat([
        { at: new Date().toISOString(), text: 'second try', delivery: { state: 'placed', paneState: 'idle' } },
      ]) });
      window.__post.resolve({ delivery: { state: 'placed', paneState: 'idle' }, recorded: true, recordedBecause: null });
    }, BASE);
    await page.waitForTimeout(400);
    const kept = await readThread(page, 'second try');
    console.log('  once kept: ' + JSON.stringify(kept));
    chk(kept.copies === 1 && !kept.pending && kept.slot !== 'Sending…', 'once kept, the thread shows the kept row and no second copy', JSON.stringify(kept));

    chk(errs.length === 0, 'no page errors', errs.join(' | '));
    await page.close();
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
