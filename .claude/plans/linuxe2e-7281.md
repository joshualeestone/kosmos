# kosmos#7281 slice E: a stock Ubuntu 24.04 installs the Linux family from the served site (branch linuxe2e-7281)

.github/workflows/linux-family-install-7281.yml, workflow_dispatch only (channel staging|prod, site). On the stock
ubuntu-24.04 runner: check the channel serves a Linux pointer (else stop red and say the family is not cut yet), HIDE
every system node so the install must bring its own, `curl <site>/setup[-staging] | sh` as a person does, then assert:
runtime/bin/node is a regular ELF x86-64 file that runs (not a link to a system node), app/bin/kosmos-tunnel is ELF
x86-64 and starts, the installed version is the pointer's, the source-channel stamp is the channel, and the board serves.

## Decided
- The hosted runner, not a container: setup.sh hands the board to systemd (no switch to skip it), and a plain
  ubuntu:24.04 container has no systemd. The runner image ships node, so the job hides it; the assertion that the
  installed node is a regular file (not a link) is what proves the install did not lean on a system one.
- Dispatch-only, never on pull requests: it reads the live site, so a PR cannot change what it tests. It cannot pass
  until the first staging Linux cut (KOSMOS_CUT_LINUX=1), which waits on kosmos-relay's
  tools/build-tunnel-release-linux.sh (PigeonPete).
- Weakest premise: `kosmos-tunnel --help` (or --version) exits 0 on the shipped connector; if neither does, that step
  needs the connector's real no-network verb.
