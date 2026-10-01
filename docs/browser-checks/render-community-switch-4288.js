'use strict';

/*
 * #4288: the Kosmos Community switch in Settings > Automation (Mona Lisa's design on the card).
 *
 * Every /api/community-setting request is answered at the browser (page.route), except in the
 * REARM arm (which writes and then restores the board's community.json), and each arm sees exactly
 * the state it names:
 *   DEFAULT   the board's own read (a sandboxed board has no community.json): the row shows
 *             under Automation, below the Daily report box, reads ON, the share says "not
 *             measured yet" (never 0), and the OFF note is hidden.
 *   OFF       a read of on:false: the knob reads Off and the OFF note says posts stay up until
 *             you delete them (#4313 built that delete, in the list below the switch).
 *   403       a gated read: the knob is HIDDEN with no position (never a false Off), and the
 *             share line says the setting could not be read.
 *   UNREADABLE  the board's 200 answer with ok:false (a corrupt file) draws could-not-read too.
 *   SHARE     a measured share renders Token Usage's own units (usageAbbr, "3% (12K of 410K)"), and a
 *             community spend of 0 renders "none".
 *   CLICK     pressing the knob PUTs on:false and paints what the board answered.
 *   CLICK-FAIL  a refused save shows its message and leaves the knob where it was.
 *   NOTICE    (part B) a pending one-time notice opens once, records itself as seen once, and closes on
 *             Got it, Escape and the backdrop; Change in Settings lands on the switch. A seen notice, an
 *             OFF switch and an unread setting open nothing.
 *   REARM     (#3485, REAL, needs AGENT_WORKFORCE_DATA) a board that dismissed the OLD notice sees the
 *             new one once; a board that dismissed the new one does not (CONTROL). The file is restored.
 * The DEFAULT arm is also the control for the others: it proves the row is found and read.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
 *     node docs/browser-checks/render-community-switch-4288.js http://127.0.0.1:PORT
 */

const { chromium } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The REARM arm writes the board's community.json, so only on a board whose data root is a temp sandbox.
function sandboxedData(d) {
  if (!d || !fs.existsSync(d)) return false;
  const real = fs.realpathSync(d);
  return [os.tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders']
    .some((t) => { try { return real.startsWith(fs.realpathSync(t) + path.sep); } catch { return false; } });
}

const BASE = process.argv[2] || process.env.KOSMOS_URL || 'http://127.0.0.1:17461';
const ROUTE = '**/api/community-setting';
const SEEN = '**/api/community-setting/notice-seen';

const fails = [];
function check(name, pass, detail) {
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : ''));
  if (!pass) fails.push(name);
}

/* Load the page and wait until its own script is running. Not `networkidle`: the page polls the board,
   and on a loaded machine a quiet 500 ms may never come, which timed this check out locally. */
async function load(pg) {
  await pg.goto(BASE, { waitUntil: 'load', timeout: 60000 });
  await pg.waitForFunction(() => typeof showTab === 'function' && typeof communityPaint === 'function', null, { timeout: 30000 });
  /* The boot cover sits over the whole page until first run's check answers, and that check is live and
     slow on a loaded machine: clicks before it lifts land on the cover (the local flakes). */
  await pg.waitForSelector('#boot-cover', { state: 'hidden', timeout: 60000 });
  if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
}

// Open Settings > Automation. Escape the first-run overlay rather than completing it, so the
// check writes nothing.
async function openAutomation(pg) {
  await load(pg);
  // The row is painted from the board's answer; wait for that paint rather than a fixed time.
  await pg.waitForFunction(() => { const t = document.getElementById('community-share'); return t && t.textContent.length > 0; }, null, { timeout: 30000 });
  await pg.evaluate(() => showTab('settings'));
  await pg.waitForTimeout(400);
  await pg.click('#s-nav button[data-go="automation"]');
  await pg.waitForTimeout(400);
}

function readRow(pg) {
  return pg.evaluate(() => {
    const tog = document.getElementById('community-toggle');
    const row = document.getElementById('community-row');
    const daily = document.getElementById('feedback-row');
    const off = document.getElementById('community-off-note');
    const box = row && row.getBoundingClientRect();
    const dbox = daily && daily.getBoundingClientRect();
    return {
      found: Boolean(tog && row),
      shown: Boolean(box && box.width > 0 && box.height > 0),
      belowDaily: Boolean(box && dbox && dbox.height > 0 && box.top > dbox.bottom),
      hidden: tog ? tog.hidden : null,
      checked: tog ? tog.getAttribute('aria-checked') : null,
      share: (document.getElementById('community-share') || {}).textContent || '',
      offNoteHidden: off ? off.hidden : null,
      offNote: off ? off.textContent : '',
      msg: (document.getElementById('community-msg') || {}).textContent || '',
    };
  });
}

