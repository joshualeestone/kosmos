/**
 * The board's disk-scan panel (#1938): agents on this computer Kosmos has no record
 * of Claude ever running in, found by walking the disk for CLAUDE.md files.
 *
 * 🔑 WHAT NO SOURCE TEST CAN SEE HERE: whether the panel appears on the board (it is
 * painted by the poll, not the page load), whether each row SHOWS the file in a
 * preview -- the load-bearing element, because the scan cannot name a folder the way
 * found() can and the person decides from the file -- and whether Add, the name field
 * for a nameless folder, and Skip work through the real handlers.
 *
 * ⚠️ THE ROUTES ARE INTERCEPTED, so nothing here starts or declines a real agent.
 *
 * ⚠️ NEEDS A SANDBOX WITH FIRST RUN ALREADY COMPLETE, or the onboarding overlay sits
 * over the board and every click times out against it:
 *
 *     mkdir -p "$SB/data/AgentWorkforce"
 *     echo '{"completedAt":"2026-01-01T00:00:00.000Z"}' > "$SB/data/AgentWorkforce/first-run.json"
 *
 * Run: see the README in this directory (same shape as render-found-board.js).
 */
'use strict';

const playwright = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:4399';
const HEADED = process.env.HEADED !== '0';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

/* One named candidate and one that its file does not name. The named one Adds with
   no typed name (connect reads it from the file); the nameless one must be given a
   name before it will connect -- the two arms this panel exists to carry. */
/* #2025: this preview carries two shapes that letterbox under the old
   `white-space: pre` and must not under the fix. The long prose sentence wraps at
   spaces (needs `pre-wrap`); the long unbroken path has no spaces to wrap at
   (needs `overflow-wrap: anywhere`, which the fix pairs with pre-wrap). The
   no-horizontal-scroll check below reads FAIL against origin/main and PASS here
   off exactly these lines. */
const NAMED_PREVIEW = 'You are **Site Monitor**, a Watcher.\n\nWatch the site around the clock and, when it goes down or slows to a crawl, tell the person in plain language what changed and what you already tried before you woke them up about it.\n\nWorking dir: /Users/site/Library/Application-Support/AgentWorkforce/projects/site-monitor/checks/a-very-long-unbroken-path-segment-with-no-spaces-to-wrap-at/config.json\n';
const NAMELESS_PREVIEW = 'You are the thing that keeps the build green.\n\nRun the pipeline.\n';
const CANDS = [
  { dir: '/Users/x/work/site-monitor', name: 'Site Monitor', role: 'Watcher', preview: NAMED_PREVIEW },
  { dir: '/Users/x/work/nameless-one', name: '', role: null, preview: NAMELESS_PREVIEW },
];

