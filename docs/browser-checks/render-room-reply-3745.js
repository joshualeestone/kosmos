// Browser-check-surface: pj-reply pj-post pj-post-go pj-room pj-room-msg pj-room-search rxns rxn-quick rxn-reply msg-replyto msg-flash
'use strict';
/* #3745 replying to a room post, in the real page on a real (sandboxed) board.
 *
 * A project with one agent and two posts. On the first post it hovers, clicks Reply, and checks the
 * "Replying to" strip above the composer; the x cancels it; Reply again, type, Post. Then:
 *   - the new post shows a compact header naming the post it answers;
 *   - clicking the header scrolls to the original and flashes it;
 *   - the agent was TYPED the reference ("answers mK by <who>, posted <when>" in the bracket, then
 *     '(answering: "<first words>")' after it), read from a small
 *     tmux wrapper in this check's sandbox that logs what is pasted;
 *   - a reply whose original is gone says "Original message unavailable".
 *   - the page state: a reply started in one project is not shown in another and comes back on return;
 *     a refused reply keeps the strip and says to press x; the guard against posts painted for another
 *     project (belt and braces, state forced by hand) holds; a jump to a post the search hides says so.
 * Controls: the second post (not a reply) has no header, and the strip starts hidden.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-room-reply-3745.js
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
const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'reply3745-shots-'));

const fail = [];
const STARTED_DAY = new Date().toDateString();
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-' + k.toLowerCase() + '-'));
  fs.writeFileSync(roots.DATA + '/fake-panes', require('../../test-support/fleet').line({ session: 'roomer-discord', claim: 'roomer', title: '✳ idle' }) + '\n');
  fs.writeFileSync(roots.DATA + '/fake-sessions', 'roomer-discord\n');
  fs.writeFileSync(roots.DATA + '/fake-screen', '❯ \n  ⏵⏵ bypass permissions on (shift+tab to cycle)\n');
  // What Kosmos types into the agent: a wrapper that logs set-buffer text, then acts as the fake tmux.
  const typed = path.join(roots.DATA, 'typed.log');
  const wrap = path.join(roots.DATA, 'tmux-wrap.sh');
  fs.writeFileSync(wrap, '#!/bin/sh\n[ "$1" = set-buffer ] && printf \'%s\\n\' "$*" >> "' + typed + '"\nexec "' + path.join(REPO, 'test-support', 'fake-tmux.sh') + '" "$@"\n', { mode: 0o755 });
  const srv = spawn('node', ['server.js'], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT), AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_DATA: roots.DATA, AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH, AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
      AGENT_WORKFORCE_TMUX_BIN: wrap,
      AGENT_WORKFORCE_FAKE_PANES: roots.DATA + '/fake-panes',
      AGENT_WORKFORCE_FAKE_SESSIONS: roots.DATA + '/fake-sessions',
      AGENT_WORKFORCE_FAKE_SCREEN: roots.DATA + '/fake-screen' },
    stdio: 'ignore',
  });
  let browser = null;
  try {
    for (let i = 0; i < 50; i++) {   // wait for the board to answer, not a fixed sleep
      try { if ((await fetch('http://127.0.0.1:' + PORT + '/api/projects')).ok) break; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    browser = await chromium.launch({ headless: process.env.HEADED === '0' });
    const p = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');
    const made = await p.evaluate(async () => {
      const other = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Other place' }) });
      if (!other.ok) return { error: 'second project ' + other.status };
      const r1 = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Reply check' }) });
      if (!r1.ok) return { error: 'project create ' + r1.status };
      const id = (await r1.json()).project.id;
      await fetch('/api/project/' + id + '/agent/roomer', { method: 'POST', headers: { 'content-type': 'application/json' } });
      for (const text of ['The launch moves to Friday.\nDetails follow.', 'Unrelated second post']) {
        const r2 = await fetch('/api/project/' + id + '/room', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
        const j = await r2.json().catch(() => null);
        if (j && j.delivery && j.delivery.state === 'could_not') return { error: 'post refused: ' + j.delivery.because };
      }
      return { id };
    });
    if (made.error) throw new Error(made.error);
    await p.click('[data-tab="projects"]');
    await p.locator('#pj-list').getByText('Reply check', { exact: true }).first().click();
    await p.waitForSelector('#pj-room .rxns .rxn-reply', { state: 'attached', timeout: 15000 });
    chk(await p.locator('#pj-reply').isHidden(), 'CONTROL: the reply strip starts hidden');
    // The Reply button lives in the hover bar: hidden until the post is hovered (the page's own CSS).
    await p.mouse.move(5, 5);
    const restOpacity = await p.evaluate(() => {
      const b = document.querySelector('#pj-room .rxns .rxn-reply');
      const q = b && b.closest('.rxn-quick');
      return q ? Number(getComputedStyle(q).opacity) : null;
    });
    chk(restOpacity === 0, 'the Reply button is in the hover bar, hidden until the post is hovered', String(restOpacity));
    const replyH = await p.evaluate(() => document.querySelector('#pj-room .rxns .rxn-reply').getBoundingClientRect().height);
    chk(replyH >= 24, 'the Reply button is at least 24px tall (WCAG 2.5.8)', String(replyH));
    // A focus() from a script does not count as keyboard focus, so read the page's own rules (CSSOM).
    const ring = await p.evaluate(() => {
      const want = ['.rxn-reply:focus-visible', '.msg-replyto:focus-visible', '.pj-replying-x:focus-visible'];
      const found = {};
      for (const sh of document.styleSheets) {
        let rules; try { rules = sh.cssRules; } catch { continue; }
        for (const r of rules) {
          if (!r.selectorText) continue;
          for (const w of want) if (r.selectorText.split(',').map((x) => x.trim()).includes(w)) found[w] = (r.style.cssText.match(/outline: ([^;]+)/) || [])[1] || '';
        }
      }
      return want.map((w) => w + '=' + (found[w] || 'none'));
    });
    chk(ring.every((x) => /=2px solid /.test(x)), 'Reply, the header and the x get the bar\'s 2px keyboard focus ring', ring.join(' '));

    // The original, not a reply that quotes it (a reply's header and screen-reader line carry its words too).
    const firstRow = p.locator('#pj-room .msg').filter({ hasText: 'The launch moves to Friday.' }).filter({ hasNot: p.locator('.msg-replyto, .vh') }).first();
    await firstRow.hover();
    await firstRow.locator('.rxn-reply').click();
    const strip = (await p.locator('#pj-reply').innerText()).replace(/\s+/g, ' ').trim();
    chk(/^Replying to You: The launch moves to Friday\./.test(strip), 'Reply shows "Replying to <who>: <first line>" above the composer', strip);
    chk(await p.evaluate(() => document.activeElement && document.activeElement.id === 'pj-post'), 'focus moves to the composer');
    chk(await p.evaluate(() => document.getElementById('pj-post').getAttribute('aria-describedby') === 'pj-reply-what'), 'the composer is described by the "Replying to" strip while replying');
    chk(await p.locator('#pj-reply .pj-replying-h').count() === 0, 'CONTROL: no "ask them" hint on a reply to your own post');
    const hint = await p.evaluate(() => { const keep = PJ_REPLY[PJ_CURRENT]; PJ_REPLY[PJ_CURRENT] = { id: keep.id, who: 'You', words: 'x', mine: false }; pjReplyPaint(PJ_CURRENT);
      const h = document.querySelector('#pj-reply .pj-replying-h'); PJ_REPLY[PJ_CURRENT] = keep; pjReplyPaint(PJ_CURRENT); return h ? h.textContent : null; });
    chk(hint === 'Add @name to ask them directly', 'a reply to someone else says how to ask them directly, even an agent displayed as "You" (keyed on who wrote it, not the name)', String(hint));
    // Pressing x while the post is on its way does not pretend to cancel: the reply already left.
    // A plain post on its way is not this reply: x still cancels (CONTROL for the arm below).
    const plainSend = await p.evaluate(() => { const r = PJ_REPLY[PJ_CURRENT]; PJ_POSTING = true; PJ_REPLY_SENDING = null;
      document.querySelector('#pj-reply .pj-replying-x').click(); PJ_POSTING = false;
      const out = { cancelled: !PJ_REPLY[PJ_CURRENT] }; PJ_REPLY[PJ_CURRENT] = r; pjReplyPaint(PJ_CURRENT); return out; });
    chk(plainSend.cancelled, 'CONTROL: while a post that is not this reply is on its way, x still cancels', JSON.stringify(plainSend));
    const midSend = await p.evaluate(() => { PJ_POSTING = true; PJ_REPLY_SENDING = { project: PJ_CURRENT, id: PJ_REPLY[PJ_CURRENT].id };
      document.querySelector('#pj-reply .pj-replying-x').click(); PJ_POSTING = false; PJ_REPLY_SENDING = null;
      const out = { still: !document.getElementById('pj-reply').hidden, said: document.getElementById('pj-room-msg').textContent }; document.getElementById('pj-room-msg').textContent = ''; return out; });
    chk(midSend.still && midSend.said === 'This is already being sent as a reply.', 'x while sending keeps the strip and says the reply already left', JSON.stringify(midSend));
    await p.locator('#pj-reply .pj-replying-x').click();
    chk(await p.locator('#pj-reply').isHidden(), 'the x cancels the reply');
    chk(await p.evaluate(() => !document.getElementById('pj-post').hasAttribute('aria-describedby')), 'CONTROL: with no reply, the composer is not described by the strip');
    await firstRow.hover();
    await firstRow.locator('.rxn-reply').click();
    await p.screenshot({ path: path.join(OUT, 'reply-composing.png') });
    await p.fill('#pj-post', 'Friday works for everyone');
    await p.click('#pj-post-go');
    await p.waitForSelector('#pj-room .msg-replyto[data-jump]', { timeout: 15000 });
    chk(await p.locator('#pj-reply').isHidden(), 'the strip clears once the reply is posted');

    const head = await p.evaluate(() => {
      const rows = [...document.querySelectorAll('#pj-room .msg')];
      const reply = rows.find((r) => r.textContent.includes('Friday works for everyone'));
      const second = rows.find((r) => r.textContent.includes('Unrelated second post'));
      const h = reply && reply.querySelector('.msg-replyto');
      return { text: h ? h.textContent.replace(/\s+/g, ' ').trim() : null, jump: h ? h.getAttribute('data-jump') : null,
        secondHasHead: !!(second && second.querySelector('.msg-replyto')) };
    });
    chk(head.text === 'You: The launch moves to Friday.', 'the reply shows a header naming the post it answers', JSON.stringify(head));
    chk(head.secondHasHead === false, 'CONTROL: a post that is not a reply has no header');
    await p.screenshot({ path: path.join(OUT, 'reply-posted.png') });

    await p.locator('#pj-room .msg-replyto[data-jump]').first().click();
    await p.waitForTimeout(250);
    const flashed = await p.evaluate((id) => {
      const box = document.querySelector('#pj-room .rxns[data-post="' + id + '"]');
      const row = box && box.closest('.msg');
      return !!(row && row.classList.contains('msg-flash'));
    }, head.jump);
    chk(flashed, 'clicking the header jumps to the original and highlights it');
    // A repaint (a new post, a reaction) replaces the row; focus goes back to the jumped-to post.
    const refocused = await p.evaluate((id) => {
      const box = document.getElementById('pj-room');
      document.activeElement.blur();   // what a repaint that removes the focused row leaves behind
      box.__lastRoom = undefined; paintRoom(box.__lastBody);
      const a = document.activeElement;
      return !!(a && a.classList.contains('msg') && a.querySelector('.rxns[data-post="' + id + '"]'));
    }, head.jump);
    chk(refocused, 'after a repaint, focus is back on the jumped-to post');

    const said = fs.existsSync(typed) ? fs.readFileSync(typed, 'utf8') : '';
    // The time alone, unless the date turned since the check began (a run across midnight).
    const dayPart = new Date().toDateString() === STARTED_DAY ? '' : '(?:[A-Z][a-z]{2} \\d{1,2} [A-Z][a-z]{2,3}(?: \\d{4})? )?';
    chk(new RegExp('answers ' + head.jump + ' by your operator, posted ' + dayPart + '\\d\\d:\\d\\d [^\\]]*\\] \\(answering: "The launch moves to Friday\\."\\) ').test(said),
      'the agent was typed which post is answered and its first words', said.split('\n').filter((l) => l.includes('Friday works')).join(' ').slice(0, 220));

    // A reply whose original is gone: rendered through the page's own row painter with no such post.
    const gone = await p.evaluate(() => {
      const pr = pjById(PJ_CURRENT);
      const html = pjRoomRow({ kind: 'post', id: 'm999998', from: 'you', operator: true, to: [], text: 'late reply', at: new Date().toISOString(), outcomes: {}, replyTo: 'm999999' }, pr);
      const d = document.createElement('div'); d.innerHTML = html;
      const h = d.querySelector('.msg-replyto');
      return h ? { text: h.textContent.trim(), jump: h.hasAttribute('data-jump') } : null;
    });
    chk(gone && gone.text === 'Original message unavailable' && gone.jump === false, 'a reply whose original is gone says so and does not jump', JSON.stringify(gone));
    const goneAdjacent = await p.evaluate(() => {
      const html = pjRoomRow({ kind: 'post', id: 'm999996', from: 'you', operator: true, to: [], text: 'late reply', at: new Date().toISOString(), outcomes: {}, replyTo: 'm999997' }, pjById(PJ_CURRENT), true);
      const d = document.createElement('div'); d.innerHTML = html;
      const h = d.querySelector('.msg-replyto'); return h ? h.textContent.trim() : null;
    });
    chk(goneAdjacent === 'Original message unavailable', 'a reply right under a missing original still says it is gone (the header is left out only when the original is there to name)', String(goneAdjacent));
    // The quoted words and name are the post's own text, drawn into the page: they must stay text.
    const escaped = await p.evaluate(() => {
      const pr = pjById(PJ_CURRENT);
      const evil = { kind: 'post', id: 'm999990', from: 'you', operator: true, to: [], text: '<img src=x onerror="window.__pwned=1"> "quoted" </b>', at: new Date().toISOString(), outcomes: {} };
      const keepPosts = PJ_ROOM_POSTS; PJ_ROOM_POSTS = new Map(PJ_ROOM_POSTS); PJ_ROOM_POSTS.set(evil.id, evil);
      const d = document.createElement('div');
      d.innerHTML = pjRoomRow({ kind: 'post', id: 'm999991', from: 'you', operator: true, to: [], text: 'answer', at: new Date().toISOString(), outcomes: {}, replyTo: evil.id }, pr);
      const keepReply = PJ_REPLY[PJ_CURRENT]; PJ_REPLY[PJ_CURRENT] = { id: evil.id, who: 'You', words: pjReplyGist(evil) }; pjReplyPaint(PJ_CURRENT);
      const strip = document.getElementById('pj-reply');
      const out = { headImg: !!d.querySelector('.msg-replyto img'), headText: (d.querySelector('.msg-replyto') || {}).textContent || '',
        stripImg: !!strip.querySelector('img'), stripText: strip.textContent };
      PJ_ROOM_POSTS = keepPosts; if (keepReply) PJ_REPLY[PJ_CURRENT] = keepReply; else delete PJ_REPLY[PJ_CURRENT]; pjReplyPaint(PJ_CURRENT);
      return out;
    });
    chk(!escaped.headImg && !escaped.stripImg && escaped.headText.includes('<img src=x') && escaped.stripText.includes('"quoted" </b>'),
      'a quoted post\'s markup is shown as text in the header and the strip, never drawn', JSON.stringify(escaped));
    const gist = await p.evaluate(() => [pjReplyGist({ text: '', attachments: [{ name: 'lease.pdf' }] }), pjReplyGist({ text: '' })]);
    chk(gist[0] === 'lease.pdf' && gist[1] === 'a message', 'a post with no words is quoted by its file name, never as nothing', JSON.stringify(gist));
    const zalgo = await p.evaluate(() => pjReplyWords('h' + '\u0301\u0302\u0303\u0304\u0305'.repeat(6) + 'i'));
    chk(zalgo === 'h\u0301\u0302i', 'stacked marks ("zalgo") are cut to two on a letter in the strip and header', JSON.stringify(zalgo));
    const unread = await p.evaluate(() => {
      const keep = PJ_ROOM_PARTIAL; PJ_ROOM_PARTIAL = true;
      const html = pjRoomRow({ kind: 'post', id: 'm999998', from: 'you', operator: true, to: [], text: 'late reply', at: new Date().toISOString(), outcomes: {}, replyTo: 'm999999' }, pjById(PJ_CURRENT));
      PJ_ROOM_PARTIAL = keep;
      const d = document.createElement('div'); d.innerHTML = html;
      const h = d.querySelector('.msg-replyto'); return h ? h.textContent.trim() : null;
    });
    chk(unread === 'Original message could not be read just now', 'when the room could not all be read, a missing original is "could not be read", not "unavailable"', String(unread));

    // A reply to the post right above it needs no header (most agent answers are exactly that).
    const adjacent = await p.evaluate(async (pid) => {
      const rows = (await (await fetch('/api/project/' + pid + '/room')).json()).rows.filter((r) => r.kind === 'post');
      const last = rows[rows.length - 1].id;
      const r = await fetch('/api/project/' + pid + '/room', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Answering the one above', reply_to: last }) });
      return (await r.json()).delivery.state;
    }, made.id);
    await p.waitForFunction(() => document.querySelector('#pj-room').textContent.includes('Answering the one above'), null, { timeout: 15000 });
    const adjHead = await p.evaluate(() => {
      const row = [...document.querySelectorAll('#pj-room .msg')].find((r) => r.textContent.includes('Answering the one above'));
      return row ? !!row.querySelector('.msg-replyto') : null;
    });
    const adjSr = await p.evaluate(() => {
      const row = [...document.querySelectorAll('#pj-room .msg')].find((r) => r.textContent.includes('Answering the one above'));
      const v = row && row.querySelector('.vh');
      return v ? v.textContent : null;
    });
    chk(adjSr === 'Answers You: Friday works for everyone.', 'with the header left out, a screen reader still hears what it answers', String(adjSr));
    chk(adjacent !== 'could_not' && adjHead === false, 'a reply to the post right above it shows no header', JSON.stringify({ adjacent, adjHead }));
    // A second answer to the same post, right under the first answer, needs no header either.
    const sibling = await p.evaluate(async (pid) => {
      const rows = (await (await fetch('/api/project/' + pid + '/room')).json()).rows.filter((r) => r.kind === 'post');
      const target = rows[rows.length - 1].replyTo;
      const r = await fetch('/api/project/' + pid + '/room', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'A second answer to it', reply_to: target }) });
      return (await r.json()).delivery.state;
    }, made.id);
    await p.waitForFunction(() => document.querySelector('#pj-room').textContent.includes('A second answer to it'), null, { timeout: 15000 });
    const sibHead = await p.evaluate(() => {
      const row = [...document.querySelectorAll('#pj-room .msg')].find((r) => r.textContent.includes('A second answer to it'));
      return row ? !!row.querySelector('.msg-replyto') : null;
    });
    chk(sibling !== 'could_not' && sibHead === false, 'a second answer right under another answer to the same post shows no header', JSON.stringify({ sibling, sibHead }));
    // A sibling hides its header only when the answer above hid its own: here the first answer shows a
    // header (a post came between), so the second answer right under it must show one too (round 27).
    const chain = await p.evaluate(async (pid) => {
      const post = async (body) => (await (await fetch('/api/project/' + pid + '/room', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()).delivery;
      await post({ text: 'Topic Q for the chain' });
      const rows = (await (await fetch('/api/project/' + pid + '/room')).json()).rows.filter((r) => r.kind === 'post');
      const q = rows[rows.length - 1].id;
      await post({ text: 'Something between' });
      await post({ text: 'First answer to Q', reply_to: q });
      const last = await post({ text: 'Second answer to Q', reply_to: q });
      return last.state;
    }, made.id);
    await p.waitForFunction(() => document.querySelector('#pj-room').textContent.includes('Second answer to Q'), null, { timeout: 15000 });
    const chainHeads = await p.evaluate(() => {
      const find = (t) => [...document.querySelectorAll('#pj-room .msg')].filter((r) => r.textContent.includes(t)).pop();
      const a = find('First answer to Q'); const b = find('Second answer to Q');
      return { first: !!(a && a.querySelector('.msg-replyto')), second: !!(b && b.querySelector('.msg-replyto')) };
    });
    chk(chain !== 'could_not' && chainHeads.first && chainHeads.second, 'a second answer under a first that shows its header shows its own too (the chain back is broken)', JSON.stringify({ chain, chainHeads }));
    // While a search hides the rows between, a reply only LOOKS adjacent: its header stays. "Friday" matches
    // the original and the reply to it, not the unrelated post between them.
    await p.fill('#pj-room-search', 'Friday');
    await p.waitForFunction(() => !document.querySelector('#pj-room').textContent.includes('Unrelated second post'), null, { timeout: 15000 });
    const searchedHead = await p.evaluate(() => {
      const row = [...document.querySelectorAll('#pj-room .msg')].find((r) => r.textContent.includes('Friday works for everyone'));
      return row ? !!row.querySelector('.msg-replyto') : null;
    });
    await p.fill('#pj-room-search', '');
    chk(searchedHead === true, 'while a search hides the rows between, a reply keeps its header', String(searchedHead));

    // The page's state. A reply started here is this project's alone: another project does not show it,
    // and it is back on return (the per-project pattern the drafts use).
    await firstRow.hover();
    await firstRow.locator('.rxn-reply').click();
    await p.click('[data-tab="projects"]');
    await p.locator('#pj-list').getByText('Other place', { exact: true }).first().click();
    await p.waitForFunction(() => document.querySelector('#pj-room') && !document.querySelector('#pj-room').textContent.includes('The launch moves'), null, { timeout: 15000 });
    chk(await p.locator('#pj-reply').isHidden(), 'a reply started in one project is not shown in another');
    const staleGuard = await p.evaluate((id) => {   // posts still painted for the project just left
      const keep = PJ_ROOM_POSTS_OF; PJ_ROOM_POSTS_OF = 'not-this-project';
      const had = PJ_ROOM_POSTS.has(id); PJ_ROOM_POSTS.set(id, PJ_ROOM_POSTS.get(id) || { id, kind: 'post', operator: true, text: 'stale' });
      pjReplyStart(id);
      const armed = !!PJ_REPLY[PJ_CURRENT];
      PJ_ROOM_POSTS_OF = keep; if (!had) PJ_ROOM_POSTS.delete(id);
      return armed;
    }, head.jump);
    chk(staleGuard === false, 'Reply on posts painted for another project does nothing');
    await p.click('[data-tab="projects"]');
    await p.locator('#pj-list').getByText('Reply check', { exact: true }).first().click();
    await p.waitForSelector('#pj-reply:not([hidden])', { timeout: 15000 });
    chk(/^Replying to You: The launch moves to Friday\./.test((await p.locator('#pj-reply').innerText()).replace(/\s+/g, ' ').trim()), 'the reply is back on return to its project');

    // A refused reply (its original is not in this room) keeps the strip and the words, and says what to do.
    await p.evaluate(() => { PJ_REPLY[PJ_CURRENT] = { id: 'm999999', who: 'You', words: 'gone' }; pjReplyPaint(PJ_CURRENT); });
    await p.fill('#pj-post', 'this will be refused');
    await p.click('#pj-post-go');
    await p.waitForFunction(() => /Press \u00d7/.test(document.getElementById('pj-room-msg').textContent), null, { timeout: 15000 });
    chk(await p.locator('#pj-reply').isVisible(), 'a refused reply keeps the strip');
    chk((await p.inputValue('#pj-post')) === 'this will be refused', 'a refused reply keeps the words');
    await p.locator('#pj-reply .pj-replying-x').click();
    chk(!/Press \u00d7/.test(await p.locator('#pj-room-msg').innerText()), 'pressing x clears the sentence that said to press it');
    // Starting a different reply after a refusal also clears it (the refusal was about the old reply).
    await p.evaluate(() => { document.getElementById('pj-room-msg').textContent = 'the message you are replying to is not one of this room\'s posts, so nothing was posted. Press \u00d7 on "Replying to" to post it as a new message.'; });
    await firstRow.hover();
    await firstRow.locator('.rxn-reply').click();
    chk(!/Press \u00d7/.test(await p.locator('#pj-room-msg').innerText()), 'starting a new reply clears a refusal about the old one');
    await p.locator('#pj-reply .pj-replying-x').click();

    // A jump to a post the search is hiding says so on screen, not only to a screen reader.
    await p.fill('#pj-room-search', 'Friday works');
    await p.waitForFunction(() => !document.querySelector('#pj-room').textContent.includes('The launch moves to Friday.\n') && document.querySelector('#pj-room .msg-replyto[data-jump]'), null, { timeout: 15000 }).catch(() => {});
    const hiddenJump = await p.evaluate(() => {
      const origShown = [...document.querySelectorAll('#pj-room .msg')].some((r) => !r.querySelector('.msg-replyto') && r.textContent.includes('The launch moves to Friday.'));
      const h = document.querySelector('#pj-room .msg-replyto[data-jump]');
      if (!h || origShown) return { skipped: true, origShown, header: !!h };
      h.click();
      return { said: document.getElementById('pj-room-msg').textContent };
    });
    chk(hiddenJump.said === 'That message is hidden by your search.', 'a jump to a post the search hides says so on screen', JSON.stringify(hiddenJump));
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
})().catch((e) => { console.error('FAIL  render-room-reply-3745: ' + (e && e.stack || e)); process.exit(2); });
