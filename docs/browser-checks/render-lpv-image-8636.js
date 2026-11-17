/**
 * kosmos#8636 (Josh, 2026-11-17: a link preview's picture "keeps not rendering", a broken "?" box 17 minutes on): a
 * link preview card whose picture does not load in the browser loses its picture box and keeps its words, and a redrawn
 * card does not ask for that picture again. A card whose picture loads keeps it (control).
 *
 * Paints a real DM thread (paintTalk) over file:// with fetch stubbed (the render-barelinks-7239 pattern). The two
 * messages carry previews the way the board sends them: one picture at an address this check answers with a 404 (as
 * name.com's own og:image did), one with a real PNG.
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-lpv-image-8636.js
 */
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');

const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

// A 1x1 PNG, so the control card's picture really loads.
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==', 'base64');
const BROKEN = '/api/unfurl/image?url=' + encodeURIComponent('https://broken.example/og.jpeg');
const GOOD = '/api/unfurl/image?url=' + encodeURIComponent('https://good.example/og.png');
const at = new Date(Date.now() - 60e3).toISOString();
const FX = {
  messages: [
    { from: 'april', at, text: 'the broken one https://broken.example/',
      preview: { url: 'https://broken.example/', title: 'Broken picture page', description: 'Its picture answers 404.', image: BROKEN } },
    { from: 'april', at, text: 'the good one https://good.example/',
      preview: { url: 'https://good.example/', title: 'Good picture page', description: 'Its picture loads.', image: GOOD } },
  ],
  olderCount: 0, historyBecause: null, historyUnfilable: false,
  presence: 'on', presenceBecause: null, asking: false, question: null, questionBecause: null, options: null,
};

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, colorScheme: 'light' });
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
    // Over file:// the picture addresses resolve to file:///api/unfurl/image?...; answer them here, counting each ask.
    const asked = { broken: 0, good: 0 };
    await page.route(/\/api\/unfurl\/image\?/, async (r) => {
      const u = r.request().url();
      if (u.includes('broken.example')) { asked.broken++; await r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"that site answered 404"}' }); return; }
      asked.good++;
      await r.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 });
    });
    await page.addInitScript((fx) => {
      const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
      window.setInterval = () => 0;
      window.fetch = async (url) => {
        const u = String(url);
        if (u.includes('/thread')) return enc(fx);
        if (u.includes('/api/status')) return enc({ agents: [], version: '0.0.0' });
        return enc({});
      };
    }, FX);
    await page.goto(PAGE);
    await page.evaluate(() => {
      CURRENT = { sessionName: 'april', name: 'April' };
      document.getElementById('panel-detail').hidden = false;
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
    });
    const paint = async () => { await page.evaluate(() => paintTalk('april', 'April')); await page.waitForTimeout(600); };
    const read = () => page.evaluate(() => {
      const card = (word) => {
        const row = [...document.querySelectorAll('#d-dmthread .msg')].find((x) => x.textContent.includes(word));
        const lpv = row && row.querySelector('.lpv');
        const img = lpv && lpv.querySelector('.lpv-img img');
        return { row: !!row, card: !!lpv, title: lpv && lpv.querySelector('.lpv-title') ? lpv.querySelector('.lpv-title').textContent : null,
          box: !!(lpv && lpv.querySelector('.lpv-img')), loaded: !!(img && img.complete && img.naturalWidth > 0) };
      };
      return { broken: card('the broken one'), good: card('the good one') };
    });

    await paint();
    const first = await read();
    chk(first.broken.row && first.good.row, 'both messages are painted in the DM thread', JSON.stringify(first));
    chk(first.broken.card && first.broken.title === 'Broken picture page', 'the card whose picture fails keeps its title', JSON.stringify(first.broken));
    chk(!first.broken.box, 'the card whose picture fails has no picture box (no broken "?")', JSON.stringify(first.broken));
    chk(first.good.card && first.good.box && first.good.loaded, 'CONTROL: the card whose picture loads shows it', JSON.stringify(first.good));
    chk(asked.broken === 1, 'the failing picture was asked for once', JSON.stringify(asked));

    // A redraw (the thread repaints as messages arrive): the failed picture is not asked for again, and stays away.
    await paint();
    const again = await read();
    chk(asked.broken === 1, 'a redrawn card does not ask again for a picture that failed', JSON.stringify(asked));
    chk(again.broken.card && !again.broken.box, 'after a redraw the card still has its words and no picture box', JSON.stringify(again.broken));
    chk(again.good.box && again.good.loaded, 'CONTROL: after a redraw the good picture is still shown', JSON.stringify(again.good));
    chk(errs.length === 0, 'no page errors', JSON.stringify(errs));
  } finally {
    await browser.close();
  }
  console.log(fail.length ? `\n${fail.length} FAILED` : '\nall passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
