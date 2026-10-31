# cloudjoin-4903r: the cloud box's join step reaches the installer (kosmos#4903 S3, installer half)

Ice Cream Kitty's cloudjoin-4903 (3298ff34c5, eb31d31bde, 10-26/27) was pushed but never opened as a PR, so no
release has it: every Kosmos Cloud box installs Kosmos and never runs `kosmos-tunnel setup cloud`, so it never calls
the coordinator's /v1/setup/cloud and never registers (found 10-28 23:5x from Kitty's stuck E2E box; Splinter's
decision m1170: Baron rebases, merges, cuts 0.7.74 to staging; Kitty reads the rebase).

## What
- The two commits cherry-picked onto main 9dcc82b9b2, unchanged except one move: the block now sits just ABOVE the
  #4356 board-mode comment instead of between that comment and the code it explains (main moved under the branch).
  It still runs before "Starting Kosmos." (the board's first start), as it must: the tunnel reads the latch once.
- The block (BEGIN/END kosmos-cloud-join): Linux and KOSMOS_CLOUD=1 only; `kosmos-tunnel setup cloud --state-dir <dir>`
  with the token on stdin, up to three tries; the `hosted` latch (0600, a regular file); remote access on; the spent
  token removed from provision.env. A rerun on a joined box changes nothing; any failure stops the install.
- Contract checked on relay main: `Command::Setup(SetupCommand::Cloud { coordinator, state_dir, json })` reads the
  token with `cloud_token_from_stdin()`; the cut rebuilds the connector from relay main.

## Tests
install.cloud-join-4903.test.js (9), run as shipped against stand-ins: does nothing off a Linux cloud box; joins and
latches; a lost answer retried with the same token; a failed join writes no latch, leaves remote off and says where
to look; no token, a refused switch or a link where the latch goes each refuse.

## After merge
Cut 0.7.74 to STAGING; Kitty re-tests on a fresh box (it must call /v1/setup/cloud); Angel's phone check.
