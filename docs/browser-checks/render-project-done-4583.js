/* #4583 (#4580 items 3 and 4): the create form asks what done looks like, the projects list says "Done not set"
 * for a project whose brief does not say it, and a second coordinator added to a project is warned about in the
 * project notice until it no longer holds or the person dismisses it.
 *
 * Drives the SHIPPED page against a real server (sandboxed roots):
 *  0. On the form: the label's words and the box's aria-label are both "What does done look like?", and the hint
 *     is shown and names neither "Done not set" nor a length.
 *  1. Create with done left blank: the POST carries no `done` key; the row shows "Done not set".
 *  2. Create with done typed: the POST carries it; the row shows no badge (control for 1).
 *  3. Coordinators (the page's own rules; the server's are in server.projects.test.js): the add answer and the
 *     project read are stubbed. A project read that says two coordinators shows NOTHING until an add brought it on
 *     (a warning at add time, not a standing nag); after the add it shows; Dismiss removes it; and a read that no
 *     longer has two coordinators drops it by itself.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-project-done-4583.js
 *      (HEADED=0 on a machine with no console session)
 * Sandboxed roots; kills only what it starts.
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..', '..');
const freePort = () => Number(execFileSync(process.execPath, ['-e', "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"], { encoding: 'utf8' }));
const PORT = freePort();
const WARN = 'Ada and Bo both have a coordinating role on this project. So they do not split the work by hand, decide who owns what now: one owns the brief (BRIEF.md) and the other owns the task queue.';

let passed = 0;
const failed = [];
const ok = (label, cond, detail) => { if (cond) { passed += 1; console.log('PASS  ' + label); } else { failed.push(label); console.log('FAIL  ' + label + (detail ? '  --  ' + String(detail).slice(0, 300) : '')); } };

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'pjdone-' + k.toLowerCase() + '-'));
  const srv = spawn('node', ['server.js'], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT), AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_DATA: roots.DATA, AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH, AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh') },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1200));
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  const posted = [];
  p.on('request', (r) => { if (r.method() === 'POST' && /\/api\/projects$/.test(r.url())) posted.push(JSON.parse(r.postData() || '{}')); });
  try {
    await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');

    const create = async (name, done) => {
      await p.click('[data-tab="projects"]');
      await p.click('#pj-new');
      await p.waitForSelector('#pj-add-view', { state: 'visible', timeout: 5000 });
      await p.fill('#pj-name', name);
      await p.fill('#pj-add-desc', 'What it is for.');
      ok(name + ': the done box is on the form and empty', (await p.inputValue('#pj-add-done')) === '');
      // #4583 follow-up: the rendered label, the box's accessible name and the hint, as a person and a screen reader get them.
      const said = await p.evaluate(() => {
        const box = document.getElementById('pj-add-done');
        const field = box.closest('.field');
        const lab = field && field.querySelector('.flabel');
        const hint = document.getElementById('pj-add-done-hint');
        return { label: lab ? lab.textContent.trim() : null, aria: box.getAttribute('aria-label'), hint: hint ? hint.textContent.trim() : null, hintShown: !!(hint && hint.offsetParent) };
      });
      ok(name + ': the done box asks "What does done look like?", on the page and to a screen reader',
        said.label === 'What does done look like?' && said.aria === said.label, JSON.stringify(said));
      ok(name + ': the done hint is shown and names neither the row tag nor a length',
        said.hintShown && /^Optional\./.test(said.hint || '') && !/Done not set|\bchar/i.test(said.hint || ''), JSON.stringify(said));
      if (done) await p.fill('#pj-add-done', done);
      await p.click('#pj-create');
      await p.waitForSelector('#pj-add-view', { state: 'hidden', timeout: 10000 });
    };
    const rowBadge = (name) => p.evaluate((n) => {
      const card = [...document.querySelectorAll('#pj-list .pc, #pj-list [data-pj], #pj-list > *')].find((el) => (el.textContent || '').includes(n));
      return card ? { found: true, badge: !!card.querySelector('.pj-doneunset'), text: (card.querySelector('.pj-doneunset') || {}).textContent || '' } : { found: false };
    }, name);

    await create('Blank Done Project', '');
    ok('blank: the create POST carries no done key', posted.length === 1 && !('done' in posted[0]), JSON.stringify(posted[0]));
    await create('Given Done Project', 'The lease is signed.');
    ok('given: the create POST carries the typed done', posted.length === 2 && posted[1].done === 'The lease is signed.', JSON.stringify(posted[1]));

    // Review round 4: a done that is too long is caught AT its box before any request; a done the engine refuses
    // is shown at the box too.
    const before = posted.length;
    await p.click('[data-tab="projects"]');
    await p.click('#pj-new');
    await p.waitForSelector('#pj-add-view', { state: 'visible', timeout: 5000 });
    await p.fill('#pj-name', 'Too Long Done');
    await p.fill('#pj-add-done', 'x'.repeat(1001));
    await p.click('#pj-create');
    await p.waitForTimeout(300);
    const longErr = await p.evaluate(() => ({ err: document.getElementById('pj-add-done-err').textContent, focus: document.activeElement && document.activeElement.id, open: !document.getElementById('pj-add-view').hidden }));
    ok('too long: said at the done box, focused, form still open, nothing sent', /longer than 1000/.test(longErr.err) && longErr.focus === 'pj-add-done' && longErr.open && posted.length === before, JSON.stringify(longErr));
    await p.route('**/api/projects', (route) => (route.request().method() === 'POST'
      ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'what done looks like has to be words' }) })
      : route.continue()));
    await p.fill('#pj-add-done', 'Short.');
    await p.click('#pj-create');
    await p.waitForTimeout(400);
    const refused = await p.evaluate(() => document.getElementById('pj-add-done-err').textContent);
    ok('refused by the engine: the reason is at the done box', refused === 'What done looks like has to be words.', refused);
    // Review round 5: a folder refusal quoting a project NAMED like the done box is not sent to the done box.
    await p.unroute('**/api/projects');
    await p.route('**/api/projects', (route) => (route.request().method() === 'POST'
      ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'that folder is already the project "What done looks like for Q4"' }) })
      : route.continue()));
    await p.click('#pj-create');
    await p.waitForTimeout(400);
    const other = await p.evaluate(() => ({ done: document.getElementById('pj-add-done-err').textContent, msg: document.getElementById('pj-add-msg').textContent }));
    ok('a folder refusal naming a "done looks like" project stays off the done box', other.done === '' && /What done looks like for Q4/.test(other.msg), JSON.stringify(other));
    await p.unroute('**/api/projects');
    await p.evaluate(() => { document.getElementById('pj-add-view').hidden = true; });

    await p.evaluate(() => loadProjects());
    await p.evaluate(() => pjView('list'));
    const blank = await rowBadge('Blank Done Project');
    const given = await rowBadge('Given Done Project');
    ok('blank: its row shows Done not set', blank.found && blank.badge && blank.text === 'Done not set', JSON.stringify(blank));
    ok('given: its row shows no badge (control)', given.found && !given.badge, JSON.stringify(given));

    // #5070: in the Roadmap, a row whose cells right of the name are all taken (an agent count AND a status pill) pushed
    // "Done not set" into a new row's first track, where a grid item stretches: 1042 px of a 1232 px row on main,
    // measured. It now has its own track on the row's one line, just before the count: the same size on every row,
    // always immediately left of the right-hand cluster (its x moves with how many of count and status a row has, by
    // design), and the row stays one line. The count and the status are added to the row the page drew (the markup
    // projectCard writes for them), measured at once, then REMOVED (a repaint would not: setLive skips identical
    // data). Desktop and phone; the injected cells must sit on the name's line, or the arm would test nothing.
    const layoutBefore = await p.evaluate(() => (document.getElementById('pj-list').classList.contains('asgrid') ? 'grid' : 'roadmap'));
    await p.evaluate(() => layoutApply('projects', 'roadmap'));
    // 660 is the tightest desktop case (the narrowest width that still keeps the tag on the name's line).
    for (const vw of [1400, 660, 390]) {
      await p.setViewportSize({ width: vw, height: 900 });
      await p.waitForTimeout(200);
      const m = await p.evaluate(() => {
        const row = [...document.querySelectorAll('#pj-list .pj-row')].find((r) => (r.textContent || '').includes('Blank Done Project'));
        const tag = row && row.querySelector('.pj-doneunset');
        if (!tag) return { found: false };
        const name = row.querySelector('.pjname');
        const box = (el) => { const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), mid: Math.round(b.top + b.height / 2) }; };
        const plain = { tag: box(tag), name: box(name), rowH: Math.round(row.getBoundingClientRect().height) };
        const head = row.querySelector('.pjcard-h') || row;
        const added = [];
        if (!row.querySelector('.pjfaces')) { const f = document.createElement('span'); f.className = 'pjfaces'; f.innerHTML = '<span class="pjcount">3 agents</span>'; head.appendChild(f); added.push(f); }
        // The pill as pjPillOf draws Working: its three-dot glyph, then the label (round 2: without the glyph it was ~20 px narrow).
        if (!row.querySelector('.pjpill')) { const s = document.createElement('span'); s.className = 'pjpill'; s.innerHTML = '<span class="act" aria-hidden="true"><i></i><i></i><i></i></span>Working'; head.appendChild(s); added.push(s); }
        const full = { tag: box(tag), name: box(name), faces: box(row.querySelector('.pjfaces')), pill: box(row.querySelector('.pjpill')), rowH: Math.round(row.getBoundingClientRect().height) };
        // Round 3: an orphan row's ancestry chip (projectCard's markup) must not ride onto the name's line through the
        // empty tag track and squeeze the name.
        const chip = document.createElement('span'); chip.className = 'pj-parent pj-anc';
        chip.innerHTML = '<span class="pj-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="pj-anc-t"><span class="vh">In </span>Kosmos<span class="pj-anc-sep" aria-hidden="true"> › </span>Mobile apps and the website</span>';
        row.appendChild(chip); added.push(chip);
        const withChip = { chip: box(chip), name: box(name) };
        // And on a row with NO "Done not set" (the empty track is there on every row): the common orphan case.
        const other = [...document.querySelectorAll('#pj-list .pj-row')].find((r) => (r.textContent || '').includes('Given Done Project'));
        let noTag = null;
        let nAdded = added.length;
        if (other && !other.querySelector('.pj-doneunset')) {
          const oh = other.querySelector('.pjcard-h') || other;
          const f2 = document.createElement('span'); f2.className = 'pjfaces'; f2.innerHTML = '<span class="pjcount">3 agents</span>'; oh.appendChild(f2); added.push(f2);
          const c2 = chip.cloneNode(true); other.appendChild(c2); added.push(c2);
          noTag = { chip: box(c2), name: box(other.querySelector('.pjname')), faces: box(f2) };
          nAdded = added.length;
          // Review of the gap fix: a status-only row (no count, no tag) lost the most room to empty tracks; measure it too.
          // The injected-cell count (5) is taken above, before this step, so it means the same whatever this step adds.
          // A fixture row that already has a status is measured as it is (the page's own pill), never left unmeasured.
          f2.remove();
          let p2 = other.querySelector('.pjpill');
          if (!p2) { p2 = document.createElement('span'); p2.className = 'pjpill'; p2.innerHTML = '<span class="act" aria-hidden="true"><i></i><i></i><i></i></span>Working'; oh.appendChild(p2); added.push(p2); }
          noTag.pillOnly = { name: box(other.querySelector('.pjname')), pill: box(p2) };
        }
        const phone = window.matchMedia('(max-width: 40rem)').matches;
        for (const el of added) el.remove();
        return { found: true, roadmap: document.body.classList.contains('pj-roadmap'), added: nAdded, plain, full, withChip, noTag, phone };
      });
      const onLine = (x) => Math.abs(x.mid - m.full.name.mid) <= 3;
      // Both widths: the injected cells are on the name's line (else the arm tests nothing), the tag keeps its size, and
      // the NAME keeps room to be read (round 2: on a phone the right-hand tracks could squeeze it to nothing).
      // The page's own breakpoint must agree with the widths this arm means as phone and desktop.
      const common = m.found && m.roadmap && m.added === 5 && m.phone === (vw === 390) && onLine(m.full.faces) && onLine(m.full.pill)
        && m.full.tag.w === m.plain.tag.w && m.full.tag.w < 200 && m.full.name.w >= 60;
      // Desktop: on the name's line, directly left of the count (one 12 px gap), the row still one line.
      // Phone: under the name, at the name's left edge.
      const placed = !m.phone
        ? onLine(m.full.tag) && Math.abs((m.full.faces.l - m.full.tag.r) - 12) <= 1 && m.full.rowH === m.plain.rowH
        : Math.abs(m.full.tag.l - m.full.name.l) <= 2 && m.full.tag.mid > m.full.name.mid + 8;
      ok(`#5070 roadmap @${vw}: with an agent count and a status, "Done not set" keeps its size and its place, and the name keeps room`,
        common && placed, JSON.stringify(m));
      // On a tag row the four tracks are full on a desktop, so this one bites at 390; the no-tag arm below covers the desktop.
      ok(`#5070 roadmap @${vw}: an orphan row's ancestry chip stays off the name's line and the name keeps room`,
        m.found && m.withChip.chip.mid > m.withChip.name.mid + 8 && m.withChip.name.w >= 60, JSON.stringify(m.withChip));
      ok(`#5070 roadmap @${vw}: on a row with no "Done not set", the orphan chip stays off the name's line too`,
        m.found && m.noTag && m.noTag.chip.mid > m.noTag.name.mid + 8 && m.noTag.name.w >= 60, JSON.stringify(m.noTag));
      // Baron's review of #5105: an EMPTY tag track must cost the name nothing. With a column-gap it cost one more gap
      // (12 px) on every row without the tag, and on every phone row (the tag moves under the name there). The name's
      // track ends exactly one 12 px space before the count: on a row with no tag, and on the tag row on a phone.
      const oneGap = (a, b) => Math.abs((b.l - a.r) - 12) <= 1;
      ok(`#5070 roadmap @${vw}: an empty "Done not set" track costs the name no room (one 12 px space before the first item on the right, and between count and status)`,
        m.found && m.noTag && Math.abs(m.noTag.faces.mid - m.noTag.name.mid) <= 3 && oneGap(m.noTag.name, m.noTag.faces)
          && m.noTag.pillOnly && Math.abs(m.noTag.pillOnly.pill.mid - m.noTag.pillOnly.name.mid) <= 3 && oneGap(m.noTag.pillOnly.name, m.noTag.pillOnly.pill)
          && oneGap(m.full.faces, m.full.pill) && (!m.phone || oneGap(m.full.name, m.full.faces)),
        JSON.stringify({ noTag: m.noTag, full: m.full, phone: m.phone }));
    }
    await p.setViewportSize({ width: 1400, height: 900 });
    await p.evaluate((l) => layoutApply('projects', l), layoutBefore);

    // ---- coordinators (page rules; the add answer and the read are stubbed) ----
    const id = await p.evaluate(() => (PROJECTS.find((x) => x.name === 'Given Done Project') || {}).id);
    let readSaysTwo = true;
    await p.route('**/api/projects', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const res = await route.fetch();
      const body = await res.json();
      for (const pr of body.projects || []) if (pr.id === id) pr.coordinators = readSaysTwo ? WARN : null;
      return route.fulfill({ response: res, json: body });
    });
    await p.route('**/api/project/*/agent/*', (route) => route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ project: null, told: { state: 'not_tried' }, said: null, coordinators: WARN }) }));
    await p.evaluate((pid) => openProject(pid), id);
    await p.evaluate(() => loadProjects());
    await p.waitForTimeout(300);
    const notice = () => p.evaluate(() => (document.getElementById('pj-one-notice').textContent || ''));
    ok('coordinators: a read that says two shows nothing before an add brought it on', !/coordinator/i.test(await notice()), await notice());
    await p.evaluate(() => addMemberToProject('pm-y', document.getElementById('pj-one-msg')));
    await p.evaluate(() => loadProjects());
    await p.waitForTimeout(300);
    ok('coordinators: after the add the warning is in the project notice', (await notice()).includes('Two coordinators on this project') && (await notice()).includes('owns the task queue'), await notice());
    await p.click('#pj-one-notice [data-pn-coord-dismiss]');
    await p.waitForTimeout(200);
    ok('coordinators: Dismiss removes it', !/coordinator/i.test(await notice()), await notice());
    await p.evaluate(() => addMemberToProject('pm-y', document.getElementById('pj-one-msg')));
    readSaysTwo = false;
    await p.evaluate(() => loadProjects());
    await p.waitForTimeout(300);
    ok('coordinators: a read with no longer two coordinators drops it by itself', !/coordinator/i.test(await notice()), await notice());
    readSaysTwo = true;
    await p.evaluate(() => loadProjects());
    await p.waitForTimeout(300);
    ok('coordinators: once dropped, it does not come back without a new add', !/coordinator/i.test(await notice()), await notice());
    // Review round 2: a repaint on the read from BEFORE the add (coordinators still null) must not clear the warning
    // before it was ever shown; the next read, which knows about the add, shows it.
    readSaysTwo = false;
    await p.evaluate(() => loadProjects());
    await p.evaluate(() => addMemberToProject('pm-y', document.getElementById('pj-one-msg')));
    await p.evaluate(() => paintOneProject());   // the stale read: coordinators null
    readSaysTwo = true;
    await p.evaluate(() => loadProjects());
    await p.waitForTimeout(300);
    ok('coordinators: a stale repaint between the add and the next read does not swallow the warning', (await notice()).includes('Two coordinators on this project'), await notice());
    await p.unroute('**/api/projects');
    await p.unroute('**/api/project/*/agent/*');

    ok('no page errors', errs.length === 0, errs.join(' | '));
  } finally {
    await b.close();
    srv.kill();
  }
  console.log(failed.length ? passed + ' passed, ' + failed.length + ' FAILED' : 'all project-done checks passed (' + passed + ')');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
