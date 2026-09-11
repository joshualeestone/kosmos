'use strict';

/**
 * #761 item 8 (Josh, 2026-08-24 21:56): "A task shows the assignee's face,
 * and under it the status (not started, waiting on me, there's an issue);
 * 'we could not check' is not a status a person can use. Multiple
 * assignees, as the pack drew."
 *
 * These run the page's real `tkFace`, `taskClaimHtml` and `paintProjectTasks`
 * against a stub DOM. `tkFace` and `taskClaimHtml` are shared with the task
 * DETAIL page (web.task-page.test.js covers that side); this file covers the
 * card LIST, plus the column filter fix underneath it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-tkcard-'));
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-tkcard-data-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-tkcard-workers-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-tkcard-launch-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

function fnSource(name) {
  let start = SCRIPT.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' vanished from the page');
  let depth = 0; let end = -1;
  for (let k = SCRIPT.indexOf('{', start); k < SCRIPT.length; k += 1) {
    if (SCRIPT[k] === '{') depth += 1;
    else if (SCRIPT[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
  }
  assert.ok(end > -1, 'could not find the end of ' + name);
  return SCRIPT.slice(start, end);
}

const fleet = require('./test-support/fleet');
const projects = require('./engine/projects');

let PROJECT = null;
test.before(() => {
  const board = fleet.install([
    fleet.agent('april', { displayName: 'April' }),
    fleet.agent('mikey', { displayName: 'Mikey' }),
  ]);
  try {
    const made = projects.create({ name: 'Task Card Faces' });
    projects.addAgent(made.id, 'april');
    projects.addAgent(made.id, 'mikey');
    PROJECT = projects.describe(projects.readAll().find((x) => x.id === made.id), board.agents);
    assert.equal(PROJECT.agents.length, 2, 'PRE-CONTROL: the fixture project does not carry both members');
    assert.ok(PROJECT.agents.every((a) => 'hasAvatar' in a),
      'PRE-CONTROL: the roster row this page reads does not carry hasAvatar');
    // #2762: and the version that goes with it, or the cache-buster below has
    // nothing to key on and the whole fix is inert.
    assert.ok(PROJECT.agents.every((a) => 'avatarVer' in a),
      'PRE-CONTROL: the roster row this page reads does not carry avatarVer (#2762)');
  } finally { board.restore(); }
});

/** Stub thin enough for innerHTML assertions: one element (#pj-tasklist), one door. */
function stubDoc() {
  const els = {
    'pj-tasklist': { innerHTML: '' },
    'pj-alltasks': { hidden: true, textContent: '' },
  };
  return { els, getElementById: (id) => els[id] || null };
}

function runPaintProjectTasks(project, showAll) {
  const doc = stubDoc();
  const src = [
    'let TK_SHOW_ALL = ' + (showAll ? 'true' : 'false') + ';',
    fnSource('tkFace'), fnSource('taskClaimHtml'), fnSource('tkMemberName'),
    'let TK_LIST_HTML = null;',
    fnSource('paintProjectTasks'),
  ].join('\n');
  new Function('document', 'esc', 'discTint', 'discInk', 'initials', 'encodeURIComponent', 'project',
    src + '\n; paintProjectTasks(project);')(
    doc, (s) => String(s), () => '#dfe5ea', () => '#4a5560',
    (n) => String(n).slice(0, 2).toUpperCase(), encodeURIComponent, project);
  return doc;
}

test('a single-assignee task shows a face and a status underneath the name, not a colored-letter chip', () => {
  const t = {
    number: 1, sentence: 'Write the brief', who: 'april', closedAt: null,
    parts: [{ id: 1, who: 'april', sentence: 'Write the brief', closedAt: null }],
    progress: { done: 0, total: 1, closed: false, assigned: 1 },
    claim: { claimed: true },
  };
  const doc = runPaintProjectTasks({ ...PROJECT, tasks: [t] });
  const html = doc.els['pj-tasklist'].innerHTML;
  assert.doesNotMatch(html, /tkchip/, 'the old colored-letter chip is still being drawn');
  assert.match(html, /class="lav"/, 'no face (.lav) was drawn for the assignee');
  assert.match(html, /<b>April<\/b>/, 'the assignee name is missing or not bold');
  // "and under it the status": name and status live in the same stacked
  // container (.tkcard-who-b), not inline on one line with the name.
  assert.match(html, /<span class="tkcard-who-b"><b>April<\/b><em class="tksay">says it is on this<\/em>/);
});

