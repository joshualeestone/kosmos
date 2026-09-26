// Browser-check-surface: asblayer asb asb-nudge asb-dot asp asp-ask asp-in asp-say asp-x asp-fold asb-row asb-toggle setup-guide asp-busy asb-act asp-open asp-hide asp-hide-yes asp-hide-no
'use strict';

/**
 * The setup assistant bubble (#3034, Josh 2026-09-24: 16:05 bottom-right app-wide, context aware;
 * 18:02 "I love it", plus the first-x choice and a Settings switch to bring it back).
 *
 * The board is real (the guide lookup, the setting, the page-context reports); the chat thread is
 * answered by a route here, because delivering to a live agent is the direct-message route's own job
 * and has its own checks. Every "shows only when" arm has a control that shows it from the same state.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-assistant-bubble-3034.js [shots-dir]
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-asb-' + tag)); ROOTS.push(d); return d; };
const SANDBOX = mkroot('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const instructions = require('../../engine/instructions');
const setupAssistant = require('../../engine/setup-assistant');
const tipsStore = require('../../engine/tips');

const SHOTS = process.argv[2] || null;
const fail = [];
let pass = 0;
function chk(ok, label, extra) {
  if (ok) { pass++; console.log('PASS  ' + label + (extra ? '  ' + extra : '')); }
  else { fail.push(label); console.log('FAIL  ' + label + (extra ? '  --  ' + extra : '')); }
}

function seedGuide(name) {
  const dir = path.dirname(instructions.fileFor(name));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# ' + name + '\n');
  fs.writeFileSync(path.join(dir, setupAssistant.GUIDE_MARKER), name + '\n');
  setupAssistant.markSetupAssistantSeeded({ name, via: 'browser-check' });
}
const unseed = () => fs.rmSync(setupAssistant.flagPath(), { force: true });

const bubble = (page) => page.evaluate(() => {
  const vis = (id) => { const el = document.getElementById(id); return !!el && !el.hidden && el.getClientRects().length > 0; };
  const b = document.getElementById('asb');
  return { layer: !!document.getElementById('asblayer'), bubble: vis('asb'), nudge: vis('asb-nudge'), panel: vis('asp'), ask: vis('asp-ask'), hide: vis('asp-hide'),
    dot: !!b && !b.querySelector('.asb-dot').hidden && vis('asb'), src: b ? (b.querySelector('img').getAttribute('src') || '') : '' };
});
const waitFor = (page, fn, ms = 6000) => page.waitForFunction(fn, null, { timeout: ms }).then(() => true, () => false);

(async () => {
  /* The person's OWN agent called "Josh" (session josh-2) comes first: the guide must be found by its
     session name ("josh"), never by a display name the person's agent can share (B2's picture proves it). */
  fleet.install([fleet.agent('josh-2', { state: 'idle', displayName: 'Josh', role: 'Personal assistant' }),
    fleet.agent('josh', { state: 'idle', displayName: 'Josh', role: 'Setup guide' }),
    fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix', role: 'Collections Coordinator' })]);
  /* Tips quiet: they are their own feature with their own check, and a tip must not cover the corner. */
  fs.writeFileSync(tipsStore.FILE(), JSON.stringify({ seen: [], off: true }));
  unseed();
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const setting = async (patch) => (await fetch(URL + '/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ setupAssistant: patch }) })).json();
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    const consoleErrs = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text()); });
    /* The guide's thread, answered here. */
    let thread = [{ from: 'josh', text: 'Want me to set up your first agent with you?', at: new Date().toISOString() }];
    const sent = [];
    let verdict = { delivery: { state: 'placed' }, recorded: true };
    await page.route('**/api/agent/josh/thread', async (route) => {
      const r = route.request();
      if (r.method() === 'POST') {
        const body = JSON.parse(r.postData() || '{}');
        sent.push(body.text);
        if (verdict.recorded) thread = thread.concat([{ from: 'you', text: body.text, at: new Date().toISOString() }]);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(verdict) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: thread, olderCount: 0 }) });
    });
    const pageReports = [];
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/setup-guide/page')) pageReports.push(JSON.parse(r.postData() || '{}')); });
    const boot = async () => {
      await page.goto(URL, { waitUntil: 'networkidle' });
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
    };

    // B1: no guide on this computer, so nothing is drawn at all (control: B2, the same board with a guide).
    await boot();
    await page.waitForTimeout(3800);
    const none = await bubble(page);
    chk(!none.layer && !none.bubble, 'B1 with no setup guide, no bubble and no layer', JSON.stringify(none));
    chk(await page.evaluate(() => document.getElementById('asb-row').hidden === true), 'B1 and no Setup assistant row in Settings');
    /* Asking for the guide on an install without one must not put a failed resource (a 404) in the console:
       every other browser check counts console errors as page errors (it went red in CI once). */
    chk(!consoleErrs.some((t) => /404|Failed to load resource/.test(t)), 'B1 asking for a guide that does not exist logs no failed resource', consoleErrs.join(' | '));

    // B1b: the guide is created AFTER the page loaded (a new install: end of first run, or the first
    // model connecting). The page keeps looking and the bubble arrives without a reload.
    seedGuide('josh');   // the slug, as createAgent records it (production shape, per Renet #3670)
    chk(await waitFor(page, () => { const b = document.getElementById('asb'); return b && !b.hidden; }, 15000), 'B1b a guide created after the page loaded shows up without a reload');

    // B2: a guide exists and the setting is on (the default): the bubble with the guide's picture, and the nudge.
    await boot();
    chk(await waitFor(page, () => { const b = document.getElementById('asb'); return b && !b.hidden; }, 8000), 'B2 with a guide, the bubble shows');
    const two = await bubble(page);
    /* #3707: this guide has no picture (the fixture saves none), so the bubble shows its initial on its disc, as its
       board card does, never a broken image. Both <img>s, and each one has really drawn. */
    const face2 = await page.evaluate(() => [document.querySelector('#asb img'), document.querySelector('#asp .asp-h img')].map((i) => ({
      src: (i.getAttribute('src') || '').slice(0, 40), svg: decodeURIComponent(i.getAttribute('src') || ''), drawn: i.complete && i.naturalWidth > 0 })));
    chk(face2.every((x) => x.src.startsWith('data:image/svg+xml') && x.drawn && />J<\/text>/.test(x.svg)), 'B2 with no picture, the guide shows its initial (J) on its disc, not a broken image (#3707)',
      JSON.stringify(face2.map((x) => ({ src: x.src, drawn: x.drawn }))));
    // CONTROL: a guide WITH a picture gets its picture (the same function, the row saying it has one).
    const withPic = await page.evaluate(() => asbAvatar({ sessionName: 'josh', name: 'Josh', hasAvatar: true, avatarVer: 3 }));
    chk(withPic === '/api/agent/josh/avatar?v=3', 'B2 CONTROL: a guide with a picture shows its picture', withPic);
    chk(two.nudge, 'B2 the nudge shows before the person has written to the guide');
    // kosmos#3881 (Josh): the nudge reads exactly "Need help?" (it said "Want help setting up Kosmos?").
    const nudgeText = await page.evaluate(() => (document.getElementById('asb-nudge-go') || {}).textContent || '');
    chk(nudgeText.trim() === 'Need help?', 'B2 the nudge says "Need help?"', JSON.stringify(nudgeText));
    // B2b: the lookup itself, with the person's own "Josh" (session josh-2) placed FIRST: the guide is found by
    // its session name, never by a display name the person's agent can share.
    const b2b = await page.evaluate(() => {
      const keep = LAST;
      LAST = [{ name: 'Josh', sessionName: 'josh-2' }, { name: 'Josh', sessionName: 'josh' }];
      const row = asbGuideRow();
      LAST = keep;
      return row && row.sessionName;
    });
    chk(b2b === 'josh', 'B2b with the person\'s own "Josh" listed first, the guide is still the agent whose session is josh', String(b2b));
    chk(await waitFor(page, () => ASB.heard !== null && ASB.readOnce === true), 'B2 precondition: the first thread read has landed');
    chk(!(await bubble(page)).dot, 'B2 a reply already in the thread does not light the dot on load (control: B6 lights it for a new one)');
    /* Measured from the page's content edge (body.clientWidth). The root reserves a stable scrollbar
       gutter (scrollbar-gutter: stable), and a fixed element sits inside it, as the tip card does. */
    const pos = await page.evaluate(() => { const r = document.getElementById('asb').getBoundingClientRect(); return { right: Math.round(document.body.clientWidth - r.right), bottom: Math.round(document.documentElement.clientHeight - r.bottom) }; });
    chk(pos.right === 16 && pos.bottom === 16, 'B2 it sits in the bottom-right corner', JSON.stringify(pos));
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'bubble-light.png') }); }

    // B15: the corner is shared. On an agent's page the chat's Send button lives there: the bubble lifts
    // above it, Send is still what the pointer hits, and the open panel does not cover it either.
    await page.evaluate(() => { const a = document.querySelector('#grid [data-agent="beatrix"]'); if (a) a.click(); });
    chk(await waitFor(page, () => { const s = document.getElementById('d-send'); return !!s && s.getClientRects().length > 0; }), 'B15 precondition: an agent page with its Send button');
    await page.waitForTimeout(1700);   // a tick: the bubble re-measures the corner
    const b15 = await page.evaluate(() => {
      const hitAt = (el) => { const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && !!h.closest('#d-send'); };
      const s = document.getElementById('d-send').getBoundingClientRect(), a = document.getElementById('asb').getBoundingClientRect();
      return { sendReachable: hitAt(document.getElementById('d-send')), overlap: s.left < a.right && s.right > a.left && s.top < a.bottom && s.bottom > a.top, lifted: document.getElementById('asb').style.bottom };
    });
    chk(b15.sendReachable && !b15.overlap, 'B15 on an agent\'s page the bubble sits clear of Send, which still takes the click', JSON.stringify(b15));
    await page.click('#asb');
    await page.waitForTimeout(300);
    const b15p = await page.evaluate(() => { const r = document.getElementById('d-send').getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && !!h.closest('#d-send'); });
    chk(b15p, 'B15 with the chat open, the page\'s Send button is still reachable');
    await page.click('#asp-fold');
    // B17: a short window. The lift is capped, so the bubble and the open chat stay wholly on screen.
    await page.setViewportSize({ width: 1280, height: 420 });
    /* A tall control in the corner. The bubble only clips it, so it no longer climbs it (Josh 2026-09-25: the
       chat stays in the corner); either way the bubble and the open chat must stay on screen. */
    await page.evaluate(() => { const t = document.createElement('button'); t.dataset.check = 'b17'; t.textContent = 'tall'; t.style.cssText = 'position:fixed;right:0;bottom:0;width:120px;height:380px;z-index:1'; document.body.appendChild(t); });
    await page.waitForTimeout(1700);
    const b17 = await page.evaluate(() => { const r = document.getElementById('asb').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight }; });
    await page.click('#asb');
    await page.waitForTimeout(300);
    const b17p = await page.evaluate(() => { const r = document.getElementById('asp').getBoundingClientRect(); const h = document.querySelector('.apphead').getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, head: Math.round(Math.max(0, h.bottom)) }; });
    chk(b17.top >= 0 && b17.bottom <= b17.vh && b17p.top >= 0 && b17p.bottom <= b17p.vh, 'B17 on a short window the lifted bubble and the open chat stay on screen', JSON.stringify({ b17, b17p }));
    /* Josh 2026-09-25: the chat keeps to the bubble's corner and gives up height, never sliding up under the header. */
    chk(b17p.top >= b17p.head, 'B17 and the open chat never runs under the header bar', JSON.stringify(b17p));
    await page.click('#asp-fold');
    await page.evaluate(() => document.querySelector('[data-check="b17"]').remove());
    await page.setViewportSize({ width: 1280, height: 860 });
    // B31 (#3821, Josh 2026-09-25 16:25 on Windows): the open chat sits where the bubble was, its bottom-right on the
    // bubble's, growing upward below the header, at every window height. A wide control in the bottom band beside the
    // bubble (his Settings page's "+ Add a provider") used to lift it to just under the header; it must not now.
    // CONTROL: the folded bubble is at the same corner in each size, so the arm reads the panel against a known place.
    await page.evaluate(() => showTab('settings'));   // Josh's screen: Settings, nothing in the bubble's own corner
    await page.evaluate(() => { const t = document.createElement('button'); t.dataset.check = 'b31'; t.textContent = 'Add a provider';
      t.style.cssText = 'position:fixed;right:90px;bottom:120px;width:560px;height:42px;z-index:1'; document.body.appendChild(t); });
    const got31 = [];
    for (const [w, h] of [[1520, 858], [1280, 720], [1280, 1200]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(1700);   // a tick: the bubble re-measures the corner
      /* From the page's right edge (clientWidth): Settings scrolls, and the tab layout keeps a scrollbar gutter. */
      const bub31 = await page.evaluate(() => { const r = document.getElementById('asb').getBoundingClientRect(); return { right: Math.round(document.documentElement.clientWidth - r.right), bottom: Math.round(innerHeight - r.bottom) }; });
      await page.click('#asb');
      await page.waitForTimeout(300);
      const p31 = await page.evaluate(() => { const r = document.getElementById('asp').getBoundingClientRect(); const hd = document.querySelector('.apphead').getBoundingClientRect();
        return { right: Math.round(document.documentElement.clientWidth - r.right), bottom: Math.round(innerHeight - r.bottom), top: Math.round(r.top), head: Math.round(hd.bottom), h: Math.round(r.height) }; });
      got31.push({ w, h, bub31, p31 });
      await page.click('#asp-fold');
      await page.waitForTimeout(200);
    }
    /* The right offset is not a fixed number: it depends on whether this machine draws a scrollbar in the gutter the
       tab layout reserves. What is fixed is that the bubble keeps one corner at every size, 16px from the bottom. */
    chk(got31.every((g) => g.bub31.bottom === 16 && g.bub31.right === got31[0].bub31.right && g.bub31.right >= 16 && g.bub31.right <= 32),
      'B31 CONTROL: the folded bubble keeps one bottom-right corner at each size, 16px from the bottom', JSON.stringify(got31.map((g) => g.bub31)));
    chk(got31.every((g) => g.p31.right === g.bub31.right && g.p31.bottom === g.bub31.bottom && g.p31.top >= g.p31.head && g.p31.h >= 160),
      'B31 the open chat sits on the bubble\'s corner and grows upward below the header, at 1520x858, 1280x720 and 1280x1200 (#3821)', JSON.stringify(got31.map((g) => ({ w: g.w, h: g.h, p: g.p31 }))));
    if (SHOTS) { await page.setViewportSize({ width: 1520, height: 858 }); await page.waitForTimeout(1700); await page.click('#asb'); await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOTS, 'panel-anchored-1520x858.png') }); await page.click('#asp-fold'); }
    await page.evaluate(() => document.querySelector('[data-check="b31"]').remove());
    await page.setViewportSize({ width: 1280, height: 860 });
    // B32 (#3821 review): the chat opened on an agent's page (the bubble lifted over Send), then Settings with it still
    // open: the chat comes down to the bubble's corner there, rather than keeping the agent page's lift.
    await page.evaluate(() => { showTab('agents'); const a = document.querySelector('#grid [data-agent="beatrix"]'); if (a) a.click(); });
    await waitFor(page, () => { const s2 = document.getElementById('d-send'); return !!s2 && s2.getClientRects().length > 0; });
    await page.waitForTimeout(1700);
    await page.click('#asb');
    await page.waitForTimeout(300);
    const up32 = await page.evaluate(() => Math.round(innerHeight - document.getElementById('asp').getBoundingClientRect().bottom));
    await page.evaluate(() => showTab('settings'));
    await page.waitForTimeout(1700);   // a tick of the assistant
    const down32 = await page.evaluate(() => ({ open: !document.getElementById('asp').hidden, bottom: Math.round(innerHeight - document.getElementById('asp').getBoundingClientRect().bottom) }));
    chk(up32 > 40 && down32.open && down32.bottom === 16, 'B32 an open chat follows the bubble when the page under it changes (lifted over Send, then down on Settings)', JSON.stringify({ up32, down32 }));
    await page.click('#asp-fold');
    await page.evaluate(() => showTab('agents'));
    await page.waitForTimeout(300);

    // B3: clicking it opens the chat in place, headed Josh and tagged as AI, and tells the guide the screen.
    pageReports.length = 0;
    /* A card-sized control under the corner (a board full of agent cards): the bubble dodged it, and the chat dodged
       anything in the bottom band, so both climbed toward the header. Now both stay in the corner over it. */
    await page.evaluate(() => { const t = document.createElement('button'); t.dataset.check = 'b3band'; t.textContent = 'card'; t.style.cssText = 'position:fixed;right:0;bottom:0;width:280px;height:250px;z-index:1'; document.body.appendChild(t); });
    await page.waitForTimeout(1700);   // a tick: the bubble re-measures the corner
    const b3bub = await page.evaluate(() => { const r = document.getElementById('asb').getBoundingClientRect(); return { right: Math.round(r.right), bottom: Math.round(r.bottom), fromBottom: Math.round(document.documentElement.clientHeight - r.bottom) }; });
    chk(b3bub.fromBottom === 16, 'B3 a card under the corner does not push the bubble up (it only clips the card)', JSON.stringify(b3bub));
    await page.click('#asb');
    chk(await waitFor(page, () => !document.getElementById('asp').hidden), 'B3 the chat opens');
    /* Josh 2026-09-25: it pops up in the bottom-right corner like a support chat, its bottom-right corner where the
       bubble was, growing up and left; not pinned under the header (a board full of cards used to push it there). */
    const b3pan = await page.evaluate(() => { const r = document.getElementById('asp').getBoundingClientRect(); const h = document.querySelector('.apphead').getBoundingClientRect();
      return { right: Math.round(r.right), bottom: Math.round(r.bottom), top: Math.round(r.top), height: Math.round(r.height), head: Math.round(Math.max(0, h.bottom)) }; });
    chk(Math.abs(b3pan.right - b3bub.right) <= 1 && Math.abs(b3pan.bottom - b3bub.bottom) <= 1 && b3pan.top > b3pan.head && b3pan.height === 420,
      'B3 the chat opens in the bottom-right corner, its corner where the bubble was, at full height below the header', JSON.stringify({ b3bub, b3pan }));
    await page.evaluate(() => document.querySelector('[data-check="b3band"]').remove());
    await waitFor(page, () => document.querySelectorAll('#asp-th .asp-m.him').length > 0);   // the thread's first read
    const head = await page.evaluate(() => {
      const note = document.querySelector('.asp-note');
      const him = [...document.querySelectorAll('#asp-th .asp-m.him')], you = document.querySelector('#asp-th .asp-m.you');
      const rs = getComputedStyle(document.documentElement);
      return { who: document.querySelector('.asp-who b').textContent, tag: !!document.querySelector('#asp .asp-tag'),
        note: note ? note.textContent : '', noteShown: !!note && getComputedStyle(note).display !== 'none',
        him: him.map((m) => m.textContent), place: document.getElementById('asp-say').placeholder,
        himBg: him[0] ? getComputedStyle(him[0]).backgroundColor : null, agentMsg: rs.getPropertyValue('--agent-msg').trim(),
        focus: document.activeElement && document.activeElement.id };
    });
    /* #3738 (Josh 08:51): "Josh, Kosmos Guide", no pill, no footer, one opening message, the new placeholder. */
    chk(head.who === 'Josh, Kosmos Guide' && !head.tag && !head.noteShown, 'B3 headed "Josh, Kosmos Guide", with no pill and no footer line (#3738)', JSON.stringify(head));
    chk(head.him[0] === 'Hi I\'m Josh, an AI Assistant to help you get your Kosmos setup. What can I help you with?' && head.him.length === 2 && head.place === 'Ask about Kosmos\u2026',
      'B3 the opening message (Josh\'s words, #3947) is the first guide bubble, then the thread; the box says "Ask about Kosmos..."', JSON.stringify(head));
    chk(head.focus === 'asp-say', 'B3 and puts the cursor in the box', JSON.stringify(head));
    /* The two lines Josh cut are gone from the page, its scripts included, so no template or fallback can bring
       one back (a starting note in the panel's markup carried one after the paint had dropped it). */
    const cut = await page.evaluate(() => { const h = document.documentElement.innerHTML; return ['Hi, I built Kosmos', 'An AI that knows Kosmos', 'AI guide. Ask me anything'].filter((w) => h.includes(w)); });
    chk(cut.length === 0, 'B3 none of the cut lines is anywhere in the page (#3738, #3947)', JSON.stringify(cut));
    /* The guide's bubble is the DM's agent cream (the same token, read, not a copy of its value). */
    chk(await page.evaluate(() => { const t = document.createElement('div'); t.style.background = 'var(--agent-msg)'; document.body.appendChild(t); const v = getComputedStyle(t).backgroundColor; t.remove();
      return v === getComputedStyle(document.querySelector('#asp-th .asp-m.him')).backgroundColor; }), 'B3 the guide\'s bubbles are the DM agent cream (--agent-msg)', JSON.stringify(head));
    for (let i = 0; i < 8 && !pageReports.some((p) => p.screen === 'board'); i++) await page.waitForTimeout(250);
    chk(pageReports.some((p) => p.screen === 'board'), 'B3 the guide is told the person is on the board', JSON.stringify(pageReports));
    const usable = await page.evaluate(() => { const b = document.getElementById('new-agent') || document.getElementById('rail-agents-new'); const r = b.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!hit && !!hit.closest('#new-agent, #rail-agents-new'); });
    chk(usable, 'B3 the page stays usable beside it (New agent is still under the pointer)');
    if (SHOTS) {
      await page.screenshot({ path: path.join(SHOTS, 'panel-light.png') });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.screenshot({ path: path.join(SHOTS, 'panel-dark.png') });
      await page.emulateMedia({ colorScheme: 'light' });
    }

    // B4: moving to another screen while it is open tells the guide the new one.
    pageReports.length = 0;
    await page.click('#tabs [data-tab="projects"]');
    for (let i = 0; i < 12 && !pageReports.some((p) => p.screen === 'projects'); i++) await page.waitForTimeout(250);
    chk(pageReports.some((p) => p.screen === 'projects'), 'B4 the guide is told when the screen changes', JSON.stringify(pageReports));
    await page.click('#tabs [data-tab="agents"]');

    // B5: sending goes to the guide's own thread, the box empties, and the nudge never returns.
    await page.fill('#asp-say', 'How do I make an agent?');
    await page.keyboard.press('Enter');
    chk(await waitFor(page, () => [...document.querySelectorAll('#asp-th .asp-m.you')].some((m) => m.textContent === 'How do I make an agent?')), 'B5 the message shows in the chat');
    chk(await page.evaluate(() => { const t = document.createElement('div'); t.style.background = 'var(--usermsg-tint)'; document.body.appendChild(t); const v = getComputedStyle(t).backgroundColor; t.remove();
      return v === getComputedStyle(document.querySelector('#asp-th .asp-m.you')).backgroundColor; }), 'B5 the person\'s bubble is the DM blue (--usermsg-tint, #3738)');
    chk(sent.length === 1 && sent[0] === 'How do I make an agent?' && await page.evaluate(() => document.getElementById('asp-say').value === ''), 'B5 it went to the guide\'s thread once and the box emptied', JSON.stringify(sent));

    // B5b: unconfirmed and NOT kept in the thread: the box is the only copy, so the words stay, and it says so.
    verdict = { delivery: { state: 'unconfirmed' }, recorded: false };
    await page.fill('#asp-say', 'Is it working?');
    await page.keyboard.press('Enter');
    await waitFor(page, () => /still in the box/.test(document.getElementById('asp-msg').textContent));
    await waitFor(page, () => ASB.sending === false);   // the send (and its re-read) has finished before the next
    const b5b = await page.evaluate(() => ({ box: document.getElementById('asp-say').value, msg: document.getElementById('asp-msg').textContent }));
    chk(b5b.box === 'Is it working?' && /still in the box/.test(b5b.msg), 'B5b an unconfirmed send that was not kept leaves the words in the box and says so', JSON.stringify(b5b));
    // B5c: could_not keeps them too, with the reason as a sentence.
    verdict = { delivery: { state: 'could_not', because: 'the assistant is not running' }, recorded: false };
    await page.keyboard.press('Enter');
    await waitFor(page, () => /could not get that/.test(document.getElementById('asp-msg').textContent));
    await waitFor(page, () => ASB.sending === false);
    const b5c = await page.evaluate(() => ({ box: document.getElementById('asp-say').value, msg: document.getElementById('asp-msg').textContent }));
    chk(b5c.box === 'Is it working?' && /The assistant is not running/.test(b5c.msg), 'B5c a send that could not go keeps the words and gives the reason', JSON.stringify(b5c));
    verdict = { delivery: { state: 'placed' }, recorded: true };
    await page.fill('#asp-say', '');

    // B6: the minus folds it back to the bubble; a reply while folded lights the dot; opening clears it.
    await page.click('#asp-fold');
    const folded = await bubble(page);
    chk(!folded.panel && folded.bubble && !folded.nudge, 'B6 the minus folds it to the bubble, and the nudge is gone for good after writing', JSON.stringify(folded));
    chk(!folded.dot, 'B6 CONTROL: no dot before a reply');
    thread = thread.concat([{ from: 'josh', text: 'Click New agent, top left.', at: new Date().toISOString() }]);
    await page.evaluate(() => asbPoll(true));
    chk((await bubble(page)).dot, 'B6 a reply while folded lights the gold dot');
    /* The reply was timed when the dot lit; opening the chat later keeps that time (a fresh stamp would hide a real
       "working" until the next board snapshot). */
    const litAt = await page.evaluate(() => ASB.heardAt);
    await page.waitForTimeout(60);
    await page.click('#asb');
    await page.waitForTimeout(300);
    chk(litAt > 0 && await page.evaluate((t) => ASB.heardAt === t, litAt), 'B6 opening keeps the time the reply landed, not the time it was opened', String(litAt));
    chk(!(await bubble(page)).dot && await page.evaluate(() => [...document.querySelectorAll('#asp-th .asp-m.him:not(.asp-open)')].length === 2), 'B6 opening it shows the reply and clears the dot');

    // B20 (#3733, Josh 08:23): while the guide is working on a reply, the chat shows the app's working row (the same
    // .act dots and "is working" the agent page uses) and the folded bubble shows the dots, so a message does not
    // feel lost. CONTROL: idle, neither shows.
    const guideState = (st) => fleet.install([fleet.agent('josh-2', { state: 'idle', displayName: 'Josh', role: 'Personal assistant' }),
      fleet.agent('josh', { state: st, displayName: 'Josh', role: 'Setup guide' }),
      fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix', role: 'Collections Coordinator' })]);
    /* A thread long enough to scroll, read to its end, so the arms below can see whether the row pushes a reply out of view. */
    for (let i = 0; i < 12; i++) thread = thread.concat([{ from: i % 2 ? 'josh' : 'you', text: 'Line ' + i + ' of an earlier conversation.', at: new Date().toISOString() }]);
    await page.evaluate(() => asbPoll(true));
    await page.evaluate(() => { const th = document.getElementById('asp-th'); th.scrollTop = th.scrollHeight; });
    chk(await page.evaluate(() => { const th = document.getElementById('asp-th'); return th.scrollHeight > th.clientHeight + 40; }), 'B20 precondition: the thread scrolls');
    guideState('working');
    chk(await waitFor(page, () => { const b = document.getElementById('asp-busy'); return !!b && !b.hidden && b.querySelectorAll('.act i').length === 3 && /Josh is working/.test(b.textContent); }, 12000),
      'B20 the guide working: the open chat shows the working row', await page.evaluate(() => document.getElementById('asp-busy').outerHTML.slice(0, 200)));
    /* The row took the thread's height as it showed: the thread, at its end before, is still at its end. */
    const atEnd20 = await page.evaluate(() => { const th = document.getElementById('asp-th'); return Math.round(th.scrollHeight - th.scrollTop - th.clientHeight); });
    chk(atEnd20 <= 2, 'B20 as the working row shows, the thread stays at its end (its last message is not under the row)', 'from end: ' + atEnd20);
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'asb-working-open.png') }); }
    // B20: the dots keep ONE node across paints (#3421): a rebuilt node restarts their loop every tick.
    await page.evaluate(() => { document.querySelector('#asp-busy .act').__kept = true; });
    await page.waitForTimeout(3500);
    chk(await page.evaluate(() => !!document.querySelector('#asp-busy .act') && document.querySelector('#asp-busy .act').__kept === true), 'B20 the working dots are not rebuilt across ticks (one continuous animation)');
    // B20: a reply that lands while the board still says working: the row steps aside for it.
    thread = thread.concat([{ from: 'josh', text: 'Here you go.', at: new Date().toISOString() }]);
    await page.evaluate(() => asbPoll(true));
    chk(await page.evaluate(() => document.getElementById('asp-busy').hidden), 'B20 a reply that has landed outranks the stale "working" from the last board snapshot');
    /* The row took the thread's height while it showed; the thread stayed at its end, so the reply is in view. */
    const inView = await page.evaluate(() => { const th = document.getElementById('asp-th'), last = th.lastElementChild;
      const a = th.getBoundingClientRect(), b = last.getBoundingClientRect(); return { text: last.textContent, bottom: Math.round(b.bottom), thBottom: Math.round(a.bottom) }; });
    chk(inView.text === 'Here you go.' && inView.bottom <= inView.thBottom + 1, 'B20 the reply that lands under the working row is in view, not scrolled under it', JSON.stringify(inView));
    /* The next snapshot still says working: its announcement goes to its own region and leaves the reply's alone. */
    await page.evaluate(() => tick());
    await waitFor(page, () => !document.getElementById('asp-busy').hidden, 6000);
    const lives = await page.evaluate(() => ({ reply: document.getElementById('asp-live').textContent, busy: document.getElementById('asp-live-busy').textContent }));
    chk(lives.reply === 'Here you go.' && lives.busy === 'Josh is working', 'B20 "working" again does not replace the reply a screen reader has yet to read', JSON.stringify(lives));
    await page.click('#asp-fold');
    await page.evaluate(() => tick());   // the next board snapshot, forced: it is newer than the reply, so "working" counts again
    chk(await waitFor(page, () => { const a = document.querySelector('#asb .asb-act'); return !!a && !a.hidden && getComputedStyle(a).display !== 'none'; }, 6000)
      && await page.evaluate(() => /Josh is working/.test(document.getElementById('asb').getAttribute('aria-label'))),
      'B20 folded, the bubble shows the working dots and says so to a screen reader');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'asb-working-folded.png'), clip: { x: 1100, y: 700, width: 180, height: 160 } });
    guideState('idle');
    chk(await waitFor(page, () => { const a = document.querySelector('#asb .asb-act'); return !!a && a.hidden; }, 12000), 'B20 CONTROL: idle, the dots go');
    await page.click('#asb');
    chk(await page.evaluate(() => document.getElementById('asp-busy').hidden), 'B20 CONTROL: and no working row in the chat');
    // B20: the guide's sign-in broken: the chat says so (busyRow's line), and the folded bubble shows no working dots.
    guideState('auth_failed');
    chk(await waitFor(page, () => { const b = document.getElementById('asp-busy'); return !!b && !b.hidden && /sign-in isn.t working/.test(b.textContent) && !b.querySelector('.act'); }, 12000), 'B20 a broken sign-in says so in the chat, not silence');
    /* Said once, in words only (the row's face and "!" are hidden from a screen reader), and not again when only its
       evidence changes, which it does from poll to poll. */
    const said20 = await page.evaluate(() => document.getElementById('asp-live-busy').textContent);
    chk(/^Josh\u2019s Claude sign-in isn\u2019t working/.test(said20), 'B20 the broken sign-in is said once, in words only', JSON.stringify(said20));
    const again20 = await page.evaluate(() => { const l = document.getElementById('asp-live-busy'); l.textContent = '';
      const r = asbGuideRow(); r.stateEvidence = 'evidence that moved on'; asbPaint(); return l.textContent; });
    chk(again20 === '', 'B20 and is not said again when only its evidence changes', JSON.stringify(again20));
    await page.click('#asp-fold');
    await page.waitForTimeout(400);
    chk(await page.evaluate(() => document.querySelector('#asb .asb-act').hidden), 'B20 and the folded bubble shows no working dots for it');
    guideState('idle');
    await page.click('#asb');
    await waitFor(page, () => document.getElementById('asp-busy').hidden, 12000);

    // B7: the first x asks once; Close for now keeps it and records the ask; a later x just closes.
    await page.click('#asp-x');
    const ask = await bubble(page);
    chk(ask.panel && ask.ask, 'B7 the first x asks Close the assistant?');
    // B7b (#3758, Josh 11:07): his words: "Close for now", "Close forever", and the line under them.
    const words = await page.evaluate(() => ({ now: document.getElementById('asp-close-now').textContent, off: document.getElementById('asp-close-off').textContent,
      line: document.querySelector('#asp-ask small').textContent.replace(/\u00a0/g, ' ') }));   // non-breaking spaces hold the path together
    chk(words.now === 'Close for now' && words.off === 'Close forever' && words.line === 'You can turn it back on under Settings > Computer', 'B7b the ask reads in Josh\'s words (#3758)', JSON.stringify(words));
    // The Settings section it names is called that: CONTROL for the words above pointing somewhere real.
    const navName = await page.evaluate(() => document.querySelector('#s-nav [data-go="mac"]').textContent.trim());
    chk(navName === 'Computer', 'B7b the Settings section the line names is called Computer (#3758)', JSON.stringify(navName));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'ask-light.png') });
    await page.click('#asp-close-now');
    await page.waitForTimeout(300);
    const kept = await bubble(page);
    const s7 = (await (await fetch(URL + '/api/settings')).json()).setupAssistant;
    chk(!kept.panel && kept.bubble && s7.asked === true && s7.on === true, 'B7 Close for now closes it, keeps the bubble, and remembers it asked', JSON.stringify({ kept, s7 }));
    // #3947: that first x came on an opening with nothing typed, so it is the first of the two before the hide offer.
    chk(await page.evaluate(() => asbIdleGet()) === 1, 'B7 and, nothing typed in that opening, it counts as the first idle close (#3947)');
    // A later x, after the person used the chat (here: wrote a question), just closes, without asking again.
    await page.click('#asb');
    await page.fill('#asp-say', 'how do I add an agent?');
    await page.click('#asp-x');
    await page.waitForTimeout(200);
    const again = await bubble(page);
    chk(!again.panel && !again.ask && again.bubble, 'B7 a later x after writing in the chat just closes, without asking again', JSON.stringify(again));
    chk(await page.evaluate(() => asbIdleGet()) === 1, 'B7 CONTROL: a close after writing is not counted (#3947)');
    // B7c (#3947, Josh 2026-09-26 08:13, verbatim: "If I click on the assistant and hit the X on him and haven't typed
    // a message, and I do that twice, then it should prompt me to close the agent forever"). This replaces the 09-25
    // rule that asked on EVERY such close. The count and the Keep it answer live in the page's storage; start known.
    const fresh = (idle, kept) => page.evaluate(([i, k]) => { localStorage.setItem(ASB_IDLE_KEY, String(i)); if (k) localStorage.setItem(ASB_KEPT_KEY, '1'); else localStorage.removeItem(ASB_KEPT_KEY); }, [idle, kept]);
    const idleNow = () => page.evaluate(() => asbIdleGet());
    await fresh(0, false);
    // The first open-and-close with nothing typed just closes, and is counted. The question written above is still in
    // the box, unsent: a draft from an earlier visit is not typing in this one, and a stray space is not typing either.
    await page.click('#asb');
    chk(await page.evaluate(() => document.getElementById('asp-say').value === 'how do I add an agent?'), 'B7c precondition: the earlier unsent draft is still in the box');
    await page.press('#asp-say', 'End');
    await page.keyboard.type(' ');
    await page.click('#asp-x');
    await page.waitForTimeout(250);
    const first = await bubble(page);
    chk(!first.panel && !first.ask && !first.hide && first.bubble && await idleNow() === 1, 'B7c the first open-and-close with nothing typed just closes, and is counted (#3947)', JSON.stringify(first));
    // The second one offers to hide the guide for good.
    await page.click('#asb');
    await page.click('#asp-x');
    await page.waitForTimeout(200);
    const second = await bubble(page);
    const hideWords = await page.evaluate(() => { const g = document.getElementById('asp-hide'); return { head: g.querySelector('b').textContent, yes: document.getElementById('asp-hide-yes').textContent,
      no: document.getElementById('asp-hide-no').textContent, line: g.querySelector('small').textContent.replace(/ /g, ' '), focus: document.activeElement && document.activeElement.id,
      group: g.getAttribute('role'), named: (document.getElementById(g.getAttribute('aria-labelledby')) || {}).textContent }; });
    chk(second.panel && second.hide && !second.ask, 'B7c the second open-and-close with nothing typed offers to hide the guide (#3947)', JSON.stringify(second));
    chk(hideWords.head === 'Hide the guide for good?' && hideWords.yes === 'Hide it' && hideWords.no === 'Keep it' && hideWords.line === 'You can turn it back on under Settings > Computer'
      && hideWords.focus === 'asp-hide-yes' && hideWords.group === 'group' && hideWords.named === 'Hide the guide for good?',
      'B7c it asks "Hide the guide for good?" (a named group) with Hide it (focused) / Keep it, and says where to turn it back on', JSON.stringify(hideWords));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'hide-offer-light.png') });
    // X on the offer is "not now": it closes, and is not another close to count.
    await page.click('#asp-x');
    await page.waitForTimeout(250);
    const notNow = await bubble(page);
    chk(!notNow.panel && !notNow.hide && notNow.bubble && await idleNow() === 1, 'B7c X on the hide offer just closes it and counts nothing more', JSON.stringify(notNow));
    // Keep it: closes, keeps the bubble, and is not offered again (nor counted).
    await page.click('#asb');
    await page.click('#asp-x');
    await page.waitForTimeout(200);
    chk((await bubble(page)).hide, 'B7c precondition: the next idle close offers again');
    await page.click('#asp-hide-no');
    await page.waitForTimeout(250);
    const keptIt = await bubble(page);
    const s7ck = (await (await fetch(URL + '/api/settings')).json()).setupAssistant;
    chk(!keptIt.panel && keptIt.bubble && s7ck.on === true && await page.evaluate(() => asbKept()) && await idleNow() === 0, 'B7c Keep it closes it, keeps the bubble, and remembers the answer', JSON.stringify({ keptIt, s7ck }));
    for (let i = 0; i < 2; i++) { await page.click('#asb'); await page.click('#asp-x'); await page.waitForTimeout(250); }
    const after = await bubble(page);
    chk(!after.panel && !after.hide && after.bubble && await idleNow() === 0, 'B7c after Keep it, two more idle closes just close, and are not counted', JSON.stringify(after));
    // A message sent (an attempt to send) restarts the count: counted once, then a send, then an idle close counts 1 again.
    await fresh(1, false);
    verdict = { delivery: { state: 'placed' }, recorded: true };
    await page.click('#asb');
    await page.fill('#asp-say', 'Thanks, that helps');
    await page.keyboard.press('Enter');
    await waitFor(page, () => ASB.sending === false && document.getElementById('asp-say').value === '');
    chk(await idleNow() === 0, 'B7c a sent message sets the count back to 0 (#3947)');
    await page.click('#asp-x');
    await page.waitForTimeout(250);
    await page.click('#asb');
    await page.click('#asp-x');
    await page.waitForTimeout(250);
    const afterSend = await bubble(page);
    chk(!afterSend.hide && !afterSend.panel && await idleNow() === 1, 'B7c CONTROL: after the send, the next idle close counts 1 and does not offer', JSON.stringify(afterSend));
    // Storage that refuses: nothing is counted, and x simply closes (never an error, never the offer).
    await fresh(0, false);
    await page.evaluate(() => { window.__lsSet = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error('refused'); }; });
    for (let i = 0; i < 2; i++) { await page.click('#asb'); await page.click('#asp-x'); await page.waitForTimeout(250); }
    const refused = await bubble(page);
    await page.evaluate(() => { Storage.prototype.setItem = window.__lsSet; });
    chk(!refused.panel && !refused.hide && refused.bubble, 'B7c with storage refusing, idle closes just close', JSON.stringify(refused));
    // Hide it: the same board switch as Close forever.
    await fresh(1, false);
    await page.click('#asb');
    await page.click('#asp-x');
    await page.waitForTimeout(200);
    chk((await bubble(page)).hide, 'B7c precondition: counted once already, the next idle close offers to hide');
    await page.click('#asp-hide-yes');
    await page.waitForTimeout(300);
    const hid = await bubble(page);
    const s7ch = (await (await fetch(URL + '/api/settings')).json()).setupAssistant;
    chk(!hid.bubble && !hid.panel && s7ch.on === false && await idleNow() === 0, 'B7c Hide it turns the guide off, bubble and all (#3947)', JSON.stringify({ hid, s7ch }));
    await setting({ on: true });
    await fresh(0, false);

    // B8: Close forever turns it off; the Settings switch reads that and brings it back.
    await setting({ asked: false });
    await boot();
    await waitFor(page, () => { const b = document.getElementById('asb'); return b && !b.hidden; }, 8000);
    await page.click('#asb');
    await page.click('#asp-x');
    await page.click('#asp-close-off');
    await page.waitForTimeout(300);
    const off = await bubble(page);
    const s8 = (await (await fetch(URL + '/api/settings')).json()).setupAssistant;
    chk(!off.bubble && !off.panel && s8.on === false && s8.asked === true, 'B8 Close forever hides it and turns it off', JSON.stringify({ off, s8 }));
    await page.evaluate(() => showTab('settings'));
    await page.evaluate(() => { const b = document.querySelector('[data-sec="mac"], [data-sec="computer"]'); if (b) b.click(); });
    const row = await page.evaluate(() => ({ hidden: document.getElementById('asb-row').hidden, on: document.getElementById('asb-toggle').getAttribute('aria-checked'),
      head: document.getElementById('tips-box').querySelector('.dlab').textContent }));
    chk(row.hidden === false && row.on === 'false' && row.head === 'Help', 'B8 Settings shows the Setup assistant switch, off, under Help', JSON.stringify(row));
    await page.evaluate(() => document.getElementById('asb-toggle').click());
    chk(await waitFor(page, () => { const b = document.getElementById('asb'); return b && !b.hidden; }), 'B8 switching it on brings the bubble back at once');
    chk((await (await fetch(URL + '/api/settings')).json()).setupAssistant.on === true, 'B8 and the board remembers it is on');

    // B9: first run is its own full-screen flow, so the bubble steps out of it (control: B8's last arm).
    await page.evaluate(() => { const fr = document.getElementById('firstrun'); if (fr) fr.hidden = false; });
    chk(await waitFor(page, () => document.getElementById('asb').hidden), 'B9 during first run the bubble is hidden');
    await page.evaluate(() => { const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true; });
    chk(await waitFor(page, () => !document.getElementById('asb').hidden), 'B9 CONTROL: it comes back when first run is gone');

    // B12: the board refuses a page report with 409 (it could not write the report, or could not check
    // just now). That is not "no guide": the chat stays open and the bubble does not blink away.
    await page.route('**/api/setup-guide/page', (route) => route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"we could not tell the setup guide which screen you are on"}' }));
    await page.click('#asb');
    await page.waitForTimeout(2500);
    const b12 = await bubble(page);
    chk(b12.panel && await page.evaluate(() => ASB.guide === 'josh'), 'B12 a refused page report (409) keeps the guide and the open chat', JSON.stringify(b12));
    await page.unroute('**/api/setup-guide/page');
    await page.click('#asp-fold');

    // B13: the settings read fails once at load; it is read again and the bubble arrives without a reload.
    let settingsFailed = 0;
    /* Only the assistant's own read fails: the first settings GET once the page knows the guide (other
       parts of the app read /api/settings too, and failing one of theirs would test nothing here). */
    await page.route('**/api/settings', async (route) => {
      const knowsGuide = await page.evaluate(() => typeof ASB !== 'undefined' && !!ASB.guide && !ASB.setting).catch(() => false);
      if (route.request().method() === 'GET' && settingsFailed === 0 && knowsGuide) { settingsFailed++; return route.abort(); }
      return route.continue();
    });
    await boot();
    chk(await waitFor(page, () => { const b = document.getElementById('asb'); return b && !b.hidden; }, 15000) && settingsFailed === 1, 'B13 a settings read that failed at load is retried and the bubble arrives', 'failed=' + settingsFailed);
    await page.unroute('**/api/settings');

    // B16: the tips cannot be read. The Setup assistant switch lives in the same Help box and must still be
    // there ("Close forever" promises it is), while the tips row hides (CONTROL: B1, no guide, no row).
    /* The page retries a failed tips read every second (tipsCheck), and a retry that succeeds repaints the
       row before this arm reads it: hold the retry off for the arm, then let it run again. */
    await page.evaluate(() => { TIPS_LOAD_NEXT = Date.now() + 1e9; TIPS_STATE = { ok: false, seen: [], off: true }; paintTipsToggle(); showTab('settings'); document.querySelector('#s-nav button[data-go="mac"]').click(); });
    await page.waitForTimeout(300);
    const b16 = await page.evaluate(() => ({ box: document.getElementById('tips-box').hidden, tipsRow: document.getElementById('tips-row').hidden, asbRow: document.getElementById('asb-row').hidden }));
    chk(b16.box === false && b16.asbRow === false && b16.tipsRow === true, 'B16 with the tips unreadable, the Help box still offers the Setup assistant switch', JSON.stringify(b16));
    await page.evaluate(() => { TIPS_LOAD_NEXT = 0; showTab('agents'); });

    // B14: a new agent takes the guide's name (its folder has no guide marker). The board answers 409
    // "not-guide"; unlike a check it could not make (B12), that means the guide is gone.
    const marker14 = path.join(path.dirname(instructions.fileFor('josh')), setupAssistant.GUIDE_MARKER);
    chk((await bubble(page)).bubble, 'B14 precondition: the bubble is showing');
    fs.rmSync(marker14, { force: true });
    await page.evaluate(() => asbPoll(true));
    chk(await waitFor(page, () => document.getElementById('asb').hidden && ASB.guide === null, 6000), 'B14 a folder that is not the guide\'s (a new agent took the name) is not used as the guide');
    fs.writeFileSync(marker14, 'josh\n');   // the real guide back, for the arms after
    chk(await waitFor(page, () => { const b = document.getElementById('asb'); return b && !b.hidden; }, 15000), 'B14 CONTROL: the marked guide is found again');

    // B19: the guide goes while the person is typing. Send says why, keeps their words, and the chat closes a
    // moment later rather than vanishing with the message unread.
    await page.click('#asb');
    await waitFor(page, () => !document.getElementById('asp').hidden);
    unseed();
    await page.fill('#asp-say', 'Are you there?');
    await page.keyboard.press('Enter');
    chk(await waitFor(page, () => /not on this computer any more/.test(document.getElementById('asp-msg').textContent) && !document.getElementById('asp').hidden), 'B19 a send refused because the guide went says so in the open chat');
    chk(await page.evaluate(() => document.getElementById('asp-say').value === 'Are you there?'), 'B19 and the words stay in the box');
    chk(await waitFor(page, () => document.getElementById('asp').hidden && ASB.guide === null, 8000), 'B19 then the chat closes with the guide gone');
    seedGuide('josh');
    chk(await waitFor(page, () => { const b = document.getElementById('asb'); return b && !b.hidden; }, 15000), 'B19 CONTROL: the guide back, the bubble returns');

    // B10: the guide goes while the chat is FOLDED: the next thread read asks the board first, is told
    // there is no guide, and the page stops using the name (a new agent that took it must never get the
    // guide's chat or light its dot). CONTROL: the bubble is showing just before.
    chk(!(await bubble(page)).panel && (await bubble(page)).bubble, 'B10 precondition: folded, bubble showing');
    unseed();
    await page.evaluate(() => asbPoll(true));
    chk(await waitFor(page, () => document.getElementById('asb').hidden && document.getElementById('asp').hidden, 6000), 'B10 a guide gone while folded: the next read notices and the bubble goes');
    chk(await page.evaluate(() => ASB.guide === null), 'B10 and the page no longer holds the name');
    // B10b: and a fresh page with no guide shows none.
    await boot();
    await page.waitForTimeout(3800);
    chk(!(await bubble(page)).bubble, 'B10b once the board names no guide, a fresh page shows no bubble');

    chk(errs.length === 0, 'B11 no page errors', errs.join(' | '));
  } finally {
    await browser.close();
    server.close();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); for (const f of fail) console.error('  FAIL  ' + f); process.exit(1); }
  console.log('\nall assistant-bubble checks passed (' + pass + ')');
})().catch((e) => { console.error(e); process.exit(1); });
