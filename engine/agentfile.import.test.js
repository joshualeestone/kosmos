'use strict';

/**
 * The import direction of the portable agent file (#1652).
 *
 * ⚠️ THE ARMS THAT MATTER ARE THE REFUSALS, and each is paired with a control
 * that COULD have passed: a refusal is only evidence when the same code path
 * accepts a valid file. This surface takes input from outside the machine, so
 * "refuses a bad file whole" is the property, not "accepts a good one".
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-agentimport-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const agentfile = require('./agentfile');
const store = require('./store');
const instructions = require('./instructions');
const status = require('./status');
const create = require('./create');

test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const deps = { identityFromText: status.identityFromText, nameUsable: create.nameUsable };
const BODY = '# You are Casey Jones\n\nYou answer one question, and you answer it well.\n';

/** A valid exported file to import, produced by the REAL export half. */
function exportedFile(name, body = BODY, profile = null) {
  const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), body);
  if (profile) store.writeProfile(name, profile);
  const out = agentfile.exportAgent(name, { store, instructions });
  assert.equal(out.ok, true, 'PRECONDITION: export failed: ' + out.because);
  return out.text;
}

test('#1652 ROUND TRIP: a real exported file imports as the same agent', () => {
  const text = exportedFile('roundtrip', BODY, { provider: 'claude' });
  const out = agentfile.importAgent(text, deps);
  assert.equal(out.ok, true, out.because);
  assert.equal(out.name, 'roundtrip');
  assert.equal(out.displayName, 'Casey Jones', 'the display name comes from the body, the same call adoption uses');
  assert.equal(out.provider, 'claude', 'the provider hint travels');
  assert.ok(out.body.includes('You answer one question'), 'the instructions body is returned for the creator');
});

test('#1652 REFUSED WHOLE: a plain markdown file with no header', () => {
  const out = agentfile.importAgent('# Just a document\n\nNo frontmatter here.\n', deps);
  assert.equal(out.ok, false);
  assert.match(out.because, /no header/);
  // CONTROL: the same importAgent accepts a valid file, so the refusal means something.
  assert.equal(agentfile.importAgent(exportedFile('ctrl1'), deps).ok, true);
});

test('#1652 REFUSED WHOLE: a header without the kosmos marker', () => {
  const out = agentfile.importAgent('---\nname: nope\n---\n\n# You are Nobody\n', deps);
  assert.equal(out.ok, false);
  assert.match(out.because, /not a Kosmos agent file/);
});

test('#1652 REFUSED WHOLE: a kosmos value that is not agent', () => {
  const out = agentfile.importAgent('---\nkosmos: skill\nname: nope\n---\n\n# You are Nobody\n', deps);
  assert.equal(out.ok, false);
  assert.match(out.because, /not a Kosmos agent file/);
});

test('#1652 REFUSED WHOLE: no usable name', () => {
  const noName = agentfile.importAgent('---\nkosmos: agent\n---\n\n# You are Nobody\n', deps);
  assert.equal(noName.ok, false);
  assert.match(noName.because, /no usable name/);
  const emptyName = agentfile.importAgent('---\nkosmos: agent\nname:    \n---\n\n# You are Nobody\n', deps);
  assert.equal(emptyName.ok, false, 'a blank name is not a usable name');
  assert.match(emptyName.because, /no usable name/);
});

test('#1652 REFUSED WHOLE: a body that names nobody', () => {
  const out = agentfile.importAgent('---\nkosmos: agent\nname: quiet\n---\n\nJust some notes, no name here.\n', deps);
  assert.equal(out.ok, false);
  assert.match(out.because, /do not name an agent/);
  // CONTROL: the identical header WITH a naming body is accepted.
  const ok = agentfile.importAgent('---\nkosmos: agent\nname: quiet\n---\n\n# You are Quiet\n', deps);
  assert.equal(ok.ok, true, 'CONTROL: a naming body is accepted, so the refusal is about the body');
});

test('#1652: the provider hint is carried when present and null when absent', () => {
  assert.equal(agentfile.importAgent(exportedFile('withprov', BODY, { provider: 'openai' }), deps).provider, 'openai');
  const noprov = agentfile.importAgent(exportedFile('noprov'), deps);
  assert.equal(noprov.ok, true, noprov.because);
  assert.equal(noprov.provider, null, 'no provider line means the hint is null, not an empty string');
});

