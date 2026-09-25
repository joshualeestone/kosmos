'use strict';
/**
 * The Settings page's left nav, on a screen (settings-nav, 2026-08-23).
 *
 * Same shape as render-agent-nav.js and for the same reason: the text tests
 * can prove the settings sections exist and which box is in which; only a
 * browser can prove a click puts that section on screen and takes the others
 * off it, in both themes, at phone width, and in the 56 to 60rem band where
 * the nav sits beside a fluid section, with the centred pair measured above
 * 60rem. Leads with a control (the other sections at zero height before any
 * click), measures by rectangle.
 *
 * The server runs in this process against a fixture fleet with every state
 * root a temp dir; the check clicks nav pills, saves the name field twice (a
 * new name, then back), and resizes the window; the theme comes from the
 * page's colorScheme.
 *
 *   node docs/browser-checks/render-settings-nav.js            # headed
 *   HEADED=0 node docs/browser-checks/render-settings-nav.js   # headless
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-snav-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-snav-workers-'));
// Sandboxed whole or the board refuses to start (#634): the four dirs and an inert tmux.
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-snav-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-snav-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-snav-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
/* A person on record, so the Your name field has something to show and a
   save has something to carry (the other two fields travel whole). Written
   into the sandboxed data root above, never the real one. */
require('../../engine/you').save({ name: 'Josh', does: 'runs the company', know: null });

