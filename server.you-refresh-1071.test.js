'use strict';

/**
 * Every agent's About-you block ("Who you work for") is refreshed when the board
 * starts (#1071), the way reports (#1676), connections (#1649) and dmfiles
 * (#3614) already are.
 *
 * 🛑 THE MEASURED GAP. `you.syncEveryone` had one caller, `PUT /api/you`, so an
 * agent made after the person last saved About-you never got the block. On
 * Mortals (2026-09-27, tools/check-block-delivery.js on origin/main) the three
 * boot-refreshed blocks were on 8 of 8 agents and this one on 1 of 8.
 *
 * 🔑 THIS WRITES EVERY AGENT'S BOOT FILE ON EVERY BOARD START, so most arms are
 * about what it must NOT touch (Liu Kang, m1859): text outside the markers
 * survives byte for byte, a file with two blocks is left alone, a missing file
 * is never created, and with nothing saved an existing block is not removed.
 * The first two arms are red without the fix; the controls pass either way and
 * guard against a fix that writes too much.
 *
 * ⚠️ THE SIBLING BOOT REFRESHES RUN IN THE SAME BOOT and append their own blocks
 * (reports, connections, dmfiles) at the END of a file that lacks them. So "byte
 * for byte" below means: every byte up to the end of the person's own text is
 * identical, and what follows it is only other managed blocks. The tail check is
 * what keeps that allowance from hiding a stray write.
 *
 * ⚠️ RUNS THE REAL SERVER as a child process, as server.reports-refresh-1676
 * does, because the boot path is behind `require.main === module`.
 */

const test = require('node:test');
const store = require('./engine/store');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO = __dirname;
const fleet = require('./test-support/fleet');
const { runUntilBanner } = require('./test-support/board-child');
const projects = require('./engine/projects');

const YOU = { name: 'Pat Doe', does: 'Runs the bakery', know: null, savedAt: '2026-09-27T00:00:00.000Z' };
const NEW_LINE = 'Pat Doe. Runs the bakery';

/* ⚠️ THE `-discord` SUFFIX IS LOAD-BEARING, for the reason the #1676 fixture
   gives: without it every fixture agent is anonymous and syncEveryone skips it,
   so every arm would pass vacuously. */
function sandbox(agents, youRecord) {
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-you-1071-'));
  const workers = path.join(sb, 'workers');
  const root = path.join(sb, 'data', store.APP);
  fs.mkdirSync(workers, { recursive: true });
  fs.mkdirSync(path.join(root, 'profiles'), { recursive: true });
  if (youRecord) fs.writeFileSync(path.join(root, 'you.json'), JSON.stringify(youRecord));
  const lines = [];
  for (const a of agents) {
    const bare = a.name.replace(/-discord$/, '');
    if (a.file !== null) {
      const dir = path.join(workers, bare);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'CLAUDE.md'), a.file);
    }
    lines.push(fleet.line({ session: a.name }));
  }
  fs.writeFileSync(path.join(sb, 'panes.txt'), lines.join('\n') + '\n');
  return sb;
}

