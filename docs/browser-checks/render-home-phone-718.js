'use strict';
/**
 * #718 row 6: the home grid and the agents list on a phone.
 *
 * The harness flagged three small targets there at 375px: the agent names (16px tall),
 * "Answer" (63x24) and "Set them to start at login" (34px). Only the last is a real
 * thumb problem: a tap anywhere on an agent's card or row opens that agent (the board's
 * one click handler), and "Answer" has its own touch hit area (render-waiting-phone-718).
 * This drives the REAL page from the REAL server and reads, at the four harness sizes:
 *   - "Set them to start at login" is at least 44px tall;
 *   - a tap on an empty part of a card (grid) and of a row (list), away from its name
 *     and any button, opens that agent, so the 16px name is not the target;
 *   - the page is no wider than the screen, in both layouts;
 * and at desktop width (1280) the button keeps its old height (the same with any min-height
 * taken away). The tab layout only: the consolidated layout does not show #restart-wrap.
 * #6107, an upright tablet (834x1194, touch): the cards are two across (one across at 600x960, a small tablet) with
 * the face on the left, name, role and state beside it and the task underneath, a needs-you card and a long name fitting;
 * also two across at 744x1133 (the iPad mini, the 330px floor). CONTROLS, each keeping the desktop card (face above the
 * name): a 900x700 tablet in landscape, and a MOUSE at 834x1194 (the only arm that fails if the touch clause is dropped).
 * #4662, at the same phone sizes: the Agents Sort dropdown is at least 16px (iOS zooms into a
 * smaller field), and every .sortctl select in the page plus one built by agentSortControlHtml
 * (how the one-screen layout builds its own) is at least 16px; at 1280 the Sort stays under 16px.
 *
 * Controls, measured: on main's page the button arm reds at every phone size in both
 * engines (34px) and the rest stay green (they pin the reason the names are left alone). With
 * the board's click handler opening an agent only from its name, both tap arms red at all
 * four sizes. With the button rule not limited to phone width, the desktop arm reds (44px
 * drawn, 34 with no min-height). #4662: on main's page the 16px arms red at every phone size
 * (13px); with the touchscreen rule applied everywhere, the desktop CONTROL reds (16px).
 *
 * Chromium at phone size is not an Android phone, and WebKit is an engine
 * approximation, not Safari.
 *
 *   node docs/browser-checks/render-home-phone-718.js            # headed
 *   HEADED=0 node docs/browser-checks/render-home-phone-718.js   # headless
 *   ENGINES=chromium,webkit HEADED=0 node docs/browser-checks/render-home-phone-718.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hp-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hp-workers-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hp-config-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hp-launch-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hp-projects-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
// The survival button writes launchd jobs. This check never clicks it, and LAUNCH above is a
// temp dir, which is what keeps a run off this Mac's real login items.

let pw;
try { pw = require('playwright'); }
catch {
  console.log('render-home-phone-718: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const create = require('../../engine/create');
const store = require('../../engine/store');

// The gate runs Chromium; ENGINES=chromium,webkit adds WebKit by hand.
const ALL_ENGINES = ['chromium', 'webkit'];
const ASKED = (process.env.ENGINES || 'chromium').split(',').map((s) => s.trim()).filter(Boolean);
const ENGINES = ASKED.filter((e) => ALL_ENGINES.includes(e));
// A misspelt engine would otherwise be dropped silently and the run read as covering it.
if (!ENGINES.length || ENGINES.length !== ASKED.length) {
  console.log('FAIL  render-home-phone-718: ENGINES names an unknown engine (' + (process.env.ENGINES || '') + '); known: ' + ALL_ENGINES.join(', '));
  process.exit(1);
}
// The mobile-shots harness sizes: iPhone SE, iPhone 15, iPhone 15 Pro Max, a Pixel.
const PHONES = [[375, 667], [393, 852], [430, 932], [412, 915]];
const NAMES = ['ada', 'bram', 'cleo'];
const SURVIVAL = '#restart-wrap [data-survival-fix]';

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

async function home(page, url, layout) {
  await page.goto(url, { waitUntil: 'networkidle' });
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  await page.click(`[data-scope="agents"] .vt[data-layout="${layout}"]`);
  await page.waitForSelector(layout === 'grid' ? '#grid .acard[data-agent="ada"]' : '#alist .lrow[data-agent="ada"]', { timeout: 8000 });
  await page.waitForTimeout(400);
}

// A point inside the agent's card or row that is not on its name or any control.
function emptySpot(page, sel) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { error: 'no ' + sel };
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    for (let fy = 0.9; fy >= 0.1; fy -= 0.1) for (let fx = 0.9; fx >= 0.1; fx -= 0.1) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy;
      const hit = document.elementFromPoint(x, y);
      if (hit && el.contains(hit) && !hit.closest('button, a, input, select, textarea, [data-answer], [role="button"]')) {
        return { x: Math.round(x), y: Math.round(y), what: hit.tagName.toLowerCase() + (hit.className && typeof hit.className === 'string' ? '.' + hit.className.split(' ')[0] : '') };
      }
    }
    return { error: 'no empty spot on ' + sel };
  }, sel);
}

(async () => {
  fleet.install(NAMES.map((n, i) => fleet.agent(n, {
    state: ['working', 'idle', 'needs_you'][i],
    displayName: n[0].toUpperCase() + n.slice(1),
    role: 'Role ' + (i + 1),
  })));
  // A profile and a folder for each agent and no login job (LAUNCH is an empty temp dir):
  // the survival panel's "missing" list, so "Set them to start at login" shows
  // (engine/register.js reads the profiles, not the fleet stub).
  NAMES.forEach((n, i) => {
    store.writeProfile(n, { role: 'Role ' + (i + 1) });
    fs.mkdirSync(create.workerDir(n), { recursive: true });
  });
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const engine of ENGINES) {
      let browser;
      try { browser = await pw[engine].launch({ headless: process.env.HEADED === '0' }); }
      catch (err) {
        chk(false, `[${engine}] could not start a browser` + (process.env.HEADED === '0' ? '' : ' (headed; try HEADED=0)'),
          err && err.message ? err.message.split('\n')[0] : String(err));
        continue;
      }
      try {
        for (const [w, h] of PHONES) {
          const tag = `[${engine} ${w}x${h}]`;
          const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: engine === 'chromium' });
          const page = await ctx.newPage();
          const errs = [];
          page.on('pageerror', (e) => errs.push(String(e.message || e).split('\n')[0]));
          await home(page, URL, 'grid');
          const btn = await page.waitForSelector(SURVIVAL, { state: 'visible', timeout: 8000 }).catch(() => null);
          if (!btn) chk(false, `${tag} "Set them to start at login" is showing`, SURVIVAL);
          else {
            const bh = await btn.evaluate((b) => Math.round(b.getBoundingClientRect().height * 10) / 10);
            chk(bh >= 44, `${tag} "Set them to start at login" is at least 44px tall`, `${bh}px`);
          }
          // #4662: iOS zooms into a focused field under 16px and does not zoom back; the Sort dropdown was 13px.
          const sort = await page.evaluate(() => { const e = document.getElementById('agent-sort');
            return e ? { px: parseFloat(getComputedStyle(e).fontSize) } : null; });
          chk(!!sort && sort.px >= 16, `${tag} #4662: the Sort dropdown is at least 16px, so focusing it does not zoom an iPhone`, JSON.stringify(sort));
          // Every sort dropdown, including the one-screen layout's (built by the same function, so one is made here
          // to measure): the first version of this fix covered #agent-sort alone and missed #agent-sort-cons.
          const sorts = await page.evaluate(() => {
            const made = typeof agentSortControlHtml === 'function' ? document.createElement('div') : null;
            if (made) { made.innerHTML = agentSortControlHtml('agent-sort-probe'); document.body.appendChild(made); }
            const out = [...document.querySelectorAll('.sortctl select')].map((e) => ({ id: e.id, px: parseFloat(getComputedStyle(e).fontSize) }));
            if (made) made.remove();
            return out;
          });
          chk(['agent-sort', 'agent-sort-probe'].every((id) => sorts.some((x) => x.id === id)) && sorts.every((x) => x.px >= 16),
            `${tag} #4662: every .sortctl select in the page, and one built as the one-screen layout builds its own, is at least 16px`, JSON.stringify(sorts));
          for (const [layout, sel, what] of [['grid', '#grid .acard[data-agent="ada"]', 'card'], ['list', '#alist .lrow[data-agent="ada"]', 'row']]) {
            await home(page, URL, layout);
            const pageW = await page.evaluate(() => document.documentElement.scrollWidth);
            chk(pageW <= w, `${tag} the page is no wider than the screen (${layout})`, `page ${pageW}px`);
            const spot = await emptySpot(page, sel);
            if (spot.error) { chk(false, `${tag} a tap on an empty part of an agent's ${what} opens it`, spot.error); continue; }
            await page.touchscreen.tap(spot.x, spot.y);
            const opened = await page.waitForFunction(() => {
              const p = document.getElementById('panel-detail');
              return p && !p.hidden && document.getElementById('d-name').textContent.trim() === 'Ada';
            }, null, { timeout: 5000 }).then(() => true, () => false);
            chk(opened, `${tag} a tap on an empty part of an agent's ${what} opens it`, `tapped ${spot.what} at ${spot.x},${spot.y}`);
          }
          chk(errs.length === 0, `${tag} no page errors`, errs.join(' | '));
          await ctx.close();
        }
        // #6107: an upright tablet (iPad 11-inch portrait, touch) gets the cards two across, face on the left, name,
        // role and state beside it, the task underneath. CONTROL: the same tablet turned to landscape keeps the
        // desktop card (the face above the name), so the arm cannot pass on a page that
        // simply always draws the tablet card. 900x700 is inside the tablet width range, so only the orientation clause
        // keeps it out (and under 960px, so the #6107 landscape-tablet one-screen layout does not apply either).
        // 744 is the iPad mini, the narrowest screen that gets two across (each card at its 330px floor).
        // The last is a MOUSE at iPad portrait size (a laptop window snapped tall): only the touch clause keeps it on the
        // desktop card, so dropping that clause from the query fails here and nowhere else.
        for (const [w, h, upright, across, mouse] of [[834, 1194, true, 2], [744, 1133, true, 2], [600, 960, true, 1], [900, 700, false, 0], [834, 1194, false, 0, true]]) {
          const tag = `[${engine} ${w}x${h} tablet]`;
          const ctx = await browser.newContext(mouse ? { viewport: { width: w, height: h } } : { viewport: { width: w, height: h }, hasTouch: true, isMobile: engine === 'chromium' });
          const page = await ctx.newPage();
          await home(page, URL, 'grid');
          // Precondition: a touch context reports a touch screen (hover none, pointer coarse; both engines do with
          // hasTouch) and the mouse context does not. If either is wrong the arm cannot measure what it claims, and it
          // says so as a harness failure instead of a product one.
          const touch = await page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches);
          if (mouse && touch) { chk(false, `${tag} harness: a mouse context reports a touch screen, so the mouse control cannot run`, 'matchMedia((hover: none) and (pointer: coarse)) is true'); await ctx.close(); continue; }
          if (!mouse && !touch) { chk(false, `${tag} harness: this engine does not report a touch screen here, so the tablet arm cannot run`, 'matchMedia((hover: none) and (pointer: coarse)) is false'); await ctx.close(); continue; }
          const card = await page.evaluate(() => {
            const cards = [...document.querySelectorAll('#grid .acard:not(.notrunning)')];
            const lefts = new Set(cards.map((c) => Math.round(c.getBoundingClientRect().left)));
            const ada = document.querySelector('#grid .acard[data-agent="ada"]');
            if (!ada) return { error: 'no ada card' };
            const r = (sel) => { const e = ada.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
            // Every child of an ordinary card sits in a named grid area: a new line the areas do not name would fall
            // into an implicit row under the model line.
            const unplaced = cards.flatMap((c) => [...c.children].filter((k) => getComputedStyle(k).display !== 'none' && getComputedStyle(k).gridArea.split('/').every((p) => p.trim() === 'auto')).map((k) => k.className));
            return { columns: lefts.size, cards: cards.length, g: r('.agauge'), n: r('.aname'), m: r('.ameta'), st: r('.astate'), task: r('.atask'), unplaced };
          });
          if (card.error || !card.g || !card.n || !card.m || !card.st || !card.task) { chk(false, `${tag} the ada card and its parts are drawn`, JSON.stringify(card)); await ctx.close(); continue; }
          const beside = card.g.r <= card.n.l + 1 && card.g.r <= card.m.l + 1 && card.g.r <= card.st.l + 1;   // name, role and state right of the face
          const stacked = card.st.t >= card.n.b - 1 && Math.abs(card.st.l - card.n.l) <= 1;   // state under the name, flush with it
          const under = card.task.t >= card.g.b - 1 && Math.abs(card.task.l - card.g.l) <= 2;   // task below the face, from its left edge
          if (upright) {
            // Two across on an iPad; one across on a 7 or 8 inch tablet, where two would leave a needs-you card too narrow.
            chk(card.cards >= 3 && card.columns === across, `${tag} #6107: the agent cards are ${across === 2 ? 'two' : 'one'} across`, JSON.stringify({ columns: card.columns, cards: card.cards }));
            chk(beside && stacked && under, `${tag} #6107: the face is on the left, name then state beside it, the task underneath`, JSON.stringify(card));
            chk(card.unplaced.length === 0, `${tag} #6107: every line of every ordinary card is in a named grid area`, JSON.stringify(card.unplaced));
            // The shapes most likely to break: cleo needs you (the state pill carries an Answer button), and a long name
            // beside the 64px face. Nothing in the card may poke out of it, or under the face.
            const fit = await page.evaluate(() => {
              const res = {};
              const inside = (card, sel) => { const e = card.querySelector(sel); if (!e) return 'absent'; const c = card.getBoundingClientRect(); const b = e.getBoundingClientRect(); return b.left >= c.left - 0.5 && b.right <= c.right + 0.5 ? 'in' : 'out:' + Math.round(b.left - c.left) + '..' + Math.round(c.right - b.right); };
              const cleo = document.querySelector('#grid .acard[data-agent="cleo"]');
              res.cleoState = cleo ? inside(cleo, '.astate') : 'no cleo card';
              res.cleoAnswer = cleo ? inside(cleo, '.astate button, .astate [data-answer]') : 'no cleo card';
              const ada = document.querySelector('#grid .acard[data-agent="ada"]');
              const nm = ada && ada.querySelector('.namego');
              if (!nm) return Object.assign(res, { error: 'no ada name' });
              const was = nm.textContent;
              nm.textContent = 'Alexandria Constantinople-Vanderberg the Second';
              try {
                const g = ada.querySelector('.agauge').getBoundingClientRect(); const n = ada.querySelector('.aname').getBoundingClientRect();
                res.longName = inside(ada, '.aname .namego'); res.nameAlign = getComputedStyle(nm).textAlign; res.clearOfFace = n.left >= g.right - 0.5; res.cardFits = ada.scrollWidth <= ada.clientWidth + 1;
              } finally { nm.textContent = was; }
              return res;
            });
            chk(!fit.error && fit.cleoState === 'in' && fit.cleoAnswer === 'in' && fit.longName === 'in' && /^(left|start)$/.test(fit.nameAlign) && fit.clearOfFace && fit.cardFits,
              `${tag} #6107: a needs-you card's state and Answer stay inside it, and a long name wraps beside the face, left-aligned`, JSON.stringify(fit));
          } else {
            // The desktop card's mark is the face ABOVE the name (the tablet card puts it beside); the column count is
            // not, since the desktop grid is two across at 834 and three at 1024 (seen in CI, #6135).
            const above = card.g.b <= card.n.t + 1;
            chk(above && !beside, `${tag} CONTROL: ${mouse ? 'a mouse at iPad portrait size' : 'landscape'} keeps the desktop card (the face above the name)`, JSON.stringify({ columns: card.columns, g: card.g, n: card.n }));
          }
          await ctx.close();
        }
        // Desktop: the phone rule must not reach it.
        {
          const tag = `[${engine} 1280x800]`;
          const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
          const page = await ctx.newPage();
          await home(page, URL, 'grid');
          const btn = await page.waitForSelector(SURVIVAL, { state: 'visible', timeout: 8000 }).catch(() => null);
          // Its height as drawn, then with any min-height taken away: equal means no phone rule reached it.
          const hOf = () => btn.evaluate((b) => Math.round(b.getBoundingClientRect().height * 10) / 10);
          const bh = btn ? await hOf() : null;
          let bare = null;
          if (btn) {
            const t = await page.addStyleTag({ content: '#restart-wrap .btn{min-height:0!important}' });
            await page.waitForTimeout(50);
            bare = await hOf();
            await t.evaluate((n) => n.remove());
          }
          chk(bh !== null && bh === bare, `${tag} "Set them to start at login" keeps its desktop height`, `${bh}px drawn, ${bare}px with no min-height`);
          const dsort = await page.evaluate(() => { const e = document.getElementById('agent-sort'); return e ? parseFloat(getComputedStyle(e).fontSize) : null; });
          chk(dsort !== null && dsort < 16, `${tag} CONTROL: the Sort dropdown keeps its desktop size (the touchscreen rule does not reach it)`, String(dsort));
          await ctx.close();
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    try { await server.close(); } catch { /* server may already be down */ }
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nALL PASS');
})().catch((e) => { console.error(e); process.exit(1); });
