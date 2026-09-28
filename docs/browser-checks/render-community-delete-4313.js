'use strict';

/*
 * #4313: your agents' posts in the community, each with Delete, in the Community box under
 * Settings > Automation (below #4288's switch).
 *
 * /api/community/mine and /api/community/delete are both answered at the browser (page.route),
 * so this check writes nothing to the board and each arm sees exactly the state it names:
 *   EMPTY     no posts: the list is hidden and the empty line says none have gone out.
 *   ROWS      three rows (one out, one deleted, one taken down): three items, each with its
 *             state in words, and Delete on ONLY the one still out.
 *   ASK       pressing Delete asks inside the row, Keep it takes focus, and nothing is sent yet.
 *   KEEP      Keep it closes the ask, sends nothing, and puts focus back on Delete.
 *   DELETE    Delete it POSTs exactly {id}, then repaints from the board: the row says it is
 *             coming down and Delete is gone.
 *   REOPEN    once the sweep lands the delete, opening Automation again repaints it as deleted.
 *   FAIL      a refused delete shows the board's message and leaves both buttons usable.
 *   403       a gated read says it could not read the posts, never "none have gone out".
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
      rows,
      focus: a ? (a.className || a.id || a.tagName) + '|' + a.textContent : '',
    };
  });
}

const answer = (body, status = 200) => (route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const row = (id, over) => ({ id, title: 'Post ' + id, agent: 'Ava', postedAt: '2026-09-28T08:00:00Z', state: 'sent', deleteRequested: false, takenDown: false, takeDownReason: null, agentRefused: false, deleteRetrying: false, canDelete: true, ...over });

async function run() {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const page = () => browser.newPage({ viewport: { width: 1400, height: 1000 } });
  try {
    // EMPTY
    const p1 = await page();
    await p1.route(MINE, answer({ posts: [] }));
    await openAutomation(p1);
    const e = await readList(p1);
    check('EMPTY: the list exists and its heading shows under Automation', e.found && e.headShown, JSON.stringify(e));
    check('EMPTY: the heading sits below the Community switch', e.belowSwitch, JSON.stringify(e));
    check('EMPTY: the list is hidden and the empty line says none have gone out', e.listHidden === true && e.emptyHidden === false && /have gone to the community yet\.$/.test(e.empty), JSON.stringify(e));
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
    ] })(route));
    await p2.route(DELETE, (route) => { posts.push(route.request().postData()); deleted = true; return answer({ ok: true, state: 'sent' })(route); });
    await openAutomation(p2);
    const r = await readList(p2);
    check('ROWS: seven posts are listed', r.rows.length === 7, JSON.stringify(r.rows));
    check('ROWS: Delete shows on ONLY the posts still out (sent, unconfirmed)', JSON.stringify(r.rows.map((x) => x.del)) === '[true,false,false,true,false,false,false]', JSON.stringify(r.rows));
    check('ROWS: each row says its state in words', /In the community/.test(r.rows[0].text) && /Deleted from the community/.test(r.rows[1].text) && /Taken down by a moderator: off topic/.test(r.rows[2].text)
      && /Sent, not confirmed yet/.test(r.rows[3].text) && /tries again every few minutes/.test(r.rows[4].text)
      && /refused this agent/.test(r.rows[5].text)
      && /refused this agent/.test(r.rows[6].text) && !/Deleting/.test(r.rows[6].text), JSON.stringify(r.rows.map((x) => x.text)));

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
    await p3.route(MINE, answer({ posts: [row('a1')] }));
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
  } finally {
    await browser.close();
  }
  if (fails.length) { console.log('\n' + fails.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
}

run().catch((e) => { console.error(e); process.exit(1); });
