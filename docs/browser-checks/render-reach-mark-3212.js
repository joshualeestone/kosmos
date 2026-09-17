/**
 * #3212: an agent the board cannot reach is marked with a question mark over its avatar,
 * instead of a delivery/status sentence.
 *
 * Josh (6.72 follow-up, 2026-09-17): "if it can't reach someone it puts a question mark icon
 * over their avatar, then we stick with not having to print any status text." After the room
 * delivery receipt ("placed with X... could not reach Z") was removed, this is how a genuine
 * failure to reach an agent is shown: a neutral grey question-mark badge (LROW_REACH) on the
 * member's .pj-face, shown when the member is not present (`!m.present`) -- the live state a room
 * post reports as "could not reach". In the room column (hideState) it replaces the status
 * sentence; the Settings members list keeps the reason.
 *
 * The check renders real pjMember() output for a present member and an unreachable one (a
 * deterministic `!present` member is not seedable through the live fleet, so the fixture calls
 * the real render function with the projects.describe member shape). Boots its own server for the
 * page + globals; run directly with:
 *   HEADED=0 NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-reach-mark-3212.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-reach-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-reach-w-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-reach-p-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-reach-l-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-reach-c-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const srv = require('../../server.js');

const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra !== undefined ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

(async () => {
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, colorScheme: 'light' });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(URL, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }

    const out = await page.evaluate(() => {
      const mk = (over) => Object.assign({ sessionName: over.name.toLowerCase(), name: over.name, hasAvatar: false, told: {}, instructions: {} }, over);
      // Room column (hideState = true): the surface Josh's ruling is about.
      const room = document.createElement('div'); room.id = 'pj-one-agents';
      room.innerHTML = pjMember(mk({ name: 'April', present: false }), true, false, true)   // unreachable
        + pjMember(mk({ name: 'Mikey', present: true, state: 'idle' }), true, false, true)   // reachable
        + pjMember(mk({ name: 'Raph', present: true, state: 'needs_you' }), true, false, true); // needs-you (warn, not reach)
      document.body.appendChild(room);
      // Settings members list (hideState = false): keeps the reason sentence.
      const settings = document.createElement('div'); settings.className = 'pj-settings-members';
      settings.innerHTML = pjMember(mk({ name: 'Donnie', present: false }), true, false, false);
      document.body.appendChild(settings);

      const rowOf = (root, agent) => root.querySelector('.pj-member[data-agent="' + agent + '"]');
      const badgeInfo = (row) => {
        const face = row.querySelector('.pj-face');
        const badge = face ? face.querySelector('.lreach') : null;
        const cs = badge ? getComputedStyle(badge) : null;
        return { has: !!badge, shown: cs ? cs.display !== 'none' : false, text: badge ? badge.textContent.trim() : '', hasWarn: !!(face && face.querySelector('.lwarn')) };
      };
      const capOf = (row) => { const s = row.querySelector('small'); return s ? s.textContent.trim() : ''; };

      const aprilRoom = rowOf(room, 'april');
      const mikeyRoom = rowOf(room, 'mikey');
      const raphRoom = rowOf(room, 'raph');
      const donnieSettings = rowOf(settings, 'donnie');
      return {
        unreach: Object.assign(badgeInfo(aprilRoom), { caption: capOf(aprilRoom), unseen: aprilRoom.classList.contains('unseen') }),
        present: Object.assign(badgeInfo(mikeyRoom), { caption: capOf(mikeyRoom) }),
        needsYou: badgeInfo(raphRoom),
        settingsUnreach: Object.assign(badgeInfo(donnieSettings), { caption: capOf(donnieSettings) }),
      };
    });

    console.log('  measured: ' + JSON.stringify(out));
    chk(out.unreach.has && out.unreach.shown && out.unreach.text === '?', 'an UNREACHABLE member shows a question-mark badge over its avatar', JSON.stringify(out.unreach));
    chk(out.unreach.unseen, 'an unreachable member is still marked .unseen (dashed border kept)', String(out.unreach.unseen));
    chk(out.unreach.caption === '', 'in the ROOM column, the unreachable member prints NO status text (the badge speaks)', JSON.stringify(out.unreach.caption));
    chk(!out.present.has, 'a REACHABLE (present) member has NO question-mark badge', JSON.stringify(out.present));
    chk(out.needsYou.hasWarn && !out.needsYou.has, 'a needs-you member keeps the red-! triangle and does NOT get the reach badge (mutually exclusive)', JSON.stringify(out.needsYou));
    chk(out.settingsUnreach.has && out.settingsUnreach.shown, 'the badge also shows in the Settings members list', JSON.stringify(out.settingsUnreach));
    chk(/cannot see this agent/i.test(out.settingsUnreach.caption), 'the Settings members list KEEPS the reason sentence (management view)', JSON.stringify(out.settingsUnreach.caption));
    chk(errs.length === 0, 'no page errors', errs.join(' | '));
    await page.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
