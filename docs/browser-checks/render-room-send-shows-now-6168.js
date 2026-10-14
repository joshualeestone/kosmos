'use strict';

// Browser-check-functions: pjPostSend paintRoom

/**
 * kosmos#6168 (Josh, 2026-10-14 13:59): "i do feel like there is a slight delay when i enter a message until it lands
 * in the dialogue on project but not so much on agents". The agent page draws the person's message the moment Send is
 * pressed (#4944, render-dm-send-shows-now). The project room drew it only after the POST answered, and a room post
 * types into every member's pane in turn before it answers, then the room was read again.
 *
 * This check loads the page over file:// with fetch stubbed (the render-pj-question-text-6129 pattern) and HOLDS the
 * room's POST open, which is the only way to see the screen while the board is still delivering. It MEASURES the
 * time from pressing Post to the person's words being drawn in the room, and prints it, so the before (on the old page:
 * not drawn until the POST answers) and the after can be compared. Then: one copy once the board keeps it, and a post
 * the board refuses stays drawn, marked, with the reason.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-room-send-shows-now-6168.js
 */
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const HEADED = process.env.HEADED !== '0';
const HOLD_MS = 2500;   // how long the stub keeps the POST open: longer than any honest "instant"

const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

function initStub() {
  window.setInterval = () => 0;   // no background polls racing the hand-driven paints
  window.__project = {
    id: 'p1', name: 'Room send', parent: null, archived: false,
    agents: [{ sessionName: 'Mara', name: 'Mara' }], defaultAgent: 'Mara', summary: { total: 1, needsYou: 0 },
  };
  window.__rows = [{ kind: 'post', id: 'r1', from: 'Mara', text: 'ready when you are', at: new Date(Date.now() - 60000).toISOString() }];
  window.__refuse = null;     // a sentence: the next POST is refused with it
  window.__release = null;    // set while a POST is held; calling it answers the POST
  const enc = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json' } });
  window.fetch = async (url, opts) => {
    const u = String(url);
    const method = String((opts && opts.method) || 'GET').toUpperCase();
    if (/\/api\/project\/p1\/room$/.test(u) && method === 'POST') {
      const sent = JSON.parse(opts.body || '{}');
      await new Promise((resolve) => { window.__release = resolve; });
      window.__release = null;
      if (window.__refuse) {
        const because = window.__refuse; window.__refuse = null;
        return enc({ ok: true, delivery: { state: 'could_not', because } });
      }
      window.__rows.push({ kind: 'post', id: 'r' + (window.__rows.length + 1), operator: true, text: sent.text, at: new Date().toISOString() });
      return enc({ ok: true, delivery: { state: 'placed', outcomes: { Mara: 'placed' } } });
    }
    if (/\/api\/project\/p1\/room$/.test(u)) return enc({ ok: true, rows: window.__rows.slice() });
    if (/\/api\/projects(\?|$)/.test(u) && method === 'GET') return enc({ ok: true, projects: [window.__project] });
    if (u.includes('/thread/')) return enc({ ok: true, asking: false, agent: { sessionName: 'Mara' }, messages: [], viewport: { text: null } });
    return enc({ ok: true, agents: [] });
  };
}

/* What the room shows about one message: how many copies, and whether the newest is the pending one, with its slot. */
function readRoom(page, words) {
  return page.evaluate((w) => {
    const rows = [...document.querySelectorAll('#pj-room .msg')].filter((r) => r.textContent.includes(w));
    const r = rows[rows.length - 1] || null;
    const box = r ? r.getBoundingClientRect() : null;
    const slot = r ? r.querySelector('.msg-t') : null;
    return {
      copies: rows.length,
      pending: Boolean(r && r.classList.contains('pj-pending')),
      you: Boolean(r && r.classList.contains('you')),
      slot: slot ? slot.textContent.trim() : null,
      drawn: Boolean(box && box.height > 0 && box.width > 0),
    };
  }, words);
}

