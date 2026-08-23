# clean-machine: #224's sudo-free half, and the two served defects it caught

## What finished looks like

tools/clean-machine.sh walks the SERVED installer (fetched from HOST,
default installkosmos.com, never this repo's copy) through three legs in a
sandbox that a stranger's Mac would recognise: REFUSAL (a clean HOME has
no Claude Code and the named sentence stops the install), WALK (the whole
path: download, checksum, staging, bundle, board answering with the
version latest.json claims), REMOVAL (uninstall takes it all down,
presence asserted before absence so a failed install cannot make the leg
vacuous). The real machine is witnessed before and after: shell profiles
by checksum, LaunchAgents by listing, and the launchd DOMAIN by label
path, because serving and supervised are different properties and a file
listing cannot see the second.

## What the sandbox has to hide, each learned by measurement

- PATH sanitized: the operator's claude leaks into command -v otherwise.
- TMUX and TMUX_PANE unset: $TMUX names the real server's socket and a
  client follows it past TMUX_TMPDIR; the sandboxed board listed the
  operator's sixteen live agents through three env layers.
- TMUX_TMPDIR sandboxed: sockets key on UID under /tmp, not HOME.
- AGENT_WORKFORCE_LAUNCH sandboxed: launchd has no sandbox, and a run of
  this harness bootstrapped its temp plist over the product's real label
  while the file witness stayed green (Mona Lisa's gate on the launchctl
  sites is what the flag arms; her find, restored twice tonight).
- The port is chosen without binding first (bind-and-close parks it in
  TIME_WAIT and the installer's collision arm moves off it), and the walk
  reads the port the installer ANNOUNCED, not the one requested.

## The two served defects the first runs caught, fixed here

1. Uninstall aborted partway on every machine without a running tmux
   server, which is every clean Mac: the #439 sweep pipeline was unguarded
   under pipefail. Guarded, with an executed test that forces the
   serverless case under the script's own set -euo pipefail.
2. Every fresh install's board 500ed until the first agent existed: the
   bundled tmux 3.5a's serverless voice is "server exited unexpectedly",
   which the engine matched only as the version wall. Discriminated by the
   socket on disk (no socket = clean machine; socket present = a live
   server we cannot read, and the refusal stands so an adopt machine's
   agents never read as an empty board). Both states pinned behind the
   shared words.

## What this cannot see, stated

The TCC dialog's wording, Keychain, and a macOS account that never ran
Claude Code: #224's other half, one sudo from Josh, on the fresh mini.

## Review bound

Two rounds maximum, declared before starting.
