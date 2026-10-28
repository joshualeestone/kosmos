// Browser-check-surface: pj-arch-head pj-arch-open pj-arch-back pj-arch-undo pj-arch-ask pjarch-modal pjarch-when pjarch-go msg-archived pj-room
'use strict';
/* kosmos#7365 slice 3b: the room archive, in the real page on a real (sandboxed) board.
 *
 * A project dated back to 2020 (#7185 hides rows older than a project), with 260 posts from ten days ago and 230
 * from the last few hours, all appended to the board's own log. Then:
 *   - before any marker nothing is archived: no boundary row, even at the start of the room (CONTROL);
 *   - "Archive older messages" opens the confirm; Escape archives nothing (CONTROL); "this week" archives the 260
 *     and the receipt names the time the server used;
 *   - the boundary row "Older messages are archived" shows only once the reader has scrolled back to the start of
 *     the live history, not on the first page (230 live rows are more than one 200-row page);
 *   - View archive opens the archive in the same panel: its header counts 260, the newest archived post is at the
 *     bottom, scrolling to the top reads the earlier page and reaches "This is the start of the room";
 *   - Back to the room paints the live room again;
 *   - a search hit on an archived post carries the Archived tag, a live hit does not (CONTROL);
 *   - Undo clears the marker, leaves the archive view, and the boundary row is gone.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-room-archive-7365.js
 *   SHOT_DIR=<dir> keeps the screenshots.
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..', '..');
const freePort = () => Number(require('node:child_process').execFileSync(process.execPath, ['-e', "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"], { encoding: 'utf8' }));
const PORT = freePort();
const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'archive7365-shots-'));
const DAY = 24 * 60 * 60 * 1000;
const ARCHIVED = 260;
const LIVE = 230;

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}
// The file under the sandbox's data root (the store adds its own app folder under AGENT_WORKFORCE_DATA).
function findUnder(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name === name) return full;
    if (e.isDirectory()) { const got = findUnder(full, name); if (got) return got; }
  }
  return null;
}

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-' + k.toLowerCase() + '-'));
  fs.writeFileSync(roots.DATA + '/fake-panes', require('../../test-support/fleet').line({ session: 'roomer-discord', claim: 'roomer', title: '✳ idle' }) + '\n');
  fs.writeFileSync(roots.DATA + '/fake-sessions', 'roomer-discord\n');
  fs.writeFileSync(roots.DATA + '/fake-screen', '❯ \n  ⏵⏵ bypass permissions on (shift+tab to cycle)\n');
  const srv = spawn('node', ['server.js'], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT), AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_DATA: roots.DATA, AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH, AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh'),
      AGENT_WORKFORCE_FAKE_PANES: roots.DATA + '/fake-panes',
      AGENT_WORKFORCE_FAKE_SESSIONS: roots.DATA + '/fake-sessions',
      AGENT_WORKFORCE_FAKE_SCREEN: roots.DATA + '/fake-screen' },
    stdio: 'ignore',
  });
  const base = 'http://127.0.0.1:' + PORT;
  let browser = null;
  try {
    for (let i = 0; i < 50; i++) {   // wait for the board to answer, not a fixed sleep
      try { if ((await fetch(base + '/api/projects')).ok) break; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    // The project, then its room seeded straight into the board's log: posts older than a day cannot be made through
    // the post route, and the marker floor (the last day stays live) means only such posts can be archived.
    const made = await fetch(base + '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Archive check' }) });
    if (!made.ok) throw new Error('project create ' + made.status);
    const pid = (await made.json()).project.id;
    await fetch(base + '/api/project/' + pid + '/agent/roomer', { method: 'POST', headers: { 'content-type': 'application/json' } });
    const projFile = findUnder(roots.DATA, 'projects.json');
    if (!projFile) throw new Error('no projects.json under the sandbox data root');
    const list = JSON.parse(fs.readFileSync(projFile, 'utf8'));
    fs.writeFileSync(projFile, JSON.stringify(list.map((q) => (q.id === pid ? { ...q, createdAt: '2020-01-01T00:00:00.000Z' } : q))));
    const now = Date.now();
    const lines = [];
    const row = (id, atMs, text, replyTo) => lines.push({ kind: 'post', id, project: pid, from: 'roomer', to: [], text, at: new Date(atMs).toISOString(), outcomes: {}, ...(replyTo ? { replyTo } : {}) });
    // a250 answers a249 (both archived); l1 answers a3 (an archived original, seen from the live room).
    for (let i = 0; i < ARCHIVED; i++) row('a' + i, now - 10 * DAY + i * 60000, (i === 7 ? 'needle-old ' : '') + 'archived post ' + i, i === 250 ? 'a249' : null);
    for (let i = 0; i < LIVE; i++) row('l' + i, now - 5 * 60 * 60000 + i * 60000, (i === 9 ? 'needle-new ' : '') + 'live post ' + i, i === 1 ? 'a3' : null);
    const logDir = path.dirname(projFile);
    fs.appendFileSync(path.join(logDir, 'messages.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');

    browser = await chromium.launch({ headless: process.env.HEADED === '0' });
    const p = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    const openRoom = async () => {
      await p.goto(base + '/', { waitUntil: 'networkidle' });
      if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');
      await p.click('[data-tab="projects"]');
      await p.locator('#pj-list').getByText('Archive check', { exact: true }).first().click();
      await p.waitForFunction(() => document.querySelectorAll('#pj-room .msg').length > 0, null, { timeout: 15000 });
    };
    // The toast's own words, once they match (the toast writes them a moment after it appears).
    const toastSays = async (re) => {
      try {
        await p.waitForFunction((src) => new RegExp(src).test((document.getElementById('msg-toast') || {}).textContent || ''), re.source, { timeout: 5000 });
      } catch { /* the match below reports what was there */ }
      return p.evaluate((src) => ((document.getElementById('msg-toast') || {}).textContent || '').match(new RegExp(src)), re.source);
    };
    // Archive with one choice, through the confirm; answers what the toast said.
    const archiveWith = async (choice, re) => {
      await p.click('#pj-arch-ask');
      await p.waitForSelector('#pjarch-modal:not([hidden])', { timeout: 5000 });
      await p.selectOption('#pjarch-when', choice);
      await p.click('#pjarch-go');
      await p.waitForSelector('#pjarch-modal', { state: 'hidden', timeout: 5000 });
      await toastSays(re);
      return p.evaluate(() => ((document.getElementById('msg-toast') || {}).textContent || '').trim());   // the whole sentence, not the matched part
    };
    /* The View archive button must be there before a step clicks it. Missing, it is a labelled FAIL and the run stops
       (every later step needs the archive), never a 30-second click timeout with no label (review 5). */
    const needViewArchive = async (where) => {
      const there = await p.waitForSelector('#pj-arch-open', { timeout: 5000 }).then(() => true, () => false);
      chk(there, 'the View archive button is there ' + where);
      if (!there) throw new Error('stopping: no View archive button ' + where);
    };
    // Scroll the room to its top until the window holds the live history back to its start (or 20 tries).
    const scrollToStart = async () => {
      for (let i = 0; i < 20; i++) {
        if (await p.evaluate(() => pjWinAtStart())) return true;
        await p.evaluate(() => { const b = document.getElementById('pj-room'); b.scrollTop = 0; b.dispatchEvent(new Event('scroll')); });
        await p.waitForTimeout(400);
      }
      return p.evaluate(() => pjWinAtStart());
    };

    // CONTROL: no marker yet, and 490 posts is under the automatic rule's 1,000, so nothing is archived.
    await openRoom();
    chk(await scrollToStart(), 'CONTROL: scrolling back reaches the start of the room');
    chk(await p.locator('#pj-arch-open').count() === 0, 'CONTROL: with nothing archived, the start of the room has no boundary row');
    chk(await p.locator('#pj-room .msg').filter({ hasText: 'archived post 0' }).count() > 0, 'CONTROL: before the marker the oldest post is in the live room');

    // The confirm. Escape first (CONTROL: nothing is archived), then "this week": the 260 posts from ten days ago are
    // archived and the 230 from today stay live.
    await p.click('#pj-arch-ask');
    await p.waitForSelector('#pjarch-modal:not([hidden])', { timeout: 5000 });
    const ask = await p.evaluate(() => ({ title: document.getElementById('pjarch-title').textContent.replace(/\s+/g, ' ').trim(),
      small: document.getElementById('pjarch-small').textContent.trim(), focus: document.activeElement && document.activeElement.id }));
    chk(/^Archive messages older than this week/.test(ask.title) && /this month/.test(ask.title) && /everything older than a day/.test(ask.title)
      && /^They leave this room and what agents read here\. You can still search and open them, and undo this from the archive\.$/.test(ask.small),
      'the confirm reads "Archive messages older than [this week]?" with the three choices and what it does', JSON.stringify(ask));
    chk(ask.focus === 'pjarch-when', 'the confirm opens with the choice focused', String(ask.focus));
    // It sits inside the room's section (no spare body row); position:fixed must still make it cover the whole window.
    const cover = await p.evaluate(() => { const r = document.getElementById('pjarch-modal').getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight }; });
    chk(cover.x === 0 && cover.y === 0 && cover.w === cover.vw && cover.h === cover.vh, 'the confirm\'s backdrop covers the whole window, though it sits inside the room\'s section', JSON.stringify(cover));
    const onTop = await p.evaluate(() => [[innerWidth / 2, innerHeight / 2], [4, 4], [innerWidth - 4, innerHeight - 4]].map(([x, y]) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest('#pjarch-modal')); }));
    chk(onTop.every(Boolean), 'the confirm paints above everything: the middle and two corners of the window are the confirm', JSON.stringify(onTop));
    await p.screenshot({ path: path.join(OUT, 'confirm.png') });
    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);
    const esc = await (await fetch(base + '/api/project/' + pid + '/room?n=1&archive=0')).json();
    chk(await p.locator('#pjarch-modal').isHidden() && Number(esc.archivedCount) === 0, 'CONTROL: Escape closes the confirm and archives nothing', String(esc.archivedCount));
    await p.click('#pj-arch-ask');
    await p.waitForSelector('#pjarch-modal:not([hidden])', { timeout: 5000 });
    await p.selectOption('#pjarch-when', 'month');
    const cutMonth = await p.locator('#pjarch-cut').innerText();
    await p.selectOption('#pjarch-when', 'week');
    const cutWeek = await p.locator('#pjarch-cut').innerText();
    chk(/^Messages from before .+\.$/.test(cutWeek) && cutWeek !== cutMonth, 'the confirm shows the cutoff as a time, and it follows the choice', JSON.stringify({ cutWeek, cutMonth }));
    // Tab stays inside the confirm (aria-modal): from Archive, the last stop, it comes round to the choice.
    await p.focus('#pjarch-go');
    await p.keyboard.press('Tab');
    chk(await p.evaluate(() => document.activeElement && document.activeElement.id) === 'pjarch-when', 'Tab from the last button comes back to the choice, not the page behind');
    // A refused Archive keeps the confirm open, says nothing changed, and leaves focus on Archive.
    await p.route('**/room/archive', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"because":"x"}' }) : r.continue()));
    await p.click('#pjarch-go');
    await p.waitForTimeout(500);
    const refused = await p.evaluate(() => ({ open: !document.getElementById('pjarch-modal').hidden, msg: document.getElementById('pjarch-msg').textContent, focus: document.activeElement && document.activeElement.id }));
    chk(refused.open && refused.msg === 'We could not archive just now; nothing changed.' && refused.focus === 'pjarch-go', 'a refused Archive keeps the confirm open, says nothing changed (no raw reason) and keeps focus on Archive', JSON.stringify(refused));
    await p.unroute('**/room/archive');
    await p.click('#pjarch-go');
    await p.waitForSelector('#pjarch-modal', { state: 'hidden', timeout: 5000 });
    // The page closes the confirm, then reads the count, then writes the toast (60 ms after its first): wait for the words.
    const receipt = await toastSays(/Messages before [^.]+ are archived\. Undo is in the archive\./);
    chk(!!receipt, 'Archive answers with a receipt naming the time the server used', String(receipt && receipt[0]));
    const marked = await (await fetch(base + '/api/project/' + pid + '/room?n=1&archive=0')).json();
    const usedMs = marked.archiveMarker ? Date.parse(marked.archiveMarker.before) : NaN;
    chk(Math.abs(usedMs - (Date.now() - 7 * DAY)) < 3 * 60 * 60 * 1000, '"this week" sent a time about seven days ago', String(marked.archiveMarker && marked.archiveMarker.before));

    await openRoom();
    await p.waitForTimeout(300);
    chk(!(await p.evaluate(() => pjWinAtStart())) && await p.locator('#pj-arch-open').count() === 0,
      'the first page (200 of 230 live posts) does not show the boundary row: it is not a standing notice');
    chk(await scrollToStart(), 'scrolling back reaches the start of the live history');
    await needViewArchive('at the start of the live history');
    const edge = await p.evaluate(() => {
      const b = document.getElementById('pj-arch-open');
      const e = b && b.closest('.pj-arch-edge');
      const first = document.querySelector('#pj-room').firstElementChild;
      return { text: e ? e.textContent.replace(/\s+/g, ' ').trim() : null, first: !!(e && first === e), archived: PJ_WIN.archivedCount };
    });
    chk(edge.text === 'Older messages are archived. View archive' && edge.first, 'at the start of the live history the first row reads "Older messages are archived. View archive"', JSON.stringify(edge));
    chk(edge.archived === ARCHIVED, 'the live read says 260 posts are archived', String(edge.archived));
    chk(await p.locator('#pj-room .msg').filter({ hasText: /^archived post|archived post \d/ }).count() === 0, 'no archived post is in the live room');
    await p.screenshot({ path: path.join(OUT, 'boundary-row.png') });
    const liveReply = await p.evaluate(() => { const r = [...document.querySelectorAll('#pj-room .msg')].find((m) => { const b = m.querySelector('.msg-bd > p'); return b && /^live post 1$/.test(b.textContent.trim()); }); const h = r && r.querySelector('.msg-replyto'); return h ? h.textContent.trim() : null; });
    chk(liveReply === 'Original message may be in the archive', 'a live reply whose original is archived says it may be in the archive, not "unavailable"', String(liveReply));
    // The reader's place: the first message whose bottom is inside the view, and how far from the top it sits.
    const place = () => p.evaluate(() => { const box = document.getElementById('pj-room'); const q = box.getBoundingClientRect(); const m = [...box.querySelectorAll('.msg')].find((x) => x.getBoundingClientRect().bottom > q.top + 1); const b = m && m.querySelector('.msg-bd > p'); return m ? { text: b ? b.textContent.trim() : '', dy: Math.round(m.getBoundingClientRect().top - q.top) } : null; });
    const placeBefore = await place();

    // View archive.
    await p.click('#pj-arch-open');
    await p.waitForSelector('#pj-arch-head:not([hidden])', { timeout: 5000 });
    chk(await p.evaluate(() => document.activeElement && document.activeElement.id) === 'pj-arch-back', 'opening the archive moves focus to its header (Back to the room)');
    const arch = await p.evaluate(() => {
      const box = document.getElementById('pj-room');
      const msgs = [...box.querySelectorAll('.msg')];
      return { head: document.getElementById('pj-arch-head').textContent.replace(/\s+/g, ' ').trim(), undo: !document.getElementById('pj-arch-undo').hidden,
        n: msgs.length, last: msgs.length ? msgs[msgs.length - 1].textContent : '', on: box.classList.contains('pj-arch-on'),
        start: !!box.querySelector('.pj-arch-edge') && /start of the room/.test(box.textContent), live: /live post/.test(box.textContent) };
    });
    chk(/^Archive 260 messages Undo Back to the room$/.test(arch.head) && arch.undo, 'the archive header reads Archive, 260 messages, Undo, Back to the room', arch.head);
    chk(arch.on && arch.n === 200 && /archived post 259/.test(arch.last) && !arch.live, 'the archive shows its newest page, the newest archived post at the bottom, and no live post', JSON.stringify({ n: arch.n, live: arch.live }));
    chk(!arch.start, 'CONTROL: on the first archive page the start-of-room line is not shown yet');
    chk(await p.locator('#pj-room .msg-archived').count() === 0, 'inside the archive view no row carries the Archived tag (the header says it)');
    const archReply = await p.evaluate(() => { const r = [...document.querySelectorAll('#pj-room .msg')].find((m) => { const b = m.querySelector('.msg-bd > p'); return b && /^archived post 250$/.test(b.textContent.trim()); }); if (!r) return null; const h = r.querySelector('.msg-replyto'); const vh = r.querySelector('.vh'); return { header: h ? h.textContent.trim() : null, heard: vh ? vh.textContent.trim() : null }; });
    chk(!!archReply && !/unavailable/.test(JSON.stringify(archReply)) && /archived post 249/.test(JSON.stringify(archReply)), 'an archived reply names its archived original, not "unavailable"', JSON.stringify(archReply));
    // A poll lands while the archive is open, with a new post in the live room: the archive stays as it is.
    const sent = await fetch(base + '/api/project/' + pid + '/room', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'posted while the archive was open' }) });
    chk(sent.ok, 'CONTROL: a post reached the live room while the archive was open', String(sent.status));
    // Wait until a poll has really read the new post into the live window (review 4: a fixed sleep proved nothing).
    const polled = await p.waitForFunction(() => Array.isArray(PJ_WIN.newest) && PJ_WIN.newest.some((r) => r && /posted while the archive was open/.test(r.text || '')), null, { timeout: 15000 }).then(() => true, () => false);
    chk(polled, 'CONTROL: a poll read the new post while the archive was open');
    const kept = await p.evaluate(() => ({ head: !document.getElementById('pj-arch-head').hidden, n: document.querySelectorAll('#pj-room .msg').length,
      leaked: /posted while the archive was open|live post/.test(document.getElementById('pj-room').textContent) }));
    chk(kept.head && kept.n >= 200 && !kept.leaked, 'a poll that lands while the archive is open leaves the archive on screen and paints no live row over it', JSON.stringify(kept));
    await p.screenshot({ path: path.join(OUT, 'archive-view.png') });
    // The earlier archive page fails once: the line says so with Try again, and a scroll does not retry by itself.
    let failOnce = true;
    await p.route(/\/room\?.*archive=1.*cursor=/, (r) => { if (failOnce) { failOnce = false; return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"x"}' }); } return r.continue(); });
    await p.evaluate(() => { const b = document.getElementById('pj-room'); b.scrollTop = 0; b.dispatchEvent(new Event('scroll')); });
    await p.waitForTimeout(800);
    const failed = await p.evaluate(() => ({ text: document.getElementById('pj-room-older-text').textContent, retry: !document.getElementById('pj-room-older-show').hidden, n: document.querySelectorAll('#pj-room .msg').length }));
    chk(failed.text === 'We could not read the earlier archived messages.' && failed.retry && failed.n === 200, 'a failed earlier archive page says so on the line, with Try again', JSON.stringify(failed));
    await p.click('#pj-room-older-show');
    await p.waitForTimeout(800);
    await p.unroute(/\/room\?.*archive=1.*cursor=/);
    chk(await p.evaluate(() => document.querySelectorAll('#pj-room .msg').length) > 200, 'Try again reads the earlier archive page');
    for (let i = 0; i < 10 && !(await p.evaluate(() => PJ_ARCH.olderCount === 0)); i++) {
      await p.evaluate(() => { const b = document.getElementById('pj-room'); b.scrollTop = 0; b.dispatchEvent(new Event('scroll')); });
      await p.waitForTimeout(400);
    }
    const earlier = await p.evaluate(() => ({ n: document.querySelectorAll('#pj-room .msg').length, start: /This is the start of the room\./.test(document.getElementById('pj-room').textContent),
      first: ((document.querySelector('#pj-room .msg .msg-bd > p') || {}).textContent || '').trim() }));
    chk(earlier.n === ARCHIVED && earlier.start && earlier.first === 'archived post 0', 'scrolling to the top of the archive reads the earlier page and reaches "This is the start of the room."', JSON.stringify(earlier));

    // Back to the room.
    await p.click('#pj-arch-back');
    await p.waitForTimeout(300);
    const back = await p.evaluate(() => ({ head: document.getElementById('pj-arch-head').hidden, on: document.getElementById('pj-room').classList.contains('pj-arch-on'),
      live: /live post 229/.test(document.getElementById('pj-room').textContent), arch: /archived post/.test(document.getElementById('pj-room').textContent) }));
    chk(back.head && !back.on && back.live && !back.arch, 'Back to the room hides the archive header and paints the live room', JSON.stringify(back));
    chk(await p.evaluate(() => /posted while the archive was open/.test(document.getElementById('pj-room').textContent)), 'Back shows the post that arrived while the archive was open');
    chk(await p.evaluate(() => document.activeElement && document.activeElement.id) === 'pj-post', 'Back moves focus to the room\'s message box');
    const placeAfter = await place();
    chk(!!placeBefore && !!placeAfter && placeBefore.text === placeAfter.text && Math.abs(placeBefore.dy - placeAfter.dy) <= 2, 'Back puts the reader back where they were (the same message at the same place at the top of the view)', JSON.stringify({ placeBefore, placeAfter }));

    // Search covers both, and an archived hit says so.
    await p.fill('#pj-room-search', 'needle');
    await p.waitForTimeout(800);
    const hits = await p.evaluate(() => [...document.querySelectorAll('#pj-room .msg')].filter((m) => /needle-/.test(m.textContent))
      .map((m) => ({ old: /needle-old/.test(m.textContent), tag: !!m.querySelector('.msg-archived') })));
    const oldHit = hits.find((h) => h.old), newHit = hits.find((h) => !h.old);
    chk(!!oldHit && oldHit.tag, 'a search hit on an archived post carries the Archived tag', JSON.stringify(hits));
    chk(!!newHit && !newHit.tag, 'CONTROL: a search hit on a live post has no Archived tag', JSON.stringify(hits));
    await p.screenshot({ path: path.join(OUT, 'search-archived-tag.png') });
    await p.fill('#pj-room-search', '');
    await p.waitForTimeout(500);

    // Undo, from the archive view.
    if (!(await scrollToStart())) chk(false, 'scrolling back reaches the start again before Undo');
    await needViewArchive('before Undo');
    await p.click('#pj-arch-open');
    await p.waitForSelector('#pj-arch-undo:not([hidden])', { timeout: 5000 });
    await p.focus('#pj-arch-undo');
    await p.click('#pj-arch-undo');
    await p.waitForFunction(() => document.getElementById('pj-arch-head').hidden, null, { timeout: 5000 }).catch(() => null);
    await p.waitForTimeout(800);
    const marker = await (await fetch(base + '/api/project/' + pid + '/room?n=1&archive=0')).json();
    chk(Number(marker.archivedCount) === 0 && !marker.archiveMarker, 'Undo clears the marker: the live read says nothing is archived', JSON.stringify({ archivedCount: marker.archivedCount, marker: marker.archiveMarker }));
    const undone = await p.evaluate(() => ({ head: document.getElementById('pj-arch-head').hidden, count: PJ_WIN.archivedCount }));
    chk(undone.head && undone.count === 0, 'after Undo the page leaves the archive and counts nothing archived', JSON.stringify(undone));
    const undoSaid = await p.evaluate(() => ({ toast: /Undone\. Messages you archived are back in the room/.test(document.body.textContent), focus: document.activeElement && document.activeElement.id }));
    chk(undoSaid.toast && undoSaid.focus === 'pj-post', 'Undo says what it did and moves focus to the message box', JSON.stringify(undoSaid));
    await scrollToStart();
    await p.waitForTimeout(300);
    chk(await p.locator('#pj-arch-head').isHidden() && await p.locator('#pj-arch-open').count() === 0, 'after Undo the start of the room has no boundary row (and the archive is not on screen)');
    // "everything older than a day": the receipt names a time 24 hours back, the time the server keeps live from.
    const daySaid = await archiveWith('day', /Messages before [^.]+ are archived\. Undo is in the archive\./);
    const dayM = await (await fetch(base + '/api/project/' + pid + '/room?n=1&archive=0')).json();
    const dayMs = dayM.archiveMarker ? Date.parse(dayM.archiveMarker.before) : NaN;
    const live = Number(dayM.olderCount) + dayM.rows.length;
    chk(Math.abs(dayMs - (Date.now() - DAY)) < 5 * 60 * 1000 && Number(dayM.archivedCount) === ARCHIVED && live === LIVE + 1,
      '"everything older than a day" archives up to 24 hours ago, and today\'s posts (230, and the one posted meanwhile) stay live', JSON.stringify({ before: dayM.archiveMarker && dayM.archiveMarker.before, archived: dayM.archivedCount, live, said: daySaid }));
    // What Archive says follows the count before and after: an earlier cutoff brings rows back; the same one archives nothing more.
    const backSaid = await archiveWith('month', /the messages you had archived are back in the room\./);
    chk(/^Nothing in this room is older than .+; the messages you had archived are back in the room\.$/.test(backSaid), 'a cutoff earlier than every post says the archived messages are back and claims nothing is archived', backSaid);
    const sameSaid = await archiveWith('month', /^Nothing more in this room was old enough to archive/);
    chk(/^Nothing more in this room was old enough to archive \(before .+\)\.$/.test(sameSaid), 'the same cutoff again says nothing more was old enough, not a receipt', sameSaid);
    // Phone width: the header holds read-aloud, the archive button and search; none of it may push the page sideways.
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForTimeout(400);
    const narrow = await p.evaluate(() => { const b = document.getElementById('pj-arch-ask').getBoundingClientRect(); const h = document.getElementById('pj-arch-ask').closest('.pjmidhead').getBoundingClientRect(); return { sw: document.documentElement.scrollWidth, vw: innerWidth, left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width), headRight: Math.round(h.right) }; });
    await p.screenshot({ path: path.join(OUT, 'phone-header.png') });
    chk(narrow.sw <= narrow.vw, 'at 390px the page does not scroll sideways', JSON.stringify(narrow));
    chk(narrow.w > 0 && narrow.left >= 0 && narrow.right <= Math.min(narrow.vw, narrow.headRight), 'at 390px the archive button is shown, inside the window and inside its header', JSON.stringify(narrow));
    // And the archive view at 390px: its header above the thread must not push the newest archived post under the composer.
    await archiveWith('day', /are archived/);   // the search was cleared before the resize, so nothing to fill here (review 4)
    await scrollToStart();
    await needViewArchive('at 390px');
    await p.click('#pj-arch-open');
    await p.waitForSelector('#pj-arch-head:not([hidden])', { timeout: 5000 });
    await p.waitForTimeout(500);
    // Measured against the composer box itself (.pjmid .composer, what the phone fit uses), with the thread at its end.
    await p.evaluate(() => { const b = document.getElementById('pj-room'); b.scrollTop = b.scrollHeight; });
    await p.waitForTimeout(300);
    const fit = await p.evaluate(() => { const msgs = document.querySelectorAll('#pj-room .msg'); const last = msgs[msgs.length - 1]; const comp = document.querySelector('.pjmid .composer'); const box = document.getElementById('pj-room').getBoundingClientRect();
      return { lastBottom: last ? Math.round(last.getBoundingClientRect().bottom) : null, roomBottom: Math.round(box.bottom), composerTop: comp ? Math.round(comp.getBoundingClientRect().top) : null }; });
    await p.screenshot({ path: path.join(OUT, 'phone-archive.png') });
    chk(fit.lastBottom !== null && fit.composerTop !== null && fit.roomBottom <= fit.composerTop + 1 && fit.lastBottom <= fit.composerTop + 1,
      'at 390px the archive\'s thread, and its newest post, end above the composer', JSON.stringify(fit));
    // Archive pressed from inside the archive view: the archive closes and the live room is painted, never left unlabelled.
    const insideSaid = await archiveWith('week', /archived|old enough/);
    const inside = await p.evaluate(() => ({ head: document.getElementById('pj-arch-head').hidden, on: document.getElementById('pj-room').classList.contains('pj-arch-on'),
      live: [...document.querySelectorAll('#pj-room .msg .msg-bd > p')].some((x) => /^live post \d+$/.test(x.textContent.trim())),
      arch: [...document.querySelectorAll('#pj-room .msg .msg-bd > p')].some((x) => /^archived post \d+$/.test(x.textContent.trim())) }));
    chk(inside.head && !inside.on && inside.live && !inside.arch, 'Archive pressed inside the archive view closes it and paints the live room, with no archived row left on screen', JSON.stringify(Object.assign({ said: insideSaid }, inside)));
    chk(errs.length === 0, 'no page errors', errs.join(' | '));
  } finally {
    if (browser) await browser.close();
    srv.kill();
    for (const d of Object.values(roots)) fs.rmSync(d, { recursive: true, force: true });
  }
  console.log(`screenshots: ${OUT}`);
  if (fail.length) { for (const f of fail) console.error('  FAIL  ' + f); }
  console.log(fail.length ? `\n${fail.length} FAILED` : '\nall passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('FAIL  render-room-archive-7365: ' + (e && e.stack || e)); process.exit(2); });
