'use strict';

/*
 * #4313: your agents' posts in the community, each with Delete, in the Community box under
 * Settings > Automation (below #4288's switch). #4801: and their comments, in the same list.
 *
 * /api/community/mine and /api/community/delete are both answered at the browser (page.route),
 * so this check writes nothing to the board and each arm sees exactly the state it names:
 *   EMPTY     no posts: the list is hidden and the empty line says none have gone out.
 *   ROWS      nine rows: each says its state in words, and
 *             Delete shows on ONLY the sent, unconfirmed and pending ones.
 *   ASK       pressing Delete asks inside the row, Keep it takes focus, and nothing is sent yet.
 *   KEEP      Keep it closes the ask, sends nothing, and puts focus back on Delete.
 *   DELETE    Delete it POSTs exactly {id}, then repaints from the board: the row says it is
 *             coming down and Delete is gone.
 *   REOPEN    once the sweep lands the delete, opening Automation again repaints it as deleted.
 *   FAIL      a refused delete shows the board's message and leaves both buttons usable.
 *   403       a gated read says it could not read the posts, never "none have gone out".
 *   COMMENT   (#4801) comments list among the posts, newest first, each reading as a comment and saying where
 *             (a link to the post it is on) and when; Delete shows where the board says canDelete and nowhere
 *             else; Delete asks with Keep it focused; Delete it POSTs exactly {id} with the comment's id, the
 *             row repaints as coming down and focus goes to the heading; an unconfirmed comment, one sent with
 *             no id, one being sent and one whose registration could not be read show no Delete and say why;
 *             a removed one says removed; review 4: one whose registration cannot be told says so. Review 2: the date has the year only when it is not this year;
 *             a post id that is not a plain id, or none, gets no link; the link's accessible name names the comment.
 *   REFUSED   (#4801 review 4) a delete the board refuses as not eligible (400) shows its message on the row AND
 *             repaints the list from /mine, so a row whose state moved under the ask says its true state and loses
 *             a Delete that cannot land. A 500 (FAIL above) keeps the ask, so the repaint is the 400's alone.
 *   UNREAD    (#4801 review 2) comments: null (the board could not read its comment records) paints one line
 *             saying so in place of comment rows, posts still listed, and never the "none" line on that basis.
 * The ROWS arm is also the control for the others: it proves the list is found and painted.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
 *     node docs/browser-checks/render-community-delete-4313.js http://127.0.0.1:PORT
 */

const { chromium } = require('playwright');

const BASE = process.argv[2] || process.env.KOSMOS_URL || 'http://127.0.0.1:17461';
const MINE = '**/api/community/mine';
const DELETE = '**/api/community/delete';

const fails = [];
function check(name, pass, detail) {
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : ''));
  if (!pass) fails.push(name);
}

async function openAutomation(pg) {
  await pg.goto(BASE, { waitUntil: 'networkidle' });
  /* The first-run overlay can paint after networkidle on a fresh board, and a check that
     reads it too early clicks into it (seen 04:00 and 06:25 when this check ran first on a
     new board). Wait, then Escape it, and wait until it is actually hidden. */
  await pg.waitForTimeout(800);
  if (!(await pg.$('#firstrun[hidden]'))) {
    await pg.keyboard.press('Escape');
    await pg.waitForSelector('#firstrun', { state: 'hidden', timeout: 5000 }).catch(() => {});
  }
  await pg.evaluate(() => showTab('settings'));
  await pg.waitForTimeout(400);
  await pg.click('#s-nav button[data-go="automation"]');
  await pg.waitForTimeout(400);
}

function readList(pg) {
  return pg.evaluate(() => {
    const list = document.getElementById('community-mine-list');
    const empty = document.getElementById('community-mine-empty');
    const head = document.getElementById('community-mine-head');
    const sw = document.getElementById('community-row');
    const hb = head && head.getBoundingClientRect();
    const sb = sw && sw.getBoundingClientRect();
    const rows = list ? [...list.querySelectorAll('li')].map((li) => ({
      id: li.dataset.id,
      text: li.textContent,
      del: Boolean(li.querySelector('.community-mine-start:not([hidden])')),
      ask: Boolean(li.querySelector('.community-mine-ask')),
    })) : [];
    const a = document.activeElement;
    return {
      found: Boolean(list && empty && head),
      headShown: Boolean(hb && hb.width > 0 && hb.height > 0),
      belowSwitch: Boolean(hb && sb && sb.height > 0 && hb.top > sb.bottom),
      listHidden: list ? list.hidden : null,
      emptyHidden: empty ? empty.hidden : null,
      empty: empty ? empty.textContent : '',
      unreadHidden: (() => { const u = document.getElementById('community-mine-comments-unread'); return u ? u.hidden : null; })(),
      unread: (() => { const u = document.getElementById('community-mine-comments-unread'); return u ? u.textContent : ''; })(),
      rows,
      focus: a ? (a.className || a.id || a.tagName) + '|' + a.textContent : '',
    };
  });
}

