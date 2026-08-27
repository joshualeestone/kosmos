/* #1037, second trigger set: the PROJECT ROOM keeps the reader where they are.
 *
 * ⭐ WHY THIS IS A SECOND FILE AND NOT A SECOND ARM. The agent thread and the
 * project room are painted by DIFFERENT FUNCTIONS. setThread() got the #1037
 * fix and holds the reader's posture across a repaint. paintRoom() never did:
 * it rewrites the markup whenever the WORDING changes and repositions only when
 * the POST LIST changes, so any repaint that is not a new post drops the reader
 * wherever the browser leaves them.
 *
 * Josh, 2026-08-26 22:05, describing exactly that: "It bounces me up after I
 * send the message... It also does this if the agent starts typing... and then
 * it's some time-based interval too. Maybe every 30 seconds."
 * Those are three ways to repaint without the post list changing: a relabelled
 * timestamp (pjWhen re-words every minute), an unanswered/typing line arriving,
 * and the poll.
 *
 * ⚠️ THE REPRO HAS TO CHANGE THE WORDING FOR REAL. setLive() dedupes on the
 * html string, so forcing box.__lastRoom to a bogus value proves nothing: the
 * write is skipped and the reader never moves. This alters a row's `at`, which
 * changes what pjWhen renders while the key (built from message IDS) stays
 * identical -- the real shape of the bug.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-room-scroll.js
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..', '..');
const freePort = () => Number(require('node:child_process').execFileSync(process.execPath, ['-e', "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"], { encoding: 'utf8' }));
const PORT = freePort();

let failures = 0, ran = 0;
const ok = (n) => { ran++; console.log('PASS  ' + n); };
const bad = (n, why) => { ran++; failures++; console.log('FAIL  ' + n + '  --  ' + why); };

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) {
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-' + k.toLowerCase() + '-'));
  }
  /* A FIXTURE member, never a live agent: the room refuses a post when nobody
     is on the project, and naming a real session here would type into that
     agent's live pane. Sandboxing the store is not sandboxing delivery. */
  fs.writeFileSync(roots.DATA + '/fake-panes',
    require('../../test-support/fleet').line({ session: 'roomer-discord', claim: 'roomer', title: '\u2733 idle' }) + '\n');
  fs.writeFileSync(roots.DATA + '/fake-sessions', 'roomer-discord\n');
  fs.writeFileSync(roots.DATA + '/fake-screen', '\u276f \n  \u23f5\u23f5 bypass permissions on (shift+tab to cycle)\n');
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
  await new Promise((r) => setTimeout(r, 1200));

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));

  try {
    await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');
    await p.evaluate(async () => {
      const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Scroll Repro' }) });
      if (!r.ok) throw new Error('project create failed: ' + r.status);
      const body = await r.json();
      // The room refuses posts until somebody is on the project.
      await fetch('/api/project/' + body.project.id + '/agent/roomer', { method: 'POST',
        headers: { 'content-type': 'application/json' } });
    });
    // Enough posts that the room genuinely scrolls.
    /* ⚠️ THE ID, NOT THE NAME, and the DELIVERY, not the status code. Posting
       to 'Scroll%20Repro' returns HTTP 200 with
       {delivery:{state:'could_not', because:'there is no project by that name'}}
       so an `if (r.ok)` fixture counted 40 successes and posted nothing. Every
       arm below then passed against an empty room. */
    const posted = await p.evaluate(async () => {
      let n = 0;
      for (let i = 1; i <= 40; i++) {
        const r = await fetch('/api/project/scrollrepro/room', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Message number ' + i + ' in this conversation, long enough to take a line or two on screen.' }) });
        if (!r.ok) continue;
        const j = await r.json().catch(() => null);
        if (j && j.delivery && j.delivery.state === 'could_not') continue;
        n++;
      }
      return n;
    });
    if (posted < 20) { bad('the fixture posted enough messages to scroll', 'only ' + posted + ' posted'); }
    else ok('the fixture posted enough messages to scroll');

    await p.click('[data-tab="projects"]');
    await p.locator('#pj-list').getByText('Scroll Repro').first().click();
    await p.waitForSelector('#pj-room', { state: 'visible' });
    await p.waitForTimeout(900);

    const scrollable = await p.evaluate(() => {
      const el = document.getElementById('pj-room');
      return { h: el.scrollHeight, c: el.clientHeight };
    });
    if (scrollable.h > scrollable.c + 50) ok('the room is actually scrollable (' + scrollable.h + ' in ' + scrollable.c + ')');
    else bad('the room is actually scrollable', JSON.stringify(scrollable) + ' -- every arm below would pass trivially');

    /* ---- 1. A READER WHO SCROLLED BACK STAYS PUT across a wording-only repaint. */
    const moved = await p.evaluate(async () => {
      const el = document.getElementById('pj-room');
      el.scrollTop = Math.floor(el.scrollHeight * 0.35);
      const before = el.scrollTop;
      const body = JSON.parse(JSON.stringify(el.__lastBody));
      // Age every row by an hour: pjWhen re-words, the ids (and so the key) do not.
      for (const row of body.rows || []) {
        if (row.at) row.at = new Date(new Date(row.at).getTime() - 3600e3).toISOString();
      }
      /* setLive dedupes on the html string, so the ONLY proof the DOM was
         rewritten is that string changing. Without this, an arm that repaints
         nothing reports "the reader did not move" and passes on any product. */
      const liveBefore = el.__lastLive;
      window.paintRoom(body);
      await new Promise((r) => setTimeout(r, 120));
      return { before, after: el.scrollTop, rewrote: el.__lastLive !== liveBefore };
    });
    if (!moved.rewrote) bad('THE REPAINT ACTUALLY REWROTE THE ROOM', 'the wording did not change, so setLive skipped the write and the arm below proves nothing');
    else ok('THE REPAINT ACTUALLY REWROTE THE ROOM');
    if (Math.abs(moved.after - moved.before) <= 4) ok('a reader who scrolled back is not moved by a wording-only repaint');
    else bad('a reader who scrolled back is not moved by a wording-only repaint',
      'was at ' + moved.before + ', now at ' + moved.after + ' (this is Josh\'s bug)');

    /* ---- 2. THE CONTROL, run not assumed. If the instrument cannot SEE a move,
       arm 1 passes on a broken product. Move the reader deliberately and require
       the same measurement to report it. */
    const ctl = await p.evaluate(() => {
      const el = document.getElementById('pj-room');
      const before = el.scrollTop;
      el.scrollTop = before + 200;
      return { before, after: el.scrollTop };
    });
    if (Math.abs(ctl.after - ctl.before) > 4) ok('CONTROL: the measurement can see a reader being moved');
    else bad('CONTROL: the measurement can see a reader being moved',
      'a deliberate 200px scroll read as no movement, so arm 1 proves nothing: ' + JSON.stringify(ctl));

    /* ---- 3. A READER AT THE BOTTOM follows a NEW post (what Josh expects when
       he sends one). */
    const tail = await p.evaluate(async () => {
      const el = document.getElementById('pj-room');
      el.scrollTop = el.scrollHeight;
      const r = await fetch('/api/project/scrollrepro/room', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'The newest message, which the person who sent it must be able to see.' }) });
      if (!r.ok) return { error: 'post failed ' + r.status };
      const j = await r.json().catch(() => null);
      if (j && j.delivery && j.delivery.state === 'could_not') return { error: 'post refused: ' + j.delivery.because };
      await new Promise((res) => setTimeout(res, 1500));
      const atBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) <= 8;
      return { atBottom, text: el.innerText.slice(-120) };
    });
    if (tail.error) bad('a reader at the bottom follows a new post', tail.error);
    else if (tail.atBottom) ok('a reader at the bottom follows a new post');
    else bad('a reader at the bottom follows a new post', 'left off the floor: ' + JSON.stringify(tail));

    /* ---- 3b. THE SAME READER, BUT THE NEW ROW CARRIES AN IMAGE THAT DECLARES
       NO HEIGHT. Arm 3 above is this arm's control and it is the reason this
       one means anything: text rows are fully measured the instant they are in
       the DOM, so a single pin lands exactly on the floor, which is what five
       separate watch runs measured and why they all came back null. An
       attached image is different: `.att.att-image .att-pic img` is
       height:auto, so the row reserves NOTHING until the bytes arrive. A pin
       computed before then is computed against a room that is about to get
       taller, and the reader is left part way up holding a scrollbar that
       moved under them.
       ⚠️ The PNG is generated here rather than committed: a binary fixture in
       the tree is a thing to maintain, and the bytes only have to be a real
       image with a large declared height. */
    const png = (() => {
      const zlib = require('node:zlib');
      const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
      const chunk = (type, data) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
        return Buffer.concat([len, td, c]);
      };
      const W = 800, H = 1200;
      const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
      const raw = Buffer.alloc((W * 3 + 1) * H);
      for (let y = 0; y < H; y++) { const o = y * (W * 3 + 1); raw[o] = 0; for (let x = 0; x < W; x++) { const q = o + 1 + x * 3; raw[q] = (x * 255 / W) | 0; raw[q + 1] = (y * 255 / H) | 0; raw[q + 2] = 160; } }
      return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
    })();
    let attachId = null;
    try {
      const up = await fetch(`http://127.0.0.1:${PORT}/api/project/scrollrepro/attachment`, {
        method: 'PUT', body: png,
        headers: { 'content-type': 'image/png', 'x-attachment-name': 'tall.png' },
      });
      const uj = await up.json();
      attachId = uj && uj.attachment && uj.attachment.id;
    } catch (e) { attachId = null; }
    if (!attachId) {
      bad('the fixture could attach an image at all', 'upload did not return an id, so the arm below would test nothing');
    } else {
      const shot = await p.evaluate(async (id) => {
        const el = document.getElementById('pj-room');
        el.scrollTop = el.scrollHeight;
        await new Promise((r) => setTimeout(r, 300));
        let sent = 0;
        for (let i = 0; i < 4; i++) {
          const r = await fetch('/api/project/scrollrepro/room', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: 'a picture ' + (i + 1), attachment: id }),
          });
          if (!r.ok) continue;
          const j = await r.json().catch(() => null);
          if (j && j.delivery && j.delivery.state === 'could_not') continue;
          sent++;
        }
        /* 🛑 WAIT FOR THE IMAGE TO ARRIVE, THEN MEASURE, and this does NOT
           defeat the test. The bug is that the pin is computed BEFORE the
           bytes land; nothing re-pins afterwards, so the shortfall persists
           and is still there once everything has settled. A fixed sleep gave
           4 posts and 1 image on one tree and 0 on another, which is a racy
           instrument reporting on a race: unreadable in both directions. */
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
          const ready = Array.from(el.querySelectorAll('img')).filter((im) => im.complete && im.naturalHeight > 0).length;
          if (ready >= 1) break;
          await new Promise((r) => setTimeout(r, 200));
        }
        await new Promise((r) => setTimeout(r, 1200));
        /* Ask the room what it drew rather than assuming a class name: a
           selector that has drifted reports "no images" in exactly the same
           words as a feature that did not render. */
        const allImgs = el.querySelectorAll('img');
        let unsized = 0;
        allImgs.forEach((im) => { if (!im.getAttribute('height') && !im.style.height) unsized++; });
        return {
          sent,
          imgs: allImgs.length,
          byAttPic: el.querySelectorAll('.att-pic img').length,
          byAtt: el.querySelectorAll('.att').length,
          unsized,
          gap: el.scrollHeight - el.scrollTop - el.clientHeight,
          tailHtml: el.innerHTML.slice(-500),
        };
      }, attachId);
      // 🛑 A NULL HERE IS ONLY MEANINGFUL IF THE STIMULUS FIRED. No effect and
      // no cause look identical from the effect side, so the arm refuses to
      // score when nothing was actually posted or nothing rendered as an image.
      if (!shot.sent) bad('the image arm posted anything at all', JSON.stringify(shot));
      else if (!shot.imgs) bad('the image arm rendered an image at all', 'posted ' + shot.sent + ' but the room drew no <img>: ' + JSON.stringify(shot));
      else {
        ok('the image arm fired: ' + shot.sent + ' posts, ' + shot.imgs + ' images, ' + shot.unsized + ' declaring no height');
        if (shot.gap <= 8) ok('a reader at the bottom still lands on the floor when the new rows carry images (gap ' + shot.gap + ')');
        else bad('a reader at the bottom still lands on the floor when the new rows carry images',
          'left ' + shot.gap + 'px short of the floor, which is the part-way-up landing Josh describes');
      }
    }
    /* ---- 4. THE REAL ACTION: typed into the composer and CLICKED, not posted
       by fetch. Josh's words are "it bounces me up AFTER I SEND THE MESSAGE",
       and the send path is not the same path as a row arriving: the composer is
       a rows=1 textarea that GROWS while he types and snaps back when it
       clears, which changes the height of everything above it. */
    const grew = await p.evaluate(async () => {
      const room = document.getElementById('pj-room');
      const box = document.getElementById('pj-post');
      room.scrollTop = room.scrollHeight;
      const before = { client: room.clientHeight, top: room.scrollTop, h: room.scrollHeight };
      box.focus();
      box.value = 'A message long enough to wrap the composer onto several lines, '
        + 'because that is what changes the height of the box above it.\nSecond line.\nThird line.';
      box.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 250));
      const typing = { client: room.clientHeight, top: room.scrollTop, h: room.scrollHeight };
      return { before, typing };
    });
    /* 📌 RECORDED, NOT ASSERTED. In the TAB view the composer growing does not
       change the room's height at all, so there is nothing here to survive.
       That is precisely why this bug lived for so long: every check ran here.
       The consolidated arms below are the ones with something to prove. */
    console.log('note  tab view room height while typing: '
      + grew.before.client + ' -> ' + grew.typing.client
      + (grew.before.client === grew.typing.client ? ' (unchanged, as expected)' : ' (CHANGED -- the tab view now resizes too, so it needs the arms below)'));

    const sent = await p.evaluate(async () => {
      const room = document.getElementById('pj-room');
      document.getElementById('pj-post-go').click();
      await new Promise((r) => setTimeout(r, 2000));
      const gap = room.scrollHeight - room.scrollTop - room.clientHeight;
      return { gap, client: room.clientHeight, tail: room.innerText.slice(-90) };
    });
    if (sent.gap <= 8) ok('after SENDING from the composer, the person can see their own message');
    else bad('after SENDING from the composer, the person can see their own message',
      sent.gap + 'px below the fold: ' + JSON.stringify(sent));

    /* ---- 5. THE SAME ARMS IN THE CONSOLIDATED VIEW, which is the layout Josh
       is actually using. It gives the room a different box entirely (grid rows,
       its own scroller), so every pass above is a statement about the TAB view
       only. A bug that lives in one layout is invisible to a check that only
       ever opens the other. */
    await p.evaluate(async () => {
      await fetch('/api/style', { method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ layout: 'consolidated' }) });
    });
    await p.setViewportSize({ width: 1440, height: 900 });
    await p.reload({ waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');
    await p.locator('#pj-list').getByText('Scroll Repro').first().click().catch(() => {});
    await p.waitForSelector('#pj-room', { state: 'visible' });
    await p.waitForTimeout(900);

    const consOn = await p.evaluate(() => document.body.classList.contains('consolidated'));
    if (consOn) ok('consolidated: the layout actually switched');
    else bad('consolidated: the layout actually switched', 'body is not .consolidated, so arms below re-test the tab view');

    const consScroll = await p.evaluate(() => {
      const el = document.getElementById('pj-room');
      return { h: el.scrollHeight, c: el.clientHeight };
    });
    if (consScroll.h > consScroll.c + 50) ok('consolidated: the room is actually scrollable (' + consScroll.h + ' in ' + consScroll.c + ')');
    else bad('consolidated: the room is actually scrollable', JSON.stringify(consScroll) + ' -- the arms below would pass trivially');

    const consMoved = await p.evaluate(async () => {
      const el = document.getElementById('pj-room');
      el.scrollTop = Math.floor(el.scrollHeight * 0.35);
      const before = el.scrollTop;
      const liveBefore = el.__lastLive;
      const body = JSON.parse(JSON.stringify(el.__lastBody));
      for (const row of body.rows || []) {
        if (row.at) row.at = new Date(new Date(row.at).getTime() - 3600e3).toISOString();
      }
      window.paintRoom(body);
      await new Promise((r) => setTimeout(r, 120));
      return { before, after: el.scrollTop, rewrote: el.__lastLive !== liveBefore };
    });
    if (!consMoved.rewrote) bad('consolidated: THE REPAINT ACTUALLY REWROTE', 'setLive skipped the write, so the arm below proves nothing');
    else ok('consolidated: THE REPAINT ACTUALLY REWROTE');
    if (Math.abs(consMoved.after - consMoved.before) <= 4) ok('consolidated: a reader who scrolled back is not moved');
    else bad('consolidated: a reader who scrolled back is not moved',
      'was at ' + consMoved.before + ', now at ' + consMoved.after + ' (this is Josh\'s bug)');

    const consSent = await p.evaluate(async () => {
      const room = document.getElementById('pj-room');
      const box = document.getElementById('pj-post');
      room.scrollTop = room.scrollHeight;
      /* One frame between scrolling and typing, which a person always has.
         The floor flag is learned from the `scroll` event, and doing both in
         one synchronous block measures a window no human occupies. */
      await new Promise((r) => setTimeout(r, 60));
      const client0 = room.clientHeight;
      box.focus();
      box.value = 'A consolidated-view message long enough to wrap the composer onto\nseveral lines.\nThird line.';
      box.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 250));
      const client1 = room.clientHeight;
      /* ⭐ THE HARM, measured where the person feels it. scrollTop does not
         move when the box shrinks -- the FLOOR moves away from them. Whatever
         the composer just took is now newest-message that is below the fold,
         with the reader having touched nothing but the keyboard. */
      const gapWhileTyping = room.scrollHeight - room.scrollTop - room.clientHeight;
      document.getElementById('pj-post-go').click();
      await new Promise((r) => setTimeout(r, 2000));
      return { client0, client1, gapWhileTyping, gap: room.scrollHeight - room.scrollTop - room.clientHeight };
    });
    /* 🔑 THE CONTROL, and it asserts the room DOES shrink. The shrink is not the
       defect: the composer needs that space while it holds three lines. But if
       it ever stopped shrinking, the arm below would pass without exercising
       anything, and this whole file would go quietly green on a product that
       had lost the fix. */
    if (consSent.client1 < consSent.client0) ok('CONTROL: consolidated, typing really does resize the room ('
      + consSent.client0 + ' -> ' + consSent.client1 + ')');
    else bad('CONTROL: consolidated, typing really does resize the room',
      'the room no longer changes height while the composer grows, so the arm below tests nothing');
    if (consSent.gapWhileTyping <= 8) ok('consolidated: a person at the bottom can still see the newest message WHILE TYPING');
    else bad('consolidated: a person at the bottom can still see the newest message WHILE TYPING',
      consSent.gapWhileTyping + 'px of the newest messages went below the fold while he typed, having touched nothing but the keyboard');
    if (consSent.gap <= 8) ok('consolidated: after SENDING, the person can see their own message');
    else bad('consolidated: after SENDING, the person can see their own message', consSent.gap + 'px below the fold');

    /* ---- 6. CONTENT ARRIVING WITHOUT A NEW POST, which is Josh's remaining
       two triggers. "As soon as the agent starts typing" and "every 30 seconds
       or so" are both repaints that GROW the thread while the message ids stay
       the same: an unanswered marker appearing under a post, a relabelled
       timestamp, a delivery verdict. paintRoom repositions only when the POST
       LIST changes, so a reader sitting on the floor is left above whatever
       just arrived, having touched nothing. */
    const grew2 = await p.evaluate(async () => {
      const el = document.getElementById('pj-room');
      el.scrollTop = el.scrollHeight;
      await new Promise((r) => setTimeout(r, 80));
      const before = { gap: el.scrollHeight - el.scrollTop - el.clientHeight, h: el.scrollHeight };
      const body = JSON.parse(JSON.stringify(el.__lastBody));
      /* An unanswered marker under the newest post: new MARKUP, same ids. */
      const rows = (body.rows || []).filter((r) => r.kind === 'post');
      const last = rows[rows.length - 1];
      if (!last) return { error: 'no posts to mark' };
      body.unanswered = Object.assign({}, body.unanswered || {});
      body.unanswered[last.id] = ['roomer'];
      const liveBefore = el.__lastLive;
      window.paintRoom(body);
      await new Promise((r) => setTimeout(r, 150));
      return { before, rewrote: el.__lastLive !== liveBefore,
        after: { gap: el.scrollHeight - el.scrollTop - el.clientHeight, h: el.scrollHeight } };
    });
    if (grew2.error) bad('a line arriving under the newest post keeps the reader on the floor', grew2.error);
    else {
      if (!grew2.rewrote) bad('THE ARRIVING LINE ACTUALLY REPAINTED', 'setLive skipped the write, so the arm below proves nothing');
      else ok('THE ARRIVING LINE ACTUALLY REPAINTED');
      if (grew2.after.h > grew2.before.h) ok('CONTROL: the thread really did grow (' + grew2.before.h + ' -> ' + grew2.after.h + ')');
      else bad('CONTROL: the thread really did grow', 'nothing was added, so the arm below tests nothing: ' + JSON.stringify(grew2));
      if (grew2.after.gap <= 8) ok('a line arriving under the newest post keeps the reader on the floor');
      else bad('a line arriving under the newest post keeps the reader on the floor',
        grew2.after.gap + 'px below the fold. This is Josh\'s "agent starts typing" / "every 30 seconds" trigger.');
    }

  } catch (e) {
    bad('the check itself', String((e && e.message) || e));
  } finally {
    await b.close().catch(() => {});
    srv.kill();
  }

  if (errs.length) bad('no page errors', errs.join(' | ')); else ok('no page errors');
  if (ran < 18) { console.log('room-scroll: only ' + ran + ' checks ran, so this proved nothing'); process.exit(1); }
  if (failures) { console.log('room-scroll: ' + failures + ' FAILED'); process.exit(1); }
  console.log('room-scroll: all good, ' + ran + ' checks');
})();
