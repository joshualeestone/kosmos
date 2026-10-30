'use strict';
/**
 * #7247: whether a child_process call RUNS schtasks.exe, read from the call alone (pure; no process is started).
 * tools/no-schtasks-preload.cjs refuses exactly these calls in a Windows test run.
 *
 * A call runs schtasks when any word it runs is schtasks, by any path or case, with or without .exe. Which words a call
 * runs (the shells, launchers and prefixes read past, the ambiguous calls read both ways, and what is not seen) is
 * tools/lib/command-words.cjs, the one reader this guard shares with test-support/tool-guard.js (#7262). A word
 * "schtasks" anywhere else (a git grep pattern, a commit message, echo schtasks, command -v schtasks) is not a call:
 * refusing those would change results the guard has no business changing (review 1 of #7247).
 */

const path = require('node:path');
const { callWords, lineWords, baseName } = require(path.join(__dirname, 'command-words.cjs'));

const PROGRAM = /^schtasks(\.exe)?$/i;
const isSchtasks = (word) => PROGRAM.test(baseName(word));

/* Whether a shell command line (exec, execSync, shell: true) starts schtasks in any of its commands. */
function commandRuns(text) {
  return lineWords(text).some(isSchtasks);
}

/* Whether spawn/execFile(file, args, options) runs schtasks. */
function callRuns(file, args, options) {
  return callWords(file, args, options).some(isSchtasks);
}

module.exports = { callRuns, commandRuns };
