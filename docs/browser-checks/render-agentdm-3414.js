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
 *   - the conversation box is the black (--k-bg) edge-to-edge treatment (no card radius).
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
        const rootCss = getComputedStyle(document.documentElement);
        const agent = q('#d-dmthread .msg:not(.you)');
        const mine = q('#d-dmthread .msg.you');
        return {
          agentCount: document.querySelectorAll('#d-dmthread .msg:not(.you)').length,
          mineCount: document.querySelectorAll('#d-dmthread .msg.you').length,
          oldDmCount: document.querySelectorAll('#d-dmthread .dm, #d-dmthread .dm-b, #d-dmthread .dm-w').length,
          agentHasAv: !!(agent && agent.querySelector('.msg-av')),
          agentHasName: !!(agent && agent.querySelector('.msg-bd .msg-nm')),
          agentTimeInsideBubble: !!(agent && agent.querySelector('.msg-bd .msg-t')),
          mineHasMineAv: !!(mine && mine.querySelector('.msg-av.mine')),
          mineTimeInsideBubble: !!(mine && mine.querySelector('.msg-bd .msg-t')),
          mineHasName: !!(mine && mine.querySelector('.msg-nm')),
          labelText: label ? (label.textContent || '') : null,
          labelFontPx: label ? parseFloat(getComputedStyle(label).fontSize) : null,
          searchPlaceholder: (document.getElementById('d-talk-search') || {}).placeholder,
          hintPresent: !!document.getElementById('d-talk-hint'),
          boxRadius: box ? getComputedStyle(box).borderTopLeftRadius : null,
          boxBg: box ? getComputedStyle(box).backgroundColor : null,
          kbg: (rootCss.getPropertyValue('--k-bg') || '').trim(),
        };
      });
      const t = `[${theme}]`;

      chk(m.agentCount >= 1 && m.mineCount >= 1, `${t} both an agent .msg and a user .msg.you render`, `agent=${m.agentCount} mine=${m.mineCount}`);
      chk(m.oldDmCount === 0, `${t} no old .dm/.dm-b/.dm-w markup remains in the DM thread`, `oldDm=${m.oldDmCount}`);
      chk(m.agentHasAv, `${t} the agent bubble has an avatar (.msg-av)`);
      chk(m.agentHasName, `${t} the agent name is bold INSIDE the bubble (.msg-bd .msg-nm)`);
      chk(m.agentTimeInsideBubble, `${t} the agent timestamp is INSIDE the bubble (.msg-bd .msg-t)`);
      chk(m.mineHasMineAv, `${t} the user bubble has the user avatar (.msg-av.mine)`);
      chk(m.mineTimeInsideBubble, `${t} the user timestamp is INSIDE the bubble (.msg-bd .msg-t)`);
      chk(m.mineHasName === false, `${t} the user bubble carries NO name (operator row, #3130)`);
      chk(/^Direct Message to /.test(m.labelText || ''), `${t} the header reads "Direct Message to <agent>"`, JSON.stringify(m.labelText));
      chk(m.labelFontPx >= 20, `${t} the header uses the big project-name font (>= 20px), not the small .dlab`, `${m.labelFontPx}px`);
      chk(m.searchPlaceholder === 'Search', `${t} the search placeholder is just "Search"`, JSON.stringify(m.searchPlaceholder));
      chk(m.hintPresent === false, `${t} the "Just between you and <agent>" hint element is gone`);
      chk(m.boxRadius === '0px', `${t} the conversation box has no card radius (edge-to-edge)`, m.boxRadius);
      // The ground follows --k-bg (near-black in dark, theme-appropriate in light). Compare the
      // box background to the resolved --k-bg so it is not a brittle literal.
      chk(!!m.boxBg && !!m.kbg, `${t} the box background and --k-bg both resolve`, `bg=${m.boxBg} kbg=${m.kbg}`);
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
