'use strict';

/*
 * #7211 (Josh, 10-26): Settings > Automation > Kosmos+ community no longer lists every post and comment by every agent.
 * It shows how many are in the community, and a link to each agent's own page on the community site. The rows, with
 * Delete, sit in a fold that is closed by default.
 *
 * /api/community/mine is answered at the browser (page.route), so this check writes nothing to the board:
 *   CLOSED    with rows, the fold shows and is closed, and no row is visible. The summary line counts posts and
 *             comments. Each agent with a community name links to community.kosmosplus.com/agent/<name> in a new
 *             tab, named for the agent. An agent with no registration (name null) has no link.
 *   OPEN      opening the fold shows the rows, with their Delete buttons.
 *   UNREAD    comments the board could not read (summary.comments null) are left out of the line, never counted as 0.
 *   NOLINKS   no agent with a community name: the links line stays hidden, and the summary still shows.
 *   NONELIVE  rows that are none of them out there (held, taken down, being deleted): the line says none are in the
 *             community now, never "0 posts and 0 comments", and the fold still holds the rows.
 *   EMPTY     no rows: the fold, the summary and the links are hidden, and the "none have gone" line shows.
 *   OLD       an answer with no summary (an older board): no summary line, and the fold still holds the rows.
 * CLOSED is the control for the others: it proves each element is found and painted.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
 *     node docs/browser-checks/render-community-index-7211.js http://127.0.0.1:PORT
 */

const { chromium } = require('playwright');

const BASE = process.argv[2] || process.env.KOSMOS_URL || 'http://127.0.0.1:17461';
const MINE = '**/api/community/mine';

const fails = [];
function check(name, pass, detail) {
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : ''));
  if (!pass) fails.push(name);
}

const base = { deleteRequested: false, takenDown: false, takeDownReason: null, agentRefused: false, agentNameUnclaimed: false, deleteRetrying: false };
const POSTS = [
  { id: 'p1', title: 'Moving invoicing to Tuesdays', agent: 'Ava', postedAt: '2026-10-25T09:00:00.000Z', state: 'sent', ...base, canDelete: true },
  { id: 'p2', title: 'What a slow runner taught me', agent: 'Bo', postedAt: '2026-10-24T09:00:00.000Z', state: 'sent', ...base, canDelete: true },
];
const COMMENTS = [
  { id: 'c1', kind: 'comment', text: 'The same happened to us', agent: 'Ava', postedAt: '2026-10-25T10:00:00.000Z', remotePostId: '7d1c2b3a-0000-4000-8000-000000000001', state: 'sent', deleteRequested: false, deleteRetrying: false, agentRefused: false, untraceable: false, untraceableReason: null, traceUnknown: false, canDelete: true },
];
const SUMMARY = { posts: 2, comments: 1, agents: [
  { agent: 'Ava', name: 'Ava-the-Ops', posts: 1, comments: 1 },
  { agent: 'Bo', name: null, posts: 1, comments: 0 },
] };

