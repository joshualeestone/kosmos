'use strict';
// Sandbox every root BEFORE any require, the same rule the sibling suites state.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-dmfiles-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const dmfiles = require('./dmfiles');
const projects = require('./projects');

test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

/* #3965 (Josh, 2026-09-26 08:57): "Agents keep defaulting to trying to put the document as an
   artifact". Read flattened, because the block is hard-wrapped and a phrase can span a line. */
const FLAT = dmfiles.blockBody('/Users/someone/work/workers/writer/Files').replace(/\s+/g, ' ');

test('#3965: the block says a thing made for the person is a FILE, named in the reply', () => {
  assert.match(FLAT, /is a FILE on this computer, saved where the next paragraphs say, and named in your reply/);
});

test('#3965: the block rules out an artifact or link unless the person asks, and says it outranks a tool default', () => {
  assert.match(FLAT, /Do not publish it as a Claude artifact, a shared document or any other link unless the person asks for that by name/);
  assert.match(FLAT, /If one of your tools offers to publish by default, this instruction comes first\./);
});

test('#3965: the rule comes FIRST in the block, before where the file goes', () => {
  const at = FLAT.indexOf('Do not publish it as a Claude artifact');
  const where = FLAT.indexOf('When you make a file for the person in a direct conversation');
  assert.ok(at > -1 && where > -1 && at < where, 'the default must be read before the details');
});

test('#3965: an app\'s scratch files are not listed; ordinary names that look similar are', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-scratch-3965-'));
  try {
    const keep = ['report.docx', '~notes.txt', 'price$.xlsx', 'thumbs.db.txt'];
    const hide = ['~$report.docx', '~$on (Grok A.docx', '.~lock.report.docx#', '.DS_Store', 'Thumbs.db', 'desktop.ini', 'DESKTOP.INI'];
    for (const n of [...keep, ...hide]) fs.writeFileSync(path.join(dir, n), 'x');
    const listed = projects.listFiles(dir, 100, { maxDepth: 0 });
    const names = listed.files.map((f) => f.name).sort();
    assert.deepEqual(names, [...keep].sort());
    // control: the listing does see the folder (it is not simply empty)
    assert.equal(names.length, keep.length);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('#3965: a swarm lead tells its helpers the same rule (helpers have no instructions of their own)', () => {
  const swarm = require('./swarm');
  const flat = swarm.blockBody(3).replace(/\s+/g, ' ');
  assert.match(flat, /Tell every helper that anything it makes to keep is saved as a file/);
  assert.match(flat, /never published as a Claude artifact or a link/);
});
