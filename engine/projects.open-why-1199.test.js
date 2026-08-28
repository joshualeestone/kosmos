'use strict';

/**
 * Why a file did not open, and not just that it did not (#1199).
 *
 * Josh clicked a PowerPoint file in a project's documents list. It did not
 * launch and the panel said "that file did not open", which is honest and a
 * dead end: it reads as the document being broken when the ordinary cause is
 * that nothing on the computer opens that kind of file at all.
 *
 * `open` already distinguishes its failures. `openFile` passed `stdio: 'ignore'`
 * and threw the distinction away one line before the catch needed it.
 *
 * ⚠️ THE FIRST TEST RUNS THE PRODUCTION PATH WITH NO INJECTED RUNNER, for the
 * reason the sibling reveal test states in this suite: an injected runner once
 * replaced the exact line that was broken, and every test stayed green over a
 * feature dead in production. Only a real `execFileSync` can prove that stderr
 * is actually captured, because that is the thing being changed.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-open-why-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.on('exit', () => {
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('./projects');

function projectWithFile(dirName, fileName) {
  const dir = path.join(SANDBOX, dirName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), 'x');
  return dir;
}

test('a file kind nothing on this computer opens says so, and says the file is fine', () => {
  // ⚠️ NO INJECTED RUNNER. The real `open` exits 1 on an extension no
  // application claims, with its reason on stderr, and no window appears.
  // Measured on this Mac: rc=1 in 0.02s, "No application knows how to open
  // URL file://...". An extension nobody could have registered keeps that
  // true on any machine that runs this suite.
  const dir = projectWithFile('open-why-a', 'quarterly.zzqqxx');
  const out = projects.openFile(dir, 'quarterly.zzqqxx');
  assert.equal(out.ok, false);
  assert.equal(out.because, 'nothing on this computer opens .zzqqxx files yet, and the file itself is fine');
  // The sentence names the extension the person can see on their own file.
  assert.ok(out.because.includes('.zzqqxx'), 'the reason names the file kind');
  // And it is NOT the old sentence, which is what made this a dead end.
  assert.notEqual(out.because, 'that file did not open');
});

/**
 * ⚠️ THE ARM THAT MATTERS MOST FOR HONESTY. `execFileSync` kills the child at
 * five seconds and throws, and the old catch called that "did not open" -- but
 * a cold application launch still in progress is not a failure, and we cannot
 * see which it was. This must never assert an outcome.
 *
 * Only reachable through the injected runner: a real five-second hang cannot be
 * manufactured here without making the suite take five seconds.
 */
test('a slow launch is reported as us not waiting, never as the file failing', () => {
  const dir = projectWithFile('open-why-b', 'huge.pptx');
  projects.setRevealRunner(() => {
    const err = new Error('spawnSync /usr/bin/open ETIMEDOUT');
    err.code = 'ETIMEDOUT';
    throw err;
  });
  try {
    const out = projects.openFile(dir, 'huge.pptx');
    assert.equal(out.ok, false);
    assert.equal(out.because, 'we stopped waiting for it after five seconds, so it may still be opening');
    assert.ok(!/did not open|could not open|failed/.test(out.because),
      'a timeout must not be reported as a failure to open');
  } finally {
    projects.setRevealRunner(null);
  }
});

/**
 * ⚠️ THE FALLBACK IS THE SAFETY OF THE WHOLE THING. The no-handler arm matches
 * a string from another program, which can change under us. An unrecognised
 * failure has to degrade to exactly the old behaviour, so a future macOS
 * rewording leaves this no worse than before it existed.
 */
test('an unrecognised failure still gets the original sentence', () => {
  const dir = projectWithFile('open-why-c', 'notes.txt');
  projects.setRevealRunner(() => {
    const err = new Error('open: something nobody has seen before');
    err.status = 1;
    err.stderr = Buffer.from('open: a message from a future macOS\n');
    throw err;
  });
  try {
    const out = projects.openFile(dir, 'notes.txt');
    assert.equal(out.ok, false);
    assert.equal(out.because, 'that file did not open');
  } finally {
    projects.setRevealRunner(null);
  }
});

/**
 * A file with no extension must not produce a sentence about our own parsing.
 */
test('a file with no extension gets a sentence about the file, not about a dot', () => {
  const dir = projectWithFile('open-why-d', 'Makefile');
  projects.setRevealRunner(() => {
    const err = new Error('no handler');
    err.stderr = Buffer.from('No application knows how to open URL file:///x/Makefile\n');
    throw err;
  });
  try {
    const out = projects.openFile(dir, 'Makefile');
    assert.equal(out.because, 'nothing on this computer opens that kind of file yet, and the file itself is fine');
    assert.ok(!out.because.includes('undefined') && !out.because.includes('  '),
      'no empty extension leaks into the sentence');
  } finally {
    projects.setRevealRunner(null);
  }
});

/**
 * The gates in front of all of this are unchanged. A refusal that never reaches
 * `open` must keep its own sentence rather than acquiring one about handlers.
 */
test('the refusals before the opener are untouched', () => {
  const dir = projectWithFile('open-why-e', 'real.txt');
  assert.equal(projects.openFile(dir, '../escape.txt').because, 'that is not a file in this project');
  assert.equal(projects.openFile(dir, '').because, 'no file was named');
  assert.equal(projects.openFile(dir, 'missing.txt').because, 'that file is not there any more, or it was moved');
});

/**
 * ⭐ THE PROMISE THE ICON MAKES. The other half of #1199 fixed the glyph map,
 * and the glyphs are OURS, not the system's: a file correctly marked as a
 * PowerPoint is not evidence that anything here opens one. This asserts the two
 * halves cannot silently disagree, by pinning that a well-known office
 * extension still reaches the handler sentence rather than a "we do not know
 * this file kind" one.
 */
test('a file we draw an icon for still gets the handler sentence when nothing opens it', () => {
  const dir = projectWithFile('open-why-f', 'deck.pptx');
  projects.setRevealRunner(() => {
    const err = new Error('no handler');
    err.stderr = Buffer.from('No application knows how to open URL file:///x/deck.pptx\n');
    throw err;
  });
  try {
    assert.equal(projects.openFile(dir, 'deck.pptx').because,
      'nothing on this computer opens .pptx files yet, and the file itself is fine');
  } finally {
    projects.setRevealRunner(null);
  }
});
