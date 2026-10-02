'use strict';

/*
 * #4525: "Waiting for you" in the Community box under Settings > Automation: every post or comment
 * an agent wrote that is held for the person, with Release and Discard. Before this list nothing in
 * the product called the release route, so held-by-default was held-forever and no agent could climb
 * the trust ladder.
 *
 * REAL      unmocked, against this check's own board: two held agent posts are seeded into the
 *           board's store. Pressing Release publishes the first AND records the approval on the
 *           agent's trust ladder (read back from the store, not from the page); Discard it removes
 *           the second. This is the arm that is red on main (no list to press).
 * The rest answer /api/community/moderation (and release/discard) at the browser:
 *   ROWS      a held post, a quarantined post, a comment on a local post and a comment on a post in
 *             the public community: the quarantined row says why and has no Release, the service
 *             comment links to its post, a long post offers Read all. Light and dark screenshots.
 *   DISCARD   Discard asks inside the row, Keep it takes focus and sends nothing, Discard it POSTs
 *             exactly {id}.
 *   FAIL      a refused release shows the board's message and leaves the buttons usable.
 *   EMPTY/403 an empty queue says nothing is waiting; a gated read says it could not read, never
 *             "nothing is waiting".
 *
 * 🛑 The REAL arm releases a post for real, and a board's send sweep forwards released posts to the
 * public community. So it runs only on a sandboxed board (AGENT_WORKFORCE_DATA under the temp dir),
 * which tools/browser-checks.sh boots with the sweep pointed at a dead address, and it turns the
 * community switch off before it seeds anything (a post released while the switch is off is never sent).
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 AGENT_WORKFORCE_DATA=<sandbox>/data \
 *     node docs/browser-checks/render-community-held-4525.js http://127.0.0.1:PORT
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const BASE = process.argv[2] || process.env.KOSMOS_URL || 'http://127.0.0.1:17461';
const SHOTS = process.env.SHOT_DIR || '';
const MOD = '**/api/community/moderation*';
const RELEASE = '**/api/community/release';
const DISCARD = '**/api/community/discard';
const SWITCH = '**/api/community-setting';
const SWITCH_ON = { on: true, ok: true, share: null };   // #4820: the board's answer has no noticeSeen now

const fails = [];
function check(name, pass, detail) {
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : ''));
  if (!pass) fails.push(name);
}

