Addresses #1922.

## What was wrong

`POST /api/connect/start` passed `known.dir` for the DEFAULT account. **What that produced depended
on the machine** -- see the qualifier below; it is not a single symptom. The default account's config is
`<HOME>/.claude.json`, a file BESIDE `<HOME>/.claude`, and setting `CLAUDE_CONFIG_DIR=<HOME>/.claude`
makes the real `claude` binary read and write `<HOME>/.claude/.claude.json` instead. Two files, two
accounts. So on a machine whose decoy read SIGNED OUT, "Sign in again" on the default account ran
the whole OAuth flow and landed the refreshed credential in a file nothing reads. **Where the decoy
read CONNECTED the flow never ran at all** -- the machine-dependence the source comment carries, and
which the direction-change section below depends on.

`accounts.listLive` and `/api/agent/:name/account-status` already scope the default by OMITTING the
directory and say why. This route did not. That asymmetry is the defect.

## The change

Two edits, both small:

- `server.js`: `configDir: known.isDefault ? null : known.dir`. Matches the spelling
  `engine/create.js` already uses in four places, and `connect.js` normalizes `null` identically to
  an omitted key.
- `engine/connect.js`: the sign-in launch pushes `env -u CLAUDE_CONFIG_DIR` when there is no launch
  dir. Unsetting is not the same as declining to set. **On a WARM tmux server** (one already running)
  the pane inherits whichever account started that server, a value this process cannot inspect. The
  mechanism is measured in `tools/witness-pane-env.sh` -- **on a PRIVATE socket with `-f /dev/null`,
  deliberately, so no config can mask it. This launch uses the SHARED socket, so applying that
  result here is an inference from the mechanism, not a second measurement.** **On a COLD server** `new-session` starts one, and a fresh server inherits its
  launching client's environment, so the leaked value is this process's own -- **also not measured;
  the witness seeds a server first and can only answer the warm case.** `env -u` strips the key
  inside the pane either way, which is why the fix does not depend on knowing the source. This makes the WRITE side match the rule
  `subscription.checkLive` already states for the READ side ("rather than trusting it to be unset").
  It strips that one key deliberately, mirroring the reader's scope; it is not pane sanitization.
  📌 This also touches the plain FIRST sign-in, which takes the same `else` branch: writer and reader
  now agree there too, where previously an ambient `CLAUDE_CONFIG_DIR` was honoured by the write and
  ignored by the read.

## 🛑 The symptom changes DIRECTION, and this is the sentence to keep

**On a machine whose stored default reads CONNECTED, "Sign in again" now returns almost immediately
and paints a green "Successfully connected to your Claude account", having opened nothing. It
REPORTS SUCCESS on a dead credential; it does not merely appear to do nothing.** Previously it ran
the whole OAuth flow into the wrong file.

⚠️ **And the set of machines that see it WIDENS, which is the part worth knowing before testing.**
**Pre-fix behaviour was MACHINE-DEPENDENT and has not been measured on the reporter's machine.**
`checkLive` was pointed at the decoy config, so the flow genuinely ran only where that decoy answered
`NONE` specifically -- the gate is `state === NONE`, so a decoy answering UNKNOWN (unparseable output,
ENOENT, timeout) took the same connected exit pre-fix. Post-fix it reads the real `~/.claude.json`,
`claude auth status` credulously answers `loggedIn: true` (#874 / #1916), and the gate holds shut
**wherever that status reports a login exists** -- the dead-but-present population this card is
about.

⚠️ **NOT every default-account machine.** `checkLive` returns `NONE` on a recognised
`loggedIn: false`, so a genuinely signed-out user still opens the gate and the sign-in runs; a
missing binary opens it too. The branch's own `#1560` arm ("a connected-looking FILE does not block
sign-in when the world says signed out") asserts that and passes. ⇒ **Post-fix the false success is
bounded to accounts whose stored login is present-but-dead; pre-fix it additionally depended on the
decoy, so this change plausibly widens who sees it, and by how much is not established.** The write path is correct either way; the repair behind the gate is
kosmos#1937.

The flow behind the #1560 gate still cannot repair a dead credential: the launch is a bare `claude`
with no login argument, so the tick re-reads the same config that already said CONNECTED. **That is
kosmos#1937 and it is not fixed here.**

This is recorded prominently because the new failure is QUIETER than the old one, and a quiet
failure is the kind that gets re-filed as a fresh regression against this PR.

## Evidence

Four arms, each mutation-proven red for its own reason:

- revert the route -> the default-route arm reds (`server.connect.test.js`)
- force `configDir: null` for a labelled account -> the ROUTE control reds (`server.connect.test.js`)
- drop the `-u` push -> the default launch arm reds (`engine/connect.test.js`)
- push `-u` unconditionally -> the LAUNCH control reds (`engine/connect.test.js`)

The launch arm also asserts ORDERING, which matters and is measured: `env` stops option parsing at
its first operand, so an assignment ahead of `-u` exits 127 (loud) and the BINARY ahead of `-u`
exits 0 while never stripping the variable (silent, and it is the original defect reinstated). The
assertion walks `env`'s argument grammar to find the first operand, so it also holds once #1937 adds
a login argument after the binary.

## What is NOT covered, stated rather than implied

- Nothing exercises the `-u` arm against a real tmux. The suite replays argv and cannot see tmux's
  parser, and `docs/browser-checks/live-connect.js` (the only real-tmux, real-CLI exerciser) sets
  `AGENT_WORKFORCE_CLAUDE_CONFIG_DIR`, so it always takes the assignment branch.
- Nothing exercises the route ternary through to the launch argv. Both halves are covered; their
  composition is not.

## Validation

**To check the validation yourself rather than take this paragraph's word** (the honest form, since
any later commit moves the hash and a sentence asserting a figure would go stale with no signal):

```
source ~/.claude/scripts/lib/validation-log.sh && validation_log_current_diff_hash
tail -1 ~/.cache/claude-validation-proofs/reauth-default-1922.jsonl
```

The newest row must read `status: clean` with a `hash` equal to that value. ⚠️ **Note the helper
hashes `origin/main...HEAD` MINUS the proof file** (`:!.claude/plans/<branch>-pre-challenge.md`), so
a bare `git diff origin/main...HEAD | shasum` will NOT match once the proof file is committed. And
per kosmos#1961 a run that SKIPPED also prints a pass, so the log's `clean` (not `skipped`) is the
field that matters.
