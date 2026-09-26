'use strict';
/**
 * #3568: is Gemini on a Google subscription ready on this Mac? Two facts about Google's
 * Antigravity CLI (agy), the program an Antigravity agent runs on:
 *
 *  - INSTALLED: runners.resolveBin('antigravity') finds a runnable agy (its own installer puts it
 *    in ~/.local/bin/agy; Kosmos does not install it). Cheap, read on every call.
 *  - SIGNED IN: agy keeps its Google sign-in to itself (no file Kosmos can read) and has no status
 *    command, so the only test is to ask it something. A one-line prompt in print mode, run in a
 *    throwaway folder: measured 2026-09-25 on Agent1s, signed in it answered "ok" in 2 to 5 s, from a
 *    folder agy had never seen and without adding it to agy's trusted folders; signed out the same
 *    command waited about 60 s and failed. So: "ok" within the cap is signed in; anything else is
 *    NOT a confident signed-out, it is "could not confirm" (it may be the network, or a slow Mac).
 *
 * The check costs one tiny prompt on the person's subscription, so it runs only when a screen asks
 * (a button press), never on a poll, and concurrent asks share one run (engine/inflight.js).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const runners = require('./runners');
const inflight = require('./inflight');

const PROMPT = 'Reply with the single word ok';
const CAP_SECONDS = 30;   // agy's own --print-timeout
const KILL_MS = 40000;    // our backstop if agy ignores its own timeout

/** { installed, bin }: cheap, safe to call on every render. */
function installed() {
  const r = runners.resolveBin('antigravity');
  return { installed: !!(r && r.present), bin: r ? r.bin : null, because: r && r.because ? r.because : null };
}

/* The seam a test replaces: run agy once and hand back (err, stdout). */
let runAgy = (bin, done) => {
  let dir = null;
  try { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-agy-check-')); } catch { dir = os.tmpdir(); }
  execFile(bin, ['-p', PROMPT, '--print-timeout', CAP_SECONDS + 's'], { cwd: dir, timeout: KILL_MS, maxBuffer: 64 * 1024 },
    (err, stdout) => {
      if (dir && dir !== os.tmpdir()) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
      done(err, String(stdout || ''));
    });
};

function checkOnce() {
  return new Promise((resolve) => {
    const inst = installed();
    if (!inst.installed) {
      resolve({ installed: false, signedIn: false, because: inst.because || 'Antigravity is not installed on this Mac' });
      return;
    }
    runAgy(inst.bin, (err, out) => {
      if (!err && /\bok\b/i.test(out)) { resolve({ installed: true, signedIn: true }); return; }
      resolve({ installed: true, signedIn: null,
        because: 'Antigravity did not answer, so it may need signing in (or this Mac is offline)' });
    });
  });
}
const shared = inflight.collapse(checkOnce);

/** { installed, signedIn: true | null, because? }: null means "could not confirm", never "signed out". */
function check() { return shared(); }

function setRunnerForTests(fn) { runAgy = fn; }

module.exports = { installed, check, setRunnerForTests, PROMPT };
