/**
 * kosmos#7248: a file of Kosmos's own that a crash left empty, NUL-filled or unreadable is named on the person's screen
 * at start: what it holds, that Kosmos has not changed it, and, when a good copy exists, a button to put it back. The
 * button asks the board and says when that did not work; the X hides the note.
 *
 * Loads the page over file:// with fetch stubbed (the render-dm-held-5805 pattern). The board half (the check at
 * start, the routes, nothing touched) is server.storecheck-7248.test.js. Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-damaged-files-7248.js
 */
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');

const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

const FILES = [
  { file: 'projects.json', holds: 'your projects, their tasks and who is on them', problem: 'nul', backup: { file: 'projects.json.recovered-x', at: new Date(Date.now() - 3600e3).toISOString() } },
  { file: 'removed.json', holds: 'the agents you removed', problem: 'empty', backup: null },
  { file: 'settings.json', holds: 'your settings', problem: 'unreadable', savedOver: true, backup: { file: 'settings.json.bak', at: new Date(Date.now() - 7200e3).toISOString() } },
  { file: 'service-keys.json', holds: 'the keys for services you connected', problem: 'empty', secret: true, backup: null },
];

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: 'light' });
      const errs = [];
      page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
      await page.addInitScript((files) => {
        window.__posts = [];
        window.__restoreAnswer = 200;
        const enc = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json' } });
        window.setInterval = () => 0;
        window.fetch = async (url, opts) => {
          const u = String(url);
          if (u.endsWith('/api/board/damaged-files')) return enc({ files });
          if (u.endsWith('/api/board/damaged-files/restore')) {
            window.__posts.push(JSON.parse(opts.body));
            return window.__restoreAnswer === 200 ? enc({ restored: true }) : enc({ error: 'Kosmos did not put it back: it has been saved since Kosmos started, so Kosmos left it; the copy is kept at projects.json.recovered-x.' }, 409);
          }
          if (u.endsWith('/api/board/damaged-files/dismiss')) { window.__posts.push('dismiss'); return enc({ dismissed: true }); }
          if (u.includes('/api/status')) return enc({ agents: [], version: '0.0.0' });
          return enc({});
        };
      }, FILES);
      await page.goto(PAGE);
      // First run is not this check's subject: closed, and the page given back, as render-dm-held-5805 does. The
      // presses below are real ones, so anything still inert or covered would fail them.
      await page.evaluate(() => {
        const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
        document.querySelectorAll('[inert]').forEach((el) => { el.inert = false; });
      });
      await page.evaluate(() => damagedFilesCheck());
      await page.waitForTimeout(300);
      const t = '[' + width + '] ';
      const note = await page.evaluate(() => {
        const s = document.getElementById('damaged-slot');
        const box = s && s.firstElementChild ? s.firstElementChild.getBoundingClientRect() : null;
        return {
          text: s ? s.textContent : '',
          rows: s ? [...s.querySelectorAll('.dmgrow')].map((r) => r.textContent) : [],
          buttons: s ? [...s.querySelectorAll('.dmgput')].map((b) => b.textContent) : [],
          shown: !!(box && box.width > 0 && box.height > 0),
          rowsShown: s ? [...s.querySelectorAll('.dmgrow')].every((r) => r.getBoundingClientRect().height > 0) : false,
          buttonH: s && s.querySelector('.dmgput') ? Math.round(s.querySelector('.dmgput').getBoundingClientRect().height) : 0,
        };
      });
      chk(note.shown && /Kosmos found 4 damaged files/.test(note.text), t + 'the note names how many files are damaged', note.text.slice(0, 80));
      chk(note.rows.length === 4 && note.rowsShown, t + 'one visible row per file (a phone keeps them)', JSON.stringify(note.rows));
      chk(/^The file with your projects, their tasks and who is on them \(projects\.json\) is blank, as a crash can leave a file\. Kosmos has not changed it\. Put back the copy saved /.test(note.rows[0] || ''),
        t + 'a row says what the file holds, its name, what is wrong and that Kosmos has not changed it', note.rows[0]);
      chk(/^The file with the agents you removed \(removed\.json\) is empty\. Kosmos has not changed it\. There is no good copy to put back\.$/.test(note.rows[1] || ''),
        t + 'a file with no good copy says so, with no button', note.rows[1]);
      chk(/^The file with your settings \(settings\.json\) cannot be read\. Kosmos has saved over it since it started\. The copy saved .+ is kept at settings\.json\.bak\.$/.test(note.rows[2] || ''),
        t + 'a file saved over since start says so, and where its copy is kept, with no button (review 2)', note.rows[2]);
      chk(/It holds a key or something you can take back, so Kosmos keeps no copy of it\.$/.test(note.rows[3] || ''), t + 'a file holding a secret offers no copy and says why', note.rows[3]);
      chk(note.buttons.length === 1 && /^Put back the copy saved /.test(note.buttons[0]), t + 'a put-back button only for the file still damaged, with a good copy', JSON.stringify(note.buttons));
      chk(!/—/.test(note.text), t + 'no em dash in the note');

      // A refused put-back says why, keeps focus on the button, and the button can be pressed again. Pressed as a person
      // presses it (focus and Enter), so an inert or covered button would fail here (review 1).
      await page.evaluate(() => { window.__restoreAnswer = 409; });
      await page.focus('#damaged-slot .dmgput');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      const refused = await page.evaluate(() => {
        const b = document.querySelector('#damaged-slot .dmgput');
        return { err: (document.querySelector('#damaged-slot .dmgrow .rerr') || {}).textContent || '', busy: b.getAttribute('aria-disabled'), focused: document.activeElement === b };
      });
      chk(/saved since Kosmos started, so Kosmos left it; the copy is kept at/.test(refused.err) && refused.busy === null && refused.focused,
        t + 'a refused put-back says why, keeps focus on the button and leaves it pressable', JSON.stringify(refused));

      // The put-back asks the board for that file; the row then says it was put back and takes focus.
      await page.evaluate(() => { window.__restoreAnswer = 200; });
      await page.click('#damaged-slot .dmgput');
      await page.waitForTimeout(300);
      const put = await page.evaluate(() => {
        const row = document.querySelector('#damaged-slot .dmgrow');
        return { posts: window.__posts, row: row.textContent, focused: document.activeElement === row };
      });
      chk(put.posts.filter((p) => p && p.file === 'projects.json').length === 2, t + 'the button asks the board to put back projects.json', JSON.stringify(put.posts));
      chk(/^projects\.json: put back\. The damaged one is kept beside it\./.test(put.row) && put.focused,
        t + 'the row then says it was put back, and takes focus from the button it replaced', JSON.stringify(put));

      // The X hides the note.
      await page.click('#damaged-slot .ux');
      await page.waitForTimeout(300);
      const gone = await page.evaluate(() => ({ html: document.getElementById('damaged-slot').innerHTML, posts: window.__posts }));
      chk(gone.html === '' && gone.posts.includes('dismiss'), t + 'the X tells the board and hides the note', JSON.stringify(gone.posts));

      // CONTROL: with nothing damaged, nothing is shown.
      await page.evaluate(() => paintDamagedFiles([]));
      chk(await page.evaluate(() => document.getElementById('damaged-slot').innerHTML === ''), t + 'CONTROL: no damaged files, no note');
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
