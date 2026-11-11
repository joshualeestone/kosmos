'use strict';
/**
 * kosmos#8368: deciding whether a token-only guard test may skip because of the HOST it runs on.
 *
 * Several engine tests pin the guard to macOS rules (`platform: 'darwin'`) and run on every host. The guard covers what
 * the instruction files ABOVE the agent's folder import (Claude Code walks up from its cwd), and on Windows the temp
 * folder sits inside the person's home, so the person's own ~/.claude/CLAUDE.md is an ancestor of every test sandbox.
 * Under the pinned macOS rules a Windows path can never be carried (its backslash is a rule-syntax character,
 * setup-assistant.js IMPORT_RULE_SYNTAX), so any import there makes the guard answer ok:false. In production a Windows
 * run never reaches that code (the guard says unsupported on win32 first). So on such a host the macOS-pinned guard
 * cannot answer ok, and the arms whose answer the host decides must skip, saying why.
 *
 * onlyImportComplaints(reason): true only when EVERY complaint in the guard's joined `otherReason` is the import note.
 * Anything else (a second complaint of any kind, a path carrying its own brackets, another shape) is false, so the arms
 * run and fail loudly. onCi(env): the same rule tools/windows-tests.js uses for CI; a test never skips there, where the
 * runner's home is clean and a skip could only hide a fault.
 */

const IMPORT_NOTE = '(a file an instruction file imports, whose path the permission rules cannot carry)';
const COVER_PREFIX = 'a file or folder Claude Code reads at start could not be covered (';

function onlyImportComplaints(reason) {
  let s = String(reason || '');
  if (!s.startsWith(COVER_PREFIX)) return false;
  s = s.slice(COVER_PREFIX.length).replace(/\): renaming that folder[\s\S]*$/, ')');
  if (!s.endsWith(')')) return false;
  s = s.slice(0, -1);
  const notes = s.match(/\([^()]*\)/g) || [];
  return notes.length > 0 && notes.every((n) => n === IMPORT_NOTE) && !/[()]/.test(s.replace(/\([^()]*\)/g, ''));
}

function onCi(env = process.env) { return !!env.CI && !/^(false|0)$/i.test(String(env.CI)); }

module.exports = { onlyImportComplaints, onCi, IMPORT_NOTE, COVER_PREFIX };
