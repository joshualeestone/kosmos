// Browser-check-surface: d-talk-label d-talk-search d-talk-box d-dmthread msg msg-bd msg-av msg-nm msg-t
'use strict';

/**
 * #3414 (Josh, 2026-09-22): the single-agent DM ("Talk to <agent>") is rebuilt to reuse the
 * project consolidated-view conversation UI. This asserts, on the REAL rendered DM:
 *   - agent rows render as the room's `.msg` bubble (gray, left) with an avatar (.msg-av), the
 *     agent name bold INSIDE the bubble (.msg-nm), and the timestamp INSIDE the bubble (.msg-t
 *     inside .msg-bd) -- NOT the old .dm/.dm-b/.dm-w markup, NOT a timestamp below the bubble;
 *   - the person's rows render as `.msg.you` (blue, right) with a .msg-av.mine and NO name;
 *   - the header is "Direct Message to <agent>" in the big project-name font (not the small
 *     uppercase .dlab), with the search shrunk to just "Search";
 *   - the "Just between you and <agent>" hint element is GONE;
 *   - the conversation box ground is pure white on light and pure black on dark, scoped to
 *     #d-talk-box, edge-to-edge with no card radius (#3414-followup, Josh 2026-09-23).
 *
 * Harness posture mirrors render-agent-msg-gray-2805.js: load over file://, answer the thread
 * poll from a fixture, set CURRENT, call paintTalk. The paint is what `node --test` cannot see.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-agentdm-3414.js
 */
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');

const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

