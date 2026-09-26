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
  assert.match(FLAT, /anything longer than a reply\) is a FILE on this computer, saved where the next paragraphs say, and named in your reply/);
});

test('#3965: the block rules out an artifact or link unless the person asks, and says it outranks a tool default', () => {
  assert.match(FLAT, /Do not publish it as a Claude artifact, a shared document or any other link unless the person asks for that, in the conversation or in your instructions/);
  assert.match(FLAT, /If one of your tools offers to publish by default, this instruction wins over that default\./);
});

test('#3965: the rule comes FIRST in the block, before where the file goes', () => {
  const at = FLAT.indexOf('Do not publish it as a Claude artifact');
  const where = FLAT.indexOf('When you make a file for the person in a direct conversation');
  assert.ok(at > -1 && where > -1 && at < where, 'the default must be read before the details');
});

test('#3965: an app\'s scratch files are not listed; ordinary names that look similar are', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-scratch-3965-'));
  try {
    const keep = ['report.docx', '~notes.txt', 'price$.xlsx', 'thumbs.db.txt', '~WRLnotes.tmp', 'Icon.png'];
    const hide = ['~$report.docx', '~$on (Grok A.docx', '.~lock.report.docx#', '.DS_Store', 'Thumbs.db', 'DESKTOP.INI', '~WRL0001.tmp', '~wrd1234.tmp', 'Icon\r'];
    for (const n of [...keep, ...hide]) fs.writeFileSync(path.join(dir, n), 'x');
    const listed = projects.listFiles(dir, 100, { maxDepth: 0 });
    const names = listed.files.map((f) => f.name).sort();
    assert.deepEqual(names, [...keep].sort());
    // (one spelling of desktop.ini only: this Mac's disk is case-insensitive, so two would be one file)
    // control: every hidden name really is on disk, so the list left them out rather than never saw them
    const onDisk = new Set(fs.readdirSync(dir));
    for (const n of hide) assert.ok(onDisk.has(n), 'fixture did not write ' + JSON.stringify(n));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('#3965: a swarm lead tells its helpers to hand files back, not publish them (a reinforcement)', () => {
  const swarm = require('./swarm');
  const flat = swarm.blockBody(3).replace(/\s+/g, ' ');
  assert.match(flat, /Tell each helper that anything it makes to keep comes back to you as a file, never as a Claude artifact or a link/);
  assert.match(flat, /You save it where your "Where to save files" section says/);
});

test('#3965: a folder with a scratch name is not walked, so nothing inside it is listed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-scratchdir-3965-'));
  try {
    for (const d of ['~$lockdir', 'Thumbs.db', 'real']) {
      fs.mkdirSync(path.join(dir, d));
      fs.writeFileSync(path.join(dir, d, 'inside.txt'), 'x');
    }
    const names = projects.listFiles(dir, 100, { maxDepth: 2 }).files.map((f) => f.name).sort();
    assert.deepEqual(names, ['real/inside.txt'], 'control: the ordinary folder IS walked; the scratch ones are not');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('#3965: a name the list hides cannot be opened either (the same rule, not only the dot-names)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-scratchopen-3965-'));
  let ran = false;
  projects.setRevealRunner(() => { ran = true; return { ok: true }; });
  try {
    for (const n of ['~$report.docx', 'Thumbs.db', '~WRL0001.tmp', 'real.txt']) fs.writeFileSync(path.join(dir, n), 'x');
    for (const n of ['~$report.docx', 'Thumbs.db', '~WRL0001.tmp']) {
      assert.equal(projects.openFile(dir, n).ok, false, JSON.stringify(n) + ' was opened');
    }
    assert.equal(ran, false, 'a refused name still reached the opener');
    // control: an ordinary file in the same folder opens through the same runner
    assert.equal(projects.openFile(dir, 'real.txt').ok, true);
    assert.equal(ran, true);
  } finally {
    projects.setRevealRunner(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