function sandboxed() {
  const d = process.env.AGENT_WORKFORCE_DATA;
  if (!d || !fs.existsSync(d)) return false;
  const real = fs.realpathSync(d);
  return [os.tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders']
    .some((t) => { try { return real.startsWith(fs.realpathSync(t) + path.sep); } catch { return false; } });
}

async function openAutomation(pg) {
  await pg.goto(BASE, { waitUntil: 'networkidle' });
  // Same first-run guard as render-community-delete-4313: the overlay can paint after networkidle.
  await pg.waitForTimeout(800);
  if (!(await pg.$('#firstrun[hidden]'))) {
    await pg.keyboard.press('Escape');
    await pg.waitForSelector('#firstrun', { state: 'hidden', timeout: 5000 }).catch(() => {});
  }
  await pg.evaluate(() => showTab('settings'));
  await pg.waitForTimeout(400);
  await pg.click('#s-nav button[data-go="automation"]');
  await pg.waitForTimeout(500);
}

function readList(pg) {
  return pg.evaluate(() => {
    const list = document.getElementById('community-held-list');
    const empty = document.getElementById('community-held-empty');
    const head = document.getElementById('community-held-head');
    const sw = document.getElementById('community-row');
    const hb = head && head.getBoundingClientRect();
    const sb = sw && sw.getBoundingClientRect();
    const rows = list ? [...list.querySelectorAll('li')].map((li) => {
      const link = li.querySelector('a.community-held-post');
      return {
        id: li.dataset.id,
        text: li.textContent,
        release: Boolean(li.querySelector('.community-held-release')),
        discard: Boolean(li.querySelector('.community-held-start')),
        why: (li.querySelector('.community-held-why') || {}).textContent || '',
        link: link ? link.href : '',
        more: Boolean(li.querySelector('.community-held-more')),
        reveal: Boolean(li.querySelector('.community-held-reveal')),
        bodyShown: (() => { const b = li.querySelector('.community-held-body'); return Boolean(b && !b.hidden && b.getBoundingClientRect().height > 0); })(),
        ask: Boolean(li.querySelector('.community-held-ask')),
      };
    }) : [];
    const a = document.activeElement;
    return {
      found: Boolean(list && empty && head),
      headShown: Boolean(hb && hb.width > 0 && hb.height > 0),
      belowSwitch: Boolean(hb && sb && sb.height > 0 && hb.top > sb.bottom),
      listHidden: list ? list.hidden : null,
      emptyHidden: empty ? empty.hidden : null,
      empty: empty ? empty.textContent : '',
      offNote: (() => { const o = document.getElementById('community-held-off'); return Boolean(o && !o.hidden); })(),
      rows,
      focus: a ? [a.id, a.className, a.tagName, a.textContent.trim().slice(0, 40)].join('|') : '',
    };
  });
}

/* The fake moderation route behaves as the real one does (communitystore.moderationQueue): only the
   asked status, oldest first by receivedAt, cut at the asked limit. Without the order and the cut a
   crowded queue could never push a row out of sight here, and the crowding arm below would pass on
   a page that has the bug. */
const mod = (queue) => (route) => {
  const q = new URL(route.request().url()).searchParams;
  const status = q.get('status');
  const limit = Number(q.get('limit')) || 100;
  const rows = queue.filter((r) => !status || r.status === status)
    .sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt))).slice(0, limit);
  return answer({ queue: rows })(route);
};
const answer = (body, status = 200) => (route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const LONG = 'Today I moved the weekly report onto the new template.\nIt took three tries.\nThe first failed on dates.\nThe second on totals.\nThe third worked, and I wrote down why so the next run is quicker.';
const REMOTE = '1b2c3d4e-0000-4000-8000-000000000001';
const QUEUE = [
  { id: 'p1', status: 'held', agent: 'Nova', author: { type: 'agent', name: 'Nova' }, topic: 'Moving the weekly report', body: LONG, receivedAt: '2026-09-29T08:00:00Z' },
  // Stopped for what is in its TOPIC: the topic is scanned like the body, so it must not be the row's title.
  { id: 'p2', status: 'quarantined', agent: 'Nova', author: { type: 'agent', name: 'Nova' }, topic: 'Ask lead@example.test', body: 'Write to the team lead.', findings: [{ cls: 'email', field: 'topic', why: 'email address (PII)' }], receivedAt: '2026-09-29T08:01:00Z' },
  { id: 'c1', status: 'held', postId: 'p9', author: { type: 'agent', name: 'Ava' }, body: 'Same here, templates help.', receivedAt: '2026-09-29T08:02:00Z' },
  // remotePostId is #4373 part B's field (its branch, not main): this row is that branch's shape.
  { id: 'c2', status: 'held', remotePostId: REMOTE, author: { type: 'agent', name: 'Ava' }, body: 'This worked for me too.', receivedAt: '2026-09-29T08:03:00Z' },
  // A comment under p1, which is itself still waiting: releasing it alone would change nothing anyone can see.
  { id: 'c3', status: 'held', postId: 'p1', author: { type: 'agent', name: 'Ava' }, body: 'Nice write-up.', receivedAt: '2026-09-29T08:04:00Z' },
  // A comment under p2, which the safety check stopped: it can never show, so it can only be discarded.
  { id: 'c4', status: 'held', postId: 'p2', author: { type: 'agent', name: 'Ava' }, body: 'Good question.', receivedAt: '2026-09-29T08:05:00Z' },
  // #4994: a deleted agent's held comment, marked never to send by communitystore.markAgentNotSent.
  { id: 'c6', status: 'held', remotePostId: REMOTE, notSent: true, author: { type: 'agent', name: 'Rex' }, body: 'Left behind.', receivedAt: '2026-09-29T08:06:00Z' },
];

async function shot(pg, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  const box = pg.locator('section.dbox:has(#community-held-head)');
  await box.scrollIntoViewIfNeeded();
  await box.screenshot({ path: path.join(SHOTS, name) });
}

async function run() {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const page = (opts = {}) => browser.newContext({ viewport: { width: 1400, height: 1000 }, ...opts }).then((c) => c.newPage());
  try {
    // REAL
    if (!sandboxed()) {
      check('REAL: runs only on a sandboxed board (AGENT_WORKFORCE_DATA under the temp dir)', false, String(process.env.AGENT_WORKFORCE_DATA));
    } else {
      const off = await fetch(BASE + '/api/community-setting', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: false }) });
      const offBody = await off.json().catch(() => null);
      check('REAL: the community switch is off before anything is seeded', off.ok && offBody && offBody.on === false, JSON.stringify(offBody));
      if (off.ok && offBody && offBody.on === false) {
        const communitystore = require('../../engine/communitystore');
        const feedpublish = require('../../engine/feedpublish');
        // #3485 auto-publish (2026-09-30): an agent's clean post now publishes straight away, so
        // these stand for rows held BEFORE that update (they stay held for the person). trusted:
        // false asks the choke for exactly that hold; agentId would now publish them.
        const seed = (topic) => feedpublish.publishPost({ kind: 'community_post', agent: 'nova4525', at: new Date().toISOString(), topic, body: 'What I built today.' }, { trusted: false });
        const a = seed('Release me');
        const b = seed('Discard me');
        check('REAL: two held posts are seeded', a.status === 'held' && b.status === 'held', JSON.stringify([a, b]));
        const before = communitystore.trustRecord('nova4525').approved_count;

        const p0 = await page();
        await openAutomation(p0);
        const r0 = await readList(p0);
        const ids = r0.rows.map((x) => x.id);
        check('REAL: with the switch off, the list says a release now stays on this computer', r0.offNote === true, JSON.stringify(r0.offNote));
        const listed = ids.includes(a.id) && ids.includes(b.id) && r0.rows.every((x) => x.release);
        check('REAL: both held posts are listed, with Release', listed, JSON.stringify(r0.rows));
        if (listed) {
          await p0.click(`li[data-id="${a.id}"] .community-held-release`);
          /* Wait on what is read next, not a fixed delay (a slow runner outlasts a sleep): the row leaves. */
          await p0.waitForSelector(`li[data-id="${a.id}"]`, { state: 'detached', timeout: 10000 }).catch(() => {});
          const released = communitystore.publishedPosts().find((p) => p.id === a.id);
          check('REAL: Release publishes the post', Boolean(released) && released.status === 'published', JSON.stringify(released || null));
          check('REAL: Release records the approval on the agent\'s trust ladder', communitystore.trustRecord('nova4525').approved_count === before + 1,
            before + ' -> ' + communitystore.trustRecord('nova4525').approved_count);
          const r1 = await readList(p0);
          check('REAL: the released post leaves the list and focus goes to the heading', !r1.rows.some((x) => x.id === a.id) && /community-held-head/.test(r1.focus), JSON.stringify(r1));

          await p0.click(`li[data-id="${b.id}"] .community-held-start`);
          await p0.click(`li[data-id="${b.id}"] .community-held-discard`);
          await p0.waitForSelector(`li[data-id="${b.id}"]`, { state: 'detached', timeout: 10000 }).catch(() => {});
          const queue = communitystore.moderationQueue({ limit: 500 }).map((r) => r.id);
          check('REAL: Discard it removes the post and publishes nothing', !queue.includes(b.id) && !communitystore.publishedPosts().some((p) => p.id === b.id), JSON.stringify(queue));
          check('REAL: a discard does not touch the trust ladder', communitystore.trustRecord('nova4525').approved_count === before + 1);
          const r2 = await readList(p0);
          check('REAL: the list is empty again and says so', r2.listHidden === true && r2.emptyHidden === false && r2.empty === 'Nothing is waiting for you.', JSON.stringify(r2));
        } // (on main there is no list, so there is nothing to press: the arm stops red at "listed")
        await p0.close();
      }
    }

    // ROWS, in light and dark
    for (const scheme of ['light', 'dark']) {
      const p1 = await page({ colorScheme: scheme, viewport: { width: 1400, height: 1800 } });   // tall enough that the sticky header never covers the box in the shot
      const asked = [];
      await p1.route(MOD, (route) => { asked.push(route.request().url()); return mod(QUEUE)(route); });
      await p1.route(SWITCH, answer(SWITCH_ON));   // the normal state: the REAL arm left this board's switch off
      await openAutomation(p1);
      const r = await readList(p1);
      const R = (id) => r.rows.find((x) => x.id === id) || {};
      if (scheme === 'light') {
        check('ROWS: the list exists and its heading shows below the Community switch', r.found && r.headShown && r.belowSwitch, JSON.stringify(r));
        check('ROWS: seven rows are listed', r.rows.length === 7, JSON.stringify(r.rows.map((x) => x.id)));
        check('ROWS: the list asks for held and stopped rows separately, each at the route\'s full page (limit=200)',
          asked.length >= 2 && asked.every((u) => /[?&]limit=200\b/.test(u)) && asked.some((u) => /status=held\b/.test(u)) && asked.some((u) => /status=quarantined\b/.test(u)), JSON.stringify(asked));
        check('ROWS: releasable rows come first, the stopped one after them', JSON.stringify(r.rows.map((x) => x.id)) === '["p1","c1","c2","c3","c4","c6","p2"]', JSON.stringify(r.rows.map((x) => x.id)));
        check('ROWS: with the switch on there is no switch-off note', r.offNote === false);
        check('ROWS: a stopped row keeps its words hidden until asked (it may hold a key)', R('p2').bodyShown === false && R('p2').reveal === true && R('p1').bodyShown === true, JSON.stringify(r.rows.map((x) => [x.bodyShown, x.reveal])));
        const leak = await p1.evaluate(() => {
          const li = document.querySelector('li[data-id="p2"]');
          const labels = [...li.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label')).join(' | ');
          return { visible: li.innerText, labels, title: li.querySelector('b').textContent };
        });
        check('ROWS: a stopped post is titled neutrally; its topic (what stopped it) is not on screen or in a button name',
          leak.title === 'A post by Nova' && !/lead@example/.test(leak.visible) && !/lead@example|team lead/.test(leak.labels), JSON.stringify(leak));
        check('ROWS: a comment under a post that is still waiting has no Release and says to release the post first',
          R('c3').release === false && R('c3').discard === true && /release the post first, then this comment/.test(R('c3').text), R('c3').text);
        check('ROWS: a comment under a STOPPED post has no Release and says it can only be discarded',
          R('c4').release === false && R('c4').discard === true && /Its post was stopped by the safety check, so this comment can only be discarded/.test(R('c4').text), R('c4').text);
        check('ROWS: a comment on a PUBLIC post says releasing it sends it there, and when it can be removed after (#4373 part B, #4801 review 2)', /Releasing it while Community is on sends it to the public community\. Once sent, it can be removed from the list below only if the community answered the send\. Released while Community is off, it is never sent\./.test(R('c2').text) && !/Comments are not sent/.test(R('c2').text) && !/cannot be taken back/.test(R('c2').text), JSON.stringify(R('c2').text));
        check('ROWS: a deleted agent\'s held comment (#4994) says releasing it never sends it, and does not promise the community', /Its agent was deleted, so releasing it never sends it to the public community\./.test(R('c6').text) && !/sends it to the public community\. Once sent/.test(R('c6').text), JSON.stringify(R('c6').text));
        check('ROWS: a comment row does not promise the community', /Comments are not sent to the community yet\./.test(R('c1').text) && !/Comments are not sent/.test(R('p1').text), JSON.stringify([R('p1').text, R('c1').text]));
        const labels = await p1.$$eval('.community-held-release', (bs) => bs.map((b) => b.getAttribute('aria-label')));
        check('ROWS: every Release names its row, comments included', new Set(labels).size === labels.length && labels.some((l) => /A comment by Ava/.test(l)), JSON.stringify(labels));
        check('ROWS: Release shows on the held rows and not on the stopped one', JSON.stringify(r.rows.map((x) => [x.id, x.release])) === '[["p1",true],["c1",true],["c2",true],["c3",false],["c4",false],["c6",true],["p2",false]]', JSON.stringify(r.rows));
        check('ROWS: every row can be discarded', r.rows.every((x) => x.discard), JSON.stringify(r.rows));
        check('ROWS: the stopped row says why in words, and that it cannot be released',
          /contains an email address, so it cannot be released\./.test(R('p2').why) && !/email address \(PII\)/.test(R('p2').text), R('p2').why);
        check('ROWS: each row shows its words and its agent', /Moving the weekly report/.test(R('p1').text) && /Nova/.test(R('p1').text) && /Same here, templates help\./.test(R('c1').text) && /Ava/.test(R('c1').text), JSON.stringify(r.rows.map((x) => x.text)));
        check('ROWS: a comment on a post in the public community links to that post (#4373 part B shape)', R('c2').link === 'https://community.kosmosplus.com/post/' + REMOTE && R('c1').link === '', JSON.stringify([R('c1').link, R('c2').link]));
        check('ROWS: a long post offers Read all; a short one does not', R('p1').more === true && R('c1').more === false, JSON.stringify(r.rows.map((x) => x.more)));
        await p1.click('li[data-id="p1"] .community-held-more');
        const open = await p1.evaluate(() => document.querySelector('li[data-id="p1"] .community-held-body').classList.contains('open'));
        check('ROWS: Read all opens the whole post', open === true);
        await p1.click('li[data-id="p1"] .community-held-more');
        await p1.click('li[data-id="p2"] .community-held-reveal');
        const shown = ((await readList(p1)).rows.find((x) => x.id === 'p2') || {}).bodyShown;
        const said = await p1.evaluate(() => document.querySelector('li[data-id="p2"] .community-held-body').innerText);
        check('ROWS: Show what it said reveals a stopped row\'s words, its topic included', shown === true && /Ask lead@example\.test/.test(said) && /Write to the team lead\./.test(said), said);
        await p1.click('li[data-id="p2"] .community-held-reveal');
      }
      await shot(p1, 'community-held-4525-' + scheme + '.png');
      await p1.close();
    }

    // DISCARD (mocked)
    const p2 = await page();
    const sent = [];
    await p2.route(MOD, mod(QUEUE.slice(0, 1)));
    await p2.route(DISCARD, (route) => { sent.push(route.request().postData()); return answer({ discarded: { id: 'p1' } })(route); });
    await openAutomation(p2);
    await p2.click('li[data-id="p1"] .community-held-start');
    await p2.waitForSelector('li[data-id="p1"] .community-held-ask', { timeout: 5000 }).catch(() => {});
    const k = await readList(p2);
    check('DISCARD: Discard asks inside the row, and Keep it takes focus', k.rows[0].ask === true && /community-held-keep/.test(k.focus), JSON.stringify(k));
    await p2.click('li[data-id="p1"] .community-held-keep');
    await p2.waitForSelector('li[data-id="p1"] .community-held-ask', { state: 'detached', timeout: 5000 }).catch(() => {});
    const kp = await readList(p2);
    check('DISCARD: Keep it closes the ask, sends nothing and puts focus back on Discard', kp.rows[0].ask === false && /community-held-start/.test(kp.focus) && sent.length === 0, JSON.stringify([kp, sent]));
    await p2.click('li[data-id="p1"] .community-held-start');
    await p2.click('li[data-id="p1"] .community-held-discard');
    await p2.waitForFunction(() => !document.querySelector('li[data-id="p1"] .community-held-ask'), null, { timeout: 5000 }).catch(() => {});
    check('DISCARD: Discard it POSTs exactly {id}', sent.length === 1 && sent[0] === JSON.stringify({ id: 'p1' }), JSON.stringify(sent));
    await p2.close();

    // FAIL
    const p3 = await page();
    await p3.route(MOD, mod(QUEUE.slice(0, 1)));
    await p3.route(RELEASE, answer({ error: 'only a held post can be released' }, 400));
    await openAutomation(p3);
    await p3.click('li[data-id="p1"] .community-held-release');
    await p3.waitForFunction(() => { const n = document.querySelector('li[data-id="p1"] .community-held-note'); return n && !n.hidden && n.textContent !== 'Releasing…'; }, null, { timeout: 5000 }).catch(() => {});
    const f = await p3.evaluate(() => {
      const li = document.querySelector('li[data-id="p1"]');
      const note = li && li.querySelector('.community-held-note');
      return {
        msg: note && !note.hidden ? note.textContent : '',
        disabled: li ? [...li.querySelectorAll('.community-held-acts button')].map((b) => b.disabled) : null,
      };
    });
    check('FAIL: the board\'s message shows in the row and the buttons are usable again', f.msg === 'only a held post can be released' && JSON.stringify(f.disabled) === '[false,false]', JSON.stringify(f));
    await p3.close();

    // FULL: a full page (the route's ceiling) says there may be more, rather than implying this is all.
    const pf = await page();
    await pf.route(MOD, mod(Array.from({ length: 200 }, (_, i) => ({ ...QUEUE[2], id: 'f' + i }))));
    await openAutomation(pf);
    const fl = await readList(pf);
    check('FULL: 200 rows say they are the oldest and there may be more', fl.rows.length === 200 && fl.emptyHidden === false && /Only the oldest 200 waiting are shown\. There may be more/.test(fl.empty), fl.empty);
    await pf.close();

    // FULL-STOPPED: 200 OLDER stopped rows cannot push a newer releasable post out of sight (it is listed first).
    const pq = await page();
    await pq.route(MOD, mod([{ ...QUEUE[0], receivedAt: '2026-09-29T12:00:00Z' },
      ...Array.from({ length: 200 }, (_, i) => ({ ...QUEUE[1], id: 'q' + i, receivedAt: '2026-09-29T08:' + String(i % 60).padStart(2, '0') + ':' + String(Math.floor(i / 60)).padStart(2, '0') + 'Z' }))]));
    await openAutomation(pq);
    const fq = await readList(pq);
    check('FULL-STOPPED: 200 stopped rows do not hide a releasable post, which comes first', fq.rows.length === 201 && fq.rows[0].id === 'p1' && fq.rows[0].release === true && /Only the oldest 200 stopped are shown\. There may be more/.test(fq.empty), JSON.stringify([fq.rows.length, fq.rows[0] && fq.rows[0].id, fq.empty]));
    await pq.close();

    // ENTRY: a comment the queue labels as one (entry: 'comment') with no postId (as #4373 part B's rows may be)
    // is still a comment: titled so, with the comment's line, never "Untitled post".
    const pe = await page();
    await pe.route(MOD, mod([{ id: 'x1', status: 'held', entry: 'comment', author: { type: 'agent', name: 'Ava' }, body: 'On a post elsewhere.', receivedAt: '2026-09-29T08:00:00Z' }]));
    await openAutomation(pe);
    const en = await readList(pe);
    check('ENTRY: a row the queue calls a comment is shown as one, whatever its routing fields', en.rows.length === 1 && /^A comment by Ava/.test(en.rows[0].text) && /Comments are not sent to the community yet/.test(en.rows[0].text) && !/Untitled post/.test(en.rows[0].text), JSON.stringify(en.rows));
    await pe.close();

    // SERVER-FAIL: a 5xx release may have landed partway, so the page says so and repaints instead of offering a retry.
    const ps = await page();
    let gone = false;
    await ps.route(MOD, (route) => mod(gone ? [] : QUEUE.slice(0, 1))(route));
    await ps.route(RELEASE, (route) => { gone = true; return answer({ error: 'we could not save that just now; try again' }, 500)(route); });
    await openAutomation(ps);
    await ps.click('li[data-id="p1"] .community-held-release');
    await ps.waitForSelector('li[data-id="p1"]', { state: 'detached', timeout: 5000 }).catch(() => {});
    const sf = await ps.evaluate(() => ({ msg: document.getElementById('community-msg').textContent, rows: document.querySelectorAll('#community-held-list li').length }));
    check('SERVER-FAIL: a 5xx says so in words and the list is repainted from the board (no retry offered)', /could not save that just now/.test(sf.msg) && /shows where it stands now/.test(sf.msg) && sf.rows === 0, JSON.stringify(sf));
    await ps.close();

    // EMPTY
    const p4 = await page();
    await p4.route(MOD, mod([]));
    await openAutomation(p4);
    const e = await readList(p4);
    check('EMPTY: the list is hidden and the line says nothing is waiting', e.listHidden === true && e.emptyHidden === false && e.empty === 'Nothing is waiting for you.', JSON.stringify(e));
    await p4.close();

    // 403
    const p5 = await page();
    await p5.route(MOD, answer({ error: 'this board belongs to the account that started it' }, 403));
    await openAutomation(p5);
    const g = await readList(p5);
    check('403: the line says it could not read, never "nothing is waiting"', g.listHidden === true && /could not read/.test(g.empty) && !/Nothing is waiting/.test(g.empty), JSON.stringify(g));
    await p5.close();
  } finally {
    await browser.close();
  }
  if (fails.length) { console.log('\n' + fails.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
}

run().catch((e) => { console.error(e); process.exit(1); });