async function postAndMeasure(page, words) {
  await page.fill('#pj-post', words);
  const t0 = Date.now();
  await page.click('#pj-post-go');
  const seen = await page.waitForFunction((w) => [...document.querySelectorAll('#pj-room .msg')].some((r) => r.textContent.includes(w)),
    words, { timeout: HOLD_MS - 500 }).then(() => Date.now() - t0).catch(() => null);
  return seen;
}

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: !HEADED }); } catch (err) {
    console.error('FAIL  render-room-send-shows-now-6168: could not start a browser. ' + ((err && err.message) || err).split('\n')[0]);
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(initStub);
  await page.goto(PAGE);
  if (await page.isVisible('#firstrun')) await page.keyboard.press('Escape');
  await page.click('[data-tab="projects"]').catch(() => {});
  await page.evaluate(() => {
    document.querySelectorAll('body > [inert]').forEach((el) => el.removeAttribute('inert'));
    LAST = [];
    PROJECTS.length = 0;
    PROJECTS.push(window.__project);
    openProject('p1');
  });
  await page.waitForFunction(() => document.querySelector('#pj-room').textContent.includes('ready when you are'), { timeout: 5000 });

  /* 1. Send-to-visible while the board is still delivering. */
  const WORDS = 'the launch copy is approved, ship it';
  const ms = await postAndMeasure(page, WORDS);
  console.log('MEASURE  room send-to-visible with the POST held ' + HOLD_MS + ' ms: ' + (ms === null ? 'NOT DRAWN while held' : ms + ' ms'));
  chk(ms !== null && ms < 500, '#6168: the room draws the person\'s message while the post is still on its way', ms === null ? 'not drawn' : ms + ' ms');
  const during = await readRoom(page, WORDS);
  chk(during.copies === 1 && during.pending && during.you, 'it is drawn once, as the person\'s own bubble, marked pending', JSON.stringify(during));
  chk(during.slot === 'Sending…', 'its time slot says Sending… while it is on its way', JSON.stringify(during.slot));

  /* 2. The board keeps it: one copy, the kept row, no second bubble. */
  await page.evaluate(() => window.__release && window.__release());
  await page.waitForFunction((w) => {
    const rows = [...document.querySelectorAll('#pj-room .msg')].filter((r) => r.textContent.includes(w));
    return rows.length === 1 && !rows[0].classList.contains('pj-pending');
  }, WORDS, { timeout: 5000 }).catch(() => {});
  const after = await readRoom(page, WORDS);
  chk(after.copies === 1 && !after.pending && after.you, 'once the board keeps it, the kept row replaces it: one copy, no longer pending', JSON.stringify(after));

  /* 3. A post the board refuses stays drawn, marked, with the reason. */
  const NOPE = 'this one the board will refuse';
  await page.evaluate(() => { window.__refuse = 'the room is on hold'; });
  await page.fill('#pj-post', NOPE);
  await page.click('#pj-post-go');
  await page.waitForFunction(() => typeof window.__release === 'function', { timeout: 3000 }).catch(() => {});
  await page.evaluate(() => window.__release && window.__release());
  await page.waitForFunction((w) => [...document.querySelectorAll('#pj-room .msg.pj-pending')].some((r) => r.textContent.includes(w) && /Not posted/.test(r.textContent)),
    NOPE, { timeout: 5000 }).catch(() => {});
  const refused = await readRoom(page, NOPE);
  const refusedText = await page.evaluate((w) => { const r = [...document.querySelectorAll('#pj-room .msg')].find((x) => x.textContent.includes(w)); return r ? r.textContent : ''; }, NOPE);
  chk(refused.copies === 1 && refused.pending && /Not posted\.\s*The room is on hold/i.test(refusedText), 'a refused post stays drawn, marked Not posted, with the board\'s reason', refusedText.slice(0, 160));
  chk(await page.inputValue('#pj-post') === NOPE, 'and its words are still in the box to send again');

  chk(errors.length === 0, 'no page errors', errors.join(' | ').slice(0, 300));
  await browser.close();
  console.log(fail.length ? '\n' + fail.length + ' FAILED' : '\nAll checks passed');
  process.exit(fail.length ? 1 : 0);
})();
