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
# Long spellings too (--in-place, --date, --format, --wrap, --perl-regexp). A counterpart excuses a hit only on the same
# line joined by ||, or on the line directly beside it (see scan_file).
# Not flagged: readlink -f (macOS has it since 12.3; Kosmos's floor is 13.5, MACOS_FLOOR in install/setup.sh).
# A FLOOR, NOT A PROOF. Known gaps, so nobody reads green as more: each line is read alone, so a form after a
# backslash-continued line (`find . \` then `-printf`) is missed; other GNU-only tools and options (tac, head -n -N,
# du -b, sha256sum on older macOS, sed's \n in a replacement) are not on the list. And two over-reaches that
# `# gnu-ok:` settles: `git grep -P` is flagged (it works only where git was built with PCRE), and so is the word
# a form inside a quoted string (B counts a quote as a command start, for `bash -c "sed -i ..."`), e.g. an echo of usage.
#
#
# Bash 4+ syntax, the other half of the same gap: the Linux shards run every script under bash 5, a Mac runs it under
# bash 3.2, and `bash -n` on 3.2 accepts most of these (they fail only when the line runs). No counterpart, always
# flagged: mapfile / readarray, declare|local|typeset -A or -n, ${x,,} ${x^^} (and the single forms), ${x@Q} and the
# other @ transforms, |& , &>> , ;;& and ;& in a case, coproc, shopt -s globstar|lastpipe, $EPOCHSECONDS/EPOCHREALTIME.
# Also a floor: wait -n, read -N / -i, ${a[-1]}, {1..9..2}, $BASHPID and printf %(fmt)T are not on the list.
#
# A line that is deliberately GNU-only (inside a Linux-only branch, say) says so on the line: `# gnu-ok: <why>`; a line
# that deliberately needs bash 4+ says `# bash4-ok: <why>`. Each excuses only its own kind.
# Comment lines are not read. Test files (tools/test-*.sh, */test-*.sh, test/) are not product code: a GNU form in one
# goes red on the macOS full suite at the cut, and many are Linux-only on purpose.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
fail=0
ok() { echo "ok    $1"; }
bad() { echo "FAIL  $1"; fail=1; }

# Where a command starts: line start, or after ; & | ( { ` a quote, a slash (/usr/bin/sed) or a space.
B="(^|[;&|(\`{\"'/[:space:]])"
O='([[:space:]]+-[a-zA-Z0-9]+)*'   # earlier short flags (-m1 -o ...) before the one that matters
# One form per line: name, the GNU-only pattern, the counterpart pattern ('' = none), TAB-separated (the patterns hold |).
forms() {
    printf '%s\t%s\t%s\n' \
        sed-i "${B}sed${O}[[:space:]]+(-[a-zA-Z]*i([[:space:]]|\$)|--in-place)" "${B}sed${O}[[:space:]]+-[a-zA-Z]*i[[:space:]]+(''|\"\")([[:space:]]|\$)" \
        date-d "${B}date${O}[[:space:]]+(-[a-zA-Z]*d([^a-zA-Z]|\$)|--date)" "${B}date${O}[[:space:]]+-[a-zA-Z]*[jr]([^a-zA-Z]|\$)" \
        stat-c "${B}stat${O}[[:space:]]+(-[a-zA-Z]*c|--format|--printf)" "${B}stat${O}[[:space:]]+-[a-zA-Z]*f" \
        base64-w "${B}base64${O}[[:space:]]+(-[a-zA-Z]*w|--wrap)" "${B}base64${O}[[:space:]]+-[a-zA-Z]*b" \
        timeout "${B}timeout[[:space:]]+(-|\"?\\\$|[0-9])" "command[[:space:]]+-v[[:space:]]+timeout" \
        grep-P "${B}grep${O}[[:space:]]+(-[a-zA-Z]*P|--perl-regexp)" "" \
        find-printf "${B}find[[:space:]].*[[:space:]]-f?printf([[:space:]]|\$)" ""
    # Bash 4+ (kosmos#6808 scope addition). Single-quoted where they hold $ or `, so nothing expands.
    V='([A-Za-z_][A-Za-z0-9_]*|[0-9]+|[@*])(\[[^]]*\])?'
    printf '%s\t%s\t%s\n' \
        bash4-mapfile "${B}(mapfile|readarray)([[:space:]]|\$)" "" \
        bash4-declare "${B}(declare|local|typeset)${O}[[:space:]]+-[a-zA-Z]*[An]([[:space:]]|\$)" "" \
        bash4-case-mod '\$\{'"$V"'(,|\^)' "" \
        bash4-transform '\$\{'"$V"'@[QEPAaKkUuL]\}' "" \
        bash4-pipe-amp '(^|[^|])\|&([[:space:]]|$)' "" \
        bash4-append-both '&>>' "" \
        bash4-case-fall ';;&|(^|[[:space:]]);&([[:space:]]|$)' "" \
        bash4-coproc "${B}coproc([[:space:]]|\$)" "" \
        bash4-shopt "${B}shopt[[:space:]]+-s[[:space:]].*(globstar|lastpipe)" "" \
        bash4-epoch '\$\{?EPOCH(SECONDS|REALTIME)' ""
}

