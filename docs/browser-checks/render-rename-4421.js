// Browser-check-surface: d-talk-label d-dmthread msg-nm d-busy d-name d-meta d-rename d-save
'use strict';
/**
 * #4421 (Josh, 2026-09-28): he renamed an agent and its heading said "Demis Hassabis - Gemini" while the
 * "Direct Message to" title, every message label and the "is working" line kept saying "Gemini-Sub". Those read
 * the card as it was when the agent was opened (CURRENT), and a restart does not reopen it.
 *
 * The real sequence, in a real page: the board serves the agent under its old name, the agent is opened with the
 * real openDetail, then the board serves the SAME agent renamed and working, and the real poll (tick) runs.
 *   OPENED   before the rename: the title names the old name (the control: the fixture reaches the page).
 *   RENAMED  after one poll: the title, the agent's message labels, the working line and the heading all name the
 *            new name, and the old one appears in none of them; the "no name was chosen" note under the heading
 *            is gone (it was given one); the rename box shows the new name.
 *   SAVE     the person then changes only the role and presses Save: the request carries the role and NO name.
 *   STALE SAVE  the board renames it again ("Third Name") and Save is pressed BEFORE any poll: the box still says the
 *            previous name, and the old Save sent it, renaming the agent back. Now no name is sent.
 *   PADDED   a typed name with spaces is saved (the box shows it trimmed), then a rename made elsewhere still
 *            reaches the box: a box left holding the untrimmed text stopped following.
 * The thread fixture holds a person's message and the agent's reply, so the labels are really drawn.
 * Harness posture mirrors render-dm-owes-4340.js: load over file://, answer fetches from the fixture, no timers.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-rename-4421.js
 */
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const ID = 'Gemini-Sub';
const NEW = 'Demis Hassabis - Gemini';
const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const card = (name, state, nameDerived) => ({
  sessionName: ID, name, state, role: 'Project Manager', running: true, isNamedOurs: true, hasAvatar: false, nameDerived,
  because: null, confidence: 'structured', runner: 'gemini', provider: 'google', stateProject: null,
});
const THREAD = {
  messages: [
    { at: ago(6), text: 'what is your name now?', delivery: { state: 'placed', paneState: 'idle' } },
    { at: ago(5), text: 'I am Demis Hassabis.', from: ID },
  ],
  owes: { state: 'clear', lastHeardAt: null, lastSentAt: null, because: null },
  olderCount: 0, historyBecause: null, historyUnfilable: false,
  presence: 'on', presenceBecause: null, asking: false, question: null, questionBecause: null, options: null,
};

