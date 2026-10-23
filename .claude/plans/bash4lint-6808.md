# bash4lint-6808: the #6808 lint also flags bash 4+ syntax

Card: kosmos#6808, scope addition of 2026-10-21 08:04 (from #6799's challenge loop, iteration 7). PR #6811 built the
GNU-only half; this is the bash 4+ half, which was named on the card and never built.

## Finished looks like
`bash tools/test-gnu-only-forms-6808.sh` (already in test:shell) goes red on a bash 4+ form in any product shell file,
stays green on the current tree and on bash 3.2 lookalikes, and runs under the Mac's bash 3.2.

## Change
- tools/test-gnu-only-forms-6808.sh: ten bash4-* forms in forms(), no counterpart (always flagged): mapfile/readarray,
  declare|local|typeset -A/-n, ${x,,} ${x^^} (single forms too, names, positionals, @ and *, subscripts), ${x@Q} and
  the other @ transforms, |&, &>>, ;;& and ;&, coproc, shopt -s globstar|lastpipe, $EPOCHSECONDS/EPOCHREALTIME.
- `# bash4-ok: <why>` excuses a bash4 hit; `# gnu-ok:` excuses only GNU hits and the reverse (two controls).
- 19 planted flags, 15 planted lookalikes allowed (${x:-a,b}, ${#a[@]}, ${!a[@]}, ${x//a/b}, ||, >>, ;;, nullglob,
  an HTML entity after a pipe, $SECONDS, mapfile=1, ...).

## Decided
- Same script, not a second one: the same file list, comment skip and per-line excuse apply, and test:shell needs no
  new wiring. Rejected: running test:shell on macOS bash 3.2 in PR CI (that is the macOS job; it already runs, and the
  point is that bash -n and a passing test do not execute every line).
- Rejected: one shared excuse word. A Linux-only GNU line and a bash4 line are different claims.

## Weakest premise
That these are the common forms. It is a floor: wait -n, read -N/-i, ${a[-1]}, brace steps, $BASHPID and
printf %(fmt)T are named in the header as not covered. Bash 5 was not available locally; the Linux shards run it.

## Validation
- /bin/bash 3.2.57: 86 ok, exit 0; scanned 123 product shell files, clean.
- Control: mapfile appended to install/kosmos-report-hook.sh -> exit 1 naming that line; file restored.