(async () => {
  const browser = await playwright.chromium.launch({ headless: !HEADED });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));

  /* 🛑 THE ANSWER CHANGES AFTER AN ADD, exactly as the engine's does: an added
     candidate is now a Kosmos agent, so the scan drops it and the set shrinks. Without
     that, the "survives a poll" assertion would be vacuous -- the panel would decline
     to repaint anyway because nothing changed. */
  let addedDir = null;
  await page.route('**/api/scan-agents', (r) => r.fulfill({
    json: { ok: true, candidates: CANDS.filter((c) => c.dir !== addedDir), bounded: {}, dismissed: false },
  }));
  await page.route('**/api/connect-agent', async (r) => {
    const body = JSON.parse(r.request().postData() || '{}');
    addedDir = body.dir;
    r.fulfill({ json: { ok: true, name: 'site-monitor', displayName: 'Site Monitor', dir: body.dir, started: true } });
  });
  await page.route('**/api/found-agents/decline', (r) => r.fulfill({ json: { ok: true, declined: '/Users/x/work/nameless-one' } }));
  /* The found panel shares the poll; keep it empty so only the scan panel draws. */
  await page.route('**/api/found-agents', (r) => r.fulfill({ json: { ok: true, agents: [], adoptable: [], dismissed: false } }));

  await page.goto(BASE + '/?tab=agents', { waitUntil: 'networkidle' });
  await page.waitForSelector('#scan-toggle', { timeout: 10000 });

  /* 🔑 THE FOLD IS SHUT ON ARRIVAL, so this opens it the way a person does -- through
     the control, not by setting `hidden` from script. A check that reached past the
     toggle would pass with the toggle broken. */
  const shut = await page.evaluate(() => ({
    listHidden: document.getElementById('scan-list').hidden,
    label: document.getElementById('scan-toggle').textContent,
  }));
  check('it arrives shut, and offers to show', shut.listHidden && /Show (it|them)/.test(shut.label),
    `hidden=${shut.listHidden} "${shut.label}"`);
  /* Per Josh's found-panel ruling, no number in the fold label. */
  check('the fold names no number', !/\d/.test(shut.label), `"${shut.label}"`);

  await page.click('#scan-toggle');
  await page.waitForSelector('#scan-list .fr-scanrow', { timeout: 8000 });
  await page.waitForTimeout(400);

  const seen = await page.evaluate((named) => {
    const wrap = document.getElementById('scan-wrap');
    const rows = [...wrap.querySelectorAll('.fr-scanrow')];
    const grid = document.getElementById('grid');
    const w = wrap.getBoundingClientRect();
    const g = grid ? grid.getBoundingClientRect() : null;
    const first = rows[0] && rows[0].querySelector('.fr-foundgo');
    if (first) first.scrollIntoView({ block: 'center' });
    const fr = first ? first.getBoundingClientRect() : null;
    const at = fr ? document.elementFromPoint(fr.left + fr.width / 2, fr.top + fr.height / 2) : null;
    /* THE LOAD-BEARING READ: the preview textarea for the named row carries the
       file's actual bytes. Read `.value`, because a textarea's content is its value
       not its text, and this is the whole reason the panel is safe to act on. */
    const namedRow = rows.find((r) => r.dataset.foundDir && r.dataset.foundDir.endsWith('site-monitor'));
    const preview = namedRow && namedRow.querySelector('.fr-scanpreview');
    const namelessRow = rows.find((r) => r.dataset.foundDir && r.dataset.foundDir.endsWith('nameless-one'));
    return {
      hidden: wrap.hidden,
      painted: w.width > 100 && w.height > 40,
      belowGrid: Boolean(g && g.height > 0 && w.top >= g.bottom - 1),
      dirs: rows.map((r) => r.dataset.foundDir),
      previewValue: preview ? preview.value : null,
      previewReadonly: preview ? preview.readOnly : null,
      /* #2025 letterbox: the fix is `white-space: pre-wrap`, but the DEFECT is a
         horizontal scrollbar, so assert the behaviour (no horizontal overflow on
         a long line) not just the property. Both are read so a failure names the
         cause. */
      previewWhiteSpace: preview ? getComputedStyle(preview).whiteSpace : null,
      previewNoHScroll: preview ? (preview.scrollWidth <= preview.clientWidth + 2) : null,
      namelessHasNameField: Boolean(namelessRow && namelessRow.querySelector('.fr-adoptinput')),
      namedHasNameField: Boolean(namedRow && namedRow.querySelector('.fr-adoptinput')),
      pressable: Boolean(at && at.closest && at.closest('.fr-foundgo') === first),
    };
  }, NAMED_PREVIEW);

  check('the panel is on the board', !seen.hidden && seen.painted, `hidden=${seen.hidden}`);
  check('it sits below the cards', seen.belowGrid);
  check('it offers both scanned folders',
    seen.dirs.some((d) => d && d.endsWith('site-monitor')) && seen.dirs.some((d) => d && d.endsWith('nameless-one')),
    JSON.stringify(seen.dirs));
  /* 🔑 THE PREVIEW IS THE FILE, verbatim and read-only. This is what makes the
     panel honest: it does not assert who the folder belongs to, it shows the
     instructions and lets the person decide. */
  check('the preview shows the file content', seen.previewValue === NAMED_PREVIEW,
    JSON.stringify(seen.previewValue));
  check('the preview is read-only', seen.previewReadonly === true);
  /* #2025: a long instruction line wraps inside the box instead of forcing a
     horizontal scrollbar, so the person is not reading prose through a letterbox. */
  check('the preview wraps a long line (no horizontal letterbox)',
    seen.previewNoHScroll === true && seen.previewWhiteSpace === 'pre-wrap',
    `whiteSpace=${seen.previewWhiteSpace} noHScroll=${seen.previewNoHScroll}`);
  check('a nameless folder gets a name field', seen.namelessHasNameField);
  check('a named folder does NOT get a name field', !seen.namedHasNameField);
  check('its buttons can be touched', seen.pressable);

  // ---- Add the named row (no typed name), hold through a poll ----------------
  await page.click('#scan-list .fr-scanrow[data-found-dir$="site-monitor"] .fr-foundgo');
  await page.waitForTimeout(400);
  const added = await page.evaluate(() => {
    const row = document.querySelector('#scan-list .fr-scanrow[data-found-dir$="site-monitor"]');
    return {
      label: row.querySelector('.fr-foundgo').textContent.trim(),
      undoShown: !row.querySelector('.fr-foundundo').hidden,
    };
  });
  check('Add on a named scan row works', added.label === 'Added' && added.undoShown,
    `"${added.label}" undo=${added.undoShown}`);

  /* 🛑 THE POLL MUST NOT EAT IT. The board repaints every five seconds; a panel that
     rebuilt itself would throw away the "Added" and the Undo on the screen. */
  await page.waitForTimeout(6500);
  const survived = await page.evaluate(() => {
    const row = document.querySelector('#scan-list .fr-scanrow[data-found-dir$="site-monitor"]');
    if (!row) return { label: '(the panel went away)', undo: false };
    return { label: row.querySelector('.fr-foundgo').textContent.trim(), undo: !row.querySelector('.fr-foundundo').hidden };
  });
  check('the press survives a board poll', survived.label === 'Added', `"${survived.label}"`);
  check('so does the undo it offered', survived.undo === true);

  // ---- the nameless row demands a name, then Skip removes it -----------------
  await page.click('#scan-list .fr-scanrow[data-found-dir$="nameless-one"] .fr-foundgo');
  await page.waitForTimeout(300);
  const demanded = await page.evaluate(() => {
    const row = document.querySelector('#scan-list .fr-scanrow[data-found-dir$="nameless-one"]');
    return (row.querySelector('.fr-foundsaid') || {}).textContent || '';
  });
  check('adding a nameless folder with no name asks for one', /name/i.test(demanded), `"${demanded}"`);

  await page.click('#scan-list .fr-scanrow[data-found-dir$="nameless-one"] .fr-adoptno');
  await page.waitForTimeout(400);
  const skipped = await page.evaluate(() => {
    const row = document.querySelector('#scan-list .fr-scanrow[data-found-dir$="nameless-one"]');
    return { declined: Boolean(row && row.classList.contains('declined')), undoBtn: Boolean(row && row.querySelector('.fr-adoptundo')) };
  });
  check('Skip declines the folder and offers an undo', skipped.declined && skipped.undoBtn,
    `declined=${skipped.declined} undo=${skipped.undoBtn}`);

  /* #2025: the panel must NOT follow the person off the Agents tab. It was hidden
     on the way off found-wrap but not scan-wrap, and the 5s poll is gated to the
     Agents tab, so once shown scan-wrap stayed on Projects and every Settings page
     ("it appears everywhere", Josh 2026-09-03). This is the tab-SWITCH handler, so
     it must read hidden immediately -- well under the 5s poll, or the check would
     be measuring the poll instead of the fix. FAIL against origin/main. */
  await page.click('[data-tab="settings"]');
  await page.waitForTimeout(300);
  const offtab = await page.evaluate(() => {
    const wrap = document.getElementById('scan-wrap');
    const bar = document.getElementById('boardbar');
    return { hidden: wrap ? wrap.hidden : true, onAgentsTab: bar ? !bar.hidden : null };
  });
  check('the scan panel hides when you leave the Agents tab',
    offtab.hidden === true && offtab.onAgentsTab === false,
    `hidden=${offtab.hidden} onAgentsTab=${offtab.onAgentsTab}`);

  check('no page errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
