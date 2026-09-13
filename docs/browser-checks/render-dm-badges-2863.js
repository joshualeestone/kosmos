'use strict';
// Browser-check-surface: dmbadge
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
            // over the avatar's top half, near its right edge, and inside the row
            // box (a badge clipped away by the avatar would fail width/height above;
            // one mispositioned off the row would fail this).
            atAvatarCorner: !!(br && ar && br.left >= ar.left - 2 && br.left <= ar.right + 18
              && br.top <= ar.top + ar.height / 2 && br.left >= rr.left && br.top >= rr.top - 8),
          };
        });
      });
      const adaL = list.find((r) => r.agent === 'ada');
      const cleoL = list.find((r) => r.agent === 'cleo');
      chk(!!adaL && adaL.hasBadge && adaL.laidOut && adaL.txt === '3',
        theme + ' list: an agent with 3 unread DMs shows a laid-out badge reading 3', JSON.stringify(adaL));
      chk(!!adaL && adaL.atAvatarCorner,
        theme + ' list: the badge sits at the avatar corner, not clipped or off-row', JSON.stringify(adaL));
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
