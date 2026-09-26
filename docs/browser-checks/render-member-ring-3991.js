// Browser-check-surface: pj-one-agents pj-member pj-face lring pjd
'use strict';
/**
 * #3991 (Josh, 2026-09-26): "we lost the context ring and green dot indicator on the tab view of
 * project, project members".
 *
 * Boots a sandboxed board with a project of three members: working, idle and stopped. Every card
 * is given a memory reading on /api/status, so a ring has something to draw. It opens the project
 * in the TAB view (not the consolidated layout) and, on chromium and webkit, checks each member row:
 *   - a memory ring (.lring) is drawn around the face, its arc the card's percent;
 *   - the presence dot is drawn: green for the working and idle members, grey for the stopped one;
 *   - the stopped member (not running) gets the grey dot, not a green one.
 *   - for EVERY member (working, idle, stopped, needs-you, auth-failed), the dot matches the
 *     consolidated row's rule computed in the page from the page's own boardMods and cardStOf.
 * Control: with the context reading removed for one member, that member has NO ring, so the ring
 * is not drawn unconditionally.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-member-ring-3991.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ring-' + tag)); ROOTS.push(d); return d; };
const SANDBOX = mkroot('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium, webkit } = require('playwright');
const fleet = require('../../test-support/fleet');
const projects = require('../../engine/projects');
const srv = require('../../server.js');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

/* The percent each member's card is given. `cosmo` gets none: the control. */
const PERCENT = { beatrix: 42, dora: 71 };