test('the unknown claim shows the ENGINE\'S REAL REASON, never the generic "we could not check"', () => {
  const t = {
    number: 2, sentence: 'Ship it', who: 'april', closedAt: null,
    parts: [{ id: 1, who: 'april', sentence: 'Ship it', closedAt: null }],
    progress: { done: 0, total: 1, closed: false, assigned: 1 },
    claim: { claimed: null, because: 'it last reported 42 minutes ago, too long to still be true' },
  };
  const doc = runPaintProjectTasks({ ...PROJECT, tasks: [t] });
  const html = doc.els['pj-tasklist'].innerHTML;
  assert.doesNotMatch(html, /we could not check/,
    'Josh, 2026-08-24 21:56: "\'we could not check\' is not a status a person can use" -- still shipping it');
  assert.match(html, /it last reported 42 minutes ago, too long to still be true/,
    'the real, specific because the engine computed did not reach the card');
  // Splinter's read: an objection to the words, not the state -- the third
  // state must still be its own visibly distinct appearance (.tkunk), not
  // silently merged into .tksay (which would read as the agent's own claim).
  assert.match(html, /<em class="tkunk"/, 'the could-not-establish state lost its distinct appearance');
  // Full sentence still reachable (title=), even though the on-screen glyphs
  // are CSS-clamped to one line by .tkcard-who-b .tkunk's overflow rule.
  assert.match(html, /title="it last reported 42 minutes ago, too long to still be true"/);
});

test('a task assigned only through parts, with no legacy top-level who, is not silently dropped from the column', () => {
  // The exact "second t.who gate" mistake engine/projects.js's own comment
  // names: a task created via the parts-first flow carries parts but no
  // top-level `who` at all.
  const t = {
    number: 3, sentence: 'Multi-part, no legacy who', who: undefined, closedAt: null,
    parts: [
      { id: 1, who: 'april', sentence: 'Half one', closedAt: null },
      { id: 2, who: null, sentence: 'Half two', closedAt: null },
    ],
    progress: { done: 0, total: 2, closed: false, assigned: 1 },
    claim: { claimed: true },
  };
  const doc = runPaintProjectTasks({ ...PROJECT, tasks: [t] });
  assert.match(doc.els['pj-tasklist'].innerHTML, /Task 3/,
    'a parts-only-assigned task (no t.who) fell out of the column, the old t.who-only filter\'s bug');
});

test('multiple assignees, as the pack drew: one face+name row per part, including an unassigned one, and an honest N of M count', () => {
  const t = {
    number: 4, sentence: 'Two-person task', who: 'april', closedAt: null,
    parts: [
      { id: 1, who: 'april', sentence: 'Pull the numbers', closedAt: null },
      { id: 2, who: 'mikey', sentence: 'Write it up', closedAt: null },
      { id: 3, who: null, sentence: 'Check it against the live flow', closedAt: null },
    ],
    progress: { done: 0, total: 3, closed: false, assigned: 2 },
    claim: { claimed: true },
  };
  const doc = runPaintProjectTasks({ ...PROJECT, tasks: [t] });
  const html = doc.els['pj-tasklist'].innerHTML;
  assert.match(html, /class="tkcard-parts"/, 'no per-part rows drawn for a multi-part task');
  assert.match(html, /<b>April<\/b>/);
  assert.match(html, /<b>Mikey<\/b>/);
  assert.match(html, /<b>Nobody yet<\/b>/, 'the unassigned third part was dropped instead of shown as its own row');
  // The count comes off t.progress.assigned/total (engine-computed,
  // progressOf), never counted client-side from the parts array.
  assert.match(html, /2 of 3 assigned/);
  // The claim (the TASK's, not a per-part fact) lands on the FIRST assigned
  // part only, the same convention the task detail page's per-part rows use.
  const aprilRowEnd = html.indexOf('Mikey');
  assert.match(html.slice(0, aprilRowEnd), /says it is on this/, 'the claim did not land on the first assigned part');
  assert.doesNotMatch(html.slice(aprilRowEnd), /says it is on this/,
    'the claim was repeated on a second part, as though two reports were made');
});

