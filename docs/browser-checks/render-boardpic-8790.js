/**
 * kosmos#8790: on a browser that sends no Sec-Fetch-Site (Safari before 16.4) the computer's connector refuses the
 * board's pictures, because an image load carries no X-Kosmos-Board-Page. The page then fetches the picture once more
 * through its own fetch, which carries that header, and shows it. This check plays the connector: every picture load
 * the browser makes is refused (401), and the page's fetch answers with the picture ONLY when the header is on it.
 * A picture the retry cannot get either still loses its box (kosmos#8636, unchanged), and a picture that loads is left
 * alone (control). Paints a real DM thread over file:// (the render-lpv-image-8636 pattern).
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-boardpic-8790.js
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
const OLDSAFARI = '/api/unfurl/image?url=' + encodeURIComponent('https://oldsafari.example/og.png');
const GOOD = '/api/unfurl/image?url=' + encodeURIComponent('https://good.example/og.png');
const at = new Date(Date.now() - 60e3).toISOString();
const FX = {
  messages: [
    { from: 'april', at, text: 'the broken one https://broken.example/',
      preview: { url: 'https://broken.example/', title: 'Broken picture page', description: 'Its picture answers 404.', image: BROKEN } },
    { from: 'april', at, text: 'the refused one https://oldsafari.example/',
      preview: { url: 'https://oldsafari.example/', title: 'Refused picture page', description: 'The connector refuses its image load.', image: OLDSAFARI } },
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
    const asked = { broken: 0, good: 0, refusedLoad: 0 };
    await page.route(/\/api\/unfurl\/image\?/, async (r) => {
      const u = r.request().url();
      if (u.includes('oldsafari.example')) { asked.refusedLoad++; await r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"sign in"}' }); return; }
      if (u.includes('broken.example')) { asked.broken++; await r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"that site answered 404"}' }); return; }
      asked.good++;
      await r.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 });
    });
    await page.addInitScript(({ fx, png }) => {
      const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
      window.setInterval = () => 0;
      window.__picFetches = [];
      window.fetch = async (url, init) => {
        const u = String(url);
        if (u.includes('/api/unfurl/image?')) {
          const marked = !!(init && init.headers && new Headers(init.headers).get('X-Kosmos-Board-Page') === '1');
          window.__picFetches.push({ u, marked });
          // The connector: the picture goes only to a request the board page marked, and a broken one fails anyway.
          if (!marked || u.includes('broken.example')) return new Response('{"error":"refused"}', { status: u.includes('broken') ? 404 : 401, headers: { 'content-type': 'application/json' } });
          return new Response(Uint8Array.from(atob(png), (c) => c.charCodeAt(0)), { status: 200, headers: { 'content-type': 'image/png' } });
        }
        if (u.includes('/thread')) return enc(fx);
        if (u.includes('/api/status')) return enc({ agents: [], version: '0.0.0' });
        return enc({});
      };
    }, { fx: FX, png: PNG_1X1.toString('base64') });
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
      return { broken: card('the broken one'), refused: card('the refused one'), good: card('the good one'), fetches: window.__picFetches.slice() };
    });

    await paint();
    const first = await read();
    chk(first.broken.row && first.refused.row && first.good.row, 'all three messages are painted in the DM thread', JSON.stringify(first));
    chk(asked.refusedLoad >= 1, 'CONTROL: the browser\'s own image load of the refused picture was refused', JSON.stringify(asked));
    chk(first.refused.box && first.refused.loaded, 'the refused picture is shown from the page\'s marked fetch', JSON.stringify(first.refused));
    const rf = first.fetches.filter((f) => f.u.includes('oldsafari.example'));
    chk(rf.length === 1 && rf[0].marked, 'it was fetched once, and that fetch carried X-Kosmos-Board-Page: 1', JSON.stringify(rf));
    chk(first.broken.card && !first.broken.box, 'a picture the retry cannot get either still loses its box (kosmos#8636)', JSON.stringify(first.broken));
    chk(first.fetches.filter((f) => f.u.includes('broken.example')).length === 1, 'and that picture was retried once, not again', JSON.stringify(first.fetches));
    chk(first.good.box && first.good.loaded, 'CONTROL: a picture that loads is shown', JSON.stringify(first.good));
    chk(!first.fetches.some((f) => f.u.includes('good.example')), 'CONTROL: a picture that loads is not fetched again', JSON.stringify(first.fetches));

    await paint();
    const again = await read();
    chk(again.refused.box && again.refused.loaded, 'after a redraw the refused picture is still shown', JSON.stringify(again.refused));
    chk(again.fetches.filter((f) => f.u.includes('oldsafari.example')).length === 1, 'and a redraw does not fetch it again', JSON.stringify(again.fetches));
    chk(again.broken.card && !again.broken.box, 'after a redraw the failed card still has no picture box', JSON.stringify(again.broken));
    chk(errs.length === 0, 'no page errors', JSON.stringify(errs));
  } finally {
    await browser.close();
  }
  console.log(fail.length ? `\n${fail.length} FAILED` : '\nall passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