async function surfaces(page) {
  return page.evaluate(() => {
    const txt = (id) => { const el = document.getElementById(id); return el ? el.textContent.trim() : null; };
    const box = document.getElementById('d-dmthread');
    const labels = box ? [...box.querySelectorAll('.msg-nm')].map((b) => b.textContent.trim()) : [];
    const note = document.querySelector('#d-meta .dmeta-note');
    return { title: txt('d-talk-label'), heading: txt('d-name'), busy: txt('d-busy'), labels, rows: box ? box.querySelectorAll('.msg').length : 0,
      note: note ? note.textContent : '', box: (document.getElementById('d-rename') || {}).value,
      ini: (document.getElementById('d-initials') || {}).textContent, tint: (document.getElementById('d-initials') || { style: {} }).style.background };
  });
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
    await page.addInitScript((t) => {
      window.__status = null;
      window.__puts = [];
      const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
      window.setInterval = () => 0;
      window.fetch = async (url, init) => {
        const u = String(url);
        if (u.includes('/profile') && init && init.method === 'PUT') { window.__puts.push(JSON.parse(init.body)); return enc({ ok: true }); }
        if (u.includes('/thread')) return enc(t);
        if (u.includes('/api/status')) return enc(window.__status);
        if (u.includes('/api/projects')) return enc({ projects: [] });
        return enc({});
      };
    }, THREAD);
    await page.goto(PAGE);
    await page.evaluate(async (c) => {
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
      window.__status = { agents: [c], version: '0.0.0' };
      await tick();
      openDetail(c.sessionName);
      document.getElementById('panel-detail').hidden = false;
    }, card(ID, 'idle', false));
    await page.waitForTimeout(400);
    const before = await surfaces(page);
    chk(before.title === 'Direct Message to ' + ID, 'OPENED: the title names the agent as the board served it', JSON.stringify(before));
    chk(/no name was chosen/.test(before.note), 'OPENED: an agent with no chosen name carries the note (the control for RENAMED)', JSON.stringify(before));

    await page.evaluate(async (c) => { window.__status = { agents: [c], version: '0.0.0' }; await tick(); }, card(NEW, 'working', true));
    await page.waitForTimeout(400);
    const after = await surfaces(page);
    const all = JSON.stringify(after);
    chk(after.rows === 2 && after.labels.length >= 1, 'RENAMED: the thread really drew its rows and an agent label', all);
    chk(after.title === 'Direct Message to ' + NEW, 'RENAMED: the "Direct Message to" title names the new name', all);
    chk(after.labels.length >= 1 && after.labels.every((l) => l === NEW || l === 'You'), 'RENAMED: the agent\'s message labels name the new name', all);
    chk(/is working/.test(after.busy || '') && (after.busy || '').includes(NEW), 'RENAMED: the working line names the new name', all);
    chk(after.heading === NEW, 'RENAMED: the heading names the new name', all);
    chk(![after.title, after.busy, after.heading, ...after.labels].some((s) => (s || '').includes(ID)), 'RENAMED: the old name appears on none of them', all);
    chk(after.note === '', 'RENAMED: the "no name was chosen" note is gone', all);
    chk(after.box === NEW, 'RENAMED: the rename box shows the new name', all);
    const want = await page.evaluate((n) => { const d = document.createElement('div'); d.style.background = discTint(n); return { ini: initials(n), tint: d.style.background, oldTint: (() => { d.style.background = discTint('Gemini-Sub'); return d.style.background; })() }; }, NEW);
    chk(want.tint !== want.oldTint, 'fixture: the two names have different disc tints (or the tint arm proves nothing)', JSON.stringify(want));
    chk(after.ini === want.ini && after.tint === want.tint, 'RENAMED: the picture\'s initial and its tint are the new name\'s', JSON.stringify({ ini: after.ini, tint: after.tint, want }));

    const puts = await page.evaluate(async () => {
      document.getElementById('d-role').value = 'Chief of Staff';
      document.getElementById('d-save').click();
      await new Promise((r) => setTimeout(r, 300));
      return window.__puts;
    });
    const put = puts[puts.length - 1] || null;
    chk(!!put && put.role === 'Chief of Staff', 'SAVE: the role change was sent', JSON.stringify(puts));
    chk(!!put && !('displayName' in put), 'SAVE: no name was sent, so the rename is not undone', JSON.stringify(puts));

    const stale = await page.evaluate(async (c) => {
      window.__status = { agents: [c], version: '0.0.0' };   // renamed on the board; no poll has run here yet
      const boxWas = document.getElementById('d-rename').value;
      document.getElementById('d-role').value = 'Head of Research';
      document.getElementById('d-save').click();
      await new Promise((r) => setTimeout(r, 300));
      return { boxWas, put: window.__puts[window.__puts.length - 1] };
    }, card('Third Name', 'idle', true));
    chk(stale.boxWas === NEW, 'STALE SAVE: fixture: the box still showed the previous name when Save was pressed', JSON.stringify(stale));
    chk(!!stale.put && stale.put.role === 'Head of Research' && !('displayName' in stale.put),
      'STALE SAVE: no name was sent, so the rename made on the board is not undone', JSON.stringify(stale));

    const padded = await page.evaluate(async ([saved, c]) => {
      window.__status = { agents: [saved], version: '0.0.0' };   // the board holds what the save records, as the route would
      const box = document.getElementById('d-rename');
      box.value = '  Padded Name  ';
      document.getElementById('d-save').click();
      await new Promise((r) => setTimeout(r, 300));
      const afterSave = box.value;
      box.blur();
      window.__status = { agents: [c], version: '0.0.0' };
      await tick();
      return { afterSave, afterRename: box.value, sent: window.__puts[window.__puts.length - 1] };
    }, [card('Padded Name', 'idle', true), card('Renamed Elsewhere', 'idle', true)]);
    chk(padded.sent && padded.sent.displayName === 'Padded Name', 'PADDED: the trimmed name was sent', JSON.stringify(padded));
    chk(padded.afterSave === 'Padded Name', 'PADDED: the box shows the name as saved', JSON.stringify(padded));
    chk(padded.afterRename === 'Renamed Elsewhere', 'PADDED: a later rename made elsewhere still reaches the box', JSON.stringify(padded));
    chk(errs.length === 0, 'no page errors', errs.join(' | '));
    await page.close();
  } finally {
    await browser.close();
  }
  console.log('\nrender-rename-4421: ' + (fail.length ? fail.length + ' failed' : 'all good'));
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('FAIL  render-rename-4421 threw: ' + (e && e.message || e)); process.exit(1); });
