'use strict';
// Browser-check-surface: dmbadge lrow onode
// (Deliberately declares lrow + onode, not just dmbadge: this check ASSERTS placement
//  relative to the list row / org node structure -- the badge over the `.lav` corner in
//  `.lrow`, top-left of `.onode` opposite `.owarn`, and not hidden by the consolidated
//  `.lrow` catch-all -- so a restructuring of those surfaces can stale these assertions,
//  which is exactly what the #2518 gate should flag. The friction of the two being core
//  classes is the intended cost of that staleness-catch; a narrower `dmbadge`-only
//  declaration was considered and rejected because it would leave the placement
//  assertions unguarded against a `.lrow`/`.onode` change.)
// #3131 + #3187 (Josh 6.70) touched `.lrow`: lrow() now wraps the state glyph+word in
// a .vh span (status is a ground colour, not text) and .lrow carries a grey/green/red
// wash. Reviewed for this change and no assertion update needed: the DM badge sits
// absolutely over the `.lav` corner and the consolidated `:not(.dmbadge)` catch-all
// exemption is unchanged, so neither the wash nor the hidden state word moves or clips
// the badge. This note records the surface review the #2518 gate asks for.
// #2863: the unread-DM bubble on the LIST row and the ORG node -- the follow-up to
// the grid-card badge (#2885), from the same `a.dmUnread` and the same dmBadge()
// helper. This drives the REAL list/org render on the REAL page with a seeded
// dmUnread and asserts, with controls that can fail on the dangerous answer:
//   - the badge renders and is LAID OUT (not a zero-size node clipped away by the
//     overflow:hidden list avatar, which is exactly why the list badge is a child
//     of the row rather than the avatar);
//   - it sits at the intended corner (over the avatar on the list; top-LEFT on the
//     org node, opposite the top-right needs-you badge so the two never collide);
//   - an agent with no unread DMs shows NO badge (the negative control).
// Mirrors render-org-rings-2576.js's harness (fleet.install + mutate LAST + re-drive).
// Own sandbox env, set BEFORE requiring server.js (which reads it at load and
// refuses to boot half-sandboxed): a throwaway workers/data/projects/launch tree
// and a stub tmux, so fleet.install writes no real worker file and the board reads
// no real fleet. The same preamble every self-contained check in this dir uses.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dm-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dm-workers-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dm-config-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dm-launch-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dm-projects-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  fleet.install([
    fleet.agent('ada', { state: 'needs_you', displayName: 'Ada', role: 'Reviewer' }),
    fleet.agent('bram', { state: 'working', displayName: 'Bram', role: 'Builder' }),
    fleet.agent('cleo', { state: 'idle', displayName: 'Cleo', role: 'Scout' }),
  ]);

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
      await page.waitForTimeout(600);

      // ── LIST ──────────────────────────────────────────────────────────────
      await page.click('[data-scope="agents"] .vt[data-layout="list"]');
      await page.waitForTimeout(400);
      const list = await page.evaluate(() => {
        // ada: 3 unread DMs; bram: 1; cleo: none (the negative control).
        for (const a of (LAST || [])) {
          if (a.sessionName === 'ada') a.dmUnread = 3;
          else if (a.sessionName === 'bram') a.dmUnread = 1;
          else if (a.sessionName === 'cleo') a.dmUnread = 0;
        }
        // Render the list directly through the real lrow() so the badge is exercised
        // in a real positioned .lrow (dmBadge suppresses CURRENT; none is open here).
        document.getElementById('alist').innerHTML = (LAST || []).map(lrow).join('');
        return [...document.querySelectorAll('#alist .lrow')].map((r) => {
          const b = r.querySelector('.dmbadge');
          const av = r.querySelector('.lav');
          const br = b ? b.getBoundingClientRect() : null;
          const ar = av ? av.getBoundingClientRect() : null;
          const rr = r.getBoundingClientRect();
          return {
            agent: r.getAttribute('data-agent'),
            hasBadge: !!b,
            txt: b ? b.textContent : null,
            laidOut: !!(br && br.width > 0 && br.height > 0),
            // #3339: the badge now sits at the ROW's top-right corner (right:-6px; top:-6px),
            // not over the avatar/name. So its right edge is at the row's right edge (a ~6px
            // outward hang), its top is at the row top (a ~6px hang above), and it is clearly
            // to the RIGHT of the avatar -- off the name. A badge left over the avatar/name
            // (br.left near the avatar) fails this; one clipped away fails width/height above.
            atRightOfCell: !!(br && ar && br.right >= rr.right - 2 && br.right <= rr.right + 12
              && br.top <= rr.top + 2 && br.top >= rr.top - 14 && br.left > ar.right),
          };
        });
      });
      const adaL = list.find((r) => r.agent === 'ada');
      const cleoL = list.find((r) => r.agent === 'cleo');
      chk(!!adaL && adaL.hasBadge && adaL.laidOut && adaL.txt === '3',
        theme + ' list: an agent with 3 unread DMs shows a laid-out badge reading 3', JSON.stringify(adaL));
      chk(!!adaL && adaL.atRightOfCell,
        theme + ' list: #3339 the badge sits at the ROW\'s right corner (right of the avatar/name), not clipped or off-row', JSON.stringify(adaL));
      chk(!!cleoL && !cleoL.hasBadge,
        theme + ' list: an agent with no unread DMs shows NO badge (control)', JSON.stringify(cleoL));

      // ── ORG ───────────────────────────────────────────────────────────────
      await page.click('[data-scope="agents"] .vt[data-layout="org"]');
      await page.waitForTimeout(400);
      await page.waitForSelector('#orgmap .onode', { timeout: 8000 });
      const org = await page.evaluate(() => {
        for (const a of (LAST || [])) {
          if (a.sessionName === 'ada') a.dmUnread = 3;
          else if (a.sessionName === 'bram') a.dmUnread = 1;
          else if (a.sessionName === 'cleo') a.dmUnread = 0;
        }
        ORG_HTML = null; paintOrg();
        return [...document.querySelectorAll('#orgmap .onode')].map((n) => {
          const b = n.querySelector('.dmbadge');
          const w = n.querySelector('svg.owarn');
          const br = b ? b.getBoundingClientRect() : null;
          const wr = w ? w.getBoundingClientRect() : null;
          const nr = n.getBoundingClientRect();
          return {
            agent: n.getAttribute('data-agent'),
            hasBadge: !!b,
            txt: b ? b.textContent : null,
            laidOut: !!(br && br.width > 0 && br.height > 0),
            // top-left: left of the node's centre and above its centre.
            topLeft: !!(br && br.left < nr.left + nr.width / 2 && br.top < nr.top + nr.height / 2),
            hasWarn: !!w,
            // ada is needs_you AND has DMs: the two badges must be on opposite
            // horizontal sides (DM left, warn right), not stacked on one corner.
            oppositeSides: !w || !b || (br.left < wr.left),
            // The badge's own aria-label is inert inside a button that carries its
            // own aria-label, so the unread count must be folded into the button's
            // accessible name (like ', needs you'). Read the button's aria-label.
            btnAriaUnread: /unread/.test(n.getAttribute('aria-label') || ''),
          };
        });
      });
      const adaO = org.find((r) => r.agent === 'ada');
      const cleoO = org.find((r) => r.agent === 'cleo');
      chk(!!adaO && adaO.hasBadge && adaO.laidOut && adaO.txt === '3',
        theme + ' org: a node with 3 unread DMs shows a laid-out badge reading 3', JSON.stringify(adaO));
      chk(!!adaO && adaO.topLeft,
        theme + ' org: the DM badge is top-left', JSON.stringify(adaO));
      chk(!!adaO && adaO.hasWarn && adaO.oppositeSides,
        theme + ' org: the DM badge (left) and the needs-you badge (right) do not collide', JSON.stringify(adaO));
      chk(!!cleoO && !cleoO.hasBadge,
        theme + ' org: a node with no unread DMs shows NO badge (control)', JSON.stringify(cleoO));
      chk(!!adaO && adaO.btnAriaUnread,
        theme + ' org: the unread-DM count is folded into the node button aria-label (the badge aria-label is inert inside a labeled button)', JSON.stringify(adaO));
      chk(!!cleoO && !cleoO.btnAriaUnread,
        theme + ' org: a no-unread node does not claim unread in its aria-label (control)', JSON.stringify(cleoO));

      // ── messages-filter (Josh 2026-09-19) ──────────────────────────────────
      // The #st-dm "Messages" tile is a toggle: filter the agents board to agents with
      // 1+ messages. In the ORG view the no-message nodes DIM (opacity down) while the tree
      // (nodes + wires) stays -- the UI-owner call for org; grid/list use display:none. A
      // "View all agents" link and a second tile click both exit. Fleet: ada+bram have unread
      // DMs, cleo does not (the non-vacuous control: cleo carries no data-has-msgs, so it dims).
      const filt = await page.evaluate(() => {
        for (const a of (LAST || [])) {
          if (a.sessionName === 'ada') a.dmUnread = 3;
          else if (a.sessionName === 'bram') a.dmUnread = 1;
          else if (a.sessionName === 'cleo') a.dmUnread = 0;
        }
        ORG_HTML = null; paintOrg();
        const tile = document.getElementById('st-dm-tile');
        tile.hidden = false;   // messages exist, so the tile is shown in reality
        const opOf = (ag) => { const n = document.querySelector('#orgmap .onode[data-agent="' + ag + '"]'); return n ? Number(getComputedStyle(n).opacity) : null; };
        const exit = document.querySelector('.board-msgfilter-exit');
        const beforeExitShown = exit ? getComputedStyle(exit).display !== 'none' : true; // hidden before filtering
        tile.click();          // turn the filter ON through the real handler
        const out = {
          on: document.body.classList.contains('filter-msgs'),
          pressed: tile.getAttribute('aria-pressed'),
          adaOp: opOf('ada'), cleoOp: opOf('cleo'),
          exitBefore: beforeExitShown,
          exitDuring: exit ? getComputedStyle(exit).display !== 'none' : false,
        };
        if (exit) exit.click(); // exit via "View all agents"
        out.offAfterExit = !document.body.classList.contains('filter-msgs');
        out.cleoOpAfter = opOf('cleo');
        return out;
      });
      chk(filt.on === true && filt.pressed === 'true',
        theme + ' filter: clicking the Messages tile turns the filter on (body.filter-msgs + aria-pressed)', JSON.stringify(filt));
      chk(filt.cleoOp !== null && filt.cleoOp < 0.5 && filt.adaOp === 1,
        theme + ' filter/org: a no-message node DIMS while a with-message node stays full (tree kept)', JSON.stringify(filt));
      chk(filt.exitBefore === false && filt.exitDuring === true,
        theme + ' filter: the "View all agents" exit link is hidden until filtering, then shown', JSON.stringify(filt));
      chk(filt.offAfterExit === true && filt.cleoOpAfter === 1,
        theme + ' filter: "View all agents" exits and restores the dimmed node', JSON.stringify(filt));

      // ── filter/list HIDE + the OFFLINE-agent regression guard ──────────────
      // A blind review caught that card()/lrow()'s NOT-RUNNING early-return branches once
      // omitted data-has-msgs, so an offline agent WITH unread messages was wrongly HIDDEN by
      // the filter (it still badges + counts). Guard both directions in the list view: bram is
      // made offline (running:false) WITH messages and must be SHOWN (its .lrow is a notrunning
      // row, carries data-has-msgs, is not display:none); cleo has no messages and must be
      // display:none. This also covers the grid/list HIDE behavior the org-only block above did not.
      await page.click('[data-scope="agents"] .vt[data-layout="list"]');
      await page.waitForTimeout(300);
      const listFilt = await page.evaluate(() => {
        for (const a of (LAST || [])) {
          if (a.sessionName === 'bram') { a.running = false; a.state = 'off'; a.dmUnread = 2; }
          else if (a.sessionName === 'ada') { a.running = true; a.dmUnread = 3; }
          else if (a.sessionName === 'cleo') { a.dmUnread = 0; }
        }
        document.getElementById('alist').innerHTML = (LAST || []).map(lrow).join('');
        document.getElementById('st-dm-tile').hidden = false;
        document.body.classList.add('filter-msgs');
        const row = (ag) => document.querySelector('#alist .lrow[data-agent="' + ag + '"]');
        const disp = (ag) => { const r = row(ag); return r ? getComputedStyle(r).display : 'missing'; };
        const bram = row('bram');
        const out = {
          bramIsNotRunning: bram ? /notrunning/.test(bram.className) : null,
          bramHasAttr: bram ? bram.hasAttribute('data-has-msgs') : null,
          bramDisp: disp('bram'), adaDisp: disp('ada'), cleoDisp: disp('cleo'),
        };
        document.body.classList.remove('filter-msgs');
        out.cleoDispAfter = disp('cleo');
        return out;
      });
      chk(listFilt.bramIsNotRunning === true && listFilt.bramHasAttr === true && listFilt.bramDisp !== 'none',
        theme + ' filter/list: an OFFLINE agent WITH messages carries data-has-msgs and is SHOWN (not hidden)', JSON.stringify(listFilt));
      chk(listFilt.adaDisp !== 'none' && listFilt.cleoDisp === 'none',
        theme + ' filter/list: a with-message agent is shown, a no-message agent is display:none (hide behavior)', JSON.stringify(listFilt));
      chk(listFilt.cleoDispAfter !== 'none',
        theme + ' filter/list: exiting the filter restores the hidden no-message row', JSON.stringify(listFilt));

      // Restore the ORG view + a running fleet for the boundary/CURRENT-suppression tests below
      // (this block switched to list, took bram offline, and had left the filter on).
      await page.click('[data-scope="agents"] .vt[data-layout="org"]');
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        for (const a of (LAST || [])) {
          if (a.sessionName === 'bram') { a.running = true; a.state = 'working'; a.dmUnread = 1; }
          else if (a.sessionName === 'ada') a.dmUnread = 3;
          else if (a.sessionName === 'cleo') a.dmUnread = 0;
        }
        document.body.classList.remove('filter-msgs');
        ORG_HTML = null; paintOrg();
      });
      await page.waitForSelector('#orgmap .onode', { timeout: 8000 });

      // ── dmAria (org button) and dmBadge (span text) are TWO derivations of one
      //    count, so pin them equal at the boundary cases a single count-3 test never
      //    exercises: the singular n=1 and the >99 cap. If a future edit changes
      //    dmBadge's cap/pluralization but not dmAria (or vice versa), the visible
      //    badge and the screen-reader name silently desync -- this reds on that.
      for (const [n, wantTxt, wantAria] of [[1, '1', '1 unread message'], [150, '99+', '99+ unread messages']]) {
        const bd = await page.evaluate((nn) => {
          for (const a of (LAST || [])) { if (a.sessionName === 'ada') a.dmUnread = nn; }
          ORG_HTML = null; paintOrg();
          const node = document.querySelector('#orgmap .onode[data-agent="ada"]');
          const b = node ? node.querySelector('.dmbadge') : null;
          return { txt: b ? b.textContent : null, aria: node ? node.getAttribute('aria-label') : null };
        }, n);
        chk(bd.txt === wantTxt && (bd.aria || '').includes(wantAria),
          theme + ' org: badge span and button aria agree at n=' + n + ' (want "' + wantTxt + '" / "' + wantAria + '")', JSON.stringify(bd));
      }

      // The CURRENT-suppression predicate is the OTHER fact dmBadge and dmAria each
      // re-derive ("don't badge the agent you're reading"). Pin them equal too: with
      // ada open as CURRENT and a positive count, BOTH the visible badge AND the aria
      // "unread" phrase must be gone. If a future edit changes one suppression but not
      // the other, this reds (a node with a badge but no announcement, or vice versa).
      const supp = await page.evaluate(() => {
        for (const a of (LAST || [])) { if (a.sessionName === 'ada') a.dmUnread = 3; }
        CURRENT = (LAST || []).find((a) => a.sessionName === 'ada') || null;
        ORG_HTML = null; paintOrg();
        const node = document.querySelector('#orgmap .onode[data-agent="ada"]');
        const res = {
          hasBadge: !!(node && node.querySelector('.dmbadge')),
          ariaUnread: /unread/.test((node && node.getAttribute('aria-label')) || ''),
        };
        CURRENT = null; ORG_HTML = null; paintOrg();
        return res;
      });
      chk(!supp.hasBadge && !supp.ariaUnread,
        theme + ' org: the open (CURRENT) agent is suppressed in BOTH the badge and the aria (one suppression, pinned)', JSON.stringify(supp));

      // ── CONSOLIDATED LIST: the badge must NOT be hidden by the catch-all ──
      // The consolidated rail applies `.lrow > :not(.lav)...:not(.dmbadge) { display:none }`.
      // Before the #2863 exemption the badge (a direct .lrow child) was caught by it and went
      // fully invisible in consolidated. Assert the badge's OWN computed display is not none
      // (getComputedStyle resolves the element's own display regardless of ancestor layout),
      // which is the precise guard for the exemption. Control: WITHOUT :not(.dmbadge) this reds.
      const cons = await page.evaluate(() => {
        document.documentElement.setAttribute('data-layout', 'consolidated');
        document.body.classList.add('consolidated');
        for (const a of (LAST || [])) {
          if (a.sessionName === 'ada') a.dmUnread = 3;
          else if (a.sessionName === 'cleo') a.dmUnread = 0;
        }
        document.getElementById('alist').innerHTML = (LAST || []).map(lrow).join('');
        const r = document.querySelector('#alist .lrow[data-agent="ada"]');
        const b = r ? r.querySelector('.dmbadge') : null;
        const disp = b ? getComputedStyle(b).display : null;
        const rc = document.querySelector('#alist .lrow[data-agent="cleo"]');
        const bc = rc ? rc.querySelector('.dmbadge') : null;
        document.documentElement.removeAttribute('data-layout');
        document.body.classList.remove('consolidated');
        return { hasBadge: !!b, display: disp, controlHasBadge: !!bc };
      });
      // display !== 'none' is the PRECISE guard for the exemption (the bug was total
      // invisibility: WITHOUT :not(.dmbadge) the catch-all resolves the badge to
      // display:none, which this reds on). A laidOut/geometry assertion is deliberately
      // NOT made here: setting data-layout + body.consolidated alone does not run the
      // full consolidated grid layout, so the rail subtree has zero geometry in this
      // minimal harness (measured). Placement rides the same `.lrow > .dmbadge` rule
      // the default-list arm above already asserts laid-out at the avatar corner.
      chk(cons.hasBadge && cons.display !== 'none',
        theme + ' consolidated list: the DM badge is exempt from the catch-all hide (own display not none)', JSON.stringify(cons));
      chk(!cons.controlHasBadge,
        theme + ' consolidated list: a no-unread agent still shows no badge (control)', JSON.stringify(cons));

      chk(errs.length === 0, theme + ': no page errors', errs.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
    try { await server.close(); } catch { /* already down */ }
  }

  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nALL PASS');
})().catch((e) => { console.error(e); process.exit(1); });
