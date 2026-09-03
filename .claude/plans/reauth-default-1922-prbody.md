Addresses #1922.

## What was wrong

`POST /api/connect` passed `known.dir` for the DEFAULT account. The default account's config is
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
  dir. Unsetting is not the same as declining to set: a pane inherits whichever account started the
  tmux server, a value this process cannot inspect. This makes the WRITE side match the rule
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

- revert the route -> the default-route arm reds
- force `configDir: null` for a labelled account -> the labelled control reds
- drop the `-u` push -> the default launch arm reds
- push `-u` unconditionally -> the labelled control reds

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

Full suite green on the rebased head: exit 0, 3899 pass / 0 fail, all shell blocks clear. The
challenge loop ran to convergence; the proof file is in `.claude/plans/`.
