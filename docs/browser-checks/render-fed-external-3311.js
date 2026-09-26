/**
 * kosmos#3311: a message from OUTSIDE this Kosmos, in a federated project's room.
 *
 * The room draws a row of kind `external` (engine/messages.externalPost, carried by
 * the room route) through the page's own pjRoomRow. This check renders such rows in
 * a real browser, in light and dark, and asserts:
 *   - the bubble is marked external (`.msg.ext`) with the sender's name and an
 *     External / External agent tag, so it is never read as one of your agents;
 *   - the sender's name and words are TEXT: an HTML payload in either renders as
 *     characters and creates no element (a message from outside must not be able
 *     to draw on the page);
 *   - line breaks in the words survive as <br>;
 *   - the tag is visible (a non-transparent colour with a border);
 *   - (#3851) the avatar is never the name's tint: an outside "Bob" is not drawn in
 *     the colour a local Bob gets, and carries the dashed outside disc.
 *
 * WHY A BROWSER. The row is HTML built in the page and styled by the page's CSS;
 * only a browser can say the payload stayed inert and the tag is actually drawn.
 *
 * HERMETIC: loads web/index.html over file://, boots no server.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-fed-external-3311.js
 * HEADED by default; HEADED=0 on a console-less machine.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-fed-external-3311: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = 'file://' + nodePath.join(nodePath.resolve(__dirname, '..', '..'), 'web', 'index.html');

const problems = [];
let pass = 0;
function ok(name, cond, detail) { if (cond) pass += 1; else problems.push(name + (detail ? ' -- ' + detail : '')); }

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('render-fed-external-3311: could not launch a browser');
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  try {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, colorScheme: theme });
      const t = '[' + theme + ']';
      page.on('pageerror', (e) => problems.push(t + ' pageerror: ' + e.message));
      await page.goto(PAGE);
      const r = await page.evaluate(() => {
        if (typeof pjRoomRow !== 'function') return { missing: true };
        const host = document.createElement('div');
        host.id = 'fed-ext-host';
        document.body.appendChild(host);
        host.innerHTML = pjRoomRow({ kind: 'external', from: 'Ada <img src=x onerror="window.__pwned=1">', fromKind: 'agent',
          text: 'hello <script>window.__pwned=2</script>\nsecond line', at: new Date().toISOString(), external: true }, { agents: [] })
          + pjRoomRow({ kind: 'external', from: 'Bob', fromKind: 'person', text: 'plain', at: new Date().toISOString(), external: true }, { agents: [] });
        const rows = [...host.querySelectorAll('.msg.ext')];
        const tag = rows[0] && rows[0].querySelector('.msg-ext-tag');
        const cs = tag ? getComputedStyle(tag) : null;
        return {
          rows: rows.length,
          tags: rows.map((r0) => (r0.querySelector('.msg-ext-tag') || {}).textContent || ''),
          name: (rows[0] && rows[0].querySelector('.msg-nm') || {}).textContent || '',
          imgs: host.querySelectorAll('img').length,
          scripts: host.querySelectorAll('script').length,
          brs: rows[0] ? rows[0].querySelectorAll('.msg-ext-tx br').length : 0,
          text: rows[0] ? (rows[0].querySelector('.msg-ext-tx') || {}).textContent || '' : '',
          pwned: window.__pwned || 0,
          tagColor: cs ? cs.color : '',
          tagBorder: cs ? cs.borderTopStyle : '',
          avBg: rows[1] ? getComputedStyle(rows[1].querySelector('.msg-av')).backgroundColor : '',
          avBorder: rows[1] ? getComputedStyle(rows[1].querySelector('.msg-av')).borderTopStyle : '',
          localBg: (() => { const d = document.createElement('div'); d.style.background = discTint('Bob'); document.body.appendChild(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; })(),
        };
      });
      ok(t + ' pjRoomRow is on the page', !r.missing);
      if (r.missing) { await page.close(); continue; }
      ok(t + ' both rows render as external bubbles', r.rows === 2, JSON.stringify(r));
      ok(t + ' an agent sender is tagged External agent, a person External', r.tags[0] === 'External agent' && r.tags[1] === 'External', JSON.stringify(r.tags));
      ok(t + ' the sender name is text, payload and all', r.name.startsWith('Ada <img'), r.name);
      ok(t + ' no element was created from the name or words', r.imgs === 0 && r.scripts === 0, JSON.stringify({ imgs: r.imgs, scripts: r.scripts }));
      ok(t + ' nothing from outside ran', r.pwned === 0, String(r.pwned));
      ok(t + ' a line break survives', r.brs === 1, String(r.brs));
      ok(t + ' the words are shown as text', r.text.includes('<script>'), r.text);
      ok(t + ' the tag is drawn', r.tagColor && r.tagColor !== 'rgba(0, 0, 0, 0)' && r.tagBorder === 'solid', JSON.stringify({ c: r.tagColor, b: r.tagBorder }));
      ok(t + ' #3851: the outside avatar is not the tint a local agent of that name gets', r.avBg !== r.localBg, JSON.stringify({ av: r.avBg, local: r.localBg }));
      ok(t + ' #3851: the outside avatar is the dashed outside disc', r.avBorder === 'dashed', r.avBorder);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  if (problems.length) {
    for (const p of problems) console.log('  FAIL  ' + p);
    console.log('FAILED: ' + problems.length);
    process.exit(1);
  }
  console.log(pass + '/' + pass + ' checks passed');
})();
