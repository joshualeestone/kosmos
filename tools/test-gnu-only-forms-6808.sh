#!/bin/bash
# kosmos#6808: product shell code must not gain a GNU-only form that only Linux understands.
#
# Since #6791 most of test:shell runs on Linux in PR CI. A test that needs macOS goes red there, loudly, but a GNU-only
# form in PRODUCT shell code (install/, bin/, the tools that run on people's Macs and ours) passes its test on Linux, and
# nothing in PR CI runs it on a Mac until the release cut. This lint closes that direction for the common forms. It
# reads the tree; it runs no product code, so it means the same on Linux and on a Mac.
#
# Flagged, each with the BSD counterpart that makes it the try-GNU-or-BSD idiom when it sits within 3 lines:
#   sed -i 's/..' f      (GNU: the script follows -i)      counterpart  sed -i '' ...      (or use -i.bak, fine on both)
#   date -d ...          (GNU date)                         counterpart  date -j / date -r
#   stat -c ...          (GNU stat)                         counterpart  stat -f
#   base64 -w N          (GNU base64)                       counterpart  base64 -b
#   timeout N ...        (GNU coreutils; no macOS command)  counterpart  command -v timeout
#   grep -P              (no BSD grep has it)               no counterpart: always flagged
#   find ... -printf     (GNU find)                         no counterpart: always flagged
# Not flagged: readlink -f (macOS has it since 12.3; Kosmos's floor is 13.5, MACOS_FLOOR in install/setup.sh).
#
# A line that is deliberately GNU-only (inside a Linux-only branch, say) says so on the line: `# gnu-ok: <why>`.
# Comment lines are not read. Test files (tools/test-*.sh, */test-*.sh, test/) are not product code: a GNU form in one
# goes red on the macOS full suite at the cut, and many are Linux-only on purpose.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
fail=0
ok() { echo "ok    $1"; }
bad() { echo "FAIL  $1"; fail=1; }

# The forms: name, the GNU-only pattern, the counterpart pattern ('' = none). ERE, so BSD and GNU grep read them alike.
B='(^|[;&|(`[:space:]])'   # a command starts here: line start, or after ; & | ( ` or a space
# One form per line: name, the GNU-only pattern, the counterpart pattern ('' = none), TAB-separated (the patterns hold |).
forms() {
    printf '%s\t%s\t%s\n' \
        sed-i "${B}sed([[:space:]]+-[a-zA-Z]+)*[[:space:]]+-[a-zA-Z]*i([[:space:]]|\$)" "${B}sed([[:space:]]+-[a-zA-Z]+)*[[:space:]]+-i[[:space:]]+(''|\"\")([[:space:]]|\$)" \
        date-d "${B}date([[:space:]]+-[a-zA-Z]+)*[[:space:]]+-[a-zA-Z]*d([[:space:]]|\$)" "${B}date([[:space:]]+-[a-zA-Z]+)*[[:space:]]+-[a-zA-Z]*[jr]([[:space:]]|\$)" \
        stat-c "${B}stat([[:space:]]+-[a-zA-Z]+)*[[:space:]]+-c" "${B}stat([[:space:]]+-[a-zA-Z]+)*[[:space:]]+-f" \
        base64-w "${B}base64([[:space:]]+-[a-zA-Z]+)*[[:space:]]+-w" "${B}base64([[:space:]]+-[a-zA-Z]+)*[[:space:]]+-b" \
        timeout "${B}timeout[[:space:]]+[0-9]" "command[[:space:]]+-v[[:space:]]+timeout" \
        grep-P "${B}grep([[:space:]]+-[a-zA-Z]+)*[[:space:]]+-[a-zA-Z]*P" "" \
        find-printf "${B}find[[:space:]].*[[:space:]]-printf([[:space:]]|\$)" ""
}

# scan_file <path> <label>: prints "<label>:<line>: <form>: <text>" for each unexcused hit.
scan_file() {
    f=$1; label=$2
    forms | while IFS="$(printf '\t')" read -r name pat cpat; do
        [ -n "$name" ] || continue
        grep -nE "$pat" "$f" 2>/dev/null | while IFS= read -r hit; do
            n=${hit%%:*}; text=${hit#*:}
            case "$text" in *"gnu-ok:"*) continue ;; esac
            # A comment line, whatever its indent.
            case "$(printf '%s' "$text" | sed 's/^[[:space:]]*//')" in '#'*) continue ;; esac
            # sed -i '' is the BSD form itself, not a hit.
            if [ "$name" = sed-i ] && printf '%s\n' "$text" | grep -qE "$cpat"; then
                printf '%s\n' "$text" | sed -E "s/-i[[:space:]]+(''|\"\")//" | grep -qE "$pat" || continue
            fi
            if [ -n "$cpat" ]; then
                lo=$((n > 3 ? n - 3 : 1)); hi=$((n + 3))
                sed -n "${lo},${hi}p" "$f" | grep -qE "$cpat" && continue
            fi
            printf '%s:%s: %s: %s\n' "$label" "$n" "$name" "$(printf '%s' "$text" | sed 's/^[[:space:]]*//' | cut -c1-120)"
        done
    done
}

