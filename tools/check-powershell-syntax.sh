#!/usr/bin/env bash
# Parse-check every shipped .ps1 on THIS machine, with no Windows box.
#
# 🛑 WHY THIS EXISTS. `test:shell` `bash -n`s roughly forty shipped scripts and
# knew nothing about PowerShell, so the Windows installer -- the one file that
# runs on a stranger's machine and deletes things -- was the only shipped script
# with no parse check at all.
#
# I found that out the expensive way: I rewrote it, introduced an escape bug
# (a backslash where PowerShell wants a backtick, inside an interpolating
# here-string), and to find out whether it parsed I restarted an EC2 Windows box.
# **The restart then failed to deliver the check anyway.** A defect that needs a
# cloud machine to detect is a defect that ships whenever the machine is down or
# nobody remembers.
#
# ⚠️ HONEST LIMIT, SO NOBODY OVERTRUSTS A GREEN. `pwsh` is PowerShell CORE 7.
# The shipped installer targets WINDOWS POWERSHELL 5.1. The parsers are close
# but not identical, and a Core-clean script can still surprise 5.1 at RUNTIME
# -- cmdlet availability, .NET differences, `-Proxy` behaviour. **This checks
# SYNTAX AND ESCAPES, which is exactly the class of bug that sent me to EC2, and
# it is not a substitute for running the thing on Windows.**
#
# 📌 SKIPS RATHER THAN FAILS when `pwsh` is absent, because it is not installed
# on every machine and a missing optional tool must not turn a whole suite red.
# It says so out loud: a silent skip would be indistinguishable from a pass,
# which is the false-zero shape this repo keeps paying for.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v pwsh >/dev/null 2>&1; then
  echo "SKIP  check-powershell-syntax: pwsh is not installed on this machine."
  echo "      The shipped .ps1 files were NOT parse-checked. This is a skip, not a pass."
  echo "      Install with: brew install powershell"
  exit 0
fi

# find, not a glob: a bare glob silently matches nothing when a directory is
# empty, and zsh aborts the whole command on a non-matching glob.
# ⚠️ NOT `mapfile`: that is bash 4+, and macOS ships bash 3.2, where it is
# "command not found" -- measured, on the machine this was written on.
FILES="$(find "$REPO/install" -name '*.ps1' -type f 2>/dev/null | sort)"

if [ -z "$FILES" ]; then
  echo "SKIP  check-powershell-syntax: no .ps1 files under install/."
  exit 0
fi

fail=0
checked=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  rel="${f#"$REPO"/}"
  out="$(pwsh -NoProfile -File "$REPO/tools/lib/ps-parse.ps1" "$f" 2>&1)" || true
  if printf '%s' "$out" | grep -q '^OK '; then
    printf 'PASS  %s  (%s)\n' "$rel" "$(printf '%s' "$out" | sed 's/^OK //')"
  else
    printf 'FAIL  %s\n' "$rel"
    printf '%s\n' "$out" | sed 's/^/        /'
    fail=1
  fi
  checked=$((checked + 1))
done <<EOF
$FILES
EOF

# ── phase 2: RENDER, because parsing cannot see an interpolation bug ─────────
# 🛑 THE BUG THAT SENT ME TO AN EC2 BOX PARSES CLEAN. `\$foo` inside an
# interpolating here-string is not a syntax error; it renders as a bare
# backslash with the variable eaten. Measured, both arms, before writing this.
# ⇒ A parse check is necessary and NOT sufficient, and saying so here matters
# more than the check itself: the previous sentence anybody would have written
# is "pwsh would have caught it", and that is false.
while IFS= read -r f; do
  [ -n "$f" ] || continue
  rel="${f#"$REPO"/}"
  rout="$(pwsh -NoProfile -File "$REPO/tools/lib/ps-render.ps1" "$f" 2>&1)" || true
  susp="$(printf '%s' "$rout" | grep -c 'SUSPECT' || true)"
  if [ "${susp:-0}" -gt 0 ]; then
    printf 'FAIL  %s  a here-string renders wrong (see below)\n' "$rel"
    printf '%s\n' "$rout" | sed 's/^/        /'
    fail=1
  else
    printf 'PASS  %s  (%s, no backslash-dollar)\n' "$rel" "$(printf '%s' "$rout" | head -1)"
  fi
done <<EOF
$FILES
EOF

# ✅ A FLOOR. Without it, a `find` typo yields an empty loop, zero output and a
# clean exit -- indistinguishable from every file passing.
if [ "$checked" -eq 0 ]; then
  echo "FAIL  no .ps1 files were actually checked, so this run proves nothing."
  exit 1
fi

# ✅ A CONTROL FOR THE RENDER PHASE, WHICH HAD NONE. The plan claimed "both
# phases carry a control that runs every time"; measured by a reviewer, that was
# FALSE -- gutting ps-render.ps1 to `exit 0` left the checker reporting PASS.
# The phase I called "the one that matters" was the unguarded one.
rbroken="$(mktemp -t kosmos-ps-rcontrol-XXXXXX)"; mv "$rbroken" "$rbroken.ps1"; rbroken="$rbroken.ps1"
printf '$x = @"\nplanted `rmdir and a \\$var\n"@\n' > "$rbroken"
rctl="$(pwsh -NoProfile -File "$REPO/tools/lib/ps-render.ps1" "$rbroken" 2>&1)" || true
rm -f "$rbroken"
if printf '%s' "$rctl" | grep -q 'SUSPECT'; then
  echo "PASS  CONTROL: the render phase detects a planted backtick and backslash-dollar."
else
  echo "FAIL  CONTROL: the render phase did NOT flag a planted defect, so every render PASS above is worthless."
  printf '%s\n' "$rctl" | sed 's/^/        /'
  fail=1
fi

# ✅ THE CONTROL. A checker that has only ever returned PASS has never been
# shown capable of returning FAIL. Feed it something known-broken and require
# the other answer, every run, so a green here means the instrument works.
broken="$(mktemp -t kosmos-ps-control-XXXXXX)"
mv "$broken" "$broken.ps1"; broken="$broken.ps1"
printf 'function {{{ broken\n' > "$broken"
ctl="$(pwsh -NoProfile -File "$REPO/tools/lib/ps-parse.ps1" "$broken" 2>&1)" || true
rm -f "$broken"
if printf '%s' "$ctl" | grep -q '^OK '; then
  echo "FAIL  CONTROL: a deliberately broken script PARSED CLEAN, so this checker cannot detect a syntax error and every PASS above is worthless."
  fail=1
else
  echo "PASS  CONTROL: a deliberately broken script is rejected, so the checker can say no."
fi

exit "$fail"
