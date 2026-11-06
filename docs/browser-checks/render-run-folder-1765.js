/**
 * kosmos#1765: on Windows, a board running from a folder other people on the PC may be able to change says so on the
 * person's screen: the launcher's own words (what is wrong, where to put a fresh copy, that the old folder can then be
 * deleted). The X tells the board and hides the note, and says when that did not work.
 *
 * Loads the page over file:// with fetch stubbed (the render-damaged-files-7248 pattern). The board half (asking the
 * folder's own Kosmos.exe, the routes, nothing started for the normal install) is engine/win32runfolder.test.js. Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-run-folder-1765.js
 */
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');

const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

const NOTICE = {
  folder: 'C:\\Kosmos',
  message: 'Kosmos is running from C:\\Kosmos, and other people who use this computer may be able to change the files in that folder, so they could change what Kosmos runs as you. To fix it, download Kosmos again, extract it into C:\\Users\\sam\\Downloads, and open Kosmos.exe from there. Kosmos then installs itself in a folder only you can change and starts from there from your next sign-in. After that you can delete C:\\Kosmos.',
};

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: 'light' });
      const errs = [];
      page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
      await page.addInitScript((notice) => {
        window.__posts = [];
        window.__dismissAnswer = 200;
        const enc = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json' } });
        window.setInterval = () => 0;
        window.fetch = async (url) => {
          const u = String(url);
          if (u.endsWith('/api/board/run-folder')) return enc({ notice });
          if (u.endsWith('/api/board/run-folder/dismiss')) {
            window.__posts.push('dismiss');
            return window.__dismissAnswer === 200 ? enc({ dismissed: true }) : enc({ error: 'we could not record that just now' }, 500);
          }
          if (u.includes('/api/status')) return enc({ agents: [], version: '0.0.0' });
          return enc({});
        };
      }, NOTICE);
      await page.goto(PAGE);
      // First run is not this check's subject: closed, and the page given back, as render-damaged-files-7248 does.
      await page.evaluate(() => {
        const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
        document.querySelectorAll('[inert]').forEach((el) => { el.inert = false; });
      });
      await page.evaluate(() => runFolderCheck());
      await page.waitForTimeout(300);
      const t = '[' + width + '] ';
      const note = await page.evaluate(() => {
        const s = document.getElementById('runfolder-slot');
        const box = s && s.firstElementChild ? s.firstElementChild.getBoundingClientRect() : null;
        const msg = s && s.querySelector('.rfmsg');
        return {
          text: s ? s.textContent : '',
          head: s && s.querySelector('.utxt b') ? s.querySelector('.utxt b').textContent : '',
          msg: msg ? msg.textContent : '',
          shown: !!(box && box.width > 0 && box.height > 0),
          msgShown: !!(msg && msg.getBoundingClientRect().height > 0),
          role: s && s.querySelector('.utxt') ? s.querySelector('.utxt').getAttribute('role') : '',
        };
      });
      chk(note.shown && note.head === 'Other people on this computer may be able to change Kosmos', t + 'the note is shown, with its heading', note.head);
      chk(note.msgShown && note.msg === NOTICE.message, t + 'the launcher\'s own words are shown in full (a phone keeps them)', note.msg.slice(0, 80));
      chk(note.role === 'status', t + 'the words are read out by a screen reader');
      chk(!/\u2014/.test(note.text), t + 'no em dash in the note');

      // A refused dismiss says so and keeps the note. Pressed as a person presses it (focus and Enter).
      await page.evaluate(() => { window.__dismissAnswer = 500; });
      await page.focus('#runfolder-slot .ux');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      const refused = await page.evaluate(() => ({
        err: (document.querySelector('#runfolder-slot .rerr') || {}).textContent || '',
        still: !!document.querySelector('#runfolder-slot .rfmsg'),
      }));
      chk(/could not record that just now/.test(refused.err) && refused.still, t + 'a refused dismiss says so and keeps the note', JSON.stringify(refused));

      // The X tells the board and hides the note.
      await page.evaluate(() => { window.__dismissAnswer = 200; });
      await page.click('#runfolder-slot .ux');
      await page.waitForTimeout(300);
      const gone = await page.evaluate(() => ({ html: document.getElementById('runfolder-slot').innerHTML, posts: window.__posts }));
      chk(gone.html === '' && gone.posts.filter((p) => p === 'dismiss').length === 2, t + 'the X tells the board and hides the note', JSON.stringify(gone.posts));

      // CONTROL: no notice, nothing shown.
      await page.evaluate(() => paintRunFolder(null));
      chk(await page.evaluate(() => document.getElementById('runfolder-slot').innerHTML === ''), t + 'CONTROL: no notice, no note');
      chk(errs.length === 0, t + 'no page errors', errs.join(' | '));
      await page.close();
    }
  } catch (e) {
    chk(false, 'the check ran to the end', String((e && e.stack) || e));
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})();