function boot(sb) {
  const child = spawn(process.execPath, [path.join(REPO, 'server.js')], {
    env: {
      ...process.env,
      PORT: '0',
      AGENT_WORKFORCE_DATA: path.join(sb, 'data'),
      AGENT_WORKFORCE_WORKERS: path.join(sb, 'workers'),
      AGENT_WORKFORCE_LAUNCH: path.join(sb, 'launch'),
      AGENT_WORKFORCE_PROJECTS: path.join(sb, 'projects'),
      /* 🛑 Without the fake tmux the roster resolves the REAL fleet and this
         boot-time WRITE path meets real agents. */
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh'),
      AGENT_WORKFORCE_FAKE_PANES: path.join(sb, 'panes.txt'),
      AGENT_WORKFORCE_DRY_RUN: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return runUntilBanner(child, { settleMs: 300 }).then((r) => {
    assert.equal(r.dead, true, 'the board was still running, so deleting its sandbox now would race it');
    return r;
  });
}

const messages = require('./engine/messages');

const fileOf = (sb, bare) => path.join(sb, 'workers', bare, 'CLAUDE.md');

/* What may follow the person's own text after a boot: nothing but whole managed
   blocks OTHER than this one (the sibling refreshes' appends), and whitespace. */
function onlyOtherBlocks(tail) {
  let rest = tail;
  for (const [s, e] of [[projects.REPORTS_START, projects.REPORTS_END],
    [projects.CONNECTIONS_START, projects.CONNECTIONS_END], [projects.DMFILES_START, projects.DMFILES_END]]) {
    const a = rest.indexOf(s); const b = rest.indexOf(e);
    if (a >= 0 && b > a) rest = rest.slice(0, a) + rest.slice(b + e.length);
  }
  return rest.trim() === '';
}

test('#1071: an existing agent without the block gets it on a plain board start, its own words kept', async () => {
  const mine = '# My agent\n\nHand-written rules the person typed.\n';
  const sb = sandbox([{ name: 'pp-youadd-discord', file: mine }], YOU);
  try {
    assert.equal(fs.readFileSync(fileOf(sb, 'pp-youadd'), 'utf8').includes(projects.YOU_START), false,
      'precondition: the agent starts WITHOUT the block, or this test proves nothing');
    await boot(sb);
    const after = fs.readFileSync(fileOf(sb, 'pp-youadd'), 'utf8');
    assert.equal(after.includes(projects.YOU_START), true,
      'a plain board start must put the About-you block into an existing agent, with nobody saving the form');
    assert.equal(after.includes(NEW_LINE), true, 'the delivered block must carry the saved answers');
    assert.equal(after.startsWith(mine.replace(/\n$/, '')), true,
      'the person\'s own text must come through unchanged ahead of the block');
    assert.equal(after.split(projects.YOU_START).length - 1, 1, 'exactly one block, not one per refresh');
  } finally { fs.rmSync(sb, { recursive: true, force: true }); }
});

test('#1071: hand-edited text on BOTH sides of an old block survives byte for byte; only the span changes', async () => {
  const before = '# Mine\n\nA rule I wrote above the block.\n\n';
  const after_ = '\n\n## My own section\n\nA rule I wrote BELOW the block, edited by hand.\n';
  const stale = `${projects.YOU_START}\n## Who you work for\n\nOld Name. Old job\n${projects.YOU_END}`;
  const sb = sandbox([{ name: 'pp-youedit-discord', file: before + stale + after_ }], YOU);
  try {
    await boot(sb);
    const got = fs.readFileSync(fileOf(sb, 'pp-youedit'), 'utf8');
    const s = got.indexOf(projects.YOU_START);
    const e = got.indexOf(projects.YOU_END) + projects.YOU_END.length;
    assert.ok(s >= 0 && e > s, 'the block must still be there, exactly once');
    assert.equal(got.indexOf(projects.YOU_START, s + 1), -1, 'the refresh must not append a second block');
    assert.equal(got.slice(0, s), before, 'every byte ABOVE the markers must be untouched');
    assert.equal(got.slice(e, e + after_.length), after_, 'every byte BELOW the markers must be untouched');
    assert.equal(onlyOtherBlocks(got.slice(e + after_.length)), true,
      'after the person\'s text there may be only the sibling refreshes\' blocks, nothing else');
    const span = got.slice(s, e);
    assert.equal(span.includes('Old Name'), false, 'the old answers must be replaced');
    assert.equal(span.includes(NEW_LINE), true, 'the current answers must be what the span now says');
  } finally { fs.rmSync(sb, { recursive: true, force: true }); }
});

test('#1071 CONTROL: a file with TWO About-you blocks is left exactly as it was', async () => {
  /* The refuse-on-ambiguity arm. Two well-formed pairs means we cannot tell
     which one is ours, and the only safe write is none. */
  const block = `${projects.YOU_START}\n## Who you work for\n\nSomeone. Something\n${projects.YOU_END}`;
  const text = `# Two blocks\n\n${block}\n\nmiddle words\n\n${block}\n`;
  const sb = sandbox([{ name: 'pp-youtwo-discord', file: text }], YOU);
  try {
    const r = await boot(sb);
    /* The refusal is SAID, not only honoured: the boot line names the agent. */
    assert.match(r.err, /could not refresh what 1 of 1 agent\(s\) know about who they work for[^\n]*First: pp-youtwo - its instructions contain 2 Kosmos about-you blocks/,
      'a refused agent must be named on stderr, not skipped in silence');
    const got = fs.readFileSync(fileOf(sb, 'pp-youtwo'), 'utf8');
    assert.equal(got.slice(0, text.length), text,
      'an ambiguous file must keep both blocks and every byte around them exactly');
    assert.equal(onlyOtherBlocks(got.slice(text.length)), true,
      'nothing about-you may be added after an ambiguous pair');
  } finally { fs.rmSync(sb, { recursive: true, force: true }); }
});

test('#1071 CONTROL: an agent whose file we never created is not invented', async () => {
  const sb = sandbox([{ name: 'pp-younofile-discord', file: null }], YOU);
  try {
    await boot(sb);
    assert.equal(fs.existsSync(fileOf(sb, 'pp-younofile')), false,
      'the board must not create an instructions file for an agent that has none');
  } finally { fs.rmSync(sb, { recursive: true, force: true }); }
});

test('#1071 CONTROL: with NOTHING saved, an existing block is kept, not stripped at boot', async () => {
  /* you.tellAgent removes the block when there is no record. The form can never
     produce that state; a boot pass could (a new world, a misrooted data dir), so
     the boot pass must not run the removal at all. */
  const text = `# Mine\n\n${projects.YOU_START}\n## Who you work for\n\nPat Doe. Runs the bakery\n${projects.YOU_END}\n`;
  const sb = sandbox([{ name: 'pp-younone-discord', file: text }], null);
  try {
    await boot(sb);
    const got = fs.readFileSync(fileOf(sb, 'pp-younone'), 'utf8');
    assert.equal(got.slice(0, text.length), text, 'the existing block and everything before it must survive a boot with no record');
    assert.equal(onlyOtherBlocks(got.slice(text.length)), true, 'nothing else may change');
  } finally { fs.rmSync(sb, { recursive: true, force: true }); }
});

test('#1071: a drifted colleagues block is healed on the same pass, the person\'s text around it kept', async () => {
  /* tellAgent runs projects.healColleagues, so this boot pass also refreshes an
     EXISTING colleagues block. Pinned so that side effect is a decision on record
     rather than a surprise. It never adds one. */
  const before = '# Mine\n\nabove\n\n';
  const after_ = '\n\nbelow, by hand\n';
  const old = `${messages.START}\n## Talking to your colleagues\n\nOLD TEXT\n${messages.END}`;
  const sb = sandbox([{ name: 'pp-youcol-discord', file: before + old + after_ }], YOU);
  try {
    await boot(sb);
    const got = fs.readFileSync(fileOf(sb, 'pp-youcol'), 'utf8');
    const s = got.indexOf(messages.START);
    const e = got.indexOf(messages.END) + messages.END.length;
    assert.equal(got.slice(0, s), before, 'bytes above the colleagues block kept');
    assert.equal(got.slice(e, e + after_.length), after_, 'bytes below the colleagues block kept');
    assert.equal(got.slice(s, e).includes('OLD TEXT'), false, 'the drifted text is replaced');
    assert.equal(got.slice(s, e).includes(messages.blockBody()), true, 'with the current block body');
  } finally { fs.rmSync(sb, { recursive: true, force: true }); }
});
