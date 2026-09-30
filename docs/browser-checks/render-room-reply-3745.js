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

    // #4358 (Josh): the four emoji together, then Reply LAST with a small arrow, and a bright gold outline on hover.
    const bar = await p.evaluate(() => {
      const q = document.querySelector('#pj-room .rxns .rxn-quick');
      const kids = q ? [...q.children].map((k) => k.classList.contains('rxn-reply') ? 'reply' : k.classList.contains('rxn-ref') ? 'ref' : k.classList.contains('rxn-more') ? 'more' : k.classList.contains('rxn-pick') ? 'pick' : '?') : [];
      const r = q && q.querySelector('.rxn-reply');
      const ico = r && r.firstElementChild;
      return { kids: kids.join(','), arrowFirst: !!ico && ico.tagName.toLowerCase() === 'svg' && ico.classList.contains('rxn-reply-ico'),
        word: r ? r.textContent.trim() : null };
    });
    chk(bar.kids === 'ref,pick,pick,pick,more,reply', 'the hover bar reads Copy reference (#4631), the three quick emoji, the smiley, then Reply last', bar.kids);
    chk(bar.arrowFirst && bar.word === 'Reply', 'Reply carries a small arrow icon before the word', JSON.stringify(bar));
    const rests = {};
    for (const scheme of ['light', 'dark']) {
      await p.emulateMedia({ colorScheme: scheme });
      const post = p.locator('#pj-room .msg').filter({ has: p.locator('.rxn-reply') }).first();
      await post.hover();
      await p.waitForTimeout(250);
      const btn = post.locator('.rxn-reply');
      const rest = await btn.evaluate((b) => getComputedStyle(b).borderTopColor);
      await btn.hover();
      await p.waitForTimeout(250);
      const hov = await btn.evaluate((b) => {
        const probe = document.createElement('span'); probe.style.color = 'var(--gold-bright)'; b.appendChild(probe);
        const gold = getComputedStyle(probe).color; probe.remove();
        return { border: getComputedStyle(b).borderTopColor, gold };
      });
      rests[scheme] = rest;
      chk(hov.border === hov.gold && hov.border !== rest, '[' + scheme + '] hovering Reply gives it the bright gold outline', JSON.stringify({ rest, hov }));
      await p.mouse.move(5, 5);
    }
    await p.emulateMedia({ colorScheme: 'light' });
    // --gold-bright is the same in both themes, so prove the dark arm really ran dark: the resting rule differs.
    chk(rests.light && rests.dark && rests.light !== rests.dark, 'CONTROL: the dark arm really ran in dark mode (the resting outline changed)', JSON.stringify(rests));

    // The original, not a reply that quotes it (a reply's header and screen-reader line carry its words too).
    const firstRow = p.locator('#pj-room .msg').filter({ hasText: 'The launch moves to Friday.' }).filter({ hasNot: p.locator('.msg-replyto, .vh') }).first();
    await firstRow.hover();
    await firstRow.locator('.rxn-reply').click();
    await p.evaluate(() => { window.PJ_REPLY_ORIGINAL_ID = PJ_REPLY[PJ_CURRENT].id; });
    const strip = (await p.locator('#pj-reply').innerText()).replace(/\s+/g, ' ').trim();
    chk(/^Replying to You: The launch moves to Friday\./.test(strip), 'Reply shows "Replying to <who>: <first line>" above the composer', strip);
    chk(await p.evaluate(() => document.activeElement && document.activeElement.id === 'pj-post'), 'focus moves to the composer');
    chk(await p.evaluate(() => document.getElementById('pj-post').getAttribute('aria-describedby') === 'pj-reply-what'), 'the composer is described by the "Replying to" strip while replying');
    // #4359 (Josh): Reply to an agent puts its @mention in the box; a reply to your own post puts none.
    chk(await p.evaluate(() => document.getElementById('pj-post').value) === '', 'CONTROL: Reply to your own post leaves the box empty (no mention)');
    chk(await p.locator('#pj-reply .pj-replying-h').count() === 0, 'the old "Add @name" hint is gone');
    const ment = await p.evaluate(() => {
      // An agent's post in this room, through the same pjReplyStart the Reply click calls (posting AS an
      // agent needs its launch token, which this hermetic board does not hand out).
      PJ_ROOM_POSTS.set('agent-4359', { id: 'agent-4359', from: 'roomer', text: 'Can you check the copy?' });
      const box = document.getElementById('pj-post');
      pjReplyStart('agent-4359');
      const first = { value: box.value, caret: box.selectionStart, hint: !!document.querySelector('#pj-reply .pj-replying-h') };
      const said = document.getElementById('pj-room-say').textContent;
      box.value = '@roomer looks good'; box.setSelectionRange(box.value.length, box.value.length);
      pjReplyStart('agent-4359');   // Reply again: the mention is not stacked
      const again = box.value;
      const againCaret = box.selectionStart;   // the cursor was in the person's words, so it stays there
      box.setSelectionRange(2, 2);
      pjReplyStart('agent-4359');   // ... but a cursor inside the mention goes to just after it
      const insideCaret = box.selectionStart;
      box.setSelectionRange(box.value.length, box.value.length);
      pjReplyStart(PJ_REPLY_ORIGINAL_ID);   // then to your own post: the mention Reply put there is taken back out
      const own = box.value;
      const ownCaret = box.selectionStart;
      // A draft, then Reply to your own post again: nothing to add, so neither the text nor the caret moves.
      box.value = 'half a thought'; box.setSelectionRange(14, 14);
      pjReplyStart(PJ_REPLY_ORIGINAL_ID);
      const kept = { value: box.value, caret: box.selectionStart };
      // A post from someone who is not one of this project's agents gets no mention either.
      PJ_ROOM_POSTS.set('stranger-4359', { id: 'stranger-4359', from: 'not-on-this-project', text: 'Hello?' });
      box.value = 'draft'; box.setSelectionRange(5, 5);
      pjReplyStart('stranger-4359');
      const stranger = { value: box.value, caret: box.selectionStart };
      PJ_ROOM_POSTS.delete('stranger-4359');
      box.value = ''; pjReplyStart('agent-4359');
      document.querySelector('#pj-reply .pj-replying-x').click();   // x with only the mention in the box empties it
      const afterX = box.value;
      PJ_ROOM_POSTS.delete('agent-4359');
      box.value = '';
      // A mention the person TYPED is theirs: Reply records none, so nothing later takes it back out.
      delete PJ_REPLY[PJ_CURRENT]; pjReplyPaint(PJ_CURRENT);
      PJ_ROOM_POSTS.set('agent-4359', { id: 'agent-4359', from: 'roomer', text: 'Can you check the copy?' });
      box.value = '@roomer hi'; box.setSelectionRange(10, 10);
      pjReplyStart('agent-4359');
      const typedRec = PJ_REPLY[PJ_CURRENT].mention;
      pjReplyStart(PJ_REPLY_ORIGINAL_ID);
      const typedKept = box.value;
      // A mention already in the words, not at the front, is not added a second time.
      box.value = 'hi @roomer '; pjReplyStart('agent-4359');
      const moved = box.value;
      box.value = 'please @roomer check'; pjReplyStart('agent-4359');
      const midSentence = box.value;
      // The engine's own rule: a trailing full stop after the name still names the agent (engine/messages.js).
      box.value = 'thanks @roomer.'; pjReplyStart('agent-4359');
      const stop = box.value;
      // #4642: any case of the name names the agent too (engine/messages.js mentionedMembers).
      box.value = 'thanks @ROOMER'; pjReplyStart('agent-4359');
      const upper = box.value;
      PJ_ROOM_POSTS.delete('agent-4359');
      delete PJ_REPLY[PJ_CURRENT]; pjReplyPaint(PJ_CURRENT); box.value = '';
      return { first, said, again, againCaret, insideCaret, own, ownCaret, kept, stranger, afterX, typedRec, typedKept, moved, midSentence, stop, upper };
    });
    chk(ment.first.value === '@roomer ' && ment.first.caret === 8 && !ment.first.hint, 'Reply to an agent puts "@roomer " at the start with the cursor after it', JSON.stringify(ment.first));
    chk(/@roomer is in the box; delete it to reply to the whole room\.$/.test(ment.said), 'a screen reader is told the mention is in the box and how to reply to the room', JSON.stringify(ment.said));
    chk(ment.again === '@roomer looks good' && ment.againCaret === 18, 'a second Reply to the same agent adds no second mention and leaves the cursor in the words', JSON.stringify({ again: ment.again, caret: ment.againCaret }));
    chk(ment.insideCaret === 8, 'a cursor sitting inside the mention goes to just after it', String(ment.insideCaret));
    chk(ment.stop === 'thanks @roomer.', 'a name ending a sentence ("@roomer.") counts as named, the engine\'s rule, so it is not added again', JSON.stringify(ment.stop));
    chk(ment.upper === 'thanks @ROOMER', '#4642: "@ROOMER" names roomer (any case), so Reply does not add "@roomer" again', JSON.stringify(ment.upper));
    chk(ment.moved === 'hi @roomer ' && ment.midSentence === 'please @roomer check', 'a mention already in the words (moved, or mid-sentence) is not added again', JSON.stringify({ moved: ment.moved, mid: ment.midSentence }));
    chk(ment.typedRec === null && ment.typedKept === '@roomer hi', 'a mention the person typed is theirs: Reply never takes it back out', JSON.stringify({ rec: ment.typedRec, kept: ment.typedKept }));
    chk(ment.own === 'looks good' && ment.ownCaret === 10, 'switching the reply to your own post takes the mention back out, keeps what you wrote, and keeps the cursor at its end', JSON.stringify({ own: ment.own, caret: ment.ownCaret }));
    chk(ment.kept.value === 'half a thought' && ment.kept.caret === 14, 'Reply to your own post with a draft in the box moves neither the draft nor the cursor', JSON.stringify(ment.kept));
    chk(ment.stranger.value === 'draft' && ment.stranger.caret === 5, 'a post from someone not on the project gets no mention, and the cursor stays put', JSON.stringify(ment.stranger));
    chk(ment.afterX === '', 'x on a reply whose box holds only the mention empties the box', JSON.stringify(ment.afterX));
    // The real click: make the second post read as roomer's (its row is on screen), hover it, click its Reply.
    // The room poll (every 5 s) rebuilds PJ_ROOM_POSTS; hold it for this arm so the edit below stays put.
    await p.evaluate(() => { window.__loadRoom4359 = loadRoom; loadRoom = async () => {}; });
    try {
    const secondId = await p.evaluate(() => {
      const box = [...document.querySelectorAll('#pj-room .rxns[data-post]')].find((b) => /Unrelated second post/.test(b.closest('.msg').textContent));
      const id = box && box.getAttribute('data-post');
      const m = id && PJ_ROOM_POSTS.get(id);
      if (!m) return null;
      window.__was4359 = { from: m.from, operator: m.operator };
      m.from = 'roomer'; m.operator = false;
      return id;
    });
    chk(!!secondId, 'CONTROL: the second post is on screen to click');
    if (secondId) {
      const row = p.locator('#pj-room .msg').filter({ hasText: 'Unrelated second post' }).filter({ hasNot: p.locator('.msg-replyto, .vh') }).first();
      await row.hover();
      await row.locator('.rxn-reply').click();
      const clicked = await p.evaluate(() => { const b = document.getElementById('pj-post'); return { value: b.value, caret: b.selectionStart, focused: document.activeElement === b }; });
      chk(clicked.value === '@roomer ' && clicked.caret === 8 && clicked.focused, 'a real Reply click on an agent\'s post leaves "@roomer " in the focused box with the cursor after it', JSON.stringify(clicked));
      // Enter with only the mention in the box: nothing is said yet, so nothing is sent.
      await p.keyboard.press('Enter');
      await p.waitForTimeout(300);
      const bare = await p.evaluate(() => ({ msg: document.getElementById('pj-room-msg').textContent, value: document.getElementById('pj-post').value }));
      chk(bare.msg === 'Say something first.' && bare.value === '@roomer ', 'Enter with only the mention sends nothing and says "Say something first."', JSON.stringify(bare));
      // With only the mention AND a file waiting, the file names go AFTER the mention (the send is captured, not made).
      await p.evaluate(() => {
        attachList(ATTACH_ROOM).push({ id: 'att-4359', name: 'notes.pdf' });
        window.__sent4359 = null;
        window.__fetch4359 = window.fetch;
        window.fetch = (url, opts) => {
          if (/\/room$/.test(String(url)) && opts && opts.method === 'POST') { window.__sent4359 = JSON.parse(opts.body); return Promise.reject(new Error('captured by the check')); }
          return window.__fetch4359(url, opts);
        };
      });
      await p.keyboard.press('Enter');
      await p.waitForTimeout(300);
      const withFile = await p.evaluate(() => {
        window.fetch = window.__fetch4359;
        const list = attachList(ATTACH_ROOM); list.splice(0, list.length);
        const out = window.__sent4359;
        document.getElementById('pj-post').value = '@roomer ';
        document.getElementById('pj-room-msg').textContent = '';
        return out && { text: out.text, attachments: out.attachments };
      });
      // A Reply while a post is on its way leaves the box alone (the words in it are the ones being sent).
      await p.waitForFunction(() => PJ_POSTING === false, null, { timeout: 5000 });   // the captured send above has settled
      const midSend = await p.evaluate((id) => {
        const box = document.getElementById('pj-post');
        box.value = '@roomer sent words';
        PJ_POSTING = true;
        pjReplyStart(PJ_REPLY_ORIGINAL_ID);
        const out = { value: box.value, rec: PJ_REPLY[PJ_CURRENT].mention };
        PJ_POSTING = false;
        box.value = ''; pjReplyStart(id);   // back to Reply's own mention for the arms that follow
        return out;
      }, secondId);
      chk(midSend.value === '@roomer sent words' && midSend.rec === null, 'a Reply while a post is on its way leaves the box (the words being sent) alone', JSON.stringify(midSend));
      chk(!!withFile && withFile.text === '@roomer notes.pdf' && JSON.stringify(withFile.attachments) === '["att-4359"]', 'with only the mention and a file waiting, the post reads "@roomer notes.pdf" and carries the file', JSON.stringify(withFile));
      await p.evaluate((id) => { const m = PJ_ROOM_POSTS.get(id); if (m) Object.assign(m, window.__was4359); document.getElementById('pj-room-msg').textContent = '';
        document.querySelector('#pj-reply .pj-replying-x').click(); }, secondId);
      chk(await p.evaluate(() => document.getElementById('pj-post').value) === '', 'x after that empties the box again');
    }
    } finally {
      await p.evaluate(() => { if (window.__fetch4359) window.fetch = window.__fetch4359; if (window.__loadRoom4359) loadRoom = window.__loadRoom4359; });
    }
    await firstRow.hover();
    await firstRow.locator('.rxn-reply').click();
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
    // Desktop: on an agent's one-word post the wider bar (with Reply) stays inside the thread; every button
    // takes its own click (round 29: it ran 48px off the left edge). It holds through a repaint too, with the
    // mouse still (round 30: a repaint rebuilt the row without its measurement). The post is added to the
    // room's own data so a repaint draws it again.
    const measureShort = () => p.evaluate(() => {
      const room = document.getElementById('pj-room');
      const row = [...room.querySelectorAll('.msg')].find((r) => r.querySelector('.rxns[data-post="m999900"]'));
      if (!row) return { error: 'no short agent row' };
      const q = row.querySelector('.rxn-quick'); const R = room.getBoundingClientRect(), Q = q.getBoundingClientRect();
      const hits = [...q.querySelectorAll('button')].map((b) => { const r = b.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!(h && (h === b || b.contains(h))); });
      return { inside: Q.left >= R.left && Q.right <= R.right + 1, bar: [Math.round(Q.left), Math.round(Q.right)], room: [Math.round(R.left), Math.round(R.right)], hits };
    });
    await p.fill('#pj-room-search', '');   // an earlier arm leaves a search in the box
    await p.evaluate(() => {
      const box = document.getElementById('pj-room');
      box.__lastBody.rows.push({ kind: 'post', id: 'm999900', from: 'roomer', to: [], text: 'ok', at: new Date().toISOString(), outcomes: {} });
      box.__lastRoom = undefined; paintRoom(box.__lastBody);
    });
    const shortBox = await p.evaluate(() => {
      const b = document.querySelector('#pj-room .rxns[data-post="m999900"]'); const row = b && b.closest('.msg');
      const bd = row && row.querySelector('.msg-bd'); if (!bd) return null;
      bd.scrollIntoView({ block: 'center' }); const r = bd.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (!shortBox) throw new Error('the short agent post did not render');
    await p.mouse.move(shortBox.x, shortBox.y);
    await p.waitForTimeout(300);
    const shortBar = await measureShort();
    chk(shortBar.inside && shortBar.hits.length === 6 && shortBar.hits.every(Boolean), 'on a one-word agent post the bar (with Reply and Copy reference, #4631) stays inside the thread and every button takes its click', JSON.stringify(shortBar));
    // The hovered row itself changes in the repaint (its words are edited here; in life a reaction lands), so
    // the page draws a NEW element without the measured class. Read in the same moment as the repaint:
    // Chromium re-sends a hover to a still mouse shortly after, which would mend it by accident.
    const afterRepaint = await p.evaluate(() => {
      const box = document.getElementById('pj-room');
      const find = () => [...box.querySelectorAll('.msg')].find((r) => r.querySelector('.rxns[data-post="m999900"]'));
      const before = find(); const hadLeft = !!(before && before.classList.contains('rxn-left'));
      box.__lastRoom = undefined; box.__lastBody = Object.assign({}, box.__lastBody, { rows: box.__lastBody.rows.map((r) => (r.id === 'm999900' ? Object.assign({}, r, { text: 'ok.' }) : r)) }); paintRoom(box.__lastBody);
      const row = find();
      const same = row === before;
      if (!row) return { error: 'no short agent row' };
      const R = box.getBoundingClientRect(), Q = row.querySelector('.rxn-quick').getBoundingClientRect();
      return { same, hadLeft, hasLeft: row.classList.contains('rxn-left'), inside: Q.left >= R.left && Q.right <= R.right + 1, bar: [Math.round(Q.left), Math.round(Q.right)], room: [Math.round(R.left), Math.round(R.right)] };
    });
    // hadLeft: the first hover needed the left-anchored bar, so this arm is testing that case and not a bar that fits anyway.
    chk(afterRepaint.hadLeft === true && afterRepaint.same === false && afterRepaint.inside, 'after a repaint that redraws the hovered row, with the mouse still, the bar is still inside the thread', JSON.stringify(afterRepaint));
    await p.evaluate(() => { const box = document.getElementById('pj-room'); box.__lastBody.rows = box.__lastBody.rows.filter((r) => r.id !== 'm999900'); box.__lastRoom = undefined; paintRoom(box.__lastBody); });
    await p.mouse.move(5, 5);

    // Phone: tapping Reply in the tapped-open bar starts the reply and closes the bar (round 29).
    // A touch page: opened wide (the project list is a click away there), then narrowed to a phone.
    const phone = await browser.newPage({ viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: true, colorScheme: 'light' });
    await phone.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle' });
    if (await phone.isVisible('#firstrun')) await phone.keyboard.press('Escape');
    await phone.evaluate(() => document.querySelector('[data-tab="projects"]').click());
    await phone.locator('#pj-list').getByText('Reply check', { exact: true }).first().tap();
    await phone.waitForSelector('#pj-room .rxn-reply', { state: 'attached', timeout: 15000 });
    await phone.setViewportSize({ width: 375, height: 740 });
    await phone.waitForTimeout(300);
    chk(await phone.evaluate(() => matchMedia('(hover: none)').matches), 'CONTROL: the phone page is a touchscreen to the page (hover: none)');
    const phoneRow = phone.locator('#pj-room .msg').filter({ hasText: 'Unrelated second post' }).first();
    await phoneRow.locator('.msg-bd p').first().tap();
    await phone.waitForTimeout(300);
    const opened = await phone.evaluate(() => document.querySelectorAll('#pj-room .msg.rxn-show').length);
    const replyTouch = await phone.evaluate(() => { const b = document.querySelector('#pj-room .msg.rxn-show .rxn-reply'); if (!b) return null; const r = b.getBoundingClientRect(); return Math.round(Math.min(r.width, r.height)); });
    chk(replyTouch !== null && replyTouch >= 36, 'on a touchscreen, Reply is a 36px target like the other bar buttons', String(replyTouch));
    await phoneRow.locator('.rxn-reply').tap();
    await phone.waitForTimeout(300);
    const afterTap = await phone.evaluate(() => ({ strip: !document.getElementById('pj-reply').hidden, text: document.getElementById('pj-reply').textContent.replace(/\s+/g, ' ').trim().slice(0, 60),
      open: document.querySelectorAll('#pj-room .msg.rxn-show').length }));
    chk(opened === 1 && afterTap.strip && /^Replying to You: Unrelated second post/.test(afterTap.text) && afterTap.open === 0, 'on a phone, tapping Reply in the tapped-open bar starts the reply and closes the bar', JSON.stringify(Object.assign({ opened }, afterTap)));
    await phone.close();
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