# scan_file <path> <label>: prints "<label>:<line>: <form>: <text>" for each unexcused hit.
# A hit is excused by its BSD counterpart only where the two are one decision: on the SAME line joined by ||, or on
# the line directly before or after (the tree's idioms: `cmd -bsd ... \` then `|| cmd -gnu ...`, `date -r ... &&
# return 0` above `date -d ...`, and an if/else on two lines). Further away it is someone else's command.
# unchained_pieces <line>: prints one x per ;/&&-separated piece of the line that holds a GNU form ($name, $pat) without
# its counterpart ($cpat) and a || in that same piece. A function, not inline in $(...): bash 3.2 cannot parse a case
# inside a command substitution.
unchained_pieces() {
    # Split at ; and && OUTSIDE quotes only: `sed -i 's/a/b/;s/c/d/'` is one command. A backslash outside single quotes
    # takes the next character with it, so `\"` or `\'` never opens a quote that would swallow the rest of the line
    # (and with it the split points: that would only ever excuse a GNU form).
    printf '%s\n' "$1" | awk '{
        out = ""; q = ""; n = length($0)
        for (i = 1; i <= n; i++) {
            c = substr($0, i, 1)
            if (c == "\\" && q != "\047") { out = out c substr($0, i + 1, 1); i++; continue }
            if (q != "") { if (c == q) q = ""; out = out c; continue }
            if (c == "\047" || c == "\"") { q = c; out = out c; continue }
            if (c == ";") { out = out "\n"; continue }
            if (c == "&" && substr($0, i + 1, 1) == "&") { out = out "\n"; i++; continue }
            out = out c
        }
        print out
    }' | while IFS= read -r piece; do
        g=$piece
        [ "$name" = sed-i ] && g=$(printf '%s\n' "$piece" | sed -E "s/-([a-zA-Z]*)i[[:space:]]+(''|\"\")/-\\1/g")
        printf '%s\n' "$g" | grep -qE "$pat" || continue
        case "$piece" in *'||'*) printf '%s\n' "$piece" | grep -qE "$cpat" && continue ;; esac
        echo x
    done
}

