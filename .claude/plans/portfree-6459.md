# portfree-6459: the install gate's released/free checks ask who is listening

Card: kosmos#6459 (follow-up to #6457, filed by April). Stacked on portcheck-6457 for its `_ti_port_busy`.

## Change
- tools/test-install.sh: chk "port released (uninstall stopped the board itself)" and chk "port free before the belt
  pass" use `! _ti_port_busy $PORT`; wait_port_free's two probes use `_ti_port_busy "$PORT" || return 0`. The old
  `curl -m 1` (and `curl -fsS`, which also called any non-2xx answer free) read a loaded board as released.
- tools/test-install-portfree-6459.sh (in test:shell): the harness's own code against a silent listener. 9/9; on the
  unfixed harness 4 fail and both controls pass.

## Weakest premise
wait_port_free now reaches its kill pass whenever anything listens on $PORT. Round 1 checked all 15 callers: each runs
after a `kosmos stop` in a sandbox with no KeepAlive, so the kill set is unchanged and only its trigger moved.

## Status
- [x] Round 1 (opus): no blockers or warnings; three nits taken (grep scope comment, disown the listener, runtime note).
- [x] Round 2 (sonnet): one nit (the runtime is 15 to 25 s), taken. Converged.
- [ ] After #6457 lands: rebase onto main, validate, proof, PR, merge once the 0.7.56 hold lifts.
