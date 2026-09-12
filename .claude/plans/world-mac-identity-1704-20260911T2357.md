# Plan: PR1m -- the Mac named-world identity slice (kosmos#1704; #2828 Mac half)

**Lane: Angel (multi-Kosmos).** This is the Mac counterpart to PR #2845 (Windows + the shared
carrier, merged) and PR #2852 (the boot fix, merged). Base: origin/main at the #2845 merge
(a677a0b5), which carries `engine/launchidentity.js` and `worlds.applyAgentWorldEnv`/`preWorldEnv`.

## What this fixes

On the Mac, an agent's machine-wide launch identity -- its launchd label
(`com.kosmos.agent.<name>`), its plist path, and its tmux session name -- is derived from the bare
agent name. A world's data is separate, but those names are not, so the same agent name in two
Kosmoses collides: a remove/restart/restore in Kosmos B reaches Kosmos A's like-named agent, and a
named-world agent reads the DEFAULT world's store (its sender token, session record and board token),
so its reports and replies are refused (#2827 Mac half, #2828 Mac half). PR #2845 closed the Windows
halves; this closes the Mac halves.

## The default world stays byte-identical

`launchidentity.launchKey(name, world)` is the bare name for the default world, so every existing
Mac install keeps its label, plist path and tmux session and needs no migration. Only a NAMED
world's agents are keyed `<name>+<worldId>`. The plist gains a `KOSMOS_WORLD` line ONLY for a named
world, so a default-world plist is byte-for-byte what it was.

## The changes (single-derivation call sites)

1. **`engine/create.js` `serviceLabel(name, worldId)`** (:735): `com.kosmos.agent.<launchKey(name,
   world)>`. `plistPath` (:736) follows for free. The world defaults to
   `launchidentity.currentWorldId()`; an explicit world wins (the board's own world, or a named
   remove). Callers that pass a world: the launchctl `enable` (:2511), `print` (:3198) and `bootout`
   (:3496) all key by the world being acted on.
2. **`plistFor`** (:1945): `label = serviceLabel(name, world)`, and a `KOSMOS_WORLD` env line written
   ONLY for a named world (the same absent-means-default pattern as KOSMOS_PORT). The supervisor
   receives the agent name as `$1`; the tmux SESSION it opens must be the launchKey, so the plist
   passes `launchKey(name, world)` as `$1` (the session name), while the agent NAME travels in the
   env/args as today.
3. **`bin/agent-supervisor.sh`**:
   - The mint one-liner (~316-322) calls `worlds.applyAgentWorldEnv(process.env)` (via the resolved
     engine) BEFORE requiring `sendertoken.js` (which freezes its DIR at require), so the token lands
     in the world's store.
   - `PANE_ENV` gets `-e KOSMOS_WORLD=<world>` for a named world AND `-e KOSMOS_WORLD=` (empty ->
     default) for the default world. Both are required: on a WARM tmux server a new session does not
     inherit the client env (so it must be set), and a COLD server started by a named-world board
     inherits the board's KOSMOS_WORLD (so a default pane must override it to empty). Verified against
     the measured tmux behavior in connect.js:2054-2070.
   - The roster/session name derivation strips `+<world>` where it needs the bare name.
4. **`engine/status.js` `parsePanes`** (:868): map each session through
   `launchidentity.nameInWorld(session-without--discord, currentWorldId())` and drop the nulls, so a
   board's roster shows only its own world. 🛑 Parse the world key with the `-discord` strip in the
   right order: a world id can end in `-discord` (CLEAN_ID allows it), so stripping `/-discord$/` off
   the whole session before the world parse would mangle `ava+qa-discord`. Strip `-discord` only from
   the parsed NAME, or parse first. Pinned by a test with a `-discord`-suffixed world id.
5. **`engine/createdroster.js` and `engine/register.js`** (AS BUILT): these two ENUMERATE the
   LaunchAgents folder (which holds every Kosmos's plists), so they gained a world filter -- they
   match on the world-independent `create.SERVICE_LABEL_PREFIX`, drop any label whose
   `parseServiceLabel` world is not this board's, and use the BARE name. `create.serviceLabel('')` is
   no longer usable as the prefix constant (it is world-dependent now), which is why
   `SERVICE_LABEL_PREFIX` + `parseServiceLabel` were added to create.js.
6. **`engine/remove.js`, `engine/delete-leftover.js`, `install/kosmos` need NO change** (AS BUILT,
   diverged from the first draft, verified in review): each resolves a SINGLE already-known agent
   name, not an enumeration. `remove.jobFor`/`delete-leftover.plan` build the label via
   `create.serviceLabel(clean)` / `create.plistPath(clean)`, which now default to the board's own
   `currentWorldId`, and `sessionFor` reads the world-filtered `parsePanes` roster -- so a remove in
   world B resolves `com.kosmos.agent.ava+b`, finds no plist, and never reaches the default `ava`.
   `install/kosmos` `board_token` reads `store.ROOT` from `AGENT_WORKFORCE_DATA`, which the supervisor
   now sets explicitly on the pane (the world's root, or empty=default), so it resolves the world's
   board token by inheritance rather than re-deriving from `KOSMOS_WORLD`. This single-point-of-
   resolution (serviceLabel's default + the pane env) is why the diff is small; #2828's remove
   isolation is pinned by a direct `remove.jobFor` test.

## Known limitation (named worlds)

A named-world board's roster (`parsePanes`) keeps only sessions whose launch key parses to its own
world, so a hand-run adopted `<name>-discord` session (which parses to the default world) is visible
only on the default board, never inside a named Kosmos. This is a new characteristic of named worlds
(which could not run agents before #2852), not a regression, and is out of this slice's scope.

## Tests

- launchidentity round-trip already covered by #2845. New Mac-specific:
  - a byte-identical snapshot of the default-world plist, and `KOSMOS_WORLD` present in a named one;
  - `serviceLabel`/`plistPath` equal today's literals for the default world, `+world` for a named one;
  - `parsePanes` keeps only this world's sessions and drops another world's, WITH the `-discord`
    world-id edge case;
  - a remove in world B resolves only `ava+b`, never the default `ava`.
- Live-Mac validation (what CI cannot give, the reason this slice is mine): create a named world and
  switch to it (now that #2852 lets a named world boot), create `ava` while `ava` exists in Kosmos 1,
  confirm two launchd labels + two tmux sessions, reply/report work in the named world, and a remove
  in the named world leaves Kosmos 1's `ava` untouched. tmux and launchctl accepting `+` in the
  session/label proven live.

## Weakest premise

A missed enumeration site (a place that builds a label/session/plist from the bare name outside the
functions above). The default-plist snapshot and a shape test (no `com.kosmos.agent.` built outside
`serviceLabel`) guard against it.