scan_file() {
    f=$1; label=$2
    forms | while IFS="$(printf '\t')" read -r name pat cpat; do
        [ -n "$name" ] || continue
        grep -nE "$pat" "$f" 2>/dev/null | while IFS= read -r hit; do
            n=${hit%%:*}; text=${hit#*:}
            case "$name" in
                bash4-*) case "$text" in *"bash4-ok:"*) continue ;; esac ;;
                *) case "$text" in *"gnu-ok:"*) continue ;; esac ;;
            esac
            # A comment line, whatever its indent.
            case "$(printf '%s' "$text" | sed 's/^[[:space:]]*//')" in '#'*) continue ;; esac
            if [ -n "$cpat" ]; then
                if printf '%s\n' "$text" | grep -qE "$cpat"; then
                    # `command -v timeout ... && timeout N` guards with &&, not ||.
                    [ "$name" = timeout ] && continue
                    # Otherwise the two must be one || chain: split the line at ; and &&, and every piece that holds a
                    # GNU form must hold the counterpart and a || too (a trailing `|| true` elsewhere excuses nothing).
                    # For sed, the BSD `-i ''` is taken out of a piece first, since it matches the GNU pattern as well.
                    left=$(unchained_pieces "$text")
                    [ -z "$left" ] && continue
                fi
                if [ "$n" -gt 1 ]; then near="$((n - 1))p;$((n + 1))p"; else near="$((n + 1))p"; fi
                sed -n "$near" "$f" | grep -qE "$cpat" && continue
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
    "find-printf|find . -name x -printf '%p'" \
    "sed-i|sed --in-place 's/a/b/' f" \
    "sed-i|sed -i '' 's/x/y/' a && sed -i 's/p/q/' b" \
    "sed-i|sed -i '' 's/x/y/' a && sed -i 's/p/q/' b || true" \
    "stat-c|stat -f %z a; stat -c %s b || exit 1" \
    "stat-c|echo \"a\\\"b\"; stat -c %s b; y || stat -f %z a" \
    "stat-c|echo it\\'s; stat -c %s b; x || stat -f %z a" \
    "sed-i|bash -c \"sed -i 's/a/b/' f\"" \
    "sed-i|/usr/bin/sed -i 's/a/b/' f" \
    "date-d|date -d@123 +%s" \
    "date-d|date --date=now +%s" \
    "stat-c|stat -Lc %s f" \
    "stat-c|stat --format=%s f" \
    "base64-w|base64 --wrap=0 f" \
    "timeout|timeout \"\$T\" curl x" \
    "grep-P|grep -m1 -oP 'x' f" \
    "grep-P|grep --perl-regexp x f" \
    "bash4-mapfile|mapfile -t lines < f" \
    "bash4-mapfile|readarray arr < <(ls)" \
    "bash4-declare|declare -A seen" \
    "bash4-declare|local -gA map=()" \
    "bash4-declare|local -n ref=\$1" \
    "bash4-declare|typeset -r -A k" \
    "bash4-case-mod|x=\${name,,}" \
    "bash4-case-mod|echo \"\${1^^}\"" \
    "bash4-case-mod|y=\${arr[0]^}" \
    "bash4-transform|printf '%s' \"\${v@Q}\"" \
    "bash4-pipe-amp|make |& tee log" \
    "bash4-append-both|cmd &>> log" \
    "bash4-case-fall|  a) x ;;&" \
    "bash4-case-fall|  a) x ;&" \
    "bash4-coproc|coproc nc -l 1" \
    "bash4-shopt|shopt -s globstar" \
    "bash4-shopt|shopt -s nullglob lastpipe" \
    "bash4-epoch|now=\$EPOCHSECONDS" \
    "bash4-epoch|t=\${EPOCHREALTIME}"; do
    form=${case_%%|*}; line=${case_#*|}
    out=$(plant "$line")
    case "$out" in *": $form: "*) ok "flags $form: $line" ;; *) bad "did not flag $form in: $line (got '$out')" ;; esac
done
for line in \
    "sed -i '' 's/a/b/' f" \
    "sed -i.bak 's/a/b/' f" \
    "sed -Ei '' 's/a/b/' f" \
    "sed -i '' 's/a/b/;s/c/d/' f 2>/dev/null || sed -i 's/a/b/;s/c/d/' f" \
    "date -d \"\$x\" '+%H;%M' 2>/dev/null || date -j -f '%s' \"\$x\" '+%H;%M'" \
    "pgrep -P 1" \
    "sed 's/a/b/' f | grep -i x" \
    "stat -c%s f 2>/dev/null || stat -f%z f" \
    "date -u -d \"\$1\" +%s 2>/dev/null || date -u -j -f '%Y' \"\$1\" +%s" \
    "base64 -w0 f 2>/dev/null || base64 -b0 f" \
    "command -v timeout >/dev/null && timeout 5 curl x" \
    "grep -E 'x' f" \
    "find . -name x -print" \
    "  # sed -i 's/a/b/' f in a comment" \
    "grep -P x f   # gnu-ok: this branch runs on Linux only" \
    "readlink -f x" \
    "declare -a list" \
    "local -r x=1" \
    "x=\${name:-a,b}" \
    "n=\${#arr[@]}" \
    "keys=\${!arr[@]}" \
    "y=\${x//a/b}" \
    "a || b" \
    "cmd >> log 2>&1" \
    "cmd > log 2>&1 &" \
    "  a) x ;;" \
    "shopt -s nullglob" \
    "echo '|&#8217;'" \
    "now=\$SECONDS" \
    "mapfile=1" \
    "mapfile -t x < f   # bash4-ok: this script is run by the Linux service only"; do
    out=$(plant "$line")
    [ -z "$out" ] && ok "allows: $line" || bad "flagged an allowed form: $line -> $out"
