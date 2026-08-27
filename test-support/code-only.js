'use strict';

/**
 * Strip prose from a source file, so an assertion about CODE cannot be
 * answered by a COMMENT.
 *
 * 🛑 WHY THIS EXISTS. This codebase documents a removal by QUOTING it — which
 * is deliberate and worth keeping — so a deletion and its own explanation live
 * in the same file by construction. An absence assertion over raw text
 * therefore matches the explanation and reports the deleted thing as present.
 * On 2026-08-26 that misfired five times in one night across three agents,
 * including a duplicate-id scan that reported THREE duplicates when the real
 * count was one, and sent somebody to investigate ids that do not collide.
 *
 * ⭐ THE BETTER RULE, WHERE IT APPLIES: assert on what the SCREEN produces,
 * not on what the file contains. Rendered output has no comments to be fooled
 * by. This helper is for the other case — a claim about WIRING, where the
 * artifact genuinely is the file and there is no screen to ask.
 *
 * ⚠️ LINE COMMENTS ONLY WHERE THE LINE BEGINS WITH ONE, and the restriction is
 * load-bearing rather than fussy (measured by Mona Lisa on web/index.html):
 * that file carries many `https://` URLs, and a naive /\/\/.*$/ truncates live
 * code after every one of them. That would HIDE a real occurrence and turn an
 * absence check green for the worst possible reason.
 * 📌 The two failure directions are NOT symmetric. Under-stripping gives a
 * false FAIL somebody investigates; over-stripping gives a false PASS nobody
 * ever looks at. When in doubt, strip less.
 */
function codeOnly(src) {
  return String(src == null ? '' : src)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
}

module.exports = { codeOnly };
