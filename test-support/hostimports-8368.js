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
 * onlyImportComplaints(reason): true only when the guard's joined `otherReason` lists nothing but import entries,
 * each an absolute path (no comma, no brackets) followed by the import note. The guard also lists entries with no note
 * at all (a bare path, a sentence), so the WHOLE list must match that shape, not just its notes: anything else is
 * false, so the arms run and fail loudly. onCi: tools/windows-tests.js's own CI rule; a test never skips on CI.
 */

const { onCi } = require('../tools/windows-tests');

const IMPORT_NOTE = '(a file an instruction file imports, whose path the permission rules cannot carry)';
const COVER_PREFIX = 'a file or folder Claude Code reads at start could not be covered (';
const RENAME_SUFFIX = /\): renaming that folder[\s\S]*$/;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ENTRY = `(?:[A-Za-z]:[\\\\/]|/)[^,()]*? ${esc(IMPORT_NOTE)}`;
const ONLY_IMPORTS = new RegExp(`^${ENTRY}(?:, ${ENTRY})*$`);

function onlyImportComplaints(reason) {
  let s = String(reason || '');
  if (!s.startsWith(COVER_PREFIX)) return false;
  s = s.slice(COVER_PREFIX.length).replace(RENAME_SUFFIX, ')');
  if (!s.endsWith(')')) return false;
  return ONLY_IMPORTS.test(s.slice(0, -1));
}

module.exports = { onlyImportComplaints, onCi, IMPORT_NOTE, COVER_PREFIX };
