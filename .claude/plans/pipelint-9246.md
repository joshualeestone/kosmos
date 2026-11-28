# kosmos#632 pipe lint on tools/test-queued-heavy-4977.sh (from #9246; reported by Baron Draxum, m7317)

main 6969a70584 fails the pre-commit pipe lint on seven lines of tools/test-queued-heavy-4977.sh, last touched by my
#9246 branch. A merge of main into any branch stages the file and is refused; a rebase is not.

Each flagged status read was checked and reads its OWN command's status, not a pipe's:
- 693, 868, 895, 912: `until_true ...; x=$?`. until_true returns its own 0 or 1 (`while ! eval "$2"; ...`).
- 819, 824, 951: `o=$(...); x=$?`, the command substitution on the same line.
The pipes the lint saw sit inside quoted until_true conditions or helper functions on the line before.

Fix: `# pipe-status-ok` on the five lines whose status line has no pipe of its own. 868 and 895 carry the pipe on
the status line itself (inside the quoted condition), where the hook rightly refuses the marker, so each condition
moved verbatim into a named function (tftb_up, k9191_ready) and the until_true call names it.
Measured: the hook's own lint program (extracted between its PIPE-LINT markers) lists the seven lines on main and
none after; a clean file gives none (control). The test itself passes after (queued run).
Not done: no behaviour change was intended or made; nothing else in the file changed.
