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
  window.__throw = false;     // the next POST's connection dies (fetch rejects)
  window.__bare502 = false;   // the next POST is a relay's bare 502 (no JSON sentence of the board's)
  window.__p2 = { id: 'p2', name: 'Other room', parent: null, archived: false, agents: [{ sessionName: 'Mara', name: 'Mara' }], defaultAgent: 'Mara', summary: { total: 1, needsYou: 0 } };
  window.__kept = false;      // the row was already written by the check (the room's read handed over first)
  window.__release = null;    // set while a POST is held; calling it answers the POST
  const enc = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json' } });
  window.fetch = async (url, opts) => {
    const u = String(url);
    const method = String((opts && opts.method) || 'GET').toUpperCase();
    if (/\/api\/project\/p1\/room$/.test(u) && method === 'POST') {
      const sent = JSON.parse(opts.body || '{}');
      await new Promise((resolve) => { window.__release = resolve; });
      window.__release = null;
      if (window.__throw) { window.__throw = false; throw new TypeError('Failed to fetch'); }
      if (window.__bare502) { window.__bare502 = false; return new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }); }
      if (window.__refuse) {
        const because = window.__refuse; window.__refuse = null;
        return enc({ ok: true, delivery: { state: 'could_not', because } });
      }
      if (!window.__kept) window.__rows.push({ kind: 'post', id: 'r' + (window.__rows.length + 1), operator: true, text: sent.text, at: new Date().toISOString() });
      window.__kept = false;
      return enc({ ok: true, delivery: { state: 'placed', outcomes: { Mara: 'placed' } } });
    }
    /* kosmos#7365 slice 2: the room reads its newest page (room?n=200&archive=0) as well as the whole room (a search):
       both are answered, the paged one with each row's key and nothing older. */
    const paged = (rows) => ({ ok: true, rows: rows.map((r, i) => Object.assign({ key: r.at + '|' + i }, r)), olderCount: 0, olderCursor: null });
    if (/\/api\/project\/p1\/room\?/.test(u) && method === 'GET') return enc(paged(window.__rows.slice()));
    if (/\/api\/project\/p2\/room\?/.test(u) && method === 'GET') return enc(paged([]));
    if (/\/api\/project\/p1\/room$/.test(u)) return enc({ ok: true, rows: window.__rows.slice() });
    if (/\/api\/project\/p2\/room$/.test(u)) return enc({ ok: true, rows: [] });
    if (/\/api\/projects(\?|$)/.test(u) && method === 'GET') return enc({ ok: true, projects: [window.__project, window.__p2] });
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
    PROJECTS.push(window.__project, window.__p2);
    openProject('p1');
  });
  await page.waitForFunction(() => document.querySelector('#pj-room').textContent.includes('ready when you are'), { timeout: 5000 });

  /* 1. Send-to-visible while the board is still delivering. */
  const WORDS = 'the launch copy is approved, ship it';
  const ms = await postAndMeasure(page, WORDS);
  console.log('MEASURE  room send-to-visible with the POST held ' + HOLD_MS + ' ms: ' + (ms === null ? 'NOT DRAWN while held' : ms + ' ms'));
  chk(ms !== null && ms < 500, '#6168: the room draws the person\'s message while the post is still on its way', ms === null ? 'not drawn' : ms + ' ms');
  const during = await readRoom(page, WORDS);
  chk(during.copies === 1 && during.pending && during.you && during.drawn, 'it is drawn once, visibly (a real box on screen), as the person\'s own bubble, marked pending', JSON.stringify(during));
  chk(during.slot === 'Sending…', 'its time slot says Sending… while it is on its way', JSON.stringify(during.slot));
  chk(await page.inputValue('#pj-post') === '', 'review 1: the words are in the room, not also left in the box (the #4944 "in both places" complaint)');

  /* 2. The handover itself, measured where it happens (review 1): the room's own read finds the kept row WHILE the post
     is still answering, so only the matcher can make it one copy (the post's tidy-up after it answers has not run). */
  await page.evaluate((w) => {
    window.__rows.push({ kind: 'post', id: 'rkept', operator: true, text: w, at: new Date().toISOString() });
    window.__kept = true;
  }, WORDS);
  await page.evaluate(() => loadRoom());
  const handed = await readRoom(page, WORDS);
  chk(handed.copies === 1 && !handed.pending && handed.you, 'the room\'s read hands over to the kept row in place: one copy, before the post even answers', JSON.stringify(handed));
  await page.evaluate(() => window.__release && window.__release());
  await page.waitForFunction(() => document.getElementById('pj-post-go').disabled === false, { timeout: 5000 }).catch(() => {});
  const after = await readRoom(page, WORDS);
  chk(after.copies === 1 && !after.pending && after.you, 'once the board answers, still one copy, no longer pending', JSON.stringify(after));

  /* 2b. The same words again (review 1: "ok" said twice). The earlier copy is not this post, so the new one is drawn. */
  await page.fill('#pj-post', WORDS);
  await page.click('#pj-post-go');
  await page.waitForFunction(() => typeof window.__release === 'function', { timeout: 3000 }).catch(() => {});
  const twice = await page.evaluate((w) => {
    const rows = [...document.querySelectorAll('#pj-room .msg')].filter((r) => r.textContent.includes(w));
    return { copies: rows.length, newestPending: rows.length > 0 && rows[rows.length - 1].classList.contains('pj-pending') };
  }, WORDS);
  chk(twice.copies === 2 && twice.newestPending, 'a second post with the same words is drawn at once, beside the first, not swallowed by it', JSON.stringify(twice));
  await page.evaluate(() => window.__release && window.__release());
  await page.waitForFunction(() => document.getElementById('pj-post-go').disabled === false, { timeout: 5000 }).catch(() => {});
  const twiceAfter = await page.evaluate((w) => [...document.querySelectorAll('#pj-room .msg')].filter((r) => r.textContent.includes(w))
    .map((r) => r.classList.contains('pj-pending')), WORDS);
  chk(twiceAfter.length === 2 && twiceAfter.every((x) => !x), 'and once kept there are two copies, neither pending', JSON.stringify(twiceAfter));

  /* 2c. The connection dies mid-post (review 1): "Not confirmed", words back in the box; when the room then shows it
     arrived, the unsure bubble gives way to the kept row rather than sitting under it. */
  const LOST = 'the connection dropped on this one';
  await page.evaluate(() => { window.__throw = true; });
  await page.fill('#pj-post', LOST);
  await page.click('#pj-post-go');
  await page.waitForFunction(() => typeof window.__release === 'function', { timeout: 3000 }).catch(() => {});
  await page.evaluate(() => window.__release && window.__release());
  await page.waitForFunction(() => document.getElementById('pj-post-go').disabled === false, { timeout: 5000 }).catch(() => {});
  const lostText = await page.evaluate((w) => { const r = [...document.querySelectorAll('#pj-room .msg.pj-pending')].find((x) => x.textContent.includes(w)); return r ? r.textContent : ''; }, LOST);
  chk(/Not confirmed\./.test(lostText), 'a post whose connection died is marked Not confirmed (it may have arrived)', lostText.slice(0, 140));
  chk(await page.inputValue('#pj-post') === LOST, 'and its words are back in the box');
  await page.evaluate((w) => { window.__rows.push({ kind: 'post', id: 'rlost', operator: true, text: w, at: new Date().toISOString() }); }, LOST);
  await page.evaluate(() => loadRoom());
  const landed = await readRoom(page, LOST);
  chk(landed.copies === 1 && !landed.pending, 'when the room shows it did arrive, the Not confirmed bubble gives way: one copy', JSON.stringify(landed));
  chk(await page.inputValue('#pj-post') === '', 'review 5: and the words put back in the box are taken out again, so one more press cannot post it twice');
  await page.fill('#pj-post', '');

  /* 2d. A relay's bare 502 (no sentence of the board's) may have been delivered: "Not confirmed", not "Not posted". */
  const GATE = 'a relay timed out on this one';
  await page.evaluate(() => { window.__bare502 = true; });
  await page.fill('#pj-post', GATE);
  await page.click('#pj-post-go');
  await page.waitForFunction(() => typeof window.__release === 'function', { timeout: 3000 }).catch(() => {});
  await page.evaluate(() => window.__release && window.__release());
  await page.waitForFunction(() => document.getElementById('pj-post-go').disabled === false, { timeout: 5000 }).catch(() => {});
  const gateText = await page.evaluate((w) => { const r = [...document.querySelectorAll('#pj-room .msg.pj-pending')].find((x) => x.textContent.includes(w)); return r ? r.textContent : ''; }, GATE);
  chk(/Not confirmed\./.test(gateText) && !/Not posted/.test(gateText), 'review 2: a bare 5xx is Not confirmed, never Not posted', gateText.slice(0, 140));
  const gateLine = await page.evaluate(() => document.getElementById('pj-room-msg').textContent);
  chk(!/could not post/i.test(gateText) && !/could not post/i.test(gateLine) && /could not tell whether/i.test(gateLine),
    'review 3: and neither the bubble nor the line under the box says it could not be posted', JSON.stringify({ bubble: gateText.slice(0, 120), line: gateLine }));
  await page.fill('#pj-post', '');

  /* 2e. The room already showed it landed, then the connection died (review 2): one copy, nothing marked, and the words
     NOT put back in the box, or a second press would post it twice. */
  const SEEN = 'this one landed before the line dropped';
  await page.evaluate(() => { window.__throw = true; });
  await page.fill('#pj-post', SEEN);
  await page.click('#pj-post-go');
  await page.waitForFunction(() => typeof window.__release === 'function', { timeout: 3000 }).catch(() => {});
  await page.evaluate((w) => { window.__rows.push({ kind: 'post', id: 'rseen', operator: true, text: w, at: new Date().toISOString() }); }, SEEN);
  await page.evaluate(() => loadRoom());
  await page.evaluate(() => window.__release && window.__release());
  await page.waitForFunction(() => document.getElementById('pj-post-go').disabled === false, { timeout: 5000 }).catch(() => {});
  const seen = await readRoom(page, SEEN);
  const seenText = await page.evaluate((w) => [...document.querySelectorAll('#pj-room .msg')].filter((x) => x.textContent.includes(w)).map((x) => x.textContent).join(' | '), SEEN);
  chk(seen.copies === 1 && !seen.pending && !/Not confirmed/.test(seenText), 'review 2: a post the room already shows is not marked when its connection then dies', JSON.stringify(seen));
  chk(await page.inputValue('#pj-post') === '', 'review 2: and its words are not put back in the box to be posted twice');
  const seenLine = await page.evaluate(() => document.getElementById('pj-room-msg').textContent);
  chk(!/could not/i.test(seenLine), 'review 3: and the line under the box does not contradict the room by saying it could not', JSON.stringify(seenLine));

  /* 2e2. A stale snapshot (review 3): an older post with the same words reached the room after the page's last read, so
     the press does not know its id. It must not swallow the new post; refused, the new one stays, marked, words back. */
  const STALE = 'ok';
  await page.evaluate((w) => { window.__rows.push({ kind: 'post', id: 'rold', operator: true, text: w, at: new Date(Date.now() - 30000).toISOString() }); window.__refuse = 'the room is on hold'; }, STALE);
  await page.fill('#pj-post', STALE);
  await page.click('#pj-post-go');
  await page.waitForFunction(() => typeof window.__release === 'function', { timeout: 3000 }).catch(() => {});
  await page.evaluate(() => loadRoom());   // a poll during the flight draws the older copy
  const staleMid = await page.evaluate(() => [...document.querySelectorAll('#pj-room .msg')].filter((r) => /(^|\s)ok(\s|$)/.test(r.querySelector('.msg-bd') ? r.querySelector('.msg-bd').textContent.replace(/Sending…|just now|\d+ ?[smh] ago/g, ' ') : '')).map((r) => r.classList.contains('pj-pending')));
  chk(staleMid.length === 2 && staleMid[1] === true, 'review 3: an older same-words post the press did not know about does not swallow the new one', JSON.stringify(staleMid));
  await page.evaluate(() => window.__release && window.__release());
  await page.waitForFunction(() => document.getElementById('pj-post-go').disabled === false, { timeout: 5000 }).catch(() => {});
  const staleAfter = await page.evaluate(() => ({ box: document.getElementById('pj-post').value, refused: [...document.querySelectorAll('#pj-room .msg.pj-pending')].some((r) => /Not posted/.test(r.textContent)) }));
  chk(staleAfter.refused && staleAfter.box === 'ok', 'review 3: refused, the new post stays marked Not posted and its words come back', JSON.stringify(staleAfter));
  await page.fill('#pj-post', '');

  /* 2e3. Another window posts the same words during the flight (review 4): the room hands over to THAT post, then the
     board refuses this one. A refusal means this post was not kept, so it is drawn again, marked, and its words come back
     rather than vanishing in silence. */
  const TWIN = 'same words from two windows';
  await page.evaluate(() => { window.__refuse = 'the room is on hold'; });
  await page.fill('#pj-post', TWIN);
  await page.click('#pj-post-go');
  await page.waitForFunction(() => typeof window.__release === 'function', { timeout: 3000 }).catch(() => {});
  await page.evaluate((w) => { window.__rows.push({ kind: 'post', id: 'rtwin', operator: true, text: w, at: new Date().toISOString() }); }, TWIN);
  await page.evaluate(() => loadRoom());
  await page.evaluate(() => window.__release && window.__release());
  await page.waitForFunction(() => document.getElementById('pj-post-go').disabled === false, { timeout: 5000 }).catch(() => {});
  const twin = await page.evaluate((w) => ({
    box: document.getElementById('pj-post').value,
    marked: [...document.querySelectorAll('#pj-room .msg.pj-pending')].some((r) => r.textContent.includes(w) && /Not posted/.test(r.textContent)),
    line: document.getElementById('pj-room-msg').textContent,
  }), TWIN);
  chk(twin.marked && twin.box === TWIN && /on hold/i.test(twin.line), 'review 4: refused after the room handed over to another window\'s same words, it is drawn again as Not posted and its words come back', JSON.stringify(twin));
  await page.fill('#pj-post', '');

  /* 2f. Moving to another project mid-post, then refused: the words are parked as that project's draft, never put into
     the other project's box (review 2: the parking branch). */
  const AWAY = 'sent from p1, refused after I moved to p2';
  await page.evaluate(() => { window.__refuse = 'the room is on hold'; });
  await page.fill('#pj-post', AWAY);
  await page.click('#pj-post-go');
  await page.waitForFunction(() => typeof window.__release === 'function', { timeout: 3000 }).catch(() => {});
  await page.evaluate(() => openProject('p2'));
  await page.evaluate(() => window.__release && window.__release());
  await page.waitForFunction(() => document.getElementById('pj-post-go').disabled === false, { timeout: 5000 }).catch(() => {});
  const away = await page.evaluate(() => ({ box: document.getElementById('pj-post').value, draft: PJ_ROOM_DRAFTS.p1 || '' }));
  chk(away.box !== 'sent from p1, refused after I moved to p2' && away.draft === 'sent from p1, refused after I moved to p2',
    'review 2: refused after moving to another project, the words are parked under the project they were sent from', JSON.stringify(away));
  await page.evaluate(() => { delete PJ_ROOM_DRAFTS.p1; openProject('p1'); });
  await page.waitForFunction(() => document.querySelector('#pj-room').textContent.includes('ready when you are'), { timeout: 5000 }).catch(() => {});
  await page.fill('#pj-post', '');

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
  chk(refused.copies === 1 && refused.pending && refused.drawn && /Not posted\.\s*The room is on hold/i.test(refusedText), 'a refused post stays drawn, marked Not posted, with the board\'s reason', refusedText.slice(0, 160));
  chk(await page.inputValue('#pj-post') === NOPE, 'and its words are still in the box to send again');

  chk(errors.length === 0, 'no page errors', errors.join(' | ').slice(0, 300));
  await browser.close();
  console.log(fail.length ? '\n' + fail.length + ' FAILED' : '\nAll checks passed');
  process.exit(fail.length ? 1 : 0);
})();