test('an unassigned single-part task still says Nobody yet, and a closed task shows no claim status', () => {
  const nobody = {
    number: 5, sentence: 'Not picked up', who: null, closedAt: null,
    parts: [{ id: 1, who: null, sentence: 'Not picked up', closedAt: null }],
    progress: { done: 0, total: 1, closed: false, assigned: 0 },
  };
  const closed = {
    number: 6, sentence: 'Finished', who: 'april', closedAt: new Date().toISOString(),
    parts: [{ id: 1, who: 'april', sentence: 'Finished', closedAt: new Date().toISOString() }],
    progress: { done: 1, total: 1, closed: true, assigned: 1 },
  };
  // Both are "behind the door" (nobody: assigned 0; closed: progress.closed
  // true), so they are invisible in the default column; showAll=true renders
  // them the way the door's own "View all tasks" click does.
  const doc = runPaintProjectTasks({ ...PROJECT, tasks: [nobody, closed] }, true);
  const html = doc.els['pj-tasklist'].innerHTML;
  assert.match(html, /tkcard-who-b">Nobody yet</, 'an unassigned task did not say Nobody yet');
  assert.doesNotMatch(html, /says it is|<em class="tk(say|unk)"/,
    'a closed task (no claim computed for it, claimFor returns null once progressOf().closed) drew a claim status anyway');
});


/* ───────────────────────────── #2762 ─────────────────────────────
 * The member-faces list keeps showing the OLD picture after a profile-image
 * update, the same class #2698 fixed on the org chart: `tkFace` rendered a BARE
 * `/api/agent/<name>/avatar`, which is byte-identical before and after the
 * change, so `paintProjectTasks`'s `html !== TK_LIST_HTML` guard skipped the
 * repaint and this <img> was never recreated.
 *
 * 🔑 THE ARM THAT MATTERS COMPARES TWO RENDERS. Asserting a `?v=` appears proves
 * the string is there; it does NOT prove the markup CHANGES when the picture
 * does, and changing is the entire mechanism the repaint guard needs. An
 * implementation that hardcoded `?v=1` would satisfy a presence check and fix
 * nothing.
 *
 * 🛑 TWO WAYS THE FIRST DRAFT OF THESE ARMS WAS WRONG, both caught by running them:
 *   1. `store.saveAvatar` was called AFTER `fleet.install()`. install() runs the
 *      real producers and builds the cards THEN, so the avatar written afterwards
 *      was invisible to them and `hasAvatar` came back false.
 *   2. The two renders used project names containing `Math.random()`, so they
 *      differed because of the NAME. That arm passed while proving nothing about
 *      the avatar, which is the exact vacuity it exists to rule out.
 * Both are why the helper below takes the picture as an input and the project
 * name is FIXED.
 *
 * These drive the real producer chain (store.saveAvatar -> status snapshot ->
 * projects.describe) rather than hand-building a member row, both because the
 * repo forbids hand-built roster rows and because a hand-built row would prove
 * nothing about whether the version reaches the page.
 */
const store = require('./engine/store');

// The 8-byte PNG signature is a real PNG to store.imageTypeOf, which guards each
// format by the length that format actually needs.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const TASK = {
  number: 1, sentence: 'Write the brief', who: 'april', closedAt: null,
  parts: [{ id: 1, who: 'april', sentence: 'Write the brief', closedAt: null }],
  progress: { done: 0, total: 1, closed: false, assigned: 1 },
  claim: { claimed: true },
};

/**
 * Describe a FIXED project, with april's avatar saved BEFORE the board is built.
 * Everything except the avatar's mtime is identical between calls, which is what
 * lets the two-render arm below attribute a difference to the picture.
 */
let FACE_PROJECT_ID = null;
function describeWithAvatar() {
  store.saveAvatar('april', 'image/png', PNG);      // BEFORE install(): install builds the cards
  const board = fleet.install([
    fleet.agent('april', { displayName: 'April' }),
    fleet.agent('mikey', { displayName: 'Mikey' }),
  ]);
  try {
    if (FACE_PROJECT_ID === null) {
      const made = projects.create({ name: 'Member Faces 2762' });
      projects.addAgent(made.id, 'april');
      projects.addAgent(made.id, 'mikey');
      FACE_PROJECT_ID = made.id;
    }
    return projects.describe(projects.readAll().find((x) => x.id === FACE_PROJECT_ID), board.agents);
  } finally { board.restore(); }
}

test('#2762: a member with a picture gets the avatar VERSION in its URL, not a bare one', () => {
  const p = describeWithAvatar();
  const row = p.agents.find((a) => a.sessionName === 'april');
  assert.ok(row && row.hasAvatar === true,
    'the fixture did not give april a picture, so this arm cannot see the defect');
  assert.ok(row.avatarVer > 0,
    'the member row carried no avatar version, so the URL below has nothing to key on (#2762)');

  const html = runPaintProjectTasks({ ...p, tasks: [TASK] }).els['pj-tasklist'].innerHTML;
  assert.match(html, /\/api\/agent\/april\/avatar\?v=\d+/,
    'the member face still renders a BARE avatar URL, so an identical repaint keeps the old picture (#2762)');
  assert.doesNotMatch(html, /\/avatar" alt/,
    'a bare (unversioned) avatar URL is still being emitted in this list');
});

