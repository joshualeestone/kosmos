'use strict';

/**
 * The portable agent file (#1652).
 *
 * ⚠️ THE ARMS THAT MATTER ARE THE ABSENCE ONES. Anybody can assert a file
 * contains what they put in it. What this format promises is what it does NOT
 * carry - the per-install identity anchor above all - and an absence is only
 * evidence when the same assertion could have found the thing.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-agentfile-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const agentfile = require('./agentfile');
const store = require('./store');
const instructions = require('./instructions');
const skills = require('./skills');

test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const BODY = '# You are Casey Jones\n\nYou answer one question, and you answer it well.\n';

function makeAgent(name, body = BODY) {
  const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, name);
  fs.mkdirSync(dir, { recursive: true });
  if (body !== null) fs.writeFileSync(path.join(dir, 'CLAUDE.md'), body);
  return dir;
}
const deps = { store, instructions };

test('#1652: an agent exports as one file whose body is the instructions verbatim', () => {
  makeAgent('casey');
  const out = agentfile.exportAgent('casey', deps);
  assert.equal(out.ok, true, out.because);
  assert.equal(out.filename, 'casey.agent.md');
  assert.match(out.text, /^---\n/, 'it opens with a frontmatter block');
  assert.match(out.text, /^kosmos: agent$/m, 'it is self-identifying, so an importer can refuse a random file');
  assert.match(out.text, /^name: casey$/m);
  assert.ok(out.text.endsWith(BODY), 'the instructions are carried VERBATIM, not reflowed');
});

test('#1652 THE SAFETY ARM: the per-install identity anchor does NOT travel', () => {
  /* store.writeProfile mints `id` once and never rewrites it, as an anchor that
     survives renames. If it travelled, two people importing one file would BE
     the same agent. */
  makeAgent('anchored');
  store.writeProfile('anchored', { displayName: 'Anchored', provider: 'claude' });
  const prof = store.readProfile('anchored');

  assert.ok(prof.id, 'PRECONDITION: the profile really does have an id, or this arm proves nothing');
  const out = agentfile.exportAgent('anchored', deps);
  assert.equal(out.ok, true, out.because);

  assert.equal(out.text.includes(prof.id), false, 'the id must not appear anywhere in the file');
  assert.equal(/^id:/m.test(out.text), false, 'and not as a field either');
  assert.equal(/^idInstall:/m.test(out.text), false);
  assert.equal(/^dir:/m.test(out.text), false, 'a path on somebody else’s machine must not travel');
  assert.equal(/^updatedAt:/m.test(out.text), false, 'nor one install’s bookkeeping');

  /* CONTROL: the same containment check finds something that SHOULD be there.
     Without it, every assertion above is equally consistent with a file that is
     empty or a matcher that never matches. */
  assert.equal(out.text.includes('claude'), true, 'CONTROL: provider IS carried, so these matchers work');
});

test('#1652: the provider travels as a hint when it is known, and is simply absent when it is not', () => {
  makeAgent('withprov');
  store.writeProfile('withprov', { provider: 'openai' });
  assert.match(agentfile.exportAgent('withprov', deps).text, /^provider: openai$/m);

  makeAgent('noprov');
  const out = agentfile.exportAgent('noprov', deps);
  assert.equal(out.ok, true, out.because);
  assert.equal(/^provider:/m.test(out.text), false, 'no provider means no line, rather than an empty one');
});

test('#1652: an agent with no instructions is refused, not exported empty', () => {
  makeAgent('silent', null);
  const out = agentfile.exportAgent('silent', deps);
  assert.equal(out.ok, false);
  assert.match(out.because, /nothing to share/);
});

test('#1652: empty instructions are refused too', () => {
  makeAgent('blank', '   \n\n');
  const out = agentfile.exportAgent('blank', deps);
  assert.equal(out.ok, false);
  assert.match(out.because, /nothing to share/);
});

test('#1652: a name that would break the frontmatter block is refused rather than escaped', () => {
  /* A newline in a value ends the block early and silently changes what the
     next line means. There is no legitimate agent name with one in it. */
  const out = agentfile.exportAgent('bad\nname', deps);
  assert.equal(out.ok, false);
  assert.match(out.because, /usable agent name/);
});

test('#1652 NOT A NEW FORMAT: the file parses with the parser that already exists', () => {
  /* ⭐ This is the arm that makes "we added no second definition" a measurement.
     engine/skills.js:readMeta already reads `---` frontmatter for SKILL.md, a
     convention its own comment records as Claude Code's rather than ours. If
     the agent file needed its own parser, this would fail. */
  makeAgent('roundtrip');
  const out = agentfile.exportAgent('roundtrip', deps);
  const f = path.join(SANDBOX, 'roundtrip.agent.md');
  fs.writeFileSync(f, out.text);

  const meta = skills.readMeta(f);
  assert.ok(meta, 'the existing parser reads the file at all');
  assert.equal(meta.name, 'roundtrip', 'and gets the name out of it');
  assert.equal(meta.title, 'You are Casey Jones', 'and the display name from the body, as adoption does');

  /* CONTROL: the same parser on a file that is NOT one of ours returns no name,
     so `meta.name` above means something. */
  const other = path.join(SANDBOX, 'plain.md');
  fs.writeFileSync(other, '# Just a document\n\nNo frontmatter here.\n');
  assert.equal(skills.readMeta(other).name, null, 'CONTROL: a plain markdown file yields no name');
});

test('#1652: the import contract is stated beside the writer, not left to be inferred', () => {
  const c = agentfile.IMPORT_CONTRACT;
  assert.equal(c.marker, 'kosmos: agent');
  assert.deepEqual([...c.required].sort(), ['kosmos', 'name']);
  assert.equal(c.bodyMustName, true, 'the body must name somebody, which is what adoption already requires');
});

test('#1652: missing dependencies are refused rather than throwing', () => {
  const out = agentfile.exportAgent('casey', {});
  assert.equal(out.ok, false);
  assert.match(out.because, /store and instructions/);
});
