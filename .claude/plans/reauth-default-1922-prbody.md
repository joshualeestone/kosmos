Addresses #1922.

## What was wrong

`POST /api/connect/start` passed `known.dir` for the DEFAULT account. The default account's config is
`<HOME>/.claude.json`, a file BESIDE `<HOME>/.claude`, and setting `CLAUDE_CONFIG_DIR=<HOME>/.claude`
makes the real `claude` binary read and write `<HOME>/.claude/.claude.json` instead. Two files, two
accounts. So "Sign in again" on the default account ran the whole OAuth flow and landed the
refreshed credential in a file nothing reads.

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
  launching client's environment, so the leaked value is this process's own. `env -u` strips the key
  inside the pane either way, which is why the fix does not depend on knowing the source. This makes the WRITE side match the rule
  `subscription.checkLive` already states for the READ side ("rather than trusting it to be unset").
  It strips that one key deliberately, mirroring the reader's scope; it is not pane sanitization.

## 🛑 The symptom changes DIRECTION, and this is the sentence to keep

**On a machine whose stored default reads CONNECTED, "Sign in again" now returns almost immediately
having opened nothing, where it previously ran the whole OAuth flow into the wrong file. Both are
broken; the routing is simply no longer the reason.**

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
