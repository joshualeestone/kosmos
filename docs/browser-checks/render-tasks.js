/* Drive-through of the tasks column: creating and viewing are both PAGES
 * (#206, then #383) with no trap and Escape inert, the typed draft survives
 * Back, the who chip is the status (Mona Lisa's v1 ruling), the door
 * reveals what the column deliberately hides, and the page's close-note
 * names the agent with the blessed wording.
 *
 * Run with the durable playwright runtime:
 *   NODE_PATH=$HOME/work/pw-runtime/node_modules node \
 *     docs/browser-checks/render-tasks.js
 * Sandboxes every root the server writes to AND the tmux it reads: the
 * spawned server gets fake-tmux with the fixture roster below, so nothing
 * in this check can reach a live pane. It once could: a real session was
 * named as the member and every run typed the membership tell into that
 * agent, because sandboxing the store is not sandboxing delivery. */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
/* Rendered text, not DOM text (#687): `innerText` honours CSS display and
   visibility, and an element with no box has no rendered text at all, so a
   sentence nobody can see reads as '' here and the assertion fails. */
const shown = async (loc) => ((await loc.boundingBox()) ? loc.innerText() : '');

const REPO = path.resolve(__dirname, '..', '..');
/* Screenshots go to SHOT_DIR or a fresh temp dir, never into the repo (#630):
   they differ byte for byte run to run and dirtied the shared checkout under
   every cut. The path is printed at the end so a person can find them. */
const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-shots-'));
/* A free port, asked of the kernel, never a number (#708): the gate got this
   in #633 and the self-booting checks still carried fixed ports, so two agents
   running the same check collided exactly as before. */
const freePort = () => Number(require('node:child_process').execFileSync(process.execPath, ['-e', "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"], { encoding: 'utf8' }));
const PORT = freePort();
/* A FIXTURE member, never a live one (#383 review): this check used to name
   a real session here, and every run typed the membership tell into that
   agent's live pane, because sandboxing the store is not sandboxing
   delivery. The spawned server gets the fake tmux below, so the roster is
   this fixture and a send goes nowhere. */
