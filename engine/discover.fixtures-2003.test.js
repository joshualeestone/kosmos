'use strict';
/**
 * kosmos#2003 - the discovery test-fixture set, self-verifying.
 *
 * Josh wanted "a variety of test agent markdown files that indicate things in
 * different ways", scattered by hand, "to see if Kosmos is able to pick them up
 * automatically". The whole value of the set is that EVERY fixture ships with its
 * expected outcome: without it, "Kosmos did not pick it up" cannot be told apart
 * from "Kosmos correctly ignored it".
 *
 * This test reads the SAME files a person scatters (test-support/discovery-fixtures/
 * - no second copy of the content) and runs them through the real discover.found()
 * and discover.scan(), asserting the measured outcome for each shape. So the
 * README table cannot rot silently: if discovery changes and a shape's behaviour
 * flips, this reds and names which shape.
 *
 * 🔑 THE LOAD-BEARING ASSERTION is the negative control (#7): a discovery that
 * offered every file indiscriminately would pass every other row here. #7 failing
 * to be ignored is the one that catches over-eagerness.
 *
 * 🛑 FRESH files only. #1 (the Kosmos-created / #1938 Lil-Nacho shape), #5 (the
 * #1493 hand-written lowercase-name case, named `pip` on purpose, not `lilnacho`),
 * and #6 (the Casey second-profile shape) are synthetic stand-ins - never the
 * preserved REAL files on Casey's machine (the live #1938 evidence).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FIX = path.join(__dirname, '..', 'test-support', 'discovery-fixtures');
const read = (name) => fs.readFileSync(path.join(FIX, name), 'utf8');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fixtures-2003-'));
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, 'claude');
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
const CONFIG = process.env.AGENT_WORKFORCE_CONFIG_ROOT;
const DISK = path.join(SB, 'disk');
fs.mkdirSync(path.join(CONFIG, 'projects'), { recursive: true });
fs.mkdirSync(DISK, { recursive: true });

const discover = require('./discover');

/* Place a fixture folder; `as` is the instruction filename (CLAUDE.md/AGENTS.md),
   `content` its text (null = no instruction file), `record` gives it a Claude
   session so found() reaches it (omit for the scan-only population). */
function place(name, { as = 'CLAUDE.md', content, record } = {}) {
  const dir = path.join(DISK, name);
  fs.mkdirSync(dir, { recursive: true });
  if (content != null) fs.writeFileSync(path.join(dir, as), content);
  if (record) {
    const key = name.replace(/[^A-Za-z0-9]/g, '-');
    const proj = path.join(CONFIG, 'projects', key);
    fs.mkdirSync(proj, { recursive: true });
    fs.writeFileSync(path.join(proj, `${key}-sess.jsonl`),
      JSON.stringify({ type: 'summary', cwd: dir }) + '\n' +
      JSON.stringify({ cwd: dir, timestamp: new Date().toISOString() }) + '\n');
  }
  return dir;
}

place('1-kosmos-created', { record: true, content: read('1-kosmos-created.md') });
place('2-current', { record: true, content: read('2-current-agent.md') });
place('3-no-file', { record: true, content: null });
place('4-codex', { record: true, as: 'AGENTS.md', content: read('4-codex-AGENTS.md') });
place('5-handwritten-lowercase', { record: true, content: read('5-handwritten-lowercase.md') });
place('6-second-profile', { content: read('6-second-profile-agent.md') }); // no record -> scan-only
place('7-not-an-agent', { record: true, content: read('7-not-an-agent.md') });
place('7b-you-are-an-expert', { record: true, content: read('7b-you-are-an-expert.md') });

const found = discover.found();
const named = new Map((found.agents || []).map((a) => [path.basename(a.dir || a.cwd || ''), a]));
const adoptable = new Set((found.adoptable || []).map((d) => path.basename((d && d.dir) || String(d))));
const scanned = new Set(((discover.scan({ roots: [{ dir: DISK, maxDepth: 6 }] }) || {}).candidates || [])
  .map((c) => path.basename(c.dir || String(c))));

test.after(() => { try { fs.rmSync(SB, { recursive: true, force: true }); } catch { /* best-effort */ } });

test('#2 the positive control is found BY NAME (if not, discovery is broken)', () => {
  assert.ok(named.has('2-current'), 'the current-format agent must be a named agent');
  assert.equal(named.get('2-current').name, 'Fixture Nova');
});

test('#1 a Kosmos-created file is found by name; re-offer is runtime-roster-dependent', () => {
  // found() lists it (it has a bold name); the kosmos:* markers do NOT suppress it.
  // `already` reflects the runtime roster (alreadyIn) - false here (no running pane),
  // so a scattered Kosmos file whose agent is not running WOULD be re-offered.
  assert.ok(named.has('1-kosmos-created'), 'a Kosmos-created file is still listed by name');
  assert.equal(named.get('1-kosmos-created').already, false,
    'with no running pane, already=false - the finding: re-adopt suppression rides the roster, not the markers');
});

test('#3 no-file and #5 lowercase-name are ADOPTABLE (offered, empty name)', () => {
  assert.ok(adoptable.has('3-no-file'), 'a folder with no CLAUDE.md is adoptable (#1531)');
  assert.ok(adoptable.has('5-handwritten-lowercase'), '"You are pip" is adoptable with an empty name (#1493)');
  // Neither becomes a NAMED agent (never a guessed name).
  assert.ok(!named.has('5-handwritten-lowercase'), 'a lowercase name is never guessed into a named agent');
});

test('#4 an AGENTS.md agent name IS readable via the Codex identity path', () => {
  // The real Codex path (codexIdentity/foundCodex, discover.js:230-236) reads
  // <cwd>/AGENTS.md through identityFromText, so the name IS read by the product.
  const status = require('./status');
  const id = status.identityFromText(read('4-codex-AGENTS.md'));
  assert.ok(id && id.displayName === 'Fixture Codex',
    'the AGENTS.md name is readable - do NOT report it as "not read"');
  // In THIS hermetic sandbox, found() sees no CLAUDE.md (so it offers the folder
  // empty-name) and foundCodex short-circuits (no ~/.codex rollout; DATA under tmp),
  // so the full foundCodex enumeration is not exercised here - the name-READABILITY
  // above is what this shape asserts, not a claim that discovery cannot read it.
  assert.ok(adoptable.has('4-codex'), 'via found() (no CLAUDE.md) the folder is offered empty-name');
});

test('#6 a folder Claude never recorded is found by SCAN only (#1938)', () => {
  assert.ok(scanned.has('6-second-profile'), 'the scan reaches a CLAUDE.md with no session record');
  assert.ok(!named.has('6-second-profile'), 'found() is blind to it (no record)');
});

test('#7 THE NEGATIVE CONTROL: a doc with no "You are" is IGNORED everywhere', () => {
  // The load-bearing assertion - a discovery that offered everything passes the
  // rest and fails only here.
  assert.ok(!named.has('7-not-an-agent'), 'must not be a named agent');
  assert.ok(!adoptable.has('7-not-an-agent'), 'must not be adoptable');
  assert.ok(!scanned.has('7-not-an-agent'), 'must not be a scan candidate');
});

test('#7b "You are an expert ..." is OFFERED (documented over-eager false-positive)', () => {
  assert.ok(adoptable.has('7b-you-are-an-expert'),
    'a role-not-a-person template is offered because it opens with "You are" - documented, not desired');
});