const answer = (body, status = 200) => (route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function run() {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const page = () => browser.newPage({ viewport: { width: 1400, height: 1000 } });
  try {
    // DEFAULT: the board's own read. GET only; any PUT here would be a write, so it is refused.
    const p1 = await page();
    let wrote = false;
    await p1.route(ROUTE, (route) => { if (route.request().method() === 'GET') return route.continue(); wrote = true; return route.abort(); });
    await openAutomation(p1);
    const d = await readRow(p1);
    check('DEFAULT: the Community row exists', d.found, JSON.stringify(d));
    check('DEFAULT: it is visible under Settings > Automation', d.shown, JSON.stringify(d));
    check('DEFAULT: it sits below the Daily report box', d.belowDaily, JSON.stringify(d));
    check('DEFAULT: the knob shows and reads ON (Josh: default ON)', d.hidden === false && d.checked === 'true', JSON.stringify(d));
    check('DEFAULT: the share says "not measured yet", never 0', /: not measured yet$/.test(d.share) && !/\b0(%|\b)/.test(d.share), JSON.stringify(d.share));
    check('DEFAULT: the OFF note is hidden while ON', d.offNoteHidden === true, String(d.offNoteHidden));
    check('DEFAULT: opening the page wrote nothing', wrote === false);
    await p1.close();

    // OFF: the knob reads Off and the note says what OFF does.
    const p2 = await page();
    await p2.route(ROUTE, answer({ on: false, ok: true, share: null }));
    await openAutomation(p2);
    const o = await readRow(p2);
    check('OFF: the knob shows and reads Off', o.hidden === false && o.checked === 'false', JSON.stringify(o));
    check('OFF: the OFF note shows', o.offNoteHidden === false, String(o.offNoteHidden));
    // #4313: the delete exists now (the list below the switch), so the note promises it again,
    // and names where it is. Before #4313 this arm asserted the note promised NO delete (review 1).
    check('OFF: the note says posts and comments stay up until you delete them below', /Posts and comments already in the community stay up until you delete them below\.$/.test(o.offNote), JSON.stringify(o.offNote));
    await p2.close();

    // 403: a gated read draws could-not-read, never a false Off.
    const p3 = await page();
    await p3.route(ROUTE, answer({ error: 'this board belongs to the account that started it' }, 403));
    await openAutomation(p3);
    const g = await readRow(p3);
    check('403: the knob is HIDDEN', g.hidden === true, JSON.stringify(g));
    check('403: the knob keeps NO position', g.checked === null, String(g.checked));
    check('403: the share line says the setting could not be read', /could not read this setting/.test(g.share), JSON.stringify(g.share));
    check('403: the OFF note stays hidden (the position is unknown)', g.offNoteHidden === true, String(g.offNoteHidden));
    await p3.close();

    // UNREADABLE: the board's own answer for a corrupt setting file is a 200 with ok:false, which never
    // reaches the page's HTTP-error path. It must still draw could-not-read, never a confident Off.
    const p3b = await page();
    await p3b.route(ROUTE, answer({ on: false, ok: false, share: null }));
    await openAutomation(p3b);
    const u = await readRow(p3b);
    check('UNREADABLE (200, ok:false): the knob is HIDDEN with no position', u.hidden === true && u.checked === null, JSON.stringify(u));
    check('UNREADABLE (200, ok:false): the share line says the setting could not be read', /could not read this setting/.test(u.share), JSON.stringify(u.share));
    check('UNREADABLE (200, ok:false): the OFF note stays hidden', u.offNoteHidden === true, String(u.offNoteHidden));
    await p3b.close();

    // SHARE: a measured share in Token Usage's units, and a zero community spend as "none".
    const p4 = await page();
    let shareBody = { on: true, ok: true, share: { community: 12400, total: 410000 } };
    await p4.route(ROUTE, (route) => answer(shareBody)(route));
    await openAutomation(p4);
    const s1 = await readRow(p4);
    // Token Usage's own formatter, so the two screens agree (#4244); the percentage is literal.
    const units = await p4.evaluate(() => [usageAbbr(12400), usageAbbr(410000)]);
    check('SHARE: a measured share renders "3% (<Token Usage units>)"', s1.share.endsWith(': 3% (' + units[0] + ' of ' + units[1] + ')'), JSON.stringify([s1.share, units]));
    // A share that rounds UP (2.5% -> 3%), so a floor in place of the rounding reds.
    shareBody = { on: true, ok: true, share: { community: 1000, total: 40000 } };
    await p4.evaluate(() => refreshCommunity());
    await p4.waitForTimeout(300);
    const sr = await readRow(p4);
    const ru = await p4.evaluate(() => [usageAbbr(1000), usageAbbr(40000)]);
    check('SHARE: a share of 2.5% rounds to 3%', sr.share.endsWith(': 3% (' + ru[0] + ' of ' + ru[1] + ')'), JSON.stringify([sr.share, ru]));
    shareBody = { on: true, ok: true, share: { community: 0, total: 410000 } };
    await p4.evaluate(() => refreshCommunity());
    await p4.waitForTimeout(300);
    const s2 = await readRow(p4);
    check('SHARE: a community spend of 0 renders "none"', /: none$/.test(s2.share), JSON.stringify(s2.share));
    // A spend against no total is no measurement, never "0%".
    shareBody = { on: true, ok: true, share: { community: 500, total: 0 } };
    await p4.evaluate(() => refreshCommunity());
    await p4.waitForTimeout(300);
    const s3 = await readRow(p4);
    check('SHARE: a share with no total reads "not measured yet"', /: not measured yet$/.test(s3.share), JSON.stringify(s3.share));
    await p4.close();

    // CLICK: the knob PUTs on:false and paints what the board answered.
    const p5 = await page();
    const puts = [];
    await p5.route(ROUTE, (route) => {
      const req = route.request();
      if (req.method() === 'PUT') { puts.push(req.postData()); return answer({ on: false, ok: true, share: null })(route); }
      return answer({ on: true, ok: true, share: null })(route);
    });
    await openAutomation(p5);
    await p5.click('#community-toggle');
    await p5.waitForTimeout(400);
    const c = await readRow(p5);
    check('CLICK: one PUT with on:false', puts.length === 1 && JSON.parse(puts[0]).on === false, JSON.stringify(puts));
    check('CLICK: the knob now reads Off and the OFF note shows', c.checked === 'false' && c.offNoteHidden === false, JSON.stringify(c));
    await p5.close();

    // CLICK-FAIL: a refused save says so and leaves the knob where it was.
    const p6 = await page();
    await p6.route(ROUTE, (route) => {
      if (route.request().method() === 'PUT') return answer({ error: 'we could not save that setting' }, 400)(route);
      return answer({ on: true, ok: true, share: null })(route);
    });
    await openAutomation(p6);
    await p6.click('#community-toggle');
    await p6.waitForTimeout(400);
    const f = await readRow(p6);
    check('CLICK-FAIL: a refused save shows its message', /could not save that setting/i.test(f.msg), JSON.stringify(f.msg));
    check('CLICK-FAIL: the knob still reads ON and the OFF note stays hidden', f.checked === 'true' && f.offNoteHidden === true, JSON.stringify(f));
    await p6.close();

    // NOTICE (part B): a pending notice opens once and records itself as seen once.
    /* A notice that should open is waited for (up to 15 s); one that should not is given until the page
       has asked for the setting twice (the row, then the notice) plus a second, never a bare sleep. */
    const noticeFor = async (body, expectOpen = true) => {
      const pg = await page();
      const posts = [];
      let gets = 0;
      await pg.route(ROUTE, (route) => { gets++; return answer(body)(route); });
      await pg.route(SEEN, (route) => { posts.push(route.request().method()); return answer({ ...body, noticeSeen: true })(route); });
      await load(pg);
      if (expectOpen) await pg.waitForSelector('#cmnotice', { timeout: 15000 }).catch(() => {});
      else { const until = Date.now() + 15000; while (gets < 2 && Date.now() < until) await pg.waitForTimeout(100); await pg.waitForTimeout(1000); }
      return { pg, posts };
    };
    const noticeState = (pg) => pg.evaluate(() => {
      const b = document.getElementById('cmnotice');
      return { open: Boolean(b), title: b ? (b.querySelector('#cn-title') || {}).textContent : '', body: b ? (b.querySelector('#cn-body') || {}).textContent : '', focus: document.activeElement ? document.activeElement.id : '' };
    });
    const pending = { on: true, ok: true, share: null, noticeSeen: false };

    // HELD: anything already covering the page (another dialog, first run, the update overlay) holds the
    // notice, and it opens once that is gone. Each is planted before the page's own script runs.
    for (const cls of ['rm-back', 'fr-back', 'upd-back']) {
      const nh = await page();
      let heldPosts = 0;
      await nh.addInitScript((c) => { document.addEventListener('DOMContentLoaded', () => { const d = document.createElement('div'); d.className = c; d.dataset.planted = '1'; document.body.appendChild(d); }); }, cls);
      await nh.route(ROUTE, answer(pending));
      await nh.route(SEEN, (route) => { heldPosts++; return answer({ ...pending, noticeSeen: true })(route); });
      await load(nh);
      await nh.waitForTimeout(3000);
      const held = await nh.evaluate(() => Boolean(document.getElementById('cmnotice')));
      check('HELD (' + cls + '): the notice waits and records nothing while it is up', held === false && heldPosts === 0, JSON.stringify([held, heldPosts]));
      await nh.evaluate(() => document.querySelector('[data-planted]').remove());
      await nh.waitForSelector('#cmnotice', { timeout: 15000 }).catch(() => {});
      const opened = await nh.evaluate(() => Boolean(document.getElementById('cmnotice')));
      check('HELD (' + cls + '): once it is gone the notice opens and records itself once', opened === true && heldPosts === 1, JSON.stringify([opened, heldPosts]));
      await nh.close();
    }

    // STALE: the switch is turned OFF (elsewhere) while the notice waits behind a cover; when the cover goes,
    // the notice reads the setting again and opens nothing.
    const ns = await page();
    let staleGets = 0; let stalePosts = 0;
    await ns.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const d = document.createElement('div'); d.className = 'rm-back'; d.dataset.planted = '1'; document.body.appendChild(d); }); });
    await ns.route(ROUTE, (route) => { staleGets++; return answer(staleGets <= 2 ? pending : { on: false, ok: true, share: null, noticeSeen: false })(route); });
    await ns.route(SEEN, (route) => { stalePosts++; return answer({ ...pending, noticeSeen: true })(route); });
    await load(ns);
    await ns.waitForTimeout(2500);
    const gotBefore = staleGets;
    await ns.evaluate(() => document.querySelector('[data-planted]').remove());
    await ns.waitForTimeout(3000);
    const st = await ns.evaluate(() => Boolean(document.getElementById('cmnotice')));
    check('STALE: a switch turned OFF during the wait opens nothing and records nothing', gotBefore === 2 && staleGets >= 3 && st === false && stalePosts === 0, JSON.stringify({ gotBefore, staleGets, st, stalePosts }));
    await ns.close();

    // BOOT: while the boot cover is up the notice waits, so "seen" is only recorded once it can be seen.
    const nb = await page();
    let bootPosts = 0;
    await nb.route('**/api/first-run', async (route) => { await new Promise((ok) => setTimeout(ok, 4000)); return route.continue(); });
    await nb.route(ROUTE, answer(pending));
    await nb.route(SEEN, (route) => { bootPosts++; return answer({ ...pending, noticeSeen: true })(route); });
    await nb.goto(BASE, { waitUntil: 'load', timeout: 60000 });
    await nb.waitForTimeout(2000);
    const during = await nb.evaluate(() => ({ cover: !(document.getElementById('boot-cover') || {}).hidden, open: Boolean(document.getElementById('cmnotice')) }));
    check('BOOT: under the boot cover the notice has not opened or recorded itself', during.cover === true && during.open === false && bootPosts === 0, JSON.stringify([during, bootPosts]));
    await nb.waitForSelector('#cmnotice', { timeout: 20000 }).catch(() => {});
    const after = await nb.evaluate(() => ({ cover: !(document.getElementById('boot-cover') || {}).hidden, open: Boolean(document.getElementById('cmnotice')) }));
    check('BOOT: once the cover lifts, the notice opens and records itself once', after.cover === false && after.open === true && bootPosts === 1, JSON.stringify([after, bootPosts]));
    await nb.close();
    const n1 = await noticeFor(pending);
    const a = await noticeState(n1.pg);
    check('NOTICE: a pending notice opens', a.open === true, JSON.stringify(a));
    // #3485 (Josh, 2026-09-30): agents publish straight away, so the notice no longer promises a release step.
    check('NOTICE: it carries Mona\'s title and says posts go out straight away unless the safety check stops them', a.title === 'Your agents can join the Kosmos community' && /posts now go to the public Kosmos community straight away, unless Kosmos’s safety check stops one; you can turn sharing off in Settings\.$/.test(a.body) && !/until you release/.test(a.body), JSON.stringify(a));
    check('NOTICE: focus starts on the box, not a button (an Enter in flight cannot dismiss it)', a.focus === 'cn-box', a.focus);
    await n1.pg.keyboard.press('Tab');
    const t1 = await n1.pg.evaluate(() => document.activeElement && document.activeElement.id);
    await n1.pg.keyboard.press('Tab');
    const t2 = await n1.pg.evaluate(() => document.activeElement && document.activeElement.id);
    await n1.pg.keyboard.press('Tab');
    const t3 = await n1.pg.evaluate(() => document.activeElement && document.activeElement.id);
    await n1.pg.keyboard.press('Shift+Tab');
    const t4 = await n1.pg.evaluate(() => document.activeElement && document.activeElement.id);
    check('NOTICE: Tab goes to the buttons and stays between them, both directions', t1 === 'cn-settings' && t2 === 'cn-ok' && t3 === 'cn-settings' && t4 === 'cn-ok', JSON.stringify([t1, t2, t3, t4]));
    check('NOTICE: it records itself as seen exactly once, when it opens', n1.posts.length === 1 && n1.posts[0] === 'POST', JSON.stringify(n1.posts));
    await n1.pg.click('#cn-ok');
    await n1.pg.waitForTimeout(200);
    check('NOTICE: Got it closes it and removes it from the page', (await noticeState(n1.pg)).open === false);
    await n1.pg.close();

    const n2 = await noticeFor(pending);
    // A window drawn OVER the notice owns the keys: with the update overlay up, Escape leaves the notice alone.
    await n2.pg.evaluate(() => { const d = document.createElement('div'); d.className = 'upd-back'; d.dataset.planted = '1'; document.body.appendChild(d); });
    await n2.pg.keyboard.press('Escape');
    await n2.pg.waitForTimeout(200);
    check('NOTICE: with the update overlay over it, Escape does not close the notice', (await noticeState(n2.pg)).open === true);
    await n2.pg.evaluate(() => document.querySelector('[data-planted]').remove());
    await n2.pg.keyboard.press('Escape');
    await n2.pg.waitForTimeout(200);
    check('NOTICE: Escape closes it', (await noticeState(n2.pg)).open === false);
    await n2.pg.close();

    const n3 = await noticeFor(pending);
    await n3.pg.mouse.click(8, 8);
    await n3.pg.waitForTimeout(200);
    check('NOTICE: a click on the backdrop closes it', (await noticeState(n3.pg)).open === false);
    await n3.pg.close();

    const n4 = await noticeFor(pending);
    await n4.pg.click('#cn-settings');
    await n4.pg.waitForTimeout(500);
    const t = await n4.pg.evaluate(() => {
      const sec = document.getElementById('s-sec-automation');
      const tog = document.getElementById('community-toggle');
      const box = sec && sec.getBoundingClientRect();
      return { open: Boolean(document.getElementById('cmnotice')), automation: Boolean(box && box.width > 0 && box.height > 0), focus: document.activeElement ? document.activeElement.id : '', tog: tog ? tog.hidden : null };
    });
    check('NOTICE: Change in Settings closes it and shows Settings > Automation', t.open === false && t.automation === true, JSON.stringify(t));
    check('NOTICE: Change in Settings puts focus on the Community switch', t.focus === 'community-toggle', JSON.stringify(t));
    await n4.pg.close();

    // The switch could not be painted (its read failed) while the notice was pending: Change in Settings
    // still lands on the Community row. The Settings row reads first (refreshCommunity runs before
    // communityNoticeCheck in the page), so the first GET fails and the later ones find the notice pending.
    const n5 = await page();
    let gets = 0;
    await n5.route(ROUTE, (route) => (++gets === 1 ? answer({ error: 'gated' }, 403)(route) : answer(pending)(route)));
    await n5.route(SEEN, (route) => answer({ ...pending, noticeSeen: true })(route));
    await load(n5);
    await n5.waitForSelector('#cmnotice', { timeout: 15000 }).catch(() => {});
    const pre = await n5.evaluate(() => ({ open: Boolean(document.getElementById('cmnotice')), tog: (document.getElementById('community-toggle') || {}).hidden }));
    check('NOTICE fallback: precondition, the notice is up and the switch is hidden', pre.open === true && pre.tog === true, JSON.stringify(pre));
    await n5.click('#cn-settings');
    await n5.waitForTimeout(500);
    const fb = await n5.evaluate(() => (document.activeElement ? document.activeElement.id : ''));
    check('NOTICE fallback: with the switch hidden, Change in Settings puts focus on the Community row', fb === 'community-row', fb);
    await n5.close();

    for (const [label, body] of [['a seen notice', { on: true, ok: true, share: null, noticeSeen: true }], ['an OFF switch', { on: false, ok: true, share: null, noticeSeen: false }], ['an unread setting', { on: false, ok: false, share: null, noticeSeen: false }]]) {
      const n = await noticeFor(body, false);
      const st = await noticeState(n.pg);
      check('NOTICE: ' + label + ' opens nothing and records nothing', st.open === false && n.posts.length === 0, JSON.stringify([st, n.posts]));
      await n.pg.close();
    }

    /* #3485 RE-ARM (Josh, 2026-09-30: agents publish straight away). The notice's words changed, so a
       person who dismissed the OLD notice ("Nothing goes out until you release it") must see the new one
       once. This arm is REAL (no page.route): it writes the board's own community.json, loads the page,
       and restores the file after, so the checks that share this board see what they saw before. It runs
       only on a sandboxed board whose data root it was given. */
    const dataRoot = process.env.AGENT_WORKFORCE_DATA;
    if (!sandboxedData(dataRoot)) {
      check('REARM: runs only on a sandboxed board (AGENT_WORKFORCE_DATA under the temp dir)', false, String(dataRoot));
    } else {
      // The board's own path (store.ROOT is <data>/<app>, not <data>), read from the module that owns it.
      const file = require('../../engine/communityswitch').FILE;
      const had = fs.existsSync(file) ? fs.readFileSync(file) : null;
      const realNotice = async (state) => {
        fs.writeFileSync(file, JSON.stringify(state));
        const pg = await page();
        let gets = 0;
        pg.on('request', (r) => { if (/\/api\/community-setting$/.test(r.url())) gets++; });
        await load(pg);
        const until = Date.now() + 15000;
        while (gets < 2 && Date.now() < until && !(await pg.$('#cmnotice'))) await pg.waitForTimeout(100);
        await pg.waitForSelector('#cmnotice', { timeout: 3000 }).catch(() => {});
        return pg;
      };
      try {
        /* Precondition: the file written is THIS board's. Without it every REARM arm could read a file the
           board never looks at, and the CONTROL would pass for that reason alone (it did, once, on sb8). */
        fs.writeFileSync(file, JSON.stringify({ on: false, noticeSeen: true, autopublishNoticeSeen: true }));
        const probe = await fetch(BASE.replace(/\/$/, '') + '/api/community-setting').then((x) => x.json()).catch(() => null);
        check('REARM: precondition, the file written is the one this board reads', Boolean(probe && probe.on === false), JSON.stringify(probe));
        // The OLD dismissal: the file has noticeSeen true and no new key. RED before the new key existed.
        const r1 = await realNotice({ on: true, noticeSeen: true });
        const s1 = await noticeState(r1);
        check('REARM: a board that dismissed the OLD notice sees the new one', s1.open === true && /straight away/.test(s1.body), JSON.stringify(s1));
        await r1.close();
        const after = JSON.parse(fs.readFileSync(file, 'utf8'));
        check('REARM: opening it recorded the new dismissal on the board', after.autopublishNoticeSeen === true, JSON.stringify(after));
        // CONTROL: a board that dismissed the NEW notice opens nothing.
        const r2 = await realNotice({ on: true, noticeSeen: true, autopublishNoticeSeen: true });
        const s2 = await noticeState(r2);
        check('REARM CONTROL: a board that dismissed the NEW notice opens nothing', s2.open === false, JSON.stringify(s2));
        await r2.close();
      } finally {
        if (had === null) fs.rmSync(file, { force: true }); else fs.writeFileSync(file, had);
      }
    }
  } finally {
    await browser.close();
  }
  console.log('\nrender-community-switch-4288: ' + (fails.length ? fails.length + ' failed' : 'all good'));
  process.exit(fails.length ? 1 : 0);
}

run().catch((e) => { console.error('FAIL  render-community-switch-4288 threw: ' + (e && e.message || e)); process.exit(1); });
