'use strict';
/**
 * kosmos#2452 (c): a Gemini-format agent file (identity in YAML front-matter, not a
 * "You are <Name>" line) dropped as a LOOSE file OUTSIDE the known gemini home is
 * offered with its front-matter NAME, not an empty name.
 *
 * Josh's 0.6.47 re-test: 3 seed agents "listed as an agent file with no name". Reproduced
 * against the real seed corpus: the three Gemini agents (code-reviewer / project-explainer
 * / sarah), seeded as loose files across Documents/Downloads/a Work folder, were offered
 * with name="". The gemini merge in discover.js (#2410) names Gemini files by front-matter
 * but only reads the KNOWN location (geminisession.agentFiles()); a Gemini file dropped
 * elsewhere is reached by the generic walk -> looseRow, which matched the "You are a
 * helpful assistant ..." body via INTRODUCES but did not parse the front-matter name.
 *
 * Fix: looseRow reads the SAME front-matter identity the merge uses
 * (agentfile.geminiIdentity), ranked below a real "You are <Name>" line and above the #8
 * H1-heading fallback. A non-gemini file yields null there and is unchanged.
 *
 *   node --test engine/discover.gemini-loose-2452.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gemloose-2452-'));
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, 'claude');
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');

const discover = require('./discover');

// A byte-faithful Gemini agent file from the seed corpus: markdown + YAML front-matter.
const GEMINI_SARAH = '---\nname: sarah\ndescription: An email assistant.\n---\nYou are a helpful assistant that helps draft and refine emails.\n';
// A standard "You are <Name>" agent (the positive control shape).
const YOU_ARE_NOVA = 'You are **Nova**, a release manager.\nYou cut and ship releases.\n';
// A file with front-matter that is NOT the Gemini shape (no name field) but a "You are"
// body -- geminiIdentity must return null, so it is unchanged (offered, name from the
// body/heading path, not fabricated from the front-matter).
const NON_GEMINI_FM = '---\ndescription: just some notes\n---\nYou are the deploy helper for the team.\n';

// Place a file as a LOOSE file (not in any .gemini/agents/ dir) under a scannable root.
function loose(dir, rel, body) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  return abs;
}
const impByBase = (r, base) => (r.importable || []).find((c) => path.basename(c.file || '') === base);

test('#2452: a LOOSE Gemini file (front-matter name) is offered WITH its name, not empty', () => {
  const DISK = fs.mkdtempSync(path.join(SB, 'loose-'));
  // No AGENT_WORKFORCE_GEMINI_HOME override + explicit roots => the #2410 gemini merge does
  // NOT run, so this file is found ONLY by the walk/looseRow -- the exact loose-file path.
  const f = loose(DISK, 'Work/gemini-sarah.md', GEMINI_SARAH);
  const r = discover.scan({ roots: [{ dir: DISK, maxDepth: 3 }] });
  const row = impByBase(r, path.basename(f));
  assert.ok(row, 'the loose Gemini agent was not offered at all');
  assert.equal(row.name, 'sarah', 'the loose Gemini agent was offered with the wrong/empty name (the #2452 bug)');
});

test('#2452 CONTROL: a standard "You are <Name>" loose file keeps its name (unchanged)', () => {
  const DISK = fs.mkdtempSync(path.join(SB, 'ctl-nova-'));
  // Neutral folder name: Documents/Downloads/Desktop are in SCAN_SKIP as CHILDREN of a
  // test root (they are import-scan ROOTS on a real machine, not self-skipped) -- using
  // one here would hide the fixture and test the skip list, per the acceptance-1329 note.
  const f = loose(DISK, 'proj/nova.md', YOU_ARE_NOVA);
  const row = impByBase(discover.scan({ roots: [{ dir: DISK, maxDepth: 3 }] }), path.basename(f));
  assert.ok(row, 'the standard agent was not offered');
  assert.equal(row.name, 'Nova', 'a "You are <Name>" line must still win the name');
});

test('#2452 CONTROL: a non-Gemini file with front-matter but no name field does NOT get a fabricated name', () => {
  const DISK = fs.mkdtempSync(path.join(SB, 'ctl-fm-'));
  const f = loose(DISK, 'papers/deploy.md', NON_GEMINI_FM);
  const row = impByBase(discover.scan({ roots: [{ dir: DISK, maxDepth: 3 }] }), path.basename(f));
  assert.ok(row, 'the file was offered (its body introduces an agent)');
  // geminiIdentity returns null for non-Gemini front-matter, so the name is whatever the
  // existing paths yield (a "You are the deploy helper" body has no clean <Name>, and there
  // is no H1) -- crucially NOT a value invented from the front-matter. Assert it is not the
  // description text and not a Gemini-derived name.
  assert.notEqual(row.name, 'just some notes', 'the description was wrongly used as a name');
  assert.ok(!/deploy helper/.test(row.name || ''), 'a body phrase was wrongly promoted to a name');
});

test('#2452: the fix is the front-matter reader, not a filename guess (rename the file, same name)', () => {
  // Proves the name comes from the YAML `name: sarah`, not the basename -- rename the file
  // to something unrelated and the offered name must still be "sarah".
  const DISK = fs.mkdtempSync(path.join(SB, 'rename-'));
  const f = loose(DISK, 'inbox/agent-42.md', GEMINI_SARAH);
  const row = impByBase(discover.scan({ roots: [{ dir: DISK, maxDepth: 3 }] }), path.basename(f));
  assert.ok(row, 'offered');
  assert.equal(row.name, 'sarah', 'the name must come from the front-matter, not the filename');
});