(async () => {
  fleet.install([
    fleet.agent('beatrix', { state: 'working', displayName: 'Beatrix', role: 'Collections Coordinator' }),
    fleet.agent('cosmo', { state: 'idle', displayName: 'Cosmo', role: 'Researcher' }),
    fleet.agent('dora', { state: 'stopped', displayName: 'Dora', role: 'Analyst' }),
    fleet.agent('ned', { state: 'needs_you', displayName: 'Ned', role: 'Writer' }),
    fleet.agent('ava', { state: 'auth_failed', displayName: 'Ava', role: 'Editor' }),
    /* A pane that merely HOLDS a name (not ours): the member projection reads it unknown. */
    fleet.stranger('zed', { state: 'working' }),
  ]);
  const p = projects.create({ name: 'Ring Check' });
  projects.writeAll(projects.readAll().map((x) => (x.id === p.id ? { ...x, agents: ['beatrix', 'cosmo', 'dora', 'ned', 'ava', 'zed'] } : x)));
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  await fetch(URL + '/api/first-run/complete', { method: 'POST' });
  let injected = 0;
  try {
    for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
      const browser = await engine.launch({ headless: process.env.HEADED === '0' });
      try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', (e) => errs.push(e.message));
        /* A memory reading on each card that should have one (a stopped card is given one too, as
           a board could: the dot, not the ring, carries "not running"). */
        await page.route('**/api/status*', async (route) => {
          const r = await route.fetch();
          let j = {};
          try { j = await r.json(); } catch { j = {}; }
          for (const a of (j.agents || [])) {
            const key = String(a.sessionName || '').replace(/-discord$/, '');
            if (PERCENT[key] !== undefined) { a.context = Object.assign({}, a.context || {}, { percent: PERCENT[key] }); injected += 1; }
          }
          await route.fulfill({ response: r, json: j });
        });
        await page.goto(URL + '/?tab=projects', { waitUntil: 'networkidle' });
        await page.waitForSelector('[data-project="' + p.id + '"]', { state: 'visible', timeout: 15000 });
        await page.click('[data-project="' + p.id + '"]');
        await page.waitForSelector('#pj-one-agents .pj-member', { timeout: 15000 });
        await page.waitForTimeout(6000); // one poll, so the members paint off a status carrying the readings

        const layout = await page.evaluate(() => document.documentElement.getAttribute('data-layout'));
        chk(layout !== 'consolidated', `${engineName}: precondition: this is the TAB view, not the consolidated layout`, String(layout));
        chk(injected > 0, `${engineName}: precondition: memory readings reached the page`, String(injected));

        const rows = await page.evaluate(() => [...document.querySelectorAll('#pj-one-agents .pj-member')].map((row) => {
          const face = row.querySelector('.pj-face');
          const ring = face && face.querySelector('.lring');
          const arc = ring && ring.querySelector('.gf');
          const after = face ? getComputedStyle(face, '::after') : null;
          return {
            name: (row.querySelector('b') || {}).textContent || '',
            ring: !!ring && getComputedStyle(ring).display !== 'none',
            dash: arc ? arc.getAttribute('stroke-dasharray') : null,
            dot: !!after && after.content !== 'none' && after.content !== 'normal' && after.width !== 'auto',
            dotColor: after ? after.backgroundColor : null,
          };
        }));
        const by = (n) => rows.find((r) => r.name === n) || {};
        const green = (c) => /rgb\(47, 125, 90\)/.test(String(c));

        const b = by('Beatrix');
        chk(b.ring, `${engineName}: the working member has a visible memory ring`, JSON.stringify(b));
        chk(b.dash && Math.abs(parseFloat(b.dash) - 0.42 * 2 * Math.PI * 15.5) < 0.5, `${engineName}: its arc is its 42% reading`, String(b.dash));
        chk(b.dot && green(b.dotColor), `${engineName}: the working member has a green dot`, String(b.dotColor));

        const d = by('Dora');
        chk(d.dot && !green(d.dotColor), `${engineName}: the stopped member's dot is NOT green`, String(d.dotColor));

        const c = by('Cosmo');
        chk(c.dot && green(c.dotColor), `${engineName}: the idle (running) member has a green dot`, String(c.dotColor));
        chk(!c.ring, `${engineName}: control: a member with no memory reading draws no ring`, JSON.stringify(c));

        /* PARITY, for every member: the dot this row draws must be the one the CONSOLIDATED row
           would draw for the same live card (lrow's not-running branch, then boardMods' off/unk),
           computed in the page from the page's own functions. */
        const parity = await page.evaluate(() => [...document.querySelectorAll('#pj-one-agents .pj-member')].map((row) => {
          const who = row.getAttribute('data-agent');
          const card = LAST.find((x) => x && x.sessionName === who);
          const face = row.querySelector('.pj-face');
          /* What the CONSOLIDATED row actually draws for this card: lrow()'s own classes, read from its
             output, not a restatement of its rule. */
          const holder = document.createElement('div');
          holder.innerHTML = lrow(card);
          const cls = holder.firstElementChild ? holder.firstElementChild.classList : { contains: () => false };
          const want = cls.contains('off') ? 'off' : cls.contains('unk') ? 'unk' : 'on';
          const got = face.classList.contains('pjd-off') ? 'off' : face.classList.contains('pjd-unk') ? 'unk' : face.classList.contains('pjd') ? 'on' : 'none';
          return { who, state: card.state, want, got };
        }));
        chk(parity.length === 6, `${engineName}: precondition: all six members are drawn`, String(parity.length));
        for (const r of parity.filter((x) => x.who !== 'zed')) chk(r.got === r.want, `${engineName}: ${r.who} (${r.state}) dot matches the consolidated row's rule`, `${r.got} vs ${r.want}`);

        /* The untied pane: the member row says unknown (no state wash), so its dot must not say online. */
        const z = await page.evaluate(() => {
          const row = document.querySelector('#pj-one-agents .pj-member[data-agent="zed"]');
          const face = row && row.querySelector('.pj-face');
          return row ? { wash: /pjm-(working|attn|idle)/.test(row.className), dot: face ? face.className : '' } : null;
        });
        const greenDot = !!z && /\bpjd\b/.test(z.dot) && !/pjd-(unk|off)/.test(z.dot);
        chk(!!z && !z.wash && !greenDot,
          `${engineName}: an untied pane (a stranger holding the name) does not get a green dot`, JSON.stringify(z));
        chk(errs.length === 0, `${engineName}: no page errors`, errs.join(' | '));
        await ctx.close();
      } finally {
        await browser.close();
      }
    }
  } finally {
    server.close();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  console.log(fail.length ? `${fail.length} check(s) FAILED` : 'all checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