const MEMBER = 'taskmate';

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) {
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-drive-' + k.toLowerCase() + '-'));
  }
  /* The shared builder, not hand-typed tabs: fleet.line() fills every
     column PANE_COLUMNS declares and throws when the engine grows one,
     which is the discipline the hand-typed form silently loses. */
  fs.writeFileSync(roots.DATA + '/fake-panes',
    require('../../test-support/fleet').line({ session: 'taskmate-discord', claim: 'taskmate', title: '\u2733 idle' }) + '\n');
  fs.writeFileSync(roots.DATA + '/fake-sessions', 'taskmate-discord\n');
  fs.writeFileSync(roots.DATA + '/fake-screen',
    '\u276f \n  \u23f5\u23f5 bypass permissions on (shift+tab to cycle)\n');
  const srv = spawn('node', ['server.js'], {
    cwd: REPO,
    env: {
      ...process.env,
      PORT: String(PORT),
      AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_DATA: roots.DATA,
      AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH,
      AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh'),
      AGENT_WORKFORCE_FAKE_PANES: roots.DATA + '/fake-panes',
      AGENT_WORKFORCE_FAKE_SESSIONS: roots.DATA + '/fake-sessions',
      AGENT_WORKFORCE_FAKE_SCREEN: roots.DATA + '/fake-screen',
    },
    stdio: 'ignore',
  });
  const die = (msg) => { srv.kill(); console.error('FAIL', msg); process.exit(1); };
  await new Promise((r) => setTimeout(r, 1200));

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  try {
    await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');

    // A project with one member, made through the real routes; a second bare
    // project exists to bounce through (the door's reveal resets on a
    // project SWITCH, deliberately not on same-project Back-and-return,
    // which follows the page's own round-31 same-project rule).
    const made = await p.evaluate(async (member) => {
      const r = await fetch('/api/projects', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Task Drive' }),
      });
      const body = await r.json();
      await fetch('/api/project/' + body.project.id + '/agent/' + member, {
        method: 'POST', headers: { 'content-type': 'application/json' },
      });
      await fetch('/api/projects', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Elsewhere' }),
      });
      return body.project.id;
    }, MEMBER);
    if (!made) die('could not create the fixture project');

    // Into the project.
    await p.click('[data-tab="projects"]');
    await p.waitForSelector('#pj-list .pj-row, .pj-item, [data-pj-open]', { timeout: 10000 }).catch(() => { });
    // The list row: click by project name text.
    await p.locator('#pj-list').getByText('Task Drive').first().click();
    await p.waitForSelector('#pj-tasks-field', { state: 'visible', timeout: 10000 });

    // The new-task PAGE (#383): + navigates, nothing pops over the project.
    await p.click('#pj-newtask');
    /* #766: New task is a dialog over the project page again. */
    await p.waitForSelector('#nt-modal', { state: 'visible' });
    if (!(await p.isVisible('#pj-one-view'))) die('the project view left the screen under the new-task dialog');
    const hint = await p.evaluate(() => { const h = document.querySelector('#nt-modal .fhint'); return h.getBoundingClientRect().height > 0 ? h.innerText.trim() : ''; });
    if (hint !== 'You can give it to somebody later.') die('the default-to-nobody hint drifted: ' + hint);
    if (!(await p.locator('#nt-go').isDisabled())) die('Create task is live with no sentence');
    await p.screenshot({ path: path.join(OUT, 'tasks-new-page.png') });

    // A page does not trap and does not dismiss: Escape leaves it standing,
    // and typed words survive Back to the same project.
    await p.keyboard.press('Escape');
    if (await p.isVisible('#nt-modal')) die('Escape did not leave the dialog (#766)');
    await p.click('#pj-newtask');
    await p.waitForSelector('#nt-modal', { state: 'visible' });
    await p.fill('#nt-what', 'held across Back');
    await p.selectOption('#nt-who', MEMBER);
    await p.click('#nt-back');
    await p.waitForSelector('#pj-one-view', { state: 'visible' });
    await p.click('#pj-newtask');
    const held = await p.inputValue('#nt-what');
    if (held !== 'held across Back') die('Back ate the typed draft: "' + held + '"');
    const heldWho = await p.inputValue('#nt-who');
    if (heldWho !== MEMBER) die('Back ate the chosen assignee: "' + heldWho + '"');
    await p.fill('#nt-what', '');
    await p.selectOption('#nt-who', '');

    // Create one task given to the member, one given to nobody.
    await p.fill('#nt-what', 'Rewrite the handoff checklist');
    await p.fill('#nt-detail', 'The old one mentions the removed billing screen.');
    await p.selectOption('#nt-who', MEMBER);
    await p.click('#nt-go');
    await p.waitForSelector('.tkcard', { timeout: 10000 });
    await p.click('#pj-newtask');
    // A clean open (the last create cleared the draft) must NOT resurrect
    // the previous task's assignee: this second task is the unassigned one,
    // and the door assertion below only exists if it stays unassigned.
    const who2 = await p.inputValue('#nt-who');
    if (who2 !== '') die('a clean open resurrected the previous assignee: "' + who2 + '"');
    await p.fill('#nt-what', 'Check it against the live flow');
    await p.click('#nt-go');
    await p.waitForSelector('.tkcard >> nth=1', { timeout: 10000 });

    /* kosmos#1009 INVERTED THIS BLOCK, and the inversion is the fix rather than
       a broken check. The column used to require `assigned > 0`, so the
       unassigned task sat behind the door and this asserted exactly that. On a
       first run EVERY task is unassigned, so a new person met an empty Tasks
       column above a link counting the tasks they had just made. The column is
       headed TASKS and now shows every OPEN task. */
    const cards = await p.locator('.tkcard').count();
    if (cards !== 2) die('the column shows ' + cards + ' cards; both open tasks belong in it now');
    /* 🛑 #1382 INVERTED THIS, the same way #1009 inverted the block above it, and
       for a reason that supersedes rather than contradicts the old assertion.
       WHAT THIS LINE WAS ACTUALLY PROTECTING: Josh's original report was a door
       showing a COUNT that contradicted the column above it. With nothing
       finished there was nothing behind the door, so a door reading "(3)" over
       an empty or complete column stated two different things at once. Hiding
       the door removed the contradiction by removing one of the two numbers.
       WHY IT IS NOT THE RIGHT GUARD ANY MORE: the door no longer opens a
       reveal-in-place of THIS project's hidden rows. It opens a screen spanning
       EVERY project, so it must not be unreachable from a project that happens
       to have nothing hidden, which is the normal state of a new project. And
       it carries NO count at all now, because a per-project number beside a
       global destination could only ever disagree with its own destination.
       ⇒ THE CONTRADICTION IS GONE BY CONSTRUCTION, not by hiding. Two numbers
       cannot disagree if there is one. So this asserts the property Josh's
       report was actually about, which is strictly stronger than the old line:
       the door is REACHABLE, and it carries NO NUMBER to disagree with the
       column. The old assertion could only ever be satisfied by the door being
       absent; this one is satisfied only by the door being present and mute. */
    if (await p.locator('#pj-alltasks').isHidden()) {
      die('the all-tasks door is hidden, so a project with nothing finished cannot reach the every-project screen');
    }
    const doorText = (await shown(p.locator('#pj-alltasks'))).trim();
    if (/\d/.test(doorText)) {
      die('the door carries a number again ("' + doorText + '"), which can disagree with the column above it and with the all-projects screen it opens');
    }
    /* ⚠️ `.nth(0)`, NOT A BARE `.tkcard-who` (#1009). The column used to hold
       ONE card, so a bare locator was unambiguous; now it holds both open
       tasks and the same locator is a strict-mode violation that throws
       before it can assert anything. The assertion two lines up was updated
       for the new count and this one, three lines from it, was not. The
       assigned card is first, which is why the unassigned check below already
       says `.nth(1)`. */
    const chip = (await shown(p.locator('.tkcard').nth(0).locator('.tkcard-who'))).trim();
    if (!chip.includes(MEMBER)) die('the who chip does not name the member: ' + chip);
    await p.screenshot({ path: path.join(OUT, 'tasks-column.png') });

    // The unassigned card is IN the column now, and still says the one allowed
    // state word. No door click needed to reach it.
    const nobody = await shown(p.locator('.tkcard').nth(1).locator('.tkcard-who'));
    if (nobody.trim() !== 'Nobody yet') die('unassigned state word: ' + nobody);

    // THE JOIN: the assignee reports holding "task 1" in the taught
    // spelling; the card grows the pack's says-line and the dialog's note
    // leads with it. Before the report, no card carries the line (claimed
    // false and could-not-read both render nothing).
    if ((await p.locator('.tksay').count()) !== 0) die('a says-line rendered before any report');
    await p.evaluate(async (member) => {
      const r = await fetch('/api/agent/' + member + '/commitments', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ commitments: [{ what: 'On task 1: the handoff checklist rewrite' }] }),
      });
      if (!r.ok) throw new Error('report failed ' + r.status);
    }, MEMBER);
    await p.waitForSelector('.tksay', { timeout: 15000 });
    const say = (await shown(p.locator('.tksay'))).trim();
    if (!/says it is on this/.test(say)) die('says-line text: ' + say);
    if ((await p.locator('.tksay').count()) !== 1) die('the says-line leaked onto unclaimed cards');

    // The view PAGE (#206): meta, the blessed close-note naming the agent.
    await p.locator('.tkcard').first().click();
    await p.waitForSelector('#pj-task-view', { state: 'visible' });
    const note = (await shown(p.locator('#tk-note'))).replace(/\s+/g, ' ').trim();
    if (!note.startsWith(MEMBER + ' says it is on this. Marking it done closes it here. It does not stop ')
        || !note.includes(MEMBER)) die('the joined close-note drifted: ' + note);
    await p.screenshot({ path: path.join(OUT, 'tasks-view-page.png') });

    /* Mark as done, come back, and the done task is BEHIND THE DOOR.
       ⚠️ THIS BLOCK USED TO ASSERT THE OPPOSITE, and it passed for a reason
       that had nothing to do with what it claimed. It said "the reveal is
       still on ... so the done card stays visible, and the door stays hidden
       because everything is showing". MEASURED at this exact step: the reveal
       is OFF (`TK_SHOW_ALL === false`), and it always was. The done card was
       on screen because `joinTaskClaims` returned tasks with no `progress`, so
       the column's filter excluded nothing -- which looks identical to a
       reveal that is on, and is why nobody caught it.
       Now that the payload carries `progress` (kosmos#1009, engine/projects.js)
       the column holds the open task alone and the door reads the full count,
       which is what the block below the project-switch has always asserted.
       This one now agrees with it instead of contradicting it. */
    await p.click('#tk-done');
    /* A page is not dismissed by succeeding (#206's own ruling): it stays,
       repainted; the button flips to Reopen. Back is the navigation. */
    await p.waitForFunction(() => { const b = document.getElementById('tk-done'); return b.getBoundingClientRect().height > 0 && b.innerText.trim() === 'Reopen'; }, null, { timeout: 10000 });
    await p.click('#tk-back');
    await p.waitForSelector('#pj-one-view', { state: 'visible', timeout: 10000 });
    await p.waitForSelector('#pj-alltasks', { state: 'visible', timeout: 10000 });
    if ((await p.locator('.tkcard').count()) !== 1) die('the column should hold the one OPEN task once the other is done');
    if ((await p.locator('.tkcard.closed').count()) !== 0) die('a done task is still sitting in the column');
    const doorDone = (await shown(p.locator('#pj-alltasks'))).trim();
    if (!/View all tasks \(2\)/.test(doorDone)) die('the door does not offer both tasks: ' + doorDone);
    // And with the reveal OFF, the done card is behind the door. The reveal
    // survives same-project Back-and-return by design, so the reset needs a
    // real project SWITCH: bounce through Elsewhere and come back.
    await p.click('#pj-back');
    await p.locator('#pj-list').getByText('Elsewhere').first().click();
    await p.waitForSelector('#pj-tasks-field', { state: 'visible', timeout: 10000 });
    await p.click('#pj-back');
    await p.locator('#pj-list').getByText('Task Drive').first().click();
    await p.waitForSelector('#pj-tasks-field', { state: 'visible', timeout: 10000 });
    /* kosmos#1009: the UNASSIGNED open task now belongs in the fresh column;
       only the DONE one is behind the door. This asserted 0 when unassigned
       tasks were hidden too. */
    if ((await p.locator('.tkcard').count()) !== 1) die('the fresh column should hold exactly the one open task');
    if ((await p.locator('.tkcard.closed').count()) !== 0) die('a done task sits in the fresh column instead of behind the door');
    const doorAfter = (await shown(p.locator('#pj-alltasks'))).trim();
    if (!/View all tasks \(2\)/.test(doorAfter)) die('door after done: ' + doorAfter);
    await p.click('#pj-alltasks');
    const doneCard = p.locator('.tkcard.closed').first();
    if (!(await doneCard.count())) die('the done task is not behind the door');
    await doneCard.click();
    await p.waitForSelector('#pj-task-view', { state: 'visible' });
    if ((await shown(p.locator('#tk-done'))).trim() !== 'Reopen') die('a done task does not offer Reopen');
    if (!(await p.locator('#tk-note').isHidden())) die('the close-note shows on a done task');
    await p.click('#tk-done');
    // An absence wait: DOM text is the stricter read here, hidden text included.
    await p.waitForFunction(() => document.getElementById('tk-done').textContent.trim() !== 'Reopen', null, { timeout: 10000 });

    if (errs.length) die('page errors: ' + errs.join(' | '));
    console.log('TASKS DRIVE OK: creation and view both pages (no trap, Escape inert, draft survives Back), column/door split, chip-is-status, THE JOIN (report -> says-line -> joined note, nothing before the report), done and reopen round trip, fixture tmux only, 0 page errors; shots in ' + OUT);
  } finally {
    await b.close();
    srv.kill();
  }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
