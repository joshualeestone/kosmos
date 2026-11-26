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

## Split, measured (same Mac, 00:3x, load 10.5, 1,127 processes, two runs)
`ps -A` 0.05 to 0.07 s; the old per-line loop 0.91 to 1.32 s; the new filter 0.04 to 0.05 s. The loop is the cost, it
grows with load (0.2 ms a line at load 8, about 1 ms at 10.5, April's 10 ms at 17), and the filter replaces it.

## Weakest premise
That the loop's growth with load continues to April's 11 s; only load 8 to 10.5 is measured here.