const now = () => new Date().toISOString();
const FX = {
  messages: [
    { from: 'April', at: now(), text: 'ready when you are.' },
    { at: now(), text: 'what account are you on?', delivery: { state: 'placed', paneState: 'idle', paneNote: 'it was sitting at its prompt' } },
    { from: 'April', at: now(), text: 'the shared one.' },
  ],
  olderCount: 0, historyBecause: null, historyUnfilable: false,
  presence: 'on', presenceBecause: null, asking: false, question: null, questionBecause: null, options: null,
};

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0', ignoreDefaultArgs: ['--hide-scrollbars'] });
  try {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, colorScheme: theme });
      const errs = [];
      page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        if (/ERR_FILE_NOT_FOUND/.test(m.text())) return; // avatar fetch over file:// has no server
        errs.push('console ' + m.text());
      });
      await page.addInitScript(() => {
        window.__fx = null;
        const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
        window.setInterval = () => 0;
        window.fetch = async (url) => {
          const u = String(url);
          if (u.includes('/thread')) return enc(window.__fx);
          if (u.includes('/api/status')) return enc({ agents: [], version: '0.0.0' });
          return enc({});
        };
      });
      await page.goto(PAGE);
      await page.evaluate((f) => {
        window.__fx = f;
        CURRENT = { sessionName: 'april', name: 'April' };
        document.getElementById('panel-detail').hidden = false;
        const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
        document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
      }, FX);
      await page.evaluate(() => paintTalk('april', 'April'));

      const m = await page.evaluate(() => {
        const q = (s) => document.querySelector(s);
        const label = document.getElementById('d-talk-label');
        const box = document.getElementById('d-talk-box');
        const agent = q('#d-dmthread .msg:not(.you)');
        const mine = q('#d-dmthread .msg.you');
        return {
          agentCount: document.querySelectorAll('#d-dmthread .msg:not(.you)').length,
          mineCount: document.querySelectorAll('#d-dmthread .msg.you').length,
          oldDmCount: document.querySelectorAll('#d-dmthread .dm, #d-dmthread .dm-b, #d-dmthread .dm-w').length,
          agentHasAv: !!(agent && agent.querySelector('.msg-av')),
          agentHasName: !!(agent && agent.querySelector('.msg-bd .msg-nm')),
          // The DM agent name/avatar must NOT carry data-open-agent: the click handler is
          // bound to #pj-room only, and the DM already lives inside m.from's detail panel.
          agentHasOpen: !!(agent && (agent.querySelector('.msg-nm[data-open-agent]') || agent.querySelector('.msg-av[data-open-agent]'))),
          agentTimeInsideBubble: !!(agent && agent.querySelector('.msg-bd .msg-t')),
          mineHasAv: !!(mine && mine.querySelector('.msg-av')),
          // The generic fetch stub answers the /api/you/avatar HEAD probe 200, so refreshYou
          // treats the operator as having a picture and the user avatar takes the PHOTO branch:
          // a plain .msg-av (the img fills it); .mine is only for the no-photo disc. This pins
          // that dmRow matches pjRoomRow and does not re-add .mine to the photo case (#3414).
          // If that probe ever stops answering 200, this arm reds (no img), it never silently
          // shifts to the disc path.
          minePhotoIsPlain: !!(mine && mine.querySelector('.msg-av img') && !mine.querySelector('.msg-av.mine')),
          mineTimeInsideBubble: !!(mine && mine.querySelector('.msg-bd .msg-t')),
          mineHasName: !!(mine && mine.querySelector('.msg-nm')),
          // #3498 (Josh, 2026-09-23): the sender name must MATCH body-copy size (13px), not the
          // old couple-points-larger 15px, and stay bold. .msg-nm is ONE shared class emitted by
          // both dmRow (this DM) and pjRoomRow (the consolidated + tab project dialogs), so this
          // single measurement pins the size for all three surfaces Josh named.
          agentNameFontPx: agent ? Math.round(parseFloat(getComputedStyle(agent.querySelector('.msg-nm')).fontSize)) : null,
          agentNameWeight: agent ? parseInt(getComputedStyle(agent.querySelector('.msg-nm')).fontWeight, 10) : null,
          bubbleBodyFontPx: agent ? Math.round(parseFloat(getComputedStyle(agent.querySelector('.msg-bd')).fontSize)) : null,
          labelText: label ? (label.textContent || '') : null,
          labelFontPx: label ? parseFloat(getComputedStyle(label).fontSize) : null,
          searchPlaceholder: (document.getElementById('d-talk-search') || {}).placeholder,
          hintPresent: !!document.getElementById('d-talk-hint'),
          boxRadius: box ? getComputedStyle(box).borderTopLeftRadius : null,
          boxBg: box ? getComputedStyle(box).backgroundColor : null,
        };
      });
      const t = `[${theme}]`;

      chk(m.agentCount >= 1 && m.mineCount >= 1, `${t} both an agent .msg and a user .msg.you render`, `agent=${m.agentCount} mine=${m.mineCount}`);
      chk(m.oldDmCount === 0, `${t} no old .dm/.dm-b/.dm-w markup remains in the DM thread`, `oldDm=${m.oldDmCount}`);
      chk(m.agentHasAv, `${t} the agent bubble has an avatar (.msg-av)`);
      chk(m.agentHasName, `${t} the agent name is bold INSIDE the bubble (.msg-bd .msg-nm)`);
      chk(m.agentHasOpen === false, `${t} the DM agent name/avatar are NOT click-to-open (no dead data-open-agent affordance)`);
      chk(m.agentTimeInsideBubble, `${t} the agent timestamp is INSIDE the bubble (.msg-bd .msg-t)`);
      chk(m.mineHasAv, `${t} the user bubble has the user avatar (.msg-av)`);
      chk(m.minePhotoIsPlain, `${t} the user photo avatar is a plain .msg-av, no .mine (matches the room, #3414)`);
      chk(m.mineTimeInsideBubble, `${t} the user timestamp is INSIDE the bubble (.msg-bd .msg-t)`);
      chk(m.mineHasName === false, `${t} the user bubble carries NO name (operator row, #3130)`);
      // #3498: sender name matches body copy (13px) and stays bold; shared .msg-nm class covers
      // the consolidated dialog, the tab-view dialog and this DM in one rule.
      chk(m.agentNameFontPx === 13, `${t} the sender name (.msg-nm) matches body-copy size 13px (#3498)`, `${m.agentNameFontPx}px`);
      chk(m.agentNameFontPx === m.bubbleBodyFontPx, `${t} the sender name equals the bubble body-copy size (#3498)`, `name=${m.agentNameFontPx} body=${m.bubbleBodyFontPx}`);
      chk(m.agentNameWeight >= 600, `${t} the sender name stays bold (>=600) (#3498)`, `${m.agentNameWeight}`);
      chk(/^Direct Message to /.test(m.labelText || ''), `${t} the header reads "Direct Message to <agent>"`, JSON.stringify(m.labelText));
      chk(m.labelFontPx >= 20, `${t} the header uses the big project-name font (>= 20px), not the small .dlab`, `${m.labelFontPx}px`);
      chk(m.searchPlaceholder === 'Search', `${t} the search placeholder is just "Search"`, JSON.stringify(m.searchPlaceholder));
      chk(m.hintPresent === false, `${t} the "Just between you and <agent>" hint element is gone`);
      chk(m.boxRadius === '0px', `${t} the conversation box has no card radius (edge-to-edge)`, m.boxRadius);
      // #3414-followup (Josh 2026-09-23): the dialogue-area ground is pure white on light and
      // pure black on dark, scoped to #d-talk-box (not the theme off-white --k-bg). Compared to
      // a literal rgb() per theme, so a box that stops being pure white/black reds here.
      const wantBg = theme === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
      chk(m.boxBg === wantBg, `${t} the dialogue box ground is ${wantBg} (pure ${theme === 'dark' ? 'black' : 'white'})`, `bg=${m.boxBg}`);
      chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
      if (process.env.SHOT_DIR) {
        await page.screenshot({ path: path.join(process.env.SHOT_DIR, 'agentdm-' + theme + '.png') }).catch(() => {});
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