const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'snav-shots-'));
// #2054: 'talking' removed -- the Agents Talking tab is deleted and its block folded
// into Automation. 'automation' is exercised by render-prompter-label-1843.js.
// #2618: 'styles' removed -- the Settings > Styles tab was deleted entirely.
const SECTIONS = ['you', 'accounts', 'connect', 'gskills', 'policy', 'mac', 'updates', 'plus', 'advanced'];
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April', role: 'a researcher' })]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: theme });
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(URL, { waitUntil: 'networkidle' });
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
      await page.evaluate(() => showTab('settings'));
      await page.waitForSelector('#panel-settings:not([hidden])');
      await page.waitForTimeout(1500);

      const rects = () => page.evaluate((keys) => {
        const out = {};
        for (const k of keys) {
          const el = document.getElementById('s-sec-' + k);
          out[k] = el.getBoundingClientRect().height;
        }
        return out;
      }, SECTIONS);

      let r = await rects();
      chk(r.you > 0, `[${theme}] landing: You has height`, String(r.you));
      // The name round trip: read into the field, saved whole, the agents told.
      const before = await page.evaluate(() => ({ v: document.getElementById('you-name').value, off: document.getElementById('you-name').disabled }));
      chk(before.v === 'Josh' && before.off === false, `[${theme}] the name on record is in the field`, JSON.stringify(before));
      await page.fill('#you-name', 'Joshua');
      await page.click('#you-name-save');
      await page.waitForFunction(() => /Saved|could not|did not/.test(document.getElementById('you-name-msg').textContent), null, { timeout: 8000 });
      const saved = await page.evaluate(() => document.getElementById('you-name-msg').textContent);
      chk(saved === 'Saved. Told 1 running agent.', `[${theme}] the name saves and the one running fixture agent is counted`, saved);
      // The control that can fail: the agent's own file carries the new name.
      const told = fs.readFileSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, 'april', 'CLAUDE.md'), 'utf8');
      chk(/Joshua/.test(told), `[${theme}] the fixture agent's instructions were rewritten with the new name`, told.slice(0, 80).replace(/\n/g, ' '));
      const rec = await (await page.request.get(URL + '/api/you')).json();
      chk(rec.you && rec.you.name === 'Joshua' && rec.you.does === 'runs the company',
        `[${theme}] the record carries the other field whole after a name-only save`, JSON.stringify(rec.you));
      await page.fill('#you-name', 'Josh'); await page.click('#you-name-save');
      await page.waitForFunction(() => /^Saved\. Told/.test(document.getElementById('you-name-msg').textContent), null, { timeout: 8000 });
      chk(SECTIONS.filter((k) => k !== 'you').every((k) => r[k] === 0),
        `[${theme}] control: the other sections measure zero before any click`, JSON.stringify(r));

      for (const k of SECTIONS) {
        await page.click('#s-nav button[data-go="' + k + '"]');
        await page.waitForTimeout(150);
        r = await rects();
        chk(SECTIONS.every((j) => (j === k ? r[j] > 0 : r[j] === 0)),
          `[${theme}] click ${k}: that section is on screen and the others are not`, JSON.stringify(r));
        const pill = await page.evaluate((key) => {
          const b = document.querySelector('#s-nav button[data-go="' + key + '"]');
          const on = [...document.querySelectorAll('#s-nav button.on')].map((x) => x.dataset.go);
          return { current: b.getAttribute('aria-current'), on, focus: document.activeElement && document.activeElement.dataset.sec };
        }, k);
        chk(pill.current === 'true' && pill.on.length === 1 && pill.on[0] === k,
          `[${theme}] click ${k}: exactly that pill is on and aria-current`, JSON.stringify(pill));
        chk(pill.focus === k, `[${theme}] click ${k}: focus moved into the section`, String(pill.focus));
        await page.screenshot({ path: path.join(OUT, `settings-${theme}-${k}.png`), fullPage: false });
      }

      // #2618 absence assertion: the Styles tab is gone in BOTH places (a removal
      // ships with a guard, or a later refactor re-adds it silently). Checks the nav
      // button, the section, and that 'styles' is not a reachable settings section.
      const styleGone = await page.evaluate(() => ({
        navBtn: !document.querySelector('#s-nav button[data-go="styles"]'),
        section: !document.getElementById('s-sec-styles'),
        notInSections: (typeof SETTINGS_SECTIONS === 'undefined') || !SETTINGS_SECTIONS.includes('styles'),
      }));
      chk(styleGone.navBtn && styleGone.section && styleGone.notInSections,
        `[${theme}] #2618: no Styles nav button, no s-sec-styles section, not in SETTINGS_SECTIONS`, JSON.stringify(styleGone));

      // The switches resolved and are measurable from inside their sections.
      /* #2623: tell-toggle and notify-toggle (the telemetry opt-outs) were
         DELETED (Josh, 2026-09-09, "invasion of privacy"), so 'updates' now
         carries only auto-toggle. */
      /* #2054: lim-toggle moved into 'automation' (the Agents Talking tab was
         deleted). ah-toggle and hb-toggle are the Auto-save/Prompter sliders now
         living there too, so they get the same on-screen-with-a-position check. */
      const WHERE = { 'lim-toggle': 'automation', 'ah-toggle': 'automation', 'hb-toggle': 'automation', 'auto-toggle': 'updates', 'eng-toggle': 'advanced' };
      for (const id of Object.keys(WHERE)) {
        await page.click('#s-nav button[data-go="' + WHERE[id] + '"]');
        await page.waitForTimeout(150);
        const sw = await page.evaluate((id) => {
          const e = document.getElementById(id);
          return { hidden: e.hidden, checked: e.getAttribute('aria-checked'), h: e.getBoundingClientRect().height };
        }, id);
        chk(sw.hidden === false && sw.h > 10 && (sw.checked === 'true' || sw.checked === 'false'),
          `[${theme}] ${id} is on screen in ${WHERE[id]} with a real position`, JSON.stringify(sw));
      }

      // Above 60rem (the page opened at 1400): the nav and a 34rem section as
      // one centred pair, equal gutters either side. This is the regime the
      // 60rem rule hands over to; without an assertion here only a
      // screenshot would show it going.
      // #1481: record WHY, not just WHAT. This assertion has been failing
      // intermittently at roughly 4 runs in 9, and every reading anybody holds
      // comes from a PASSING run, so nobody has ever seen the state during a
      // failure. The two observed modes are 327/327 and 319.5/334.5, which sum
      // to the SAME 654: one gap, either even or 7.5px off centre. A 15px
      // displacement is scrollbar-shaped, and a DOCUMENT scrollbar is already
      // ruled out (clientWidth excludes it, so the total would drop to 639 and
      // it does not). The remaining candidate is a scrolled ANCESTOR, whose
      // scrollbar narrows the box the pair centres inside while leaving
      // documentElement.clientWidth at 1400.
      //
      // These fields are DIAGNOSTIC ONLY. No assertion reads them, so this
      // cannot change any verdict; it only means the next failure explains
      // itself. Overflow is already recorded at 920px and 420px, and 1400px is
      // the only width that fails, so it was the one width with no data.
      const pair = await page.evaluate(() => {
        const navEl = document.getElementById('s-nav');
        const secEl = document.querySelector('#panel-settings .dsec:not([hidden])');
        const nav = navEl.getBoundingClientRect();
        const sec = secEl.getBoundingClientRect();
        const vw = document.documentElement.clientWidth;

        // Every ancestor of the section that is actually scrolling, and the
        // width its scrollbar is taking. `bar` is the number that matters: a
        // non-zero bar on an ancestor narrows the box the pair centres inside.
        const scrolledAncestors = [];
        for (let el = secEl; el && el !== document.documentElement; el = el.parentElement) {
          const bar = el.offsetWidth - el.clientWidth;
          if (bar > 0 || el.scrollHeight > el.clientHeight + 1) {
            scrolledAncestors.push({
              id: el.id || null,
              cls: (el.className || '').toString().slice(0, 40) || null,
              bar,
              scrollH: el.scrollHeight,
              clientH: el.clientHeight,
            });
          }
        }

        /* 🛑 GUTTERS ARE MEASURED INSIDE .dbody, WHICH IS WHAT THE PAIR IS
           CENTRED IN. They used to be nav.left and (clientWidth - sec.right),
           i.e. measured against the VIEWPORT, and that made this assertion fail
           whenever `scrollbar-gutter: stable` reserved its 15px: .dbody became
           1337 inside a 1400 clientWidth and the gutters read 319.5 / 334.5,
           7.5px off centre, while the pair was perfectly centred in its own
           container the whole time.
           ⇒ Measured inside .dbody they are 303/303 without the reservation and
           295.5/295.5 with it: equal either way, and still unequal if the pair
           is genuinely off centre, which is the thing this line claims to test.
           The viewport-relative numbers are kept below as diagnostics. */
        const dbody = secEl.closest('.dbody').getBoundingClientRect();
        return {
          navWidth: nav.width,
          secWidth: sec.width,
          leftGutter: nav.left - dbody.left,
          rightGutter: dbody.right - sec.right,
          // diagnostics: the old viewport-relative pair, which is what moves
          viewportLeftGutter: nav.left,
          viewportRightGutter: vw - sec.right,
          // diagnostic only, asserted on by nothing
          docBar: window.innerWidth - vw,
          clientWidth: vw,
          innerWidth: window.innerWidth,
          scrolledAncestors,
          // The one stylesheet rule that reserves exactly this much width is
          //   html:not([data-layout="consolidated"]) { scrollbar-gutter: stable; }
          // so whether it applies is worth recording: if `layout` differs
          // between a passing and a failing run, the 15px reservation is
          // toggling and that is the intermittency.
          layout: document.documentElement.dataset.layout || null,
          gutterRuleApplies:
            document.documentElement.dataset.layout !== 'consolidated',
          htmlBar:
            document.documentElement.offsetWidth -
            document.documentElement.clientWidth,
          bodyWidth: document.body.getBoundingClientRect().width,
          dbodyWidth: (() => {
            const b = secEl.closest('.dbody');
            return b ? b.getBoundingClientRect().width : null;
          })(),
        };
      });
      chk(pair.navWidth > 0 && Math.abs(pair.secWidth - 544) <= 1, `[${theme}] at 1400px the section is the 34rem measure`, JSON.stringify(pair));
      chk(Math.abs(pair.leftGutter - pair.rightGutter) <= 4, `[${theme}] at 1400px the nav and section sit as one centred pair`, JSON.stringify(pair));

      // The band between the phone rule (56rem) and the centred pair (60rem):
      // the nav stays beside a FLUID section that starts at the gutter. This
      // is the only place that width is rendered; the phone fix restated the
      // Settings rule inside the 56rem block and must not reach up here.
      await page.setViewportSize({ width: 920, height: 900 });
      await page.waitForTimeout(300);
      const band = await page.evaluate(() => {
        const nav = document.getElementById('s-nav').getBoundingClientRect();
        const sec = document.querySelector('#panel-settings .dsec:not([hidden])').getBoundingClientRect();
        return { navWidth: nav.width, navRight: nav.right, secLeft: sec.left, secWidth: sec.width, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
      });
      // navWidth > 0: a detached or display:none nav has a zero rect, and 0 <= anything
      chk(band.navWidth > 0 && band.navRight <= band.secLeft + 1, `[${theme}] at 920px the nav sits beside the section`, JSON.stringify(band));
      chk(band.secWidth > 544 + 1, `[${theme}] at 920px the section is fluid, wider than the 34rem pair`, JSON.stringify(band));
      chk(!band.overflow, `[${theme}] at 920px the page does not scroll sideways`);

      // Narrow: the nav becomes a row above the content, and nothing overflows.
      await page.setViewportSize({ width: 420, height: 900 });
      await page.waitForTimeout(300);
      const narrow = await page.evaluate(() => {
        const nav = document.getElementById('s-nav').getBoundingClientRect();
        const sec = document.querySelector('#panel-settings .dsec:not([hidden])').getBoundingClientRect();
        return { navHeight: nav.height, navBottom: nav.bottom, secTop: sec.top, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
      });
      chk(narrow.navHeight > 0 && narrow.navBottom <= narrow.secTop + 1, `[${theme}] at 420px the nav sits above the section`, JSON.stringify(narrow));
      chk(!narrow.overflow, `[${theme}] at 420px the page does not scroll sideways`);
      await page.screenshot({ path: path.join(OUT, `settings-${theme}-narrow.png`), fullPage: false });

      /* #718 phone (375x667, the smallest of the four #718 sizes). The pills are ONE row that
         scrolls sideways inside the nav, the page itself never does, and picking a pill off the
         right edge brings it into view. Fields are 16px (iOS zooms the page for smaller) and the
         controls are 44px to tap. The pill count is asserted first so "one row" cannot pass on
         a nav that lost its pills. */
      await page.setViewportSize({ width: 375, height: 667 });
      await page.click('#s-nav button[data-go="you"]');
      await page.waitForTimeout(300);
      const phone = await page.evaluate(() => {
        const nav = document.getElementById('s-nav');
        const pills = [...nav.querySelectorAll('button[data-go]')];
        return {
          pills: pills.length,
          rows: new Set(pills.map((b) => Math.round(b.getBoundingClientRect().top))).size,
          navScrolls: nav.scrollWidth > nav.clientWidth,
          pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          minPillH: Math.min(...pills.map((b) => b.getBoundingClientRect().height)),
          nameFont: parseFloat(getComputedStyle(document.getElementById('you-name')).fontSize),
          saveH: document.getElementById('you-name-save').getBoundingClientRect().height,
        };
      });
      chk(phone.pills >= 9 && phone.rows === 1, `[${theme}] at 375px the section pills are one row`, JSON.stringify(phone));
      chk(phone.navScrolls && !phone.pageOverflow, `[${theme}] at 375px the pill row scrolls inside itself and the page does not scroll sideways`, JSON.stringify(phone));
      chk(phone.minPillH >= 44 && phone.saveH >= 44, `[${theme}] at 375px pills and the Save button are at least 44px tall`, JSON.stringify(phone));
      chk(phone.nameFont >= 16, `[${theme}] at 375px the name field is at least 16px, so iOS does not zoom`, JSON.stringify(phone));

      /* Control first: the last pill starts past the nav's right edge. The click is an in-page
         el.click(), because Playwright's own click scrolls its target into view and would pass
         this with settingsGo doing nothing. */
      const offEdge = await page.evaluate(() => {
        const n = document.getElementById('s-nav').getBoundingClientRect();
        return document.querySelector('#s-nav button[data-go="advanced"]').getBoundingClientRect().left > n.right;
      });
      chk(offEdge, `[${theme}] control: at 375px the last pill starts past the nav's right edge`);
      await page.evaluate(() => document.querySelector('#s-nav button[data-go="advanced"]').click());
      await page.waitForTimeout(300);
      const last = await page.evaluate(() => {
        const n = document.getElementById('s-nav').getBoundingClientRect();
        const c = document.querySelector('#s-nav button[data-go="advanced"]').getBoundingClientRect();
        return { navL: n.left, navR: n.right, pillL: c.left, pillR: c.right, scrollY: window.scrollY };
      });
      chk(last.pillL >= last.navL - 1 && last.pillR <= last.navR + 1, `[${theme}] at 375px the chosen last pill is scrolled into view`, JSON.stringify(last));

      /* A MIDDLE pill is centred, not merely in view: the last pill sits at the clamped end of
         the scroll, where centring and snapping cannot disagree, so only a middle one tests it. */
      const mid = await page.evaluate(async () => {
        const pills = [...document.querySelectorAll('#s-nav button[data-go]')];
        const b = pills[Math.floor(pills.length / 2)];
        b.click();
        await new Promise((r) => setTimeout(r, 600));
        const nav = document.getElementById('s-nav');
        const n = nav.getBoundingClientRect(), c = b.getBoundingClientRect();
        const cs = getComputedStyle(nav);
        const boxL = n.left + parseFloat(cs.borderLeftWidth), boxR = boxL + nav.clientWidth;
        return { go: b.dataset.go, off: Math.round((c.left + c.width / 2) - (boxL + boxR) / 2), scrollLeft: nav.scrollLeft };
      });
      chk(mid.scrollLeft > 0 && Math.abs(mid.off) <= 3, `[${theme}] at 375px a middle pill (${mid.go}) is centred in the row`, JSON.stringify(mid));

      // The needs-you dot on a pill clears its label (the phone padding is narrower than desktop).
      const dot = await page.evaluate(() => {
        const b = document.querySelector('#s-nav button[data-go="plus"]');
        const had = b.hasAttribute('data-dot');
        b.setAttribute('data-dot', '');
        const d = b.querySelector('.dot');
        // The visible label is the first span; the button also holds a visually hidden
        // "(needs you)" span, whose off-screen box must not count as the label.
        const range = document.createRange();
        range.selectNodeContents(b.querySelector('span:not(.dot):not(.vh)') || b);
        const out = { hasDot: !!d, textR: range.getBoundingClientRect().right, dotL: d ? d.getBoundingClientRect().left : null };
        if (!had) b.removeAttribute('data-dot');
        return out;
      });
      chk(dot.hasDot && dot.dotL >= dot.textR + 2, `[${theme}] at 375px the needs-you dot on a pill clears its label`, JSON.stringify(dot));

      // The Kosmos Plus sign-in pill is 44px tall with its label centred in it.
      await page.evaluate(() => document.querySelector('#s-nav button[data-go="plus"]').click());
      await page.waitForTimeout(400);
      const signin = await page.evaluate(() => {
        const a = document.getElementById('plus-signin-top');
        if (!a || !a.getClientRects().length) return null;
        const r = a.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(a);
        const t = range.getBoundingClientRect();
        return { h: r.height, off: Math.round((t.top + t.height / 2) - (r.top + r.height / 2)) };
      });
      chk(signin && signin.h >= 44 && Math.abs(signin.off) <= 2, `[${theme}] at 375px the Kosmos Plus sign-in pill is 44px with its label centred`, JSON.stringify(signin));
      const signinLow = await page.evaluate(() => {
        const a = document.getElementById('plus-signin-bottom');
        if (!a || !a.getClientRects().length) return null;
        const r = a.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(a);
        const t = range.getBoundingClientRect();
        return { h: r.height, off: Math.round((t.top + t.height / 2) - (r.top + r.height / 2)) };
      });
      chk(signinLow && signinLow.h >= 44 && Math.abs(signinLow.off) <= 2, `[${theme}] at 375px the lower Kosmos Plus sign-in link is 44px with its label centred`, JSON.stringify(signinLow));

      // A switch keeps its drawn size; a point just above it, inside the 44px band, still hits it.
      // tips-toggle is always shown (eng-toggle ships hidden), in the This Mac section, so open
      // that section first: the step above left Kosmos Plus on screen.
      await page.evaluate(() => document.querySelector('#s-nav button[data-go="mac"]').click());
      await page.waitForTimeout(400);
      const hit = await page.evaluate(() => {
        const t = document.getElementById('tips-toggle');
        t.scrollIntoView({ block: 'center' });
        const r = t.getBoundingClientRect();
        const at = document.elementFromPoint(r.left + r.width / 2, r.top - 8);
        return { h: r.height, hits: !!at && (at === t || t.contains(at)) };
      });
      chk(hit.h < 44 && hit.hits, `[${theme}] at 375px a switch keeps its drawn size and a tap 8px above it lands on it`, JSON.stringify(hit));
      await page.screenshot({ path: path.join(OUT, `settings-${theme}-phone.png`), fullPage: false });

      /* The current pill is centred on the two paths that do not go through a pill click:
         a section chosen while Settings is hidden (showTab brings it back), and a section chosen
         at desktop width before the window narrows to a phone. Each starts from scrollLeft 0,
         so a pass means the page moved the row. Each uses its own middle pill that no step at
         phone width clicked ('policy', then 'automation'): Chrome's scroll-snap restores the
         pill it last snapped to, which would centre a previously clicked pill with no help. */
      const centred = (go) => page.evaluate((key) => {
        const nav = document.getElementById('s-nav');
        const b = nav.querySelector('button[data-go="' + key + '"]');
        const n = nav.getBoundingClientRect(), c = b.getBoundingClientRect();
        const boxL = n.left + nav.clientLeft, boxR = boxL + nav.clientWidth;
        return { go: key, on: b.classList.contains('on'), off: Math.round((c.left + c.width / 2) - (boxL + boxR) / 2), scrollLeft: nav.scrollLeft };
      }, go);
      await page.evaluate(() => {
        if (document.activeElement) document.activeElement.blur();
        showTab('agents');
        document.getElementById('s-nav').scrollLeft = 0;
        settingsGo('policy', { focus: false });
        showTab('settings');
      });
      await page.waitForTimeout(400);
      const viaShow = await centred('policy');
      chk(viaShow.on && viaShow.scrollLeft > 0 && Math.abs(viaShow.off) <= 3,
        `[${theme}] at 375px a section chosen while Settings was hidden is centred when Settings shows`, JSON.stringify(viaShow));
      await page.setViewportSize({ width: 1400, height: 950 });
      await page.waitForTimeout(300);
      await page.evaluate(() => { document.getElementById('s-nav').scrollLeft = 0; settingsGo('automation', { focus: false }); });
      await page.setViewportSize({ width: 375, height: 667 });
      await page.waitForTimeout(500);
      const viaResize = await centred('automation');
      chk(viaResize.on && viaResize.scrollLeft > 0 && Math.abs(viaResize.off) <= 3,
        `[${theme}] a section chosen at desktop width is centred once the window narrows to 375px`, JSON.stringify(viaResize));

      /* A checkbox is tapped through its label, so each label wrapping one in Settings is at
         least 44px tall. The Automation guards only show while the recommender is on, so the
         check shows their row itself; it counts them first, so an empty set cannot pass. It runs
         after the centring checks, which need 'automation' unclicked at this width. */
      await page.evaluate(() => document.querySelector('#s-nav button[data-go="automation"]').click());
      await page.waitForTimeout(300);
      const boxes = await page.evaluate(() => {
        const row = document.getElementById('rec-guards-row');
        const was = row.hidden; row.hidden = false;
        const out = [...document.querySelectorAll('#panel-settings .dsec label')]
          .filter((l) => l.querySelector(':scope > input[type="checkbox"], :scope > input[type="radio"]') && l.getClientRects().length)
          .map((l) => Math.round(l.getBoundingClientRect().height));
        row.hidden = was;
        return out;
      });
      chk(boxes.length >= 3 && boxes.every((h) => h >= 44), `[${theme}] at 375px every checkbox label in Settings is at least 44px tall`, JSON.stringify(boxes));

      // The widest #718 phone (430) is still one row and still does not scroll sideways.
      await page.setViewportSize({ width: 430, height: 932 });
      await page.waitForTimeout(300);
      const wide = await page.evaluate(() => {
        const pills = [...document.querySelectorAll('#s-nav button[data-go]')];
        return {
          pills: pills.length,
          rows: new Set(pills.map((b) => Math.round(b.getBoundingClientRect().top))).size,
          pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      });
      chk(wide.pills >= 9 && wide.rows === 1 && !wide.pageOverflow, `[${theme}] at 430px the pills are one row and the page does not scroll sideways`, JSON.stringify(wide));

      chk(errs.length === 0, `[${theme}] no page errors`, errs.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
    fleet.restore();
  }
  console.log('screenshots: ' + OUT);
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
