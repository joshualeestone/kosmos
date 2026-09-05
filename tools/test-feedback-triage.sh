#!/usr/bin/env bash
# Functional test for `kosmos feedback triage` (#2246): exercises the CLI glue
# that bash -n cannot -- flag parsing, --dir, --since, --cards, exit codes, and
# the guarded per-file read -- against the real engine, not a mock. The sibling
# feedback verbs are only bash -n'd; the triage verb adds materially more shell
# logic, so it gets a real end-to-end run.
set -u

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$SELF_DIR/.." && pwd)"
NODE_BIN="$(command -v node)"
if [ -z "$NODE_BIN" ]; then echo "SKIP: no node on PATH"; exit 0; fi

fail() { echo "FAIL: $1"; exit 1; }

# A fake KOSMOS_HOME whose app/ is the repo (so app/engine/* resolves) and whose
# runtime/bin/node is the real node. The CLI resolves NODE and APP from here.
HOME_DIR="$(mktemp -d)"
REPORTS="$(mktemp -d)"
trap 'rm -rf "$HOME_DIR" "$REPORTS"' EXIT
ln -s "$REPO" "$HOME_DIR/app"
mkdir -p "$HOME_DIR/runtime/bin"
ln -s "$NODE_BIN" "$HOME_DIR/runtime/bin/node"
export KOSMOS_HOME="$HOME_DIR"

# Seed a --dir of reports: a recurring issue across two days, one sentiment
# line (noise), and one that matches an open card.
printf -- '---\ndate: 2026-09-01\n---\n- The export button label overlaps the icon.\n- Love it, works great!\n- The dock icon is easy to lose among other apps.\n' > "$REPORTS/2026-09-01.md"
printf -- '---\ndate: 2026-09-02\n---\n- The export button label is overlapping the icon again.\n' > "$REPORTS/2026-09-02.md"

run() { bash "$REPO/install/kosmos" feedback triage "$@"; }
# Extract the lines of one section (between its "## <header>" and the next "## ").
# Scoping assertions to a section is what makes them discriminate: the overlap
# item appearing ANYWHERE in the digest does not prove it was classed as a
# candidate rather than as noise.
section() { printf '%s\n' "$1" | awk -v h="$2" 'index($0,h){f=1;next} /^## /{f=0} f'; }

# 1. --dir: the recurring overlap issue is a CANDIDATE, the sentiment is NOISE.
out="$(run --dir "$REPORTS")" || fail "triage --dir exited non-zero"
printf '%s\n' "$out" | grep -q "No card was opened and nothing was changed" || fail "digest header missing the no-action statement"
section "$out" "## Candidates for review" | grep -qi "overlaps the icon\|overlapping the icon" \
  || fail "the overlap issue was not classed as a candidate (scoped to the Candidates section)"
section "$out" "## Below the bar" | grep -qi "Love it" \
  || fail "the sentiment line was not classed as noise (scoped to the Below-the-bar section)"

# 2. --since: only the later day is read.
out2="$(run --dir "$REPORTS" --since 2026-09-02)" || fail "triage --since exited non-zero"
printf '%s\n' "$out2" | grep -q "1 report(s)" || fail "--since did not restrict to one report: $(printf '%s' "$out2" | grep -i summary)"

# 3. --cards - (stdin): the dock item resembling an open card is FLAGGED in the
# "already carded" section, and is NOT also a fresh candidate.
out3="$(printf '%s\n' 'The dock icon is easy to lose among other applications' | run --dir "$REPORTS" --cards -)" || fail "triage --cards - exited non-zero"
section "$out3" "## Likely already carded" | grep -qi "dock icon" || fail "the dock item was not flagged as an open-card duplicate"
section "$out3" "## Candidates for review" | grep -qi "dock icon" && fail "the dock item was ALSO listed as a fresh candidate (should be dedup'd against the open card)"

# 4. a subdirectory named x.md must be skipped, not crash.
mkdir -p "$REPORTS/broken.md"
out4="$(run --dir "$REPORTS" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] || fail "a subdir named *.md crashed triage (rc=$rc) instead of being skipped"
printf '%s\n' "$out4" | grep -qi "skipping unreadable report: broken.md" || fail "the unreadable entry was not skipped with a note"
rmdir "$REPORTS/broken.md"

# 5. --since with a non-date value is refused with exit 2, in the CLI's voice.
run --dir "$REPORTS" --since not-a-date >/dev/null 2>&1; rc=$?
[ "$rc" -eq 2 ] || fail "a bad --since should exit 2, got $rc"

# 6. an unknown flag is refused with exit 2.
run --dir "$REPORTS" --bogus >/dev/null 2>&1; rc=$?
[ "$rc" -eq 2 ] || fail "an unknown flag should exit 2, got $rc"

echo "PASS: kosmos feedback triage (--dir, --since, --cards, guarded read, exit codes)"
