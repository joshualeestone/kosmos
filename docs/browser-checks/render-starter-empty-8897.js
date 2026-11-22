/**
 * kosmos#8897: a project's empty Tasks column says when it is the starter project Kosmos made, so nobody reads its
 * empty list as work its agents should invent. It stops saying so the moment work arrives, or the person renames it
 * (then it is theirs). CONTROL: a real empty project keeps its own sentence.
 *
 * The page's own paintProjectTasks, from web/index.html loaded as a file (no board): a project as /api/projects sends
 * it, with `starter: true` only on the seeded one (engine/projects.js describe, proven by engine/starter-page-8897.test.js).
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-starter-empty-8897.js
 *
 * HEADED by default, like the other checks here; HEADED=0 on a machine with no console session.
 */
const nodePath = require('node:path');
let pw;
try { pw = require('playwright'); }
catch { console.log('render-starter-empty-8897: playwright is not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const STARTER = 'This is the starter project Kosmos made to show you around. Its agents are waiting for you: give them a task here, or start your own project.';
const STARTER_ALONE = 'This is the starter project Kosmos made to show you around. Add an agent to it, or start your own project.';
const PLAIN = 'Add a task, or have an agent add one, to start tracking progress.';
const DONE_ONLY = 'Nothing open here. The finished ones are behind View All.';
const fails = [];
const say = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fails.push(label); };

(async () => {
  const headless = process.env.HEADED === '0';
  for (const engine of ['chromium', 'webkit']) {
    const browser = await pw[engine].launch({ headless });
    for (const width of [1100, 390]) {
      const tag = `[${engine} ${width}]`;
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      /* A file page has no board: WebKit refuses the page's own background fetches to file:// (the board's API), which
         is the harness, not this change. Every other page error counts. */
      page.on('pageerror', (e) => { const m = String(e); if (!/Fetch API cannot load file:/.test(m)) errors.push(m); });
      await page.goto('file://' + PAGE);
      const r = await page.evaluate(({ open, closed }) => {
        const text = () => { const l = document.getElementById('pj-tasklist'); return l ? l.textContent.trim() : null; };
        const out = {};
        const starter = { id: 'p-welcome', name: 'Welcome', tasks: [], starter: true, agents: ['ada'] };
        /* Review 1: seeded before any agent exists, it has none to be waiting. */
        paintProjectTasks({ ...starter, agents: [] }); out.alone = text();
        paintProjectTasks(starter); out.starterEmpty = text();
        out.marked = !!document.querySelector('#pj-tasklist [data-starter-empty]');
        /* Renamed by the person on the same page, no switch between: its own now (the repaint guard must see it). */
        paintProjectTasks({ ...starter, name: 'Q4 launch', starter: undefined }); out.renamed = text();
        paintProjectTasks(starter); out.backToStarter = text();
        /* Work arrives: one open task. */
        paintProjectTasks({ ...starter, tasks: [open] }); out.withTask = text();
        /* Only finished work: the done-only sentence, not the starter one. */
        paintProjectTasks({ ...starter, tasks: [closed] }); out.doneOnly = text();
        /* CONTROL: a real empty project. */
        if (typeof TK_LIST_HTML !== 'undefined') TK_LIST_HTML = null;   // the page resets the guard when it switches projects
        paintProjectTasks({ id: 'p-real', name: 'Real', tasks: [] }); out.realEmpty = text();
        return out;
      }, {
        open: { id: 't1', number: 1, sentence: 'Write the launch note', who: null, parts: [{ id: 'a', who: null }], progress: { assigned: 0, closed: 0, total: 1 } },
        closed: { id: 't2', number: 2, sentence: 'Old thing', who: 'x', closedAt: '2026-11-20T00:00:00Z', parts: [{ id: 'a', who: 'x', closedAt: '2026-11-20T00:00:00Z' }], progress: { assigned: 1, closed: 1, total: 1 } },
      });
      say(r.starterEmpty === STARTER && r.marked, tag + ' the starter project\'s empty list says what it is', JSON.stringify(r.starterEmpty));
      say(r.alone === STARTER_ALONE, tag + ' with no agent yet, it says to add one, never that its agents wait (review 1)', JSON.stringify(r.alone));
      say(r.renamed === PLAIN, tag + ' renamed by the person (no project switch between), it reads as any empty project', JSON.stringify(r.renamed));
      say(r.backToStarter === STARTER, tag + ' and back, the starter sentence again (the guard follows the sentence)', JSON.stringify(r.backToStarter));
      say(typeof r.withTask === 'string' && r.withTask.includes('Write the launch note') && !r.withTask.includes('starter project'), tag + ' once work arrives, the task shows and the starter sentence goes', JSON.stringify(r.withTask));
      say(r.doneOnly === DONE_ONLY, tag + ' with only finished work, the done-only sentence, not the starter one', JSON.stringify(r.doneOnly));
      say(r.realEmpty === PLAIN, tag + ' CONTROL: a real empty project keeps its own sentence', JSON.stringify(r.realEmpty));
      say(errors.length === 0, tag + ' no page errors', errors.slice(0, 2).join(' | '));
      await page.close();
    }
    await browser.close();
  }
  console.log(fails.length ? 'FAILED' : 'all good');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
