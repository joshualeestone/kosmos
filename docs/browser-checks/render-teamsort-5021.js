// Browser-check-surface: team-seeded team-seeded-pick seededTeamGroups SEEDED_KIND_HEADING loadSeededTeams cstep-kind
'use strict';
/**
 * #5021 (Josh, 0.7.17 staging: "categorized by something, at minimum alpha, but ... grouping like we have on picking
 * another role"): New Agent > Team's "Choose a team" menu lists the ready-made teams under headings, A to Z inside each.
 *
 * HERMETIC (file://, fetch stubbed, as render-docs-seg-4937). The real page, opened the person's way (openCreate, then
 * the Team card), with the seeded-teams answer stubbed. On chromium and webkit:
 *   - teams with no group (every catalogue today): two headings, Business then Personal and family, each A to Z,
 *     though the answer lists them in rank order with the kinds interleaved (the old menu kept that order);
 *   - teams with a group (the catalogue's next step): those headings, business ones first, A to Z; a team with no
 *     group still sits under its kind;
 *   - the first entry is still "Choose a team", and picking a team still shows its description.
 * Control: the stub's teams all reach the menu (count), so a missing heading is a heading, not a missing team.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-teamsort-5021.js
 */
const path = require('node:path');
const { chromium, webkit } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

// Rank order as the route sends it, kinds interleaved by rank (ranks restart per kind).
const PLAIN = [
  { key: 'sales', label: 'Sales Team', kind: 'business', rank: 2, blurb: 'Sells.' },
  { key: 'home', label: 'Household Management Team', kind: 'personal', rank: 1, blurb: 'Runs the house.' },
  { key: 'mkt', label: 'Marketing Team', kind: 'business', rank: 1, blurb: 'Markets.' },
  { key: 'pa', label: 'Personal Assistant Team', kind: 'personal', rank: 2, blurb: 'Helps.' },
  { key: 'cust', label: 'Customer Insights Team', kind: 'business', rank: 3, blurb: 'Listens.' },
];
const GROUPED = [
  { key: 'sales', label: 'Sales Team', kind: 'business', rank: 2, group: 'Marketing and sales', blurb: 's' },
  { key: 'mkt', label: 'Marketing Team', kind: 'business', rank: 1, group: 'Marketing and sales', blurb: 'm' },
  { key: 'cust', label: 'Customer Support Team', kind: 'business', rank: 3, group: 'Customers', blurb: 'c' },
  { key: 'home', label: 'Household Management Team', kind: 'personal', rank: 1, group: 'Home and family', blurb: 'h' },
  { key: 'wed', label: 'Wedding Planning Team', kind: 'personal', rank: 2, blurb: 'w' },   // no group: its kind
];

async function menu(engine, teams) {
  const browser = await engine.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.addInitScript((teams) => {
      const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
      window.setInterval = () => 0;
      window.fetch = async (url) => {
        const u = String(url);
        if (u.includes('/api/teams/seeded')) return enc({ teams });
        return enc({});
      };
    }, teams);
    await page.goto(PAGE);
    await page.evaluate(async () => {
      const fr = document.getElementById('firstrun');
      if (fr) { fr.hidden = true; fr.style.display = 'none'; }
      for (const el of document.querySelectorAll('[inert]')) el.inert = false;
      openCreate();
      await new Promise((r) => setTimeout(r, 100));
    });
    await page.click('#cstep-kind [data-path="team"]');
    await page.waitForFunction(() => document.getElementById('team-seeded').options.length > 1, null, { timeout: 8000 }).catch(() => {});
    const shape = await page.evaluate(() => {
      const sel = document.getElementById('team-seeded');
      return {
        first: sel.options[0] && sel.options[0].textContent,
        count: sel.options.length - 1,
        groups: [...sel.querySelectorAll('optgroup')].map((g) => ({ label: g.label, teams: [...g.querySelectorAll('option')].map((o) => o.textContent) })),
      };
    });
    await page.selectOption('#team-seeded', teams[0].key).catch(() => {});
    const desc = await page.evaluate(() => (document.getElementById('team-seeded-desc') || {}).textContent || '');
    return { shape, desc, errs };
  } finally {
    await browser.close();
  }
}

(async () => {
  let ran = 0;
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const plain = await menu(engine, PLAIN);
    chk(plain.shape.count === PLAIN.length, `${name}: control: every team reached the menu`, String(plain.shape.count));
    chk(plain.shape.first === 'Choose a team', `${name}: the first entry is still "Choose a team"`, plain.shape.first);
    chk(JSON.stringify(plain.shape.groups) === JSON.stringify([
      { label: 'Business', teams: ['Customer Insights Team', 'Marketing Team', 'Sales Team'] },
      { label: 'Personal and family', teams: ['Household Management Team', 'Personal Assistant Team'] },
    ]), `${name}: with no groups, Business then Personal and family, each A to Z`, JSON.stringify(plain.shape.groups));
    chk(plain.desc.length > 0, `${name}: picking a team still shows what it does`, plain.desc.slice(0, 40));
    chk(plain.errs.length === 0, `${name}: no page errors`, plain.errs.join(' | '));
    const grouped = await menu(engine, GROUPED);
    chk(JSON.stringify(grouped.shape.groups) === JSON.stringify([
      { label: 'Customers', teams: ['Customer Support Team'] },
      { label: 'Marketing and sales', teams: ['Marketing Team', 'Sales Team'] },
      { label: 'Home and family', teams: ['Household Management Team'] },
      { label: 'Personal and family', teams: ['Wedding Planning Team'] },
    ]), `${name}: with groups, the catalogue's headings (business first, A to Z), a team with none under its kind`, JSON.stringify(grouped.shape.groups));
    chk(grouped.errs.length === 0, `${name}: no page errors (grouped)`, grouped.errs.join(' | '));
    ran += 1;
  }
  chk(ran === 2, 'precondition: both engines ran', String(ran));
  console.log(fail.length ? `${fail.length} check(s) FAILED` : 'all checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
