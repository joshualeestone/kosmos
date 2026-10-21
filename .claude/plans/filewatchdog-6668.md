# #6668: a per-file wall-clock limit in tools/run-tests.sh
**Measured N.** Sampled full suite (9785dbbbd9, 10-20 05:02-05:15): node --test children's lifetimes, mean load 18.7.

| file (sampled lifetime) | s | | file (summed test lines, four earlier logs, max) | s |
|---|---|---|---|---|
| server.dm-rollover-5841.test.js | 388 | | server.dm-rollover-5841.test.js | 595 |
| engine/remote.test.js | 363 | | engine/usage.test.js | 595 |
| tools.release-gate.test.js | 290 | | tools.release-gate.test.js | 446 |
| engine/usage.test.js | 221 | | engine/remote.test.js | 344 |
| engine/win32apply.test.js | 214 | | (that run 19.5 min, in the card's load ~10 window) | |

**N = 30 min** (3x the ~595 s estimate, 4.6x the 388 s sample), scaled, capped at 60 min. Per-test 600000 ms (slowest
test 183.5 s), scaled. Both print only on a node-part red ("off" if not started or node not found).
**Design.** A loop outside node, scoped by parent pid (only this runner's own node --test, by name or full path, and
its direct children), looking every 0.2 s for at most 25 looks while node is not found, then every 5 s (1 s under a 30
s limit). It TERMs a child older than N with its process tree, from one ps snapshot in which the root's ppid is node
(descendants not rechecked), KILLs 5 s later only live pids whose parent was in that snapshot or in a fresh such walk,
prints `TIMED OUT after <limit>` (minutes when whole, else seconds) and flags it, once per file (keyed on pid and start
time), in a file beside the run root (or in TMPDIR when no run root exists): red even if node said 0. Behind a non-exec
node shim (Volta) it watches node --test's only node --test child. Green runs print nothing more than "node --test not
found yet" (whenever node takes 5 s or more to start, at any limit) and "could not make the file watchdog's flag file".
**Not handled:** a reparented or daemonised descendant, or one re-parented to launchd in the grace (not KILLed;
survives if it ignores TERM); etime is wall clock (a host sleep can give a TIMED OUT red); a TERMed runner leaves its
node --test running without the per-file limit: stop the inner node too.
**Weakest premise:** one sampled run; **would change my mind:** a file past 10 min in a later sample. **Exits:** TERM
and Ctrl-C leave no watchdog (scaled liveness arms, trap and loop as a pair); the file loop honours a stop before each
file and each KILL, so a stop in a grace skips that KILL. #4273 is pre-existing (#6671). NITs left: a SIGKILLed test
run leaves its fixtures; a caller's _S applies unscaled; the watchdog can rewrite its flag files after the trap removed
them. **Red arms** (restored, cmp identical): watchdog off or root-only walk -> hang arms; no KILL -> TERM-ignoring
arm; limit 0 -> CONTROL; no stop checks -> stop arm; flag off/unscaled -> timeout arms; N unscaled/uncapped -> scaling
arm; limit on green -> silent arm; limit claimed when off -> off arm (skipped if 0555 is writable); limit on a non-node
red -> leak arm; no shim descent -> shim arm; grep 1 ms -> stall; manual: node never matched -> warning and "off (node
--test not found before the run ended)". **Unproven:** the exit trap alone, node-0 flag, pid-reuse, once-per-file,
no-run-root trap.