# --- 1. the lint can go red, and the idioms it must allow stay green -----------------------------------------------
T=$(mktemp -d "${TMPDIR:-/tmp}/gnu-only-6808.XXXXXX") || { echo "FAIL  mktemp"; exit 1; }
trap 'rm -rf "$T"' EXIT
plant() { printf '#!/bin/sh\n%s\n' "$1" > "$T/p.sh"; scan_file "$T/p.sh" p; }
for case_ in \
    "sed-i|sed -i 's/a/b/' f" \
    "sed-i|sed -Ei 's/a/b/' f" \
    "sed-i|x=1; sed -i -e 's/a/b/' f" \
    "date-d|date -d '2026-01-01' +%s" \
    "date-d|t=\$(date -u -d \"\$iso\" +%s)" \
    "stat-c|stat -c %s f" \
    "base64-w|base64 -w0 f" \
    "timeout|timeout 5 curl x" \
    "grep-P|grep -P '\\d+' f" \
    "grep-P|grep -oP 'x' f" \
    "find-printf|find . -name x -printf '%p'"; do
    form=${case_%%|*}; line=${case_#*|}
    out=$(plant "$line")
    case "$out" in *": $form: "*) ok "flags $form: $line" ;; *) bad "did not flag $form in: $line (got '$out')" ;; esac
done
for line in \
    "sed -i '' 's/a/b/' f" \
    "sed -i.bak 's/a/b/' f" \
    "sed 's/a/b/' f | grep -i x" \
    "stat -c%s f 2>/dev/null || stat -f%z f" \
    "date -u -d \"\$1\" +%s 2>/dev/null || date -u -j -f '%Y' \"\$1\" +%s" \
    "base64 -w0 f 2>/dev/null || base64 -b0 f" \
    "command -v timeout >/dev/null && timeout 5 curl x" \
    "grep -E 'x' f" \
    "find . -name x -print" \
    "  # sed -i 's/a/b/' f in a comment" \
    "grep -P x f   # gnu-ok: this branch runs on Linux only" \
    "readlink -f x"; do
    out=$(plant "$line")
    [ -z "$out" ] && ok "allows: $line" || bad "flagged an allowed form: $line -> $out"
done
# The BSD-first-then-GNU idiom across lines, as the tree writes it (tools/build-kosmos-bundle.sh).
printf '#!/bin/sh\nsed -i %s "s/x/y/" f 2>/dev/null \\\n  || sed -i "s/x/y/" f\n' "''" > "$T/p.sh"
out=$(scan_file "$T/p.sh" p); [ -z "$out" ] && ok "allows sed -i '' then sed -i on the next line" || bad "flagged the two-line sed idiom: $out"
printf '#!/bin/sh\n%s\n\n\n\n\nsed -i "s/x/y/" f\n' "sed -i '' 's/x/y/' g" > "$T/p.sh"
out=$(scan_file "$T/p.sh" p); case "$out" in *": sed-i: "*) ok "CONTROL: a counterpart 5 lines away does not excuse it" ;; *) bad "a counterpart 5 lines away excused a GNU sed: '$out'" ;; esac

# --- 2. the tree: every product shell file, no unexcused GNU-only form ---------------------------------------------
# Tracked files that are shell: *.sh, or no extension with a sh/bash shebang. Not tests (see the header).
# (A function, not inline in $(...): bash 3.2, macOS's, cannot parse a case inside a command substitution.)
list_files() {
    git -C "$ROOT" ls-files | while IFS= read -r f; do
        case "$f" in tools/test-*|*/test-*.sh|test/*) continue ;; esac
        case "$f" in
            *.sh) printf '%s\n' "$f" ;;
            *.*) ;;
            *) case "$(head -1 "$ROOT/$f" 2>/dev/null)" in '#!/bin/sh'*|'#!/bin/bash'*|'#!/usr/bin/env bash'*|'#!/usr/bin/env sh'*) printf '%s\n' "$f" ;; esac ;;
        esac
    done
}
files=$(list_files)
count=$(printf '%s\n' "$files" | grep -c .)
# A floor, so a broken listing (not a git checkout, a moved tree) is red rather than a clean scan of nothing. 100 when
# written (117 product shell files on 2026-10-21).
[ "$count" -ge 100 ] && ok "scanned $count product shell files" || bad "only $count product shell files found (floor 100): the listing broke"
printf '%s\n' "$files" | grep -qx 'install/setup.sh' && ok "install/setup.sh is among them" || bad "install/setup.sh was not scanned"
hits=$(printf '%s\n' "$files" | while IFS= read -r f; do [ -n "$f" ] && scan_file "$ROOT/$f" "$f"; done)
if [ -z "$hits" ]; then
    ok "no product shell file has an unexcused GNU-only form"
else
    bad "GNU-only forms in product shell code (a Mac has no such option; add the BSD counterpart beside it, or '# gnu-ok: <why>' on a Linux-only line):"
    printf '%s\n' "$hits" | sed 's/^/      /'
fi

[ "$fail" = 0 ] && echo "gnu-only-forms: all passed" || echo "gnu-only-forms: FAILURES above"
exit "$fail"
