# besidelog-9139 review record (kosmos#9139, the reading half: a red names the runs that went beside it)

Every round a fresh blind reviewer; each fix landed with an arm, shown red on the previous version where it was new.

- Round 1 (1be96386bd): 0 B, 3 MAJOR, 4 MINOR. Window started before the queue wait (-> from the turn); a run with no end
  line read as still going forever, times without a date (-> 7200 s bound, dates); the trim's rename lost lines under
  concurrent writers (-> mkdir lock). Minors: reused id, spaced id, malformed lines, weak arms. Control: 6 arms red.
- Round 2 (ff220a137c): 0 B, 1 MAJOR (test), 4 MINOR. 20-writer arm could go red under load (-> short hold, trim past
  500 back to 400, 10 s wait; 300/300 with 100 ms added per hold); stale lock left forever (-> broken past 10 s);
  contradictory summary; malformed arm could not fail.
- Round 3 (d20dd73450): 1 BLOCKER. BSD-first `stat -f %m` printed text then failed on GNU, so on Linux a contended
  writer wrote nothing and a stale lock was never broken (measured with a GNU-shaped stat: 90/300). -> GNU first, as
  launchagent-leak-guard.sh does; same probe 300/300. Minors: double stale break, unwritable dir spin, newlines.
- Round 4 (1cfc4a6391): 0 B, 0 MAJOR. set -e: writer could end a GitHub Actions step (-> every failure guarded, new arm,
  red on the partial fix); stale lock rechecked after rename.
- Round 5 (60eeeb1c63): 0 B, 0 MAJOR. Misspelled verb returned 2 (-> warns, 0); put-back could nest a lock; root makes
  the unwritable arm vacuous (-> reported as a skip); tr -s squeezed "_". All fixed.

Converged: rounds 4 and 5 found no BLOCKER or MAJOR. Linux is proven by the PR's shell shards (this file runs there).