test('#2762 THE MECHANISM: changing the picture CHANGES the markup, which is what defeats the repaint skip', () => {
  const first = describeWithAvatar();
  const verA = first.agents.find((a) => a.sessionName === 'april').avatarVer;
  const htmlA = runPaintProjectTasks({ ...first, tasks: [TASK] }).els['pj-tasklist'].innerHTML;

  /* The version is the avatar file's mtime, so a re-save has to land on a
     different millisecond for this arm to mean anything. Assert that precondition
     rather than assume it: without it, equal HTML could mean "the fix is broken"
     OR "the clock did not move", and those need different answers. */
  let second = null; let verB = verA;
  for (let i = 0; i < 200 && verB === verA; i += 1) {
    second = describeWithAvatar();
    verB = second.agents.find((a) => a.sessionName === 'april').avatarVer;
  }
  assert.notEqual(verB, verA,
    'PRECONDITION: the avatar version did not move between two saves, so this arm cannot tell a changed picture from an unchanged one');

  const htmlB = runPaintProjectTasks({ ...second, tasks: [TASK] }).els['pj-tasklist'].innerHTML;
  assert.notEqual(htmlA, htmlB,
    'the list markup is byte-identical after a picture change, so TK_LIST_HTML skips the repaint and the face stays stale (#2762)');

  /* And the difference must be THE VERSION, not something incidental that
     happened to move between the two renders (the first draft of this arm passed
     because the project NAME differed). Replacing the version in B with A's makes
     the two identical again; if it does not, something else is varying and this
     arm is not measuring what it claims. */
  assert.equal(htmlB.split('?v=' + verB).join('?v=' + verA), htmlA,
    'the two renders differ by something OTHER than the avatar version, so this arm is not attributing the change to the picture');
});

test('#2762 CONTROL: a member with NO picture still draws initials and no <img> at all', () => {
  /* Without this, "always append ?v=" would pass the arms above while turning the
     no-picture case into a broken image. */
  const p = describeWithAvatar();
  const row = p.agents.find((a) => a.sessionName === 'mikey');
  assert.equal(row.hasAvatar, false, 'the fixture gave mikey a picture, so this control proves nothing');
  const t = {
    ...TASK, who: 'mikey',
    parts: [{ id: 1, who: 'mikey', sentence: 'Write the brief', closedAt: null }],
  };
  const html = runPaintProjectTasks({ ...p, tasks: [t] }).els['pj-tasklist'].innerHTML;
  assert.doesNotMatch(html, /mikey\/avatar/, 'an avatar URL was drawn for a member with no picture');
  assert.match(html, /class="lav"[^>]*>MI</, 'the no-picture member lost its initials');
});

test('#2762: a STRANGER holding the name lends neither the picture nor its version', () => {
  /* A stranger's `tmux new -s april` is on the roster and matches by sessionName.
     The row must not carry that agent's photograph, and must not carry its avatar
     VERSION either: a cache-buster keyed on a borrowed picture's mtime is a weaker
     version of the same identity leak.

     🔑 TWO GATES ENFORCE THIS, EITHER ONE SUFFICES, AND THAT IS MEASURED RATHER
     THAN ASSERTED. Deleting only the producer's gate (status.js `tied ? ... : 0`)
     leaves this arm GREEN, and so does deleting only projects.js's own
     `isNamedOurs` gate. Deleting BOTH turns this arm RED. All three measured.

     That matters because "two mechanisms, either suffices" and "one mechanism
     plus dead code wearing a safety comment" look identical from outside, and a
     single-mutation battery cannot tell them apart: whichever gate you remove,
     the other one still holds the property, so both survive and neither looks
     load-bearing. The double mutation is the only experiment that separates the
     two, and here it says both gates are real. (kosmos#2717 is the case where
     that same experiment found the opposite, and the guard was vacuous.)

     The re-gate is kept for the reason the line above it re-gates `hasAvatar`,
     which status.js also already gates: `describe(project, roster, all)` takes
     its roster from the CALLER, so this file re-gates every name-keyed read
     rather than trusting whichever producer supplied the cards. */
  store.saveAvatar('april', 'image/png', PNG);
  const board = fleet.install([
    fleet.stranger('april'),
    fleet.agent('mikey', { displayName: 'Mikey' }),
  ]);
  let p = null;
  try {
    const made = projects.create({ name: 'Stranger Faces 2762' });
    projects.addAgent(made.id, 'april');
    p = projects.describe(projects.readAll().find((x) => x.id === made.id), board.agents);
  } finally { board.restore(); }

  const row = p.agents.find((a) => a.sessionName === 'april');
  assert.ok(row, 'PRE-CONTROL: the stranger row is not on the project at all, so this arm cannot see the leak');
  assert.equal(row.hasAvatar, false, "a stranger's pane lent the row the real agent's photograph");
  assert.equal(row.avatarVer, 0, "a stranger's pane lent the row the real agent's avatar version");

  const html = runPaintProjectTasks({ ...p, tasks: [TASK] }).els['pj-tasklist'].innerHTML;
  assert.doesNotMatch(html, /april\/avatar/,
    "an avatar URL was drawn for a name held by a stranger");
});