test('#1652 THE SAFETY ARM: the per-install identity anchor cannot enter through the file', () => {
  /* A hostile or hand-edited file that carries an id: line must not put it into
     the returned material. import reads only name/displayName/provider/body, and
     the create flow mints a fresh id, so two importers become two agents. */
  const text = '---\nkosmos: agent\nname: sneaky\nid: 11111111-1111-1111-1111-111111111111\ndir: /somebody/else\n---\n\n# You are Sneaky\n';
  const out = agentfile.importAgent(text, deps);
  assert.equal(out.ok, true, out.because);
  assert.equal(Object.prototype.hasOwnProperty.call(out, 'id'), false, 'an id from the file must not appear in the material');
  assert.equal(Object.prototype.hasOwnProperty.call(out, 'dir'), false, 'a dir from the file must not appear either');
  assert.equal(JSON.stringify(out).includes('11111111-1111'), false, 'the id value must not leak anywhere in the result');
  // CONTROL: the material this containment check runs over is real (name is there).
  assert.equal(out.name, 'sneaky', 'CONTROL: the returned material is populated, so the absences above mean something');
});

test('#1652: input that travelled (CRLF line endings and a leading BOM) still imports', () => {
  /* A file emailed or pasted through Windows can gain CRLF and a BOM. That is
     input hygiene, not a second format: a valid agent file must not be refused
     for surviving the trip. */
  const crlf = '﻿' + '---\r\nkosmos: agent\r\nname: travelled\r\n---\r\n\r\n# You are Travelled\r\n';
  const out = agentfile.importAgent(crlf, deps);
  assert.equal(out.ok, true, 'a CRLF+BOM file was refused: ' + out.because);
  assert.equal(out.name, 'travelled');
  assert.equal(out.displayName, 'Travelled');
});

test('#1652: missing the injected deps is refused, not thrown (mirrors export)', () => {
  const out = agentfile.importAgent(exportedFile('nodeps'), {});
  assert.equal(out.ok, false);
  assert.match(out.because, /identity parser/);
});

test('#1652 REFUSED WHOLE: a path-unsafe name (a security property, not machine state)', () => {
  /* A `..`, a slash or a NUL would become a folder, a tmux session and a launchd
     label. This surface takes outside input, so it refuses such a name HERE
     rather than trusting the create flow to re-check. Uses the canonical
     create.nameUsable, so import cannot guard less than create does. */
  for (const bad of ['../../etc/passwd', '..', '.', 'a/b', 'a\\b']) {
    const out = agentfile.importAgent(`---\nkosmos: agent\nname: ${bad}\n---\n\n# You are Evil\n`, deps);
    assert.equal(out.ok, false, `a path-unsafe name was accepted: ${JSON.stringify(bad)}`);
    assert.match(out.because, /not a usable agent name/);
  }
  // CONTROL: a safe name with the identical shape is accepted, so the refusal is about the name.
  assert.equal(agentfile.importAgent('---\nkosmos: agent\nname: safe-name\n---\n\n# You are Safe\n', deps).ok, true);
});

test('#1652: the kosmos marker is read from the HEADER only, never the body', () => {
  /* A file whose header lacks the marker but whose BODY contains a `kosmos:
     agent` line must be refused: field() searches the frontmatter block only. */
  const out = agentfile.importAgent('---\nname: sneaky\n---\n\nkosmos: agent\n# You are Sneaky\n', deps);
  assert.equal(out.ok, false, 'a kosmos line in the body was mistaken for the header marker');
  assert.match(out.because, /not a Kosmos agent file/);
});

test('#1652: only the FIRST frontmatter block is the header; a second block is body', () => {
  /* The non-greedy match takes the first `---...---`. A second block later in
     the body (or a horizontal rule) must not override the real header. */
  const text = '---\nkosmos: agent\nname: firstblock\n---\n\n# You are First\n\n---\nkosmos: fake\nname: evil\n---\n';
  const out = agentfile.importAgent(text, deps);
  assert.equal(out.ok, true, out.because);
  assert.equal(out.name, 'firstblock', 'a second --- block overrode the real header');
});
