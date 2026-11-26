# #9117: the leak guard's process scans walk only the lines that name the root

## Problem (April's measurement on the card)
`leak_process_check` and `leak_process_stop_root` in tools/lib/test-leak-guard.sh took a `ps -A` snapshot of every
process, then ran a bash `read <<<` and a `leak_names_root` call per line. With 1,139 processes at load ~17 a scan took
about 11 s, and a run's wind-down took 6 to 90 s.

## Change
`leak_root_lines <snapshot> <root> <real>`: one awk pass keeps only lines containing the root in either spelling. Every
pattern in leak_names_root contains one of the two, so no dropped line could have matched. All three per-line loops
(the two passes and the KILL pass in leak_process_check, and leak_process_stop_root) read the filtered lines.
leak_names_root still judges each kept line, so exactness (kt42 vs kt429, #6698) is unchanged. The paths go to awk
through ENVIRON, not -v, so a backslash is literal; index() makes a dot literal.

## Measured (this Mac, 11-26 00:2x, load about 8, 1,100 processes, a fixture with a real orphan)
- main: check 0.2 s, stop_root 0.3 s. This branch: 0.1 s, 0.1 s.
- Both stop an orphan naming the root, and both leave a /tmp/kt429 lookalike alone.
- NOT reproduced: the card's 11 s per scan. At load 8 the old loop cost about 0.2 ms a line, not 10. The loop's line
  count drops from about 1,100 to the few that name the root, but the gain at load 17 is reasoned, not measured.

## Tests (tools/test-test-leak-guard-4273.sh, 82 checks, all pass)
5 new: the filter keeps only root lines (either spelling); a dot is literal; a backslash is literal; CONTROL: a kept
lookalike is still refused by leak_names_root; all 3 loops read the filtered lines.
Perturbations: no filter -> 2 new checks red; one loop back on the whole snapshot -> the wiring check red.

## Weakest premise
That the per-line bash loop is what made April's scans slow. If `ps -A` itself was the slow part under load, this
change helps little. The measurement that would settle it is a timed scan at load 15 or more, split into ps and loop.
