# kosmos#8786 follow-up: setup.sh and the CLI use this user's OWN systemd runtime folder

**Measured 11-20 on a real Hetzner Cloud box (throwaway hello+cloudone2):** an update started from a root console as
`runuser -u kosmos -- env ... kosmos update --if-newer --install` installed 0.8.12 and wrote S2's nightly timer, but
left it DISABLED. The box's install.log: "Kosmos could not set itself to start with systemd: systemd did not reload its
user units: Failed to connect to bus". A root login has `XDG_RUNTIME_DIR=/run/user/0`; runuser passes it through, and
setup.sh's default applied only when the variable was UNSET, so the kosmos user's `systemctl --user` looked for root's
bus. With `XDG_RUNTIME_DIR=/run/user/<kosmos uid>` set explicitly, daemon-reload and enable --now worked.

New boxes are not affected (cloud-init runs setup.sh through `sudo -u kosmos`, which resets the environment), so this
is a hardening, not a release blocker (said on #8786).

## Change
- setup.sh: `_kosmos_own_runtime_dir`, used at all three systemd sites in place of the unset-only default: keep an
  inherited XDG_RUNTIME_DIR only if it exists and is owned by this user (`test -O`), else `/run/user/<uid>`.
- install/kosmos: its own default (#4918 review 13) gets the same ownership test.
- tools/test-setup-xdg-own-8786.sh: unset, own (control), another user's folder, a missing folder; registered in
  test:shell. Mutation (back to unset-only) reds two cases.

## Weakest premise
That `/run/user/<uid>` is the user manager's folder on every Linux we support. It is systemd's fixed layout (pam_systemd),
and setup.sh already assumed it for su and cron.