const answer = (body, status = 200) => (route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const row = (id, over) => ({ id, title: 'Post ' + id, agent: 'Ava', postedAt: '2026-09-28T08:00:00Z', state: 'sent', deleteRequested: false, takenDown: false, takeDownReason: null, agentRefused: false, deleteRetrying: false, canDelete: true, ...over });
// #4801: communitymine.mineComments()'s row shape.
const CPOST = '7d1b0d2e-5a0e-4f6a-9c1e-2b3c4d5e6f70';   // the community post the comments are on
const crow = (id, over) => ({ id, kind: 'comment', text: 'Reply ' + id, agent: 'Bo', postedAt: '2026-09-28T09:00:00Z', remotePostId: CPOST, state: 'sent', deleteRequested: false, deleteRetrying: false, agentRefused: false, untraceable: false, untraceableReason: null, traceUnknown: false, canDelete: true, ...over });

async function run() {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const page = () => browser.newPage({ viewport: { width: 1400, height: 1000 } });
  try {
    // EMPTY
    const p1 = await page();
    await p1.route(MINE, answer({ posts: [], comments: [] }));
    await openAutomation(p1);
    const e = await readList(p1);
    check('EMPTY: the list exists and its heading shows under Automation', e.found && e.headShown, JSON.stringify(e));
    check('EMPTY: the heading sits below the Community switch', e.belowSwitch, JSON.stringify(e));
    check('EMPTY: the list is hidden and the empty line says none have gone out', e.listHidden === true && e.emptyHidden === false && /have gone to the community yet\.$/.test(e.empty), JSON.stringify(e));
    check('EMPTY: comments read as a list, so the could-not-read-comments line stays hidden', e.unreadHidden === true, JSON.stringify(e));
    await p1.close();

    // ROWS + ASK + KEEP + DELETE, on one page so the repaint after a delete is observed.
    const p2 = await page();
    let deleted = false;
    let landed = false;
    const posts = [];
    await p2.route(MINE, (route) => answer({ posts: [
      landed ? row('a1', { state: 'deleted', deleteRequested: true, canDelete: false })
        : deleted ? row('a1', { deleteRequested: true, canDelete: false }) : row('a1'),
      row('b2', { state: 'deleted', deleteRequested: true, canDelete: false }),   // the sweep's real shape
      row('c3', { takenDown: true, takeDownReason: 'off topic', canDelete: false }),
      row('d4', { state: 'unconfirmed' }),
      row('e5', { deleteRequested: true, deleteRetrying: true, canDelete: false }),
      row('f6', { agentRefused: true, canDelete: false }),
      row('g7', { agentRefused: true, deleteRequested: true, canDelete: false }),   // refused after the owner asked
      row('h8', { state: 'pending' }),   // waiting for a retry (429 / 401): not out yet, Delete withholds it
      row('i9', { state: 'pending', agentRefused: true, canDelete: false }),   // never goes out
    ], comments: [] })(route));
    await p2.route(DELETE, (route) => { posts.push(route.request().postData()); deleted = true; return answer({ ok: true, state: 'sent' })(route); });
    await openAutomation(p2);
    const r = await readList(p2);
    check('ROWS: nine posts are listed', r.rows.length === 9, JSON.stringify(r.rows));
    check('ROWS: Delete shows on ONLY the posts still out or about to go (sent, unconfirmed, pending)', JSON.stringify(r.rows.map((x) => x.del)) === '[true,false,false,true,false,false,false,true,false]', JSON.stringify(r.rows));
    check('ROWS: each row says its state in words', /In the community/.test(r.rows[0].text) && /Deleted from the community/.test(r.rows[1].text) && /Taken down by a moderator: off topic/.test(r.rows[2].text)
      && /Sent, not confirmed yet/.test(r.rows[3].text) && /tries again every few minutes/.test(r.rows[4].text)
      && /refused this agent/.test(r.rows[5].text)
      && /refused this agent/.test(r.rows[6].text) && !/Deleting/.test(r.rows[6].text)
      && /Not sent yet/.test(r.rows[7].text)
      && /Not sent\. The community refused this agent/.test(r.rows[8].text) && !/In the community/.test(r.rows[8].text), JSON.stringify(r.rows.map((x) => x.text)));

    await p2.click('li[data-id="a1"] .community-mine-start');
    await p2.waitForTimeout(200);
    const k = await readList(p2);
    check('ASK: Delete asks inside the row', k.rows[0].ask === true, JSON.stringify(k.rows[0]));
    check('ASK: Keep it takes focus (an unaimed Enter is harmless)', /community-mine-keep/.test(k.focus), k.focus);
    check('ASK: nothing is sent before Delete it', posts.length === 0, String(posts.length));

    await p2.click('li[data-id="a1"] .community-mine-keep');
    await p2.waitForTimeout(200);
    const kp = await readList(p2);
    check('KEEP: the ask closes and Delete is back', kp.rows[0].ask === false && kp.rows[0].del === true, JSON.stringify(kp.rows[0]));
    check('KEEP: focus returns to Delete', /community-mine-start/.test(kp.focus), kp.focus);
    check('KEEP: nothing was sent', posts.length === 0, String(posts.length));

    await p2.click('li[data-id="a1"] .community-mine-start');
    await p2.click('li[data-id="a1"] .community-mine-del');
    await p2.waitForTimeout(500);
    const d = await readList(p2);
    check('DELETE: exactly one POST, carrying only the post id', posts.length === 1 && posts[0] === JSON.stringify({ id: 'a1' }), JSON.stringify(posts));
    check('DELETE: the row repaints as coming down, with no Delete', /Deleting\. It comes down/.test(d.rows[0].text) && d.rows[0].del === false && d.rows[0].ask === false, JSON.stringify(d.rows[0]));

    // REOPEN: the sweep lands the delete on its own clock. Leaving Automation and coming back
    // repaints from the board, so the row does not say "Deleting" forever.
    landed = true;
    await p2.click('#s-nav button[data-go="you"]');
    await p2.waitForTimeout(200);
    await p2.click('#s-nav button[data-go="automation"]');
    await p2.waitForTimeout(500);
    const ro = await readList(p2);
    check('REOPEN: opening Automation again repaints the row as deleted', /Deleted from the community/.test(ro.rows[0].text) && !/Deleting/.test(ro.rows[0].text), JSON.stringify(ro.rows[0]));
    await p2.close();

    // FAIL
    const p3 = await page();
    await p3.route(MINE, answer({ posts: [row('a1')], comments: [] }));
    await p3.route(DELETE, answer({ error: 'we could not save that' }, 500));
    await openAutomation(p3);
    await p3.click('li[data-id="a1"] .community-mine-start');
    await p3.click('li[data-id="a1"] .community-mine-del');
    await p3.waitForTimeout(400);
    const f = await p3.evaluate(() => {
      const ask = document.querySelector('li[data-id="a1"] .community-mine-ask');
      return {
        ask: Boolean(ask),
        msg: ask ? ask.querySelector('[role="alert"]').textContent : '',
        delDisabled: ask ? ask.querySelector('.community-mine-del').disabled : null,
        keepDisabled: ask ? ask.querySelector('.community-mine-keep').disabled : null,
      };
    });
    check('FAIL: the board’s message shows in the row', f.ask && f.msg === 'we could not save that', JSON.stringify(f));
    check('FAIL: both buttons are usable again', f.delDisabled === false && f.keepDisabled === false, JSON.stringify(f));
    await p3.close();

    // 403
    const p4 = await page();
    await p4.route(MINE, answer({ error: 'this board belongs to the account that started it' }, 403));
    await openAutomation(p4);
    const g = await readList(p4);
    check('403: the list is hidden and the line says it could not read, never "none"', g.listHidden === true && /could not read/.test(g.empty) && !/have gone to the community yet/.test(g.empty), JSON.stringify(g));
    await p4.close();

    // COMMENT (#4801)
    const p5 = await page();
    /* Review 2 NIT a: c1 is dated THIS year (from this machine's clock, which the browser shares), so its date must
       read without the year; c8 is from 2019, so its date must read with it. Both sort as the arm expects. */
    const C1_AT = new Date().getFullYear() + '-09-28T10:00:00Z';
    let cdeleted = false;
    const cposts = [];
    await p5.route(MINE, (route) => answer({
      posts: [row('a1', { postedAt: '2026-09-28T08:00:00Z' })],
      comments: [
        cdeleted ? crow('c1', { deleteRequested: true, canDelete: false }) : crow('c1', { postedAt: C1_AT }),
        crow('c2', { state: 'unconfirmed', untraceable: true, canDelete: false, postedAt: '2026-09-28T07:00:00Z' }),
        crow('c3', { untraceable: true, untraceableReason: 'no-id', canDelete: false, postedAt: '2026-09-28T06:00:00Z' }),   // sent, the service gave no id
        crow('c4', { state: 'deleted', deleteRequested: true, canDelete: false, postedAt: '2026-09-28T05:00:00Z' }),
        crow('c5', { state: 'pending', postedAt: '2026-09-28T04:00:00Z' }),
        crow('c6', { state: 'sending', canDelete: false, postedAt: '2026-09-28T03:00:00Z' }),   // its POST is out now
        crow('c7', { traceUnknown: true, canDelete: false, postedAt: '2026-09-28T02:00:00Z' }),  // keys.json unreadable
        crow('c9', { remotePostId: 'not/a plain id', postedAt: '2026-09-28T01:00:00Z' }),   // review 2 NIT b: no link
        crow('c10', { remotePostId: null, postedAt: '2026-09-28T00:30:00Z' }),               // review 2 NIT b: no link
        // review 3: sent by a registration the board no longer holds.
        crow('c11', { untraceable: true, untraceableReason: 'other-registration', canDelete: false, postedAt: '2026-09-28T00:10:00Z' }),
        // review 4: no agentId, sent in the sweep that registered: whether the held registration sent it cannot be told.
        crow('c12', { untraceable: true, untraceableReason: 'registration-unknown', canDelete: false, postedAt: '2026-09-28T00:05:00Z' }),
        crow('c8', { postedAt: '2019-09-28T10:00:00Z' }),   // review 2 NIT a: another year, so the date says the year
      ],
    })(route));
    await p5.route(DELETE, (route) => { cposts.push(route.request().postData()); cdeleted = true; return answer({ ok: true, state: 'sent' })(route); });
    await openAutomation(p5);
    const c = await readList(p5);
    const ids = c.rows.map((x) => x.id).join(',');
    check('COMMENT: comments list with the posts, newest first', ids === 'c1,a1,c2,c3,c4,c5,c6,c7,c9,c10,c11,c12,c8', ids);
    const byId = Object.fromEntries(c.rows.map((x) => [x.id, x]));
    check('COMMENT: a comment row reads as a comment, with its text and agent', byId.c1 && /^Comment: Reply c1/.test(byId.c1.text) && /Bo/.test(byId.c1.text) && /In the community/.test(byId.c1.text), JSON.stringify(byId.c1));
    check('COMMENT: Delete shows where the board says canDelete, and nowhere else', JSON.stringify(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'].map((i) => byId[i] && byId[i].del)) === '[true,false,false,false,true,false,false]', JSON.stringify(c.rows));
    check('COMMENT: a comment being sent says Sending', byId.c6 && /Sending\. Kosmos is sending it/.test(byId.c6.text), JSON.stringify(byId.c6));
    check('COMMENT: unreadable registrations say so, never "no way to find"', byId.c7 && /could not read its community registrations just now/.test(byId.c7.text) && !/no way to find/.test(byId.c7.text), JSON.stringify(byId.c7));
    // WHERE and WHEN (review 1): a link out to the post it is on, built as the #4525 held list builds it, and the date.
    const where = await p5.evaluate((c1At) => {
      const li = document.querySelector('li[data-id="c1"]');
      const a = li && li.querySelector('a.community-mine-post');
      const t = li && li.querySelector('time.community-mine-when');
      const old = document.querySelector('li[data-id="c8"] time.community-mine-when');
      const fmt = (at, y) => new Date(at).toLocaleDateString(undefined, y ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' });
      const linkOf = (id) => { const x = document.querySelector('li[data-id="' + id + '"]'); return x ? x.querySelectorAll('a.community-mine-post').length : -1; };
      return { href: a ? a.href : '', target: a ? a.target : '', rel: a ? a.rel : '', text: a ? a.textContent : '', label: a ? a.getAttribute('aria-label') : '',
        dt: t ? t.dateTime : '', day: t ? t.textContent : '', expectThisYear: fmt(c1At, false), expectWithYear: fmt(c1At, true),
        oldDay: old ? old.textContent : '', expectOld: fmt('2019-09-28T10:00:00Z', true), expectOldNoYear: fmt('2019-09-28T10:00:00Z', false),
        links: { c9: linkOf('c9'), c10: linkOf('c10'), c8: linkOf('c8') } };
    }, C1_AT);
    check('COMMENT: the row links to the post it is on, out of the board', where.href === 'https://community.installkosmos.com/post/' + CPOST && where.target === '_blank' && /noopener/.test(where.rel) && where.text === 'on a community post', JSON.stringify(where));
    check('COMMENT: the post link\'s accessible name names the comment (review 2 NIT c)', where.label === 'The post this comment is on: Reply c1', JSON.stringify(where));
    check('COMMENT: a post id that is not a plain id, or none, gets no link; a plain one does (review 2 NIT b)', where.links.c9 === 0 && where.links.c10 === 0 && where.links.c8 === 1, JSON.stringify(where.links));
    // The two formats must differ, or the year checks below could not tell them apart.
    check('COMMENT: CONTROL: the this-year and with-year formats differ', where.expectThisYear !== where.expectWithYear && where.expectOld !== where.expectOldNoYear, JSON.stringify(where));
    check('COMMENT: the row says when, without the year when it is this year (review 2 NIT a)', where.dt === C1_AT && where.day === where.expectThisYear, JSON.stringify(where));
    check('COMMENT: a comment from another year says the year (review 2 NIT a)', where.oldDay === where.expectOld, JSON.stringify(where));
    check('COMMENT: an unconfirmed comment says why it cannot be removed', byId.c2 && /never learned whether this arrived, so it cannot remove it/.test(byId.c2.text), JSON.stringify(byId.c2));
    check('COMMENT: a comment sent with no id says why it cannot be removed', byId.c3 && /no way to find this comment again, so it cannot remove it/.test(byId.c3.text), JSON.stringify(byId.c3));
    check('COMMENT: a comment from a registration the board no longer holds says so (review 3)', byId.c11 && byId.c11.del === false && /no longer holds the registration that sent it, so it cannot remove it/.test(byId.c11.text) && !/no way to find/.test(byId.c11.text), JSON.stringify(byId.c11));
    check('COMMENT: a comment whose registration cannot be told says so, never "no longer holds" (review 4)', byId.c12 && byId.c12.del === false && /cannot tell whether the registration it holds sent this comment, so it cannot remove it/.test(byId.c12.text) && !/no longer holds/.test(byId.c12.text) && !/no way to find/.test(byId.c12.text), JSON.stringify(byId.c12));
    check('COMMENT: a pending comment says Not sent yet, with no promise of when (review 3)', byId.c5 && /Not sent yet\./.test(byId.c5.text) && !/tries again/.test(byId.c5.text), JSON.stringify(byId.c5));
    // Review 3: the ask for a PENDING comment says it will not be sent, never that it comes down from the community.
    await p5.click('li[data-id="c5"] .community-mine-start');
    await p5.waitForTimeout(200);
    const pk = await p5.evaluate(() => { const ask = document.querySelector('li[data-id="c5"] .community-mine-ask'); return ask ? ask.querySelector('p').textContent : ''; });
    check('COMMENT: the ask for a pending comment says it will not be sent (review 3)', pk === 'It will not be sent. It cannot be undone.', pk);
    await p5.click('li[data-id="c5"] .community-mine-keep');
    await p5.waitForTimeout(100);
    check('COMMENT: a removed comment says removed', byId.c4 && /Removed from the community/.test(byId.c4.text), JSON.stringify(byId.c4));
    await p5.click('li[data-id="c1"] .community-mine-start');
    await p5.waitForTimeout(200);
    const ck = await p5.evaluate(() => {
      const ask = document.querySelector('li[data-id="c1"] .community-mine-ask');
      return { ask: Boolean(ask), say: ask ? ask.querySelector('p').textContent : '', keep: ask ? ask.querySelector('.community-mine-keep').textContent : '', del: ask ? ask.querySelector('.community-mine-del').textContent : '' };
    });
    check('COMMENT: Delete asks inside the row with Delete it and Keep it', ck.ask && ck.keep === 'Keep it' && ck.del === 'Delete it', JSON.stringify(ck));
    const cf = await readList(p5);
    check('COMMENT: Keep it takes focus (an unaimed Enter is harmless)', /community-mine-keep/.test(cf.focus), cf.focus);
    check('COMMENT: the ask does not say a comment stays on this board', /within a few minutes\. It cannot be undone\.$/.test(ck.say) && !/stays on this board/.test(ck.say), ck.say);
    check('COMMENT: nothing is sent before Delete it', cposts.length === 0, String(cposts.length));
    await p5.click('li[data-id="c1"] .community-mine-del');
    await p5.waitForTimeout(500);
    const cd = await readList(p5);
    const c1 = cd.rows.find((x) => x.id === 'c1');
    check('COMMENT: exactly one POST, carrying only the comment id', cposts.length === 1 && cposts[0] === JSON.stringify({ id: 'c1' }), JSON.stringify(cposts));
    check('COMMENT: the row repaints as coming down, with no Delete', Boolean(c1) && /Removing\. It comes down/.test(c1.text) && c1.del === false && c1.ask === false, JSON.stringify(c1));
    const hf = await p5.evaluate(() => (document.activeElement ? document.activeElement.id : ''));
    check('COMMENT: after Delete it, focus goes to the list heading', hf === 'community-mine-head', hf);
    await p5.close();

    // REFUSED (#4801 review 4): the sweep settled c1 between paint and click; the board answers 400, and the list
    // repaints from /mine, so the row says its true state and the stale Delete is gone. The message stays on the row.
    const p8 = await page();
    // The page reads /mine more than once while it opens, so the row's state flips on the refusal, not on a read count.
    let mineReads = 0;
    let refused = false;
    let readsAtRefusal = -1;
    await p8.route(MINE, (route) => { mineReads++; return answer({ posts: [], comments: [
      refused ? crow('c1', { untraceable: true, untraceableReason: 'registration-unknown', canDelete: false }) : crow('c1'),
    ] })(route); });
    const REFUSAL = 'Kosmos cannot tell whether the registration it holds sent this comment, so it cannot remove it';
    await p8.route(DELETE, (route) => { refused = true; readsAtRefusal = mineReads; return answer({ error: REFUSAL }, 400)(route); });
    await openAutomation(p8);
    const before8 = await readList(p8);
    check('REFUSED: CONTROL: the row offers Delete before the click', before8.rows.length === 1 && before8.rows[0].del === true, JSON.stringify(before8.rows));
    await p8.click('li[data-id="c1"] .community-mine-start');
    await p8.click('li[data-id="c1"] .community-mine-del');
    await p8.waitForTimeout(500);
    const after8 = await readList(p8);
    const said8 = await p8.evaluate(() => { const n = document.querySelector('li[data-id="c1"] [role="alert"]'); return n ? n.textContent : ''; });
    // The row's own state line, apart from the message (which carries similar words), so the repaint is what is read.
    const state8 = await p8.evaluate(() => { const n = document.querySelector('li[data-id="c1"] > div > p.dhint'); return n ? n.textContent : ''; });
    check('REFUSED: a 400 answer repaints the list from /mine', readsAtRefusal >= 0 && mineReads === readsAtRefusal + 1, readsAtRefusal + ' -> ' + mineReads);
    check('REFUSED: the row says its true state, with no Delete and no ask', after8.rows.length === 1 && after8.rows[0].del === false && after8.rows[0].ask === false && /In the community\. Kosmos cannot tell whether the registration it holds sent this comment/.test(state8), state8 + ' ' + JSON.stringify(after8.rows));
    check('REFUSED: the board\'s message stays on the row', said8 === REFUSAL, said8);
    await p8.close();

    // UNREAD (#4801 review 2): the board could not read its comment records.
    const p6 = await page();
    await p6.route(MINE, answer({ posts: [], comments: null }));
    await openAutomation(p6);
    const u = await readList(p6);
    check('UNREAD: with no posts, the line says the comments could not be read', u.unreadHidden === false && /^Kosmos could not read your agents[’'] comments just now\.$/.test(u.unread), JSON.stringify(u));
    check('UNREAD: never the "none" line on that basis', u.emptyHidden === true && u.listHidden === true, JSON.stringify(u));
    await p6.close();
    const p7 = await page();
    await p7.route(MINE, answer({ posts: [row('a1')], comments: null }));
    await openAutomation(p7);
    const u2 = await readList(p7);
    check('UNREAD: posts are still listed, with no comment rows, and the line shows', u2.rows.length === 1 && u2.rows[0].id === 'a1' && u2.unreadHidden === false && u2.emptyHidden === true, JSON.stringify(u2));
    await p7.close();
  } finally {
    await browser.close();
  }
  if (fails.length) { console.log('\n' + fails.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
}

run().catch((e) => { console.error(e); process.exit(1); });
