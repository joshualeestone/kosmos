/**
 * kosmos#7239 (Josh, 2026-10-26): an agent writes a web address bare, without https:// (meridianworks.kosmosplus.com),
 * and in a Direct Message it stayed plain text. It is a link now, opened as https:// in a new window (the Mac and
 * Windows apps send a new-window link to the system browser). Things that only look like an address stay plain: a
 * file name, a version, a dotted code name, an email, anything in code.
 *
 * Paints a real DM thread (paintTalk) over file:// with fetch stubbed (the render-dm-held-5805 pattern), reads the
 * anchors, and clicks one to see the new window it opens. The project room's bubble body (pjRoomBody) is read the same way.
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-barelinks-7239.js
 */
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');

const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

const TEXT = 'The site is up at meridianworks.kosmosplus.com, the notes at example.com/path. and the old one at https://example.org.'
  + ' Not links: notes.md, 0.7.70, store.ROOT, Kosmos.app, logger.info, requirements.in, logo.ai, claude.ai, a@b.com and `example.net` in code.';
const FX = {
  messages: [{ from: 'april', at: new Date(Date.now() - 60e3).toISOString(), text: TEXT }],
  olderCount: 0, historyBecause: null, historyUnfilable: false,
  presence: 'on', presenceBecause: null, asking: false, question: null, questionBecause: null, options: null,
};

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, colorScheme: 'light' });
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
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
    await page.evaluate(() => paintTalk('april', 'April'));
    await page.waitForTimeout(400);

    const got = await page.evaluate(() => {
      const row = [...document.querySelectorAll('#d-dmthread .msg')].find((x) => /meridianworks/.test(x.textContent));
      const as = row ? [...row.querySelectorAll('a')] : [];
      return { found: !!row, links: as.map((a) => ({ text: a.textContent, href: a.getAttribute('href'), target: a.getAttribute('target') })), text: row ? row.textContent : '' };
    });
    chk(got.found, 'the agent message is painted in the DM thread');
    const by = (t) => got.links.find((l) => l.text === t);
    const host = by('meridianworks.kosmosplus.com');
    chk(!!host && host.href === 'https://meridianworks.kosmosplus.com' && host.target === '_blank',
      'a bare host is a link to https://, opened in a new window', JSON.stringify(host));
    const withPath = by('example.com/path');
    chk(!!withPath && withPath.href === 'https://example.com/path' && withPath.target === '_blank',
      'a bare host with a path is a link, its full stop left outside', JSON.stringify(withPath));
    chk(!!by('https://example.org'), 'CONTROL: an https:// address is still a link (#355)', JSON.stringify(got.links));
    chk(got.links.length === 3, 'nothing that only looks like an address is a link (notes.md, 0.7.70, store.ROOT, Kosmos.app, logger.info, an email, code)',
      JSON.stringify(got.links.map((l) => l.text)));
    chk(['notes.md', '0.7.70', 'store.ROOT', 'Kosmos.app', 'logger.info', 'requirements.in', 'logo.ai', 'claude.ai', 'a@b.com', 'example.net'].every((w) => got.text.includes(w)),
      'and every one of them is still shown');

    // The project room: an agent's room post goes through the room's own body renderer (pjRoomBody, what paintRoom
    // draws in each bubble), put into a room bubble on the page.
    // Review 1: with the room's own interplay in play, a cited project file named like a host (brand.io) and an
    // @mention keep their chips and are never website links.
    const room = await page.evaluate((text) => {
      PJ_DOC_NAMES = new Set(['brand.io']);
      const html = pjRoomBody({ kind: 'post', id: 'r1', from: 'you', operator: true, at: new Date().toISOString(),
        text: text + ' See brand.io, **brand.io** and @april.' }, { id: 'p', agents: [{ sessionName: 'april', name: 'April' }] });
      PJ_DOC_NAMES = null;
      const box = document.createElement('div');
      box.className = 'msg-bd';
      box.innerHTML = html;
      document.getElementById('pj-room').appendChild(box);
      return {
        links: [...box.querySelectorAll('a')].map((a) => ({ text: a.textContent, href: a.getAttribute('href'), target: a.getAttribute('target') })),
        text: box.textContent,
        chip: box.querySelectorAll('.ref .refgo[data-ref="brand.io"]').length === 2,   // plain and bold (review 2)
        mention: [...box.querySelectorAll('.pjmention')].map((x) => x.textContent),
      };
    }, TEXT);
    const rby = (t) => room.links.find((l) => l.text === t);
    chk(!!rby('meridianworks.kosmosplus.com') && rby('meridianworks.kosmosplus.com').href === 'https://meridianworks.kosmosplus.com' && rby('meridianworks.kosmosplus.com').target === '_blank',
      'room: a bare host is a link to https://, in a new window', JSON.stringify(room.links));
    chk(!!rby('example.com/path') && rby('example.com/path').href === 'https://example.com/path', 'room: a bare host with a path is a link');
    chk(room.links.length === 3, 'room: nothing that only looks like an address is a link', JSON.stringify(room.links.map((l) => l.text)));
    chk(room.chip, 'room: a cited project file named like a host (brand.io) keeps its Show me (review 1)', JSON.stringify(room));
    chk(room.mention.length === 1 && /@april/i.test(room.mention[0]), 'room: an @mention keeps its chip', JSON.stringify(room.mention));

    // The click: a new window to the https:// address (in the Mac app this is what goes to the system browser). The
    // check has no network, so that request is answered here and its address recorded.
    const asked = [];
    await page.context().route(/^https:\/\/meridianworks\.kosmosplus\.com\//, async (r) => {
      try { asked.push(r.request().url()); await r.fulfill({ status: 200, contentType: 'text/html', body: '<p>stand-in</p>' }); } catch { /* the window closed */ }
    });
    const [popup] = await Promise.all([
      page.waitForEvent('popup', { timeout: 5000 }).catch(() => null),
      page.evaluate(() => {
        const a = [...document.querySelectorAll('#d-dmthread a')].find((x) => x.textContent === 'meridianworks.kosmosplus.com');
        if (a) a.click();
      }),
    ]);
    if (popup) await popup.waitForLoadState('domcontentloaded').catch(() => {});
    const opened = popup ? popup.url() : null;
    chk(!!popup && asked.length >= 1 && /^https:\/\/meridianworks\.kosmosplus\.com\/?$/.test(asked[0]),
      'a click opens a new window that asks for the https:// address, not inside Kosmos', JSON.stringify({ opened, asked }));
    if (popup) await popup.close().catch(() => {});
    chk(await page.evaluate(() => location.protocol === 'file:'), 'the Kosmos page itself did not navigate away');

    chk(errs.length === 0, 'no page errors', errs.join(' | '));
  } catch (e) {
    chk(false, 'the check ran to the end', String((e && e.stack) || e));
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})();
