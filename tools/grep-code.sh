#!/bin/bash
# Search what the file DOES, not what its comments SAY about what it used to do.
#
# 🛑 WHY THIS EXISTS. This codebase deletes copy by removing the live line and
# QUOTING it in a comment that records who ruled it and why. That convention is
# worth keeping -- it is how a later reader learns a deletion was deliberate.
# But it means EVERY RAW SEARCH FOR DELETED COPY MATCHES, for ever, and reports
# the thing as still present.
#
# ⚠️ IT HAS NOW FOOLED TWO PEOPLE IN ONE MORNING, on the same sentence, in two
# different files (2026-08-27): once on the source and once on the SERVED
# installer, where it read as a live regression in a release cut minutes
# earlier. Both were one step from reopening a closed ruling.
#
# ⭐ THE CHECKERS ALREADY STRIP COMMENTS. A person at a keyboard had no strip,
# so the safe path was longer than the unsafe one. This makes it shorter.
#
#   bash tools/grep-code.sh "Nothing to do." install/pkg-scripts/installing.html
#   bash tools/grep-code.sh "Two questions" web/index.html
#
# Prints matching lines with numbers, comments removed. Exit 0 if found, 1 if
# not, 2 on a usage or read error -- THREE states, because "I could not look"
# and "it is not there" are different answers.
set -uo pipefail
PATTERN="${1:?usage: bash tools/grep-code.sh <pattern> <file> [file...]}"
shift
[ "$#" -gt 0 ] || { echo "usage: bash tools/grep-code.sh <pattern> <file> [file...]" >&2; exit 2; }

found=0
for f in "$@"; do
  [ -r "$f" ] || { echo "grep-code: cannot read $f" >&2; exit 2; }
  # Same three strips as test-support/code-only.js, deliberately: one behaviour,
  # not two spellings of it. Line comments only where the line BEGINS with one,
  # because a naive //.*$ truncates live code after every https:// URL and would
  # HIDE a real occurrence -- an absence going green for the worst reason.
  out="$(node -e '
    const fs = require("fs");
    const src = fs.readFileSync(process.argv[1], "utf8");
    const pat = process.argv[2];
    const lines = src.split("\n");
    /* Blank the comments IN PLACE so line numbers still point at the real file.
       Stripping them out would renumber every line after the first comment,
       which is worse than useless in a message telling somebody where to look. */
    let joined = src
      .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "))
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .split("\n").map((l) => (/^[ \t]*\/\//.test(l) ? "" : l));
    joined.forEach((l, i) => { if (l.includes(pat)) console.log((i + 1) + ":" + lines[i].trim()); });
  ' "$f" "$PATTERN" 2>/dev/null)" || { echo "grep-code: failed reading $f" >&2; exit 2; }
  if [ -n "$out" ]; then
    found=1
    while IFS= read -r line; do printf '%s:%s\n' "$f" "$line"; done <<< "$out"
  fi
done
[ "$found" -eq 1 ] && exit 0 || exit 1
