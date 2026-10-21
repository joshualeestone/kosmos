# tmuxisolate-6852 — isolate the Linux systemd live test's tmux onto a private server (Related to #6851)

## Problem

`tools/test-linux-systemd-live-4918.sh` makes bare tmux calls (`has-session`, `kill-session`, and
two `kill-server` at the then-lines 229/274). A bare tmux call uses the server named by `$TMUX` when
that is set. The test runs only in CI (a dedicated box, no `$TMUX`), so it is safe there, but if it
were run from inside an agent pane the inherited `$TMUX` would send `kill-server` to that pane's
server, taking the default/fleet tmux server (and every agent on it) down. This is the hazard class
behind #6851 (the Agent1s default-server death).

## Measured fact (throwaway repro on Mortals, from the #6851 audit)

An inherited `$TMUX` outranks `TMUX_TMPDIR`: a bare tmux command with `$TMUX` set to server A and
`TMUX_TMPDIR` pointing at server B answered from A. So a private `TMUX_TMPDIR` alone does not protect
a bare call from an agent pane; `-L`/`-S` or unsetting `$TMUX` does.

## Fix (test-only)

Near the top of the script, right after `TMPDIR_ROOT` is made and before any agent is created:
- `export TMUX_TMPDIR="$TMPDIR_ROOT/tmux"` (+ `mkdir -p`) — a private server under the test's temp root.
- `unset TMUX TMUX_PANE` — so the bare calls land on that private server, not an inherited one.

`engine/linuxjob.js:285` copies `TMUX_TMPDIR` into each agent's systemd unit `Environment=`, so the
systemd-launched agents use the same private server and the bare `has-session` checks still match.
The two `kill-server` calls (kept bare, now with a pointer comment) then reset only this test's
private server, never the default one. CI behaviour is unchanged (no `$TMUX` there), and
`TMPDIR_ROOT` (which now contains the private tmux dir) is already removed in `cleanup()`.

## Done when

1. The script sets a private `TMUX_TMPDIR` and unsets `$TMUX`/`$TMUX_PANE` before any agent is created.
2. `bash -n` passes.
3. The two `kill-server` calls can no longer reach the default server from an agent pane.

## Verification

`bash -n` passes. The live test runs only in CI (a real systemd + tmux Linux box), so it is not run
locally; the change is a shell-env isolation whose effect is argued above and matched to
`linuxjob.js`'s `TMUX_TMPDIR` propagation. shellcheck is not installed on this box.

## Scope

Related to #6851 (the incident). Addresses #6852 (this hardening card). Reviewer: Scorpion. kosmos
main is under the 0.7.62 merge hold, so this PR is built and opened now and merges after the lift.
