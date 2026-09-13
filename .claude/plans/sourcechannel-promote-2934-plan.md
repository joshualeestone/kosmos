# #2934 - a prod-aligned board reports sourceChannel: 'staging'

branch: sourcechannel-promote-2934

## The reported symptom

Mortals-box fresh-install QA of 0.6.59 (Sub-Zero measured, Liu Kang re-probed): a board
whose INSTALLED and SERVED versions are both 0.6.59 prod, with the staging and prod
pointers aligned on the same sha (fe9645c7), reports `sourceChannel: "staging"` on
/api/status, which paints a loud STAGING badge.

The card asks two things: confirm whether it is intentional post-promote or a stale tag,
and fix it to reflect the served channel.

## What I measured, all from source

1. `install/setup.sh:3553` writes `<store.ROOT>/source-channel` from `_PTR_FILE`:
   `latest-staging.json` -> `staging`, anything else -> `prod`. One write covers both the
   fresh-install and the update path, because update.js's auto-update spawns setup.sh
   rather than installing in-process (setup.sh:3521).
2. `server.js sourceChannelNow()` reads that file, lowercases, folds anything but
   `staging` to `prod`. It is the ONLY reader.
3. NOTHING rewrites the file on promote, and nothing can: #2036's invariant is that the
   SAME bytes are promoted to prod with no rebuild, so a promote moves no bytes on an
   already-installed box and triggers no update. The file is a one-time install stamp.
4. `engine/update.js updateChannel(platform, env)` reads `AGENT_WORKFORCE_UPDATE_CHANNEL` /
   `KOSMOS_UPDATE_CHANNEL` from the ENVIRONMENT, not from the file. (Windows reads only the
   `KOSMOS_` name: under the `AGENT_WORKFORCE_` prefix every variable is a launch override.)
5. 🛑 The login-job plist written by setup.sh carries exactly `HOME`, `PATH`, `LANG`,
   `KOSMOS_PORT`, plus four `AGENT_WORKFORCE_*` keys ONLY when KOSMOS_HOME is non-default.
   `KOSMOS_UPDATE_CHANNEL` is NOT among them, and setup.sh:3627 states the job "inherits
   only what EnvironmentVariables carries, nothing from the shell that wrote it."

## The answer to the card's question: neither "intentional" nor "stale tag"

The question presupposes that a build has one served channel. After a promote it does not:
the same sha is on BOTH pointers, by design. So "reflect the served channel" has no single
correct answer for the box that was measured, which is exactly why the field looks wrong.

The field faithfully records "which pointer this box last fetched from". That is a true
fact and it is not what a reader takes STAGING to mean. A reader takes it as "these bytes
are pre-release", and after a promote that is false.

## THE CALL

Re-derive the channel instead of trusting the install stamp, using data the board ALREADY
HAS, with no new network call:

  sourceChannel = 'staging' only if the recorded file says staging AND this box's running
  version is NOT yet on prod.

"Not yet on prod" is computable offline: on a prod-polling box the updater already caches
the prod pointer's version every 15 minutes (update.js:184). If that cached version is >=
RUNNING, prod has caught up and our bytes are on prod, so the badge goes dark. If RUNNING
is newer than the prod pointer, we are genuinely ahead of prod and the badge is correct.

Precedence, in order:
  - file says prod            -> 'prod'      (unchanged, the overwhelming majority)
  - cached pointer is NOT the prod pointer -> 'staging'  (cannot compare; keep the stamp)
  - no readable cached version (offline, first 15 min) -> 'staging'  (today's behavior)
  - RUNNING newer than cached prod version -> 'staging'  (genuinely pre-release)
  - otherwise                 -> 'prod'      (prod caught up; THE FIX)

### What I rejected, and why

- **Fetch the prod pointer from the board.** Precise, but it adds a network dependency to a
  cosmetic field, and the answer would be unavailable offline. The cached pointer already
  carries it for free on exactly the boxes where the bug was reported.
- **Make `updateChannel()` fall back to the source-channel file.** This is the fix the
  evidence most wants (it would also cure finding 5, the lost subscription), but it CHANGES
  WHICH BYTES REAL MACHINES INSTALL. update.js:44 says so in terms: "a bug here is the
  0.6.25 class itself. It is opt-in and default-prod until the loop is proven end-to-end on
  a real fresh machine; the default channel does not move here." Not mine to ship on a
  cosmetic card. Filed separately instead.
- **Wording-only change to the badge.** Cheap, but the card explicitly says "the underlying
  field should still be correct", and #2658 may remove the visible indicator anyway, which
  would leave the telemetry wrong and unwatched.
- **Do nothing and document the field as install-provenance.** Defensible, but it leaves a
  release verification able to read a prod board as a staging board, which is the stated harm.

### My weakest premise

That the badge should mean "these bytes are ahead of prod" rather than "this box is
subscribed to staging builds". The card's own sentence ("fix it to reflect the served
channel") reads as the former and I have built the former. If the intent was the latter,
this change is wrong in the opposite direction: a staging SUBSCRIBER sitting on a promoted
build would lose the badge while still being first in line for the next staging build.

What would change my mind: anyone saying the badge's job is to identify testers rather than
pre-release bytes. Note that under finding 5 that reading is currently unimplementable
anyway, because the subscription does not survive a reboot.

## Found underneath, filed separately, NOT fixed here

🔴 The staging update subscription does not survive a login. `KOSMOS_UPDATE_CHANNEL` is
read from the environment and is never written into the login job's EnvironmentVariables,
so after any reboot a staging box polls `latest.json` and silently becomes a prod box. The
`source-channel` file is the only durable record that the box was ever on staging, and the
updater does not read it. Materially worse than this card's cosmetic symptom, and it sits
on the update path, so it gets its own card and a decision from someone who owns that loop.


## 🛑 A TRAP THIS CARD NEARLY WALKED INTO, recorded because it is not visible from the diff

The shared main checkout `~/work/agent-workforce` was **145 commits behind origin/main** while I
was reading it (`engine/update.js` differed by 158 lines, `server.js` by 855). My first reading of
the updater came from there and was wrong in the one way that matters:

  STALE:   cache.latest is a version STRING, compared as newer(cache.latest, RUNNING)
  CURRENT: cache.latest is the validated MANIFEST OBJECT {version, ...},
           compared as newer(cache.latest.version, RUNNING)

Handing the manifest object to `newer()` makes `parts()` return null, which makes `newer()` return
**false for every input**. The first version of this fix did exactly that, and it fails in the
worst direction: a comparison that can never fire reads as "prod caught up", so the badge would go
dark on a box that is genuinely ahead of prod -- the precise case the badge exists for -- while
passing every test that only checks the promoted case.

Why the accessor is named `cachedLatestVersion` and not `cachedLatest`: the name is the guard.