done
# Each excuse clears only its own kind: a bash4-ok line still has its GNU form flagged, and the other way round.
out=$(plant "grep -P x f   # bash4-ok: wrong excuse"); case "$out" in *": grep-P: "*) ok "CONTROL: bash4-ok does not excuse a GNU form" ;; *) bad "bash4-ok excused grep -P: '$out'" ;; esac
out=$(plant "declare -A m   # gnu-ok: wrong excuse"); case "$out" in *": bash4-declare: "*) ok "CONTROL: gnu-ok does not excuse a bash 4 form" ;; *) bad "gnu-ok excused declare -A: '$out'" ;; esac
# The BSD-first-then-GNU idiom across lines, as the tree writes it (tools/build-kosmos-bundle.sh).
printf '#!/bin/sh\nsed -i %s "s/x/y/" f 2>/dev/null \\\n  || sed -i "s/x/y/" f\n' "''" > "$T/p.sh"
out=$(scan_file "$T/p.sh" p); [ -z "$out" ] && ok "allows sed -i '' then sed -i on the next line" || bad "flagged the two-line sed idiom: $out"
printf '#!/bin/sh\n%s\n\n\n\n\nsed -i "s/x/y/" f\n' "sed -i '' 's/x/y/' g" > "$T/p.sh"
out=$(scan_file "$T/p.sh" p); case "$out" in *": sed-i: "*) ok "CONTROL: a counterpart 5 lines away does not excuse it" ;; *) bad "a counterpart 5 lines away excused a GNU sed: '$out'" ;; esac
printf '#!/bin/sh\nstat -f %%z a\nx=1\nstat -c %%s b\n' > "$T/p.sh"
out=$(scan_file "$T/p.sh" p); case "$out" in *": stat-c: "*) ok "CONTROL: a BSD stat for another file 2 lines up does not excuse a GNU one" ;; *) bad "a BSD stat 2 lines away excused a GNU stat: '$out'" ;; esac
# The tree's other two-line shapes: a BSD try above with && return, and an if/else (tools/lib/cut-guard.sh, site-deploy-kick.sh).
printf '#!/bin/sh\n  date -r "$e" +%%H 2>/dev/null && return 0\n  date -d "@$e" +%%H 2>/dev/null && return 0\n' > "$T/p.sh"
out=$(scan_file "$T/p.sh" p); [ -z "$out" ] && ok "allows a BSD date on the line above a GNU one" || bad "flagged the date -r / date -d pair: $out"

# --- 2. the tree: every product shell file, no unexcused GNU-only form ---------------------------------------------
# Tracked files that are shell: *.sh, or no extension with a sh/bash shebang. Not tests (see the header).
# (A function, not inline in $(...): bash 3.2, macOS's, cannot parse a case inside a command substitution.)
list_files() {
    git -C "$ROOT" ls-files | while IFS= read -r f; do
        case "$f" in tools/test-*|*/test-*.sh|test/*) continue ;; esac
        case "$f" in
            *.sh) printf '%s\n' "$f" ;;
            *.*) ;;
            *) case "$(head -1 "$ROOT/$f" 2>/dev/null)" in '#!/bin/sh'*|'#!/bin/bash'*|'#! /bin/sh'*|'#! /bin/bash'*|'#!/usr/bin/env bash'*|'#!/usr/bin/env sh'*|'#!/usr/bin/env -S bash'*) printf '%s\n' "$f" ;; esac ;;
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
    ok "no product shell file has an unexcused GNU-only form or bash 4+ syntax"
else
    bad "GNU-only forms or bash 4+ syntax in product shell code (a Mac has neither: add the BSD counterpart beside a GNU form, write bash 3.2 instead of bash 4, or put '# gnu-ok: <why>' / '# bash4-ok: <why>' on a Linux-only line):"
    printf '%s\n' "$hits" | sed 's/^/      /'
fi

[ "$fail" = 0 ] && echo "gnu-only-forms: all passed" || echo "gnu-only-forms: FAILURES above"
exit "$fail"