async function openAutomation(pg, body) {
  await pg.route(MINE, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
  await pg.goto(BASE, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(800);
  if (!(await pg.$('#firstrun[hidden]'))) {
    await pg.keyboard.press('Escape');
    await pg.waitForSelector('#firstrun', { state: 'hidden', timeout: 5000 }).catch(() => {});
  }
  await pg.evaluate(() => showTab('settings'));
  await pg.waitForTimeout(400);
  await pg.click('#s-nav button[data-go="automation"]');
  await pg.waitForTimeout(600);
}

function read(pg) {
  return pg.evaluate(() => {
    const $ = (id) => document.getElementById(id);
    const shown = (el) => Boolean(el) && !el.hidden && el.getClientRects().length > 0;
    const fold = $('community-mine-all');
    const rows = [...document.querySelectorAll('#community-mine-list li')];
    return {
      found: Boolean(fold && $('community-mine-summary') && $('community-mine-links')),
      foldShown: shown(fold),
      foldOpen: fold ? fold.open : null,
      rowCount: rows.length,
      /* checkVisibility, not getClientRects: a closed <details> hides its content with content-visibility, and
         getClientRects still lays such content out and returns boxes for it (measured 10:59: 3 "visible" rows in a
         closed fold). checkVisibility answers whether it is drawn. */
      rowsVisible: rows.filter((li) => li.checkVisibility()).length,
      deleteVisible: [...document.querySelectorAll('#community-mine-list .community-mine-start')].filter((b) => b.checkVisibility()).length,
      summary: shown($('community-mine-summary')) ? $('community-mine-summary').textContent : null,
      links: shown($('community-mine-links')) ? $('community-mine-links').textContent : null,
      anchors: [...document.querySelectorAll('#community-mine-links a')].map((a) => ({ text: a.textContent, href: a.href, target: a.target, rel: a.rel, label: a.getAttribute('aria-label') })),
      emptyShown: shown($('community-mine-empty')),
    };
  });
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED !== '1' });
  try {
    const p1 = await browser.newPage();
    await openAutomation(p1, { posts: POSTS, comments: COMMENTS, summary: SUMMARY });
    const c = await read(p1);
    check('CLOSED: the summary, the links and the fold are all on the page', c.found, JSON.stringify(c));
    check('CLOSED: the fold shows and is closed by default', c.foldShown === true && c.foldOpen === false, JSON.stringify(c));
    check('CLOSED: the rows are painted but none is visible', c.rowCount === 3 && c.rowsVisible === 0 && c.deleteVisible === 0, JSON.stringify(c));
    check('CLOSED: the summary counts posts and comments', c.summary === 'Your agents have 2 posts and 1 comment in the community.', c.summary);
    check('CLOSED: one link, to the named agent\'s community page, in a new tab', c.anchors.length === 1
      && c.anchors[0].href === 'https://community.kosmosplus.com/agent/Ava-the-Ops' && c.anchors[0].text === 'Ava'
      && c.anchors[0].target === '_blank' && /noopener/.test(c.anchors[0].rel), JSON.stringify(c.anchors));
    check('CLOSED: the link says where it goes', c.anchors[0] && c.anchors[0].label === 'Ava’s page on the Kosmos+ community', JSON.stringify(c.anchors));
    check('CLOSED: an agent with no community name gets no link', !/\bBo\b/.test(c.links || ''), c.links);

    await p1.click('#community-mine-all-sum');
    await p1.waitForTimeout(200);
    const o = await read(p1);
    check('OPEN: the fold opens and every row shows, with its Delete', o.foldOpen === true && o.rowsVisible === 3 && o.deleteVisible === 3, JSON.stringify(o));
    await p1.close();

    const p2 = await browser.newPage();
    await openAutomation(p2, { posts: POSTS, comments: null, summary: { posts: 2, comments: null, agents: [{ agent: 'Ava', name: 'Ava-the-Ops', posts: 1, comments: null }] } });
    const u = await read(p2);
    check('UNREAD: comments it could not read are left out, never counted as 0', u.summary === 'Your agents have 2 posts in the community.', u.summary);
    await p2.close();

    const p3 = await browser.newPage();
    await openAutomation(p3, { posts: POSTS, comments: [], summary: { posts: 2, comments: 0, agents: [{ agent: 'Bo', name: null, posts: 2, comments: 0 }] } });
    const n = await read(p3);
    check('NOLINKS: no named agent: the links line stays hidden, the summary shows', n.links === null && n.summary === 'Your agents have 2 posts and 0 comments in the community.', JSON.stringify(n));
    await p3.close();

    const p6 = await browser.newPage();
    await openAutomation(p6, { posts: [{ ...POSTS[0], state: 'withheld', canDelete: false }], comments: [], summary: { posts: 0, comments: 0, agents: [] } });
    const z = await read(p6);
    check('NONELIVE: no row is out there: the line says none are, and the fold still holds the row', z.summary === 'None of your agents’ posts or comments are in the community now.' && z.foldShown === true && z.rowCount === 1, JSON.stringify(z));
    await p6.close();

    const p4 = await browser.newPage();
    await openAutomation(p4, { posts: [], comments: [], summary: { posts: 0, comments: 0, agents: [] } });
    const e = await read(p4);
    check('EMPTY: no rows: fold, summary and links hidden, the "none" line shows', e.foldShown === false && e.summary === null && e.links === null && e.emptyShown === true, JSON.stringify(e));
    await p4.close();

    const p5 = await browser.newPage();
    await openAutomation(p5, { posts: POSTS, comments: COMMENTS });
    const old = await read(p5);
    check('OLD: an answer with no summary: no summary line, the fold still holds the rows', old.summary === null && old.foldShown === true && old.rowCount === 3, JSON.stringify(old));
    await p5.close();
  } finally {
    await browser.close();
  }
  console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join('; ')}` : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
