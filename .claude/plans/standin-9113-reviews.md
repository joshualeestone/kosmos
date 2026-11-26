# standin-9113 review record (#9113)

## Round 1 (blind reviewer, at 402cac4966)
- No BLOCKER, no MAJOR.
- Mechanism confirmed by probe in three stages: fork to first exec (parent's argv, neither gate scan matches: the only window
  in which the gate misses the stand-in); after bash -c exec (first scan already matches); after exec -a (final form).
- The reproduction is valid only if the delay sits before the first exec: it did, `( sleep 1; exec bash -c ... ) &`.
- MINOR: a stand-in killed before its first exec is a fork of the test and would run its EXIT trap (deletes $W). Fixed in
  ba6cd7ad47: `( trap - EXIT; exec bash -c ... ) &`, the form the server start already uses.
- NIT: /bin/ps comment named a reason that did not hold (standin is never called under the fake-ps PATH). Reworded.
- NIT: comment implied the window lasts to the final exec. Reworded: it ends at the FIRST exec; the wait is stricter.
- Checked clean: match for all three state-dir spellings, fake ps and fake pgrep cases, fail counting, leftovers, bash 3.2,
  macOS-only (tools/shell-macos-only.txt).

## Round 2 (fresh blind reviewer, at ba6cd7ad47)
- No BLOCKER, no MAJOR. Converged.
- Probed: $! of `( trap - EXIT; exec bash -c ... ) &` is the pid that ends up as the stand-in; kill + wait returns 143 and it
  is gone; the subshell did not run the parent's EXIT trap. Suite 57/0, rc 0, bash 3.2.57.
- The wait also fixes the PASS-expecting stand-in rows, which could earlier pass before the stand-in was up.
- NIT (accepted, no change): SECONDS is whole seconds, so the deadline is 9 to 10 s.
- NIT (accepted, no change): a sub-millisecond fork-to-trap window remains; the only kill that could land there comes 10 s later.
- Note, pre-existing: the final leftover check counts only kosmos-gate-stub-$TAG, not stand-ins; each is unstood on its own line.
