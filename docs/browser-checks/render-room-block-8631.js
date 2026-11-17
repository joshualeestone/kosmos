/**
 * kosmos#8631 (App Store guideline 1.2, the board's half of #8625): Report and Block on a message from outside this
 * Kosmos, the room's one line when a block hides messages, and Settings, Your Profile, Blocked with Unblock.
 *
 * Asserts, in light and dark, through the page's own functions:
 *   - an outside row with an x- id shows Report and Block, each at least 44px tall and drawn;
 *   - CONTROL: the person's own post from another computer (sameAccount) and a row with no x- id show neither;
 *   - the report mail's body is the phone's (BoardRoom.swift reportBody) line for line, with the sender's account;
 *   - Block asks first (Don't block takes focus, the words name the person), then on the board's yes removes that person's
 *     held rows and closes; on a refusal the dialog stays open and says why;
 *   - the room note says how many messages a block hides, and is hidden when the read says none;
 *   - the Blocked list shows each person with Unblock, says "No one is blocked." when empty, and stays HIDDEN when the
 *     list cannot be read (never an empty list that reads as "no one"); Unblock posts the account and says so.
 *
 * HERMETIC: loads web/index.html over file:// and answers the board's routes with a stubbed fetch; boots no server.
 * The routes themselves are tested in server.room-block-8631.test.js and server.room-block-8625.test.js.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-room-block-8631.js
 * HEADED by default; HEADED=0 on a console-less machine.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-room-block-8631: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = 'file://' + nodePath.join(nodePath.resolve(__dirname, '..', '..'), 'web', 'index.html');

const problems = [];
let pass = 0;
function ok(name, cond, detail) { if (cond) pass += 1; else problems.push(name + (detail ? ' -- ' + detail : '')); }

const ROW = { kind: 'external', id: 'x-1234abcd-0000', from: 'Ana', fromKind: 'person', text: 'hello from outside',
  at: '2026-11-17T15:00:00.000Z', external: true };

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('render-room-block-8631: could not launch a browser');
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  try {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, colorScheme: theme });
      const t = '[' + theme + ']';
      page.on('pageerror', (e) => problems.push(t + ' pageerror: ' + e.message));
      await page.goto(PAGE);
      const have = await page.evaluate(() => ['pjRoomRow', 'xReportBody', 'xBlockAsk', 'pjBlockedNoteSet', 'blockedPaint']
        .filter((f) => { try { return eval('typeof ' + f) !== 'function'; } catch { return true; } }));
      ok(t + ' the #8631 functions are on the page', have.length === 0, JSON.stringify(have));

      // 1. The row's two actions, and the controls where they must not appear.
      const rows = await page.evaluate((row) => {
        const host = document.createElement('div');
        host.id = 'pj-room-test';
        host.className = 'thread';
        document.body.appendChild(host);
        host.innerHTML = pjRoomRow(row, { agents: [] })
          + pjRoomRow(Object.assign({}, row, { id: 'x-1234abcd-0001', sameAccount: true }), { agents: [] })
          + pjRoomRow(Object.assign({}, row, { id: 'not-an-x-id' }), { agents: [] });
        const r = [...host.querySelectorAll('.msg.ext')];
        const btn = (el, a) => el.querySelector('[' + a + ']');
        const box = (b) => { if (!b) return null; const q = b.getBoundingClientRect(); return { h: q.height, w: q.width, color: getComputedStyle(b).color, text: b.textContent }; };
        return {
          n: r.length,
          report: box(btn(r[0], 'data-ext-report')),
          block: box(btn(r[0], 'data-ext-block')),
          ids: [btn(r[0], 'data-ext-report') && btn(r[0], 'data-ext-report').getAttribute('data-ext-report'), btn(r[0], 'data-ext-block') && btn(r[0], 'data-ext-block').getAttribute('data-ext-block')],
          labels: [btn(r[0], 'data-ext-report') && btn(r[0], 'data-ext-report').getAttribute('aria-label'), btn(r[0], 'data-ext-block') && btn(r[0], 'data-ext-block').getAttribute('aria-label')],
          own: r[1] ? r[1].querySelectorAll('[data-ext-report],[data-ext-block]').length : -1,
          noX: r[2] ? r[2].querySelectorAll('[data-ext-report],[data-ext-block]').length : -1,
        };
      }, ROW);
      ok(t + ' three outside rows render', rows.n === 3, String(rows.n));
      ok(t + ' Report and Block show on an outside message', rows.report && rows.block && rows.report.text === 'Report' && rows.block.text === 'Block', JSON.stringify(rows));
      ok(t + ' both are at least 44px tall and drawn', rows.report && rows.block && rows.report.h >= 44 && rows.block.h >= 44 && rows.report.w > 0
        && rows.report.color !== 'rgba(0, 0, 0, 0)', JSON.stringify([rows.report, rows.block]));
      ok(t + ' both name the message by its id', rows.ids[0] === ROW.id && rows.ids[1] === ROW.id, JSON.stringify(rows.ids));
      ok(t + ' a screen reader hears whose message each acts on', rows.labels[0] === 'Report this message from Ana' && rows.labels[1] === 'Block Ana', JSON.stringify(rows.labels));
      ok(t + ' CONTROL: never on the person\'s own post from another computer', rows.own === 0, String(rows.own));
      ok(t + ' CONTROL: never on a row with no x- id', rows.noX === 0, String(rows.noX));

      // 2. The report mail's body, the phone's shape.
      const body = await page.evaluate((row) => xReportBody(row, 'p-1', 'Launch room', 'acctA'), ROW);
      const lines = body.split('\n');
      ok(t + ' the report opens as the phone\'s does', lines[0] === 'I am reporting this message from someone outside my Kosmos.', lines[0]);
      ok(t + ' it names the sender, their account, the room and the message', lines.includes('From: Ana') && lines.includes('Sender account: acctA')
        && lines.includes('Room: Launch room (p-1)') && lines.includes('Message id: ' + ROW.id) && lines.includes('hello from outside'), body);
      ok(t + ' an unknown account says so', (await page.evaluate((row) => xReportBody(row, 'p-1', 'Launch room', null), ROW)).includes('Sender account: not known'));

      // 3. Block: asks first, then removes the person's held rows on the board's yes.
      const ask = await page.evaluate((row) => {
        PJ_CURRENT = 'p-1';
        PJ_WIN.older = [row, Object.assign({}, row, { id: 'x-other-0000', from: 'Bea' })];
        PJ_WIN.newest = [];
        window.__posted = [];
        window.__answer = { status: 200, body: { blocked: true, name: 'Ana', hidden: { 'p-1': [row.id] } } };
        window.fetch = async (url, opts) => {
          window.__posted.push([String(url), opts && opts.method || 'GET', opts && opts.body || null]);
          // Only the block route gets the arm's answer; the page's own background reads get nothing to misread.
          if (!/\/block$/.test(String(url))) return { ok: false, status: 404, json: async () => ({}) };
          const a = window.__answer;
          return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body };
        };
        window.loadRoom = async () => {};
        xBlockAsk(row.id, null);
        const m = document.getElementById('xblock-modal');
        return { shown: !m.hidden && m.getBoundingClientRect().height > 0, focus: document.activeElement && document.activeElement.id,
          words: document.getElementById('xblock-small').textContent, title: document.getElementById('xblock-title').textContent };
      }, ROW);
      ok(t + ' Block asks first', ask.shown && ask.title === 'Block them?', JSON.stringify(ask));
      ok(t + ' not blocking takes focus, so a stray Enter is harmless', ask.focus === 'xblock-keep', ask.focus);
      ok(t + ' the question names the person and says they are not told', ask.words.startsWith('You will not see messages from Ana\'s account') && ask.words.includes('They are not told.'), ask.words);
      await page.click('#xblock-go');
      await page.waitForFunction(() => document.getElementById('xblock-modal').hidden, null, { timeout: 3000 }).catch(() => {});
      const done = await page.evaluate(() => ({ hidden: document.getElementById('xblock-modal').hidden, posted: window.__posted,
        older: PJ_WIN.older.map((r) => r.id), cursor: PJ_WIN.cursor }));
      ok(t + ' the block posts to the board\'s route for that message', done.posted.some((p) => p[0] === '/api/project/p-1/room/x-1234abcd-0000/block' && p[1] === 'POST'), JSON.stringify(done.posted));
      ok(t + ' the dialog closes on the board\'s yes', done.hidden);
      ok(t + ' the window starts again, so no held page keeps a row or a cursor the room no longer serves', JSON.stringify(done.older) === '[]' && done.cursor === null, JSON.stringify(done));

      // 3b. A refusal keeps the dialog open and says why.
      const refused = await page.evaluate(async (row) => {
        window.__answer = { status: 409, body: { error: 'this message has no sender Kosmos can name' } };
        PJ_WIN.older = [row];
        xBlockAsk(row.id, null);
        document.getElementById('xblock-go').click();
        for (let i = 0; i < 50 && document.getElementById('xblock-msg').textContent === 'Blocking…'; i += 1) await new Promise((r) => setTimeout(r, 20));
        const out = { open: !document.getElementById('xblock-modal').hidden, msg: document.getElementById('xblock-msg').textContent, again: !document.getElementById('xblock-go').disabled };
        xBlockClose();
        return out;
      }, ROW);
      const unconfirmed = await page.evaluate(async (row) => {
        window.__answer = { status: 200, body: { ok: true } };
        PJ_WIN.older = [row];
        xBlockAsk(row.id, null);
        document.getElementById('xblock-go').click();
        for (let i = 0; i < 50 && document.getElementById('xblock-msg').textContent === 'Blocking\u2026'; i += 1) await new Promise((r) => setTimeout(r, 20));
        const out = document.getElementById('xblock-msg').textContent;
        xBlockClose();
        return out;
      }, ROW);
      ok(t + ' a 2xx that does not say blocked is not called a failure (the phone\'s words)', unconfirmed === 'We could not confirm the block. If their messages are still shown, try again.', unconfirmed);
      ok(t + ' a refusal leaves the dialog open with the board\'s reason', refused.open && refused.msg === 'We could not block them: this message has no sender Kosmos can name.' && refused.again, JSON.stringify(refused));

      // 3c. The real buttons in #pj-room, through the page's own click handling (round 1: every arm above called the
      // functions directly, so a broken selector in the delegation would have stayed green).
      const real = await page.evaluate(async (row) => {
        const room = document.getElementById('pj-room');
        const long = Object.assign({}, row, { id: 'x-cccc3333-0003', text: 'a'.repeat(1999) + '\u{1F600}' + 'tail' });
        PJ_CURRENT = 'p-1';
        PJ_WIN.older = [long];
        PJ_WIN.newest = [];
        room.innerHTML = pjRoomRow(long, { agents: [] });
        window.__posted = [];
        window.fetch = async (url, opts) => {
          window.__posted.push([String(url), opts && opts.method || 'GET', opts && opts.body || null]);
          if (/\/sender$/.test(String(url))) return { ok: true, status: 200, json: async () => ({ account: 'acctA' }) };
          if (/\/block$/.test(String(url))) return { ok: true, status: 200, json: async () => ({ blocked: true, name: 'Ana', hidden: {} }) };
          return { ok: false, status: 404, json: async () => ({}) };
        };
        const say = document.getElementById('pj-room-msg');
        say.textContent = '';
        let threw = null, href = null;
        window.addEventListener('unhandledrejection', (e) => { threw = String(e.reason); }, { once: true });
        const realClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () { if (/^mailto:/.test(this.href)) { href = this.href; return; } return realClick.call(this); };
        room.querySelector('[data-ext-report]').click();
        for (let i = 0; i < 50 && !say.textContent; i += 1) await new Promise((r) => setTimeout(r, 20));
        HTMLAnchorElement.prototype.click = realClick;
        const out = { said: say.textContent, threw, href, sender: window.__posted.some((q) => q[0] === '/api/project/p-1/room/x-cccc3333-0003/sender') };
        room.querySelector('[data-ext-block]').click();
        out.dialog = !document.getElementById('xblock-modal').hidden;
        xBlockClose();
        // A row only the archive holds (the archive view paints PJ_ARCH.rows into the same room).
        PJ_WIN.older = [];
        PJ_ARCH.rows = [Object.assign({}, row, { id: 'x-dddd4444-0004' })];
        xBlockAsk('x-dddd4444-0004', null);
        out.archive = !document.getElementById('xblock-modal').hidden;
        xBlockClose();
        PJ_ARCH.rows = [];
        say.textContent = '';
        xBlockAsk('x-eeee5555-0005', null);
        out.missing = { dialog: !document.getElementById('xblock-modal').hidden, said: say.textContent };
        room.innerHTML = '';
        return out;
      }, ROW);
      ok(t + ' the real Report button reads the sender and says where the report went', real.sender && real.said.startsWith('Your mail app should open with the report to hello@installkosmos.com.'), JSON.stringify(real));
      const mail = real.href ? new URL(real.href) : null;
      ok(t + ' the mail goes to the published address with the phone\'s subject and the sender\'s account', !!mail && mail.pathname === 'hello@installkosmos.com'
        && mail.searchParams.get('subject') === 'Kosmos report: a message in a shared room' && (mail.searchParams.get('body') || '').includes('Sender account: acctA'), String(real.href).slice(0, 160));
      ok(t + ' an emoji at the 2000-character cut does not break the report', real.threw === null && real.said !== '', String(real.threw));
      ok(t + ' the real Block button opens the dialog', real.dialog === true);
      ok(t + ' a row only the archive holds can be blocked', real.archive === true);
      ok(t + ' a message no longer in the room says so rather than doing nothing', real.missing.dialog === false && real.missing.said === 'We could not find that message. Read the room again and try once more.', JSON.stringify(real.missing));

      // 4a. The real loadRoom sets the line from the room read (round 7: the call sites were untested), and the archive's
      // own read sets it while the archive shows; going back to the room puts the room's own line back.
      // On a page of its own: the arms above leave fetch stubbed for the whole page, and the page's own poll runs too.
      const fresh = await browser.newPage({ viewport: { width: 1100, height: 800 }, colorScheme: theme });
      fresh.on('pageerror', (e) => problems.push(t + ' pageerror (wired): ' + e.message));
      await fresh.goto(PAGE);
      const wired = await fresh.evaluate(async () => {
        const settle = async () => { await loadRoom(); await new Promise((r) => setTimeout(r, 400)); await loadRoom(); };
        const el = document.getElementById('pj-blocked-note');
        const saved = { read: window.pjWinRead, byId: window.pjById, cur: PJ_CURRENT };
        window.pjById = () => ({ id: 'p-9', name: 'Wired', agents: [] });
        PJ_CURRENT = 'p-9';
        pjWinReset('p-9');
        window.pjWinRead = async (pid, n, cursor, archive) => (archive
          ? { ok: true, rows: [], olderCount: 0, olderCursor: null, archivedCount: 0, archiveMarker: null, hiddenBlocked: 5 }
          : { ok: true, rows: [], unanswered: [], olderCount: 0, olderCursor: null, archivedCount: 0, archiveMarker: null, hiddenBlocked: window.__hid });
        const out = {};
        window.__hid = 2; await settle(); out.two = el.hidden ? null : el.textContent;
        window.__hid = undefined; await settle(); out.none = el.hidden;
        window.__hid = 2; await settle();
        await pjArchOpen(false); out.arch = el.hidden ? null : el.textContent;
        await loadRoom(); out.archAfterPoll = el.hidden ? null : el.textContent;
        pjArchClose(true); out.back = el.hidden ? null : el.textContent;
        window.pjWinRead = saved.read; window.pjById = saved.byId; PJ_CURRENT = saved.cur; pjWinReset(saved.cur);
        return out;
      });
      await fresh.close();
      ok(t + ' the room read sets the line through loadRoom', wired.two && wired.two.startsWith('2 messages are hidden here'), JSON.stringify(wired));
      ok(t + ' CONTROL: a read with no count clears it', wired.none === true, JSON.stringify(wired));
      ok(t + ' the archive says what a block hides in it, and a live poll does not overwrite that', wired.arch && wired.arch.startsWith('5 messages') && wired.archAfterPoll && wired.archAfterPoll.startsWith('5 messages'), JSON.stringify(wired));
      ok(t + ' back in the room, the room\'s own line returns', wired.back && wired.back.startsWith('2 messages'), JSON.stringify(wired));

      // 4. The room's one line.
      const note = await page.evaluate(() => {
        const el = document.getElementById('pj-blocked-note');
        pjBlockedNoteSet({ hiddenBlocked: 2 });
        const two = { hidden: el.hidden, text: el.textContent, link: !!el.querySelector('[data-blocked-go]') };
        pjBlockedNoteSet({ hiddenBlocked: 1 });
        const one = el.textContent;
        pjBlockedNoteSet({});
        return { two, one, none: el.hidden };
      });
      ok(t + ' the room says how many messages a block hides', !note.two.hidden && note.two.text.startsWith('2 messages are hidden here because you blocked who sent them.') && note.two.link, JSON.stringify(note.two));
      ok(t + ' one hidden message is said as one', note.one.startsWith('A message is hidden here because you blocked who sent it.'), note.one);
      ok(t + ' CONTROL: no line when the read says none', note.none === true);

      // 5. Settings, Your Profile, Blocked.
      const list = await page.evaluate(async () => {
        const box = document.getElementById('you-blocked-box');
        const out = {};
        window.fetch = async (url, opts) => {
          window.__posted.push([String(url), opts && opts.method || 'GET', opts && opts.body || null]);
          if (String(url) === '/api/blocked') return window.__list;
          if (String(url) === '/api/blocked/unblock') return { ok: true, status: 200, json: async () => ({ unblocked: true, changed: true }) };
          return { ok: false, status: 404, json: async () => ({}) };
        };
        window.__list = { ok: false, status: 503, json: async () => ({ error: 'no' }) };
        box.hidden = false;
        await blockedPaint();
        out.failed = box.hidden;
        window.__list = { ok: true, status: 200, json: async () => ({ blocked: [] }) };
        await blockedPaint();
        out.empty = { hidden: box.hidden, text: document.getElementById('you-blocked').textContent };
        window.__list = { ok: true, status: 200, json: async () => ({ blocked: [{ account: 'acctA', name: 'Ana', at: '2026-11-17T15:00:00Z' }] }) };
        await blockedPaint();
        const b = document.querySelector('#you-blocked [data-unblock]');
        out.one = { text: document.getElementById('you-blocked').textContent, btn: b ? b.textContent : null, label: b ? b.getAttribute('aria-label') : null };
        window.__posted = [];
        window.__list = { ok: true, status: 200, json: async () => ({ blocked: [] }) };
        b.click();
        for (let i = 0; i < 50 && !document.getElementById('you-blocked-msg').textContent; i += 1) await new Promise((r) => setTimeout(r, 20));
        out.unblock = { posted: window.__posted, msg: document.getElementById('you-blocked-msg').textContent };
        return out;
      });
      ok(t + ' an unreadable list hides the box, never "no one"', list.failed === true, JSON.stringify(list));
      ok(t + ' an empty list says no one is blocked', list.empty.hidden === false && list.empty.text === 'No one is blocked.', JSON.stringify(list.empty));
      ok(t + ' a blocked person is listed with Unblock', list.one.text.includes('Ana') && list.one.btn === 'Unblock' && list.one.label === 'Unblock Ana', JSON.stringify(list.one));
      ok(t + ' Unblock posts that account', list.unblock.posted.some((p) => p[0] === '/api/blocked/unblock' && p[1] === 'POST' && p[2] === JSON.stringify({ account: 'acctA' })), JSON.stringify(list.unblock.posted));
      ok(t + ' and says so', list.unblock.msg === 'Ana is unblocked. Their messages are back in your rooms.', list.unblock.msg);
      // Round 2: an Unblock that fails, whose re-read fails too, keeps the list on screen and says so; focus stays in the box.
      const failedUnblock = await page.evaluate(async () => {
        showTab('settings');   // the person is on Settings when they press Unblock
        settingsGo('you', { focus: false });
        await blockedPaint();   // the read arriving on Settings started, before the list below exists
        window.__list = { ok: true, status: 200, json: async () => ({ blocked: [{ account: 'acctC', name: 'Cal', at: '2026-11-17T15:00:00Z' }] }) };
        await blockedPaint();
        const before = window.fetch;
        window.fetch = async (url) => (String(url) === '/api/blocked'
          ? { ok: false, status: 503, json: async () => ({ error: 'no' }) }
          : { ok: false, status: 500, json: async () => ({ error: 'no' }) });
        const msg = document.getElementById('you-blocked-msg');
        msg.textContent = '';
        document.querySelector('#you-blocked [data-unblock]').click();
        for (let i = 0; i < 50 && !msg.textContent; i += 1) await new Promise((r) => setTimeout(r, 20));
        await new Promise((r) => setTimeout(r, 20));
        const out = { shown: !document.getElementById('you-blocked-box').hidden, msg: msg.textContent,
          still: document.getElementById('you-blocked').textContent.includes('Cal'), focus: document.activeElement && document.activeElement.id,
          again: !!document.querySelector('#you-blocked [data-unblock]') && !document.querySelector('#you-blocked [data-unblock]').disabled };
        window.fetch = before;
        return out;
      });
      ok(t + ' a failed Unblock keeps the list and says so', failedUnblock.shown && failedUnblock.still && failedUnblock.msg === 'We could not unblock Cal. Try again in a moment.', JSON.stringify(failedUnblock));
      ok(t + ' after Unblock, focus is on the Blocked box', failedUnblock.focus === 'you-blocked-box', String(failedUnblock.focus));
      ok(t + ' a failed Unblock can be tried again', failedUnblock.again === true, JSON.stringify(failedUnblock));
      // Round 2: a window reset for the SAME room (a gap read) keeps the note; another room clears it.
      const reset = await page.evaluate(() => {
        pjWinReset('p-1');
        pjBlockedNoteSet({ hiddenBlocked: 3 });
        pjWinReset('p-1');
        const same = !document.getElementById('pj-blocked-note').hidden;
        pjWinReset('p-2');
        return { same, other: document.getElementById('pj-blocked-note').hidden };
      });
      ok(t + ' a reset of the same room keeps the note', reset.same === true, JSON.stringify(reset));
      ok(t + ' CONTROL: another room clears it', reset.other === true, JSON.stringify(reset));
      // The note's link lands on the list once it has been read (round 1: it focused a box that was still hidden).
      const landed = await page.evaluate(async () => {
        document.getElementById('you-blocked-box').hidden = true;
        window.__list = { ok: true, status: 200, json: async () => ({ blocked: [{ account: 'acctB', name: 'Bea', at: '2026-11-17T15:00:00Z' }] }) };
        pjBlockedNoteSet({ hiddenBlocked: 1 });
        await blockedPaint();   // nothing left running from earlier arms
        window.__posted = [];
        document.querySelector('#pj-blocked-note [data-blocked-go]').click();
        for (let i = 0; i < 50 && document.activeElement && document.activeElement.id !== 'you-blocked-box'; i += 1) await new Promise((r) => setTimeout(r, 20));
        return { focus: document.activeElement && document.activeElement.id, shown: !document.getElementById('you-blocked-box').hidden, settings: !document.getElementById('panel-settings').hidden,
          reads: window.__posted.filter((q) => q[0] === '/api/blocked').length };
      });
      ok(t + ' the note\'s link opens Settings on the Blocked list', landed.settings && landed.shown && landed.focus === 'you-blocked-box', JSON.stringify(landed));
      ok(t + ' the note\'s link reads the Blocked list once', landed.reads === 1, String(landed.reads));
      await page.close();
    }
  } finally {
    await browser.close();
  }
  if (problems.length) {
    for (const p of problems) console.log('  FAIL  ' + p);
    console.log('FAILED: ' + problems.length);
    process.exit(1);
  }
  console.log(pass + '/' + pass + ' checks passed');
})();
