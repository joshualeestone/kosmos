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

  sourceChannel = 'staging' unless the updater can POSITIVELY show that prod publishes the
  exact version this box is running.

The predicate is `update.prodPublishesRunning()`, which returns true / false / **null**,
where null means "this cache cannot speak to the question". Only a positive `true`
downgrades the badge:

  - file says prod                  -> 'prod'    (unchanged, the overwhelming majority)
  - prod pointer names OUR version  -> 'prod'    **the fix**
  - anything else, including every unknown -> 'staging' (keeps the recorded stamp)

### 🛑 EQUALITY, NOT ">=", and this is the correction that matters

The first draft asked "is prod at least as new as us?" That is NOT the same question as
"did our bytes reach prod", and the gap is exactly the box the badge exists for: a staging
build that was **abandoned** rather than promoted, while prod later published a different,
newer build, satisfies `>=` while this box runs bytes that never went to prod at all. The
draft would have darkened the badge there. Auto-update being on by default bounds the
window to about one update cycle, but a tester who turned auto-update off would keep a dark
badge on pre-release bytes indefinitely.

Equality is sound for one specific reason, and it is #2036's invariant: the same bytes are
promoted with no rebuild, so the prod pointer naming our exact version means our bytes ARE
the prod bytes. Nothing weaker than equality carries that.

### Where the predicate lives, and why not in server.js

Inside `engine/update.js`, as one named export rather than four raw ones assembled at the
call site. The cache's shape is that module's business, and `available()` already performs
the mirror-image comparison there. Two derivations of one fact is this repo's own
most-shipped defect; an earlier draft of this change had the caller reach in for
`cache.latest` and got its shape wrong (see the trap section below), which is precisely the
failure a single named predicate makes unavailable.

## THE ACCEPTED WINDOW (the fix is true of a moment, not forever)

`false` from the predicate covers TWO worlds it cannot tell apart: bytes that never reached
prod, and OUR bytes, promoted, since SUPERSEDED by a newer prod release. The second means a
correctly-promoted box reads 'staging' again from the moment prod moves on until it takes
that update, which re-runs setup.sh and rewrites the stamp.

So **#2934's symptom can reappear briefly after any release, and it self-heals.** That is
accepted rather than overlooked: no weaker comparison closes the window without
reintroducing the abandoned-build error, which darkens the badge on genuinely un-promoted
bytes and is the worse failure. Anyone seeing this symptom right after a release should
look here before reopening the card. Stated in the doc comment, at the board's call site,
and in a test arm that names both worlds.

## 🔑 THIS FIX AND #2969 ARE COUPLED

The reported mortals box only reaches the prod-pointer rung BECAUSE it had silently lost its
staging subscription at login (#2969): with no channel in the environment the poller fetches
`latest.json`, so the cache can speak about prod. **Fix #2969 so the subscription survives,
and that same box resumes polling the STAGING pointer, the predicate returns null, and the
box displays STAGING again.**

That is not straightforwardly a regression: for a genuine staging subscriber, "you are on
the staging channel" is arguably the honest badge. But it must be a decision somebody makes
deliberately when closing #2969, not something discovered from a reopened #2934. Stated in
the code comment, on this card, and on #2969.

### What I rejected, and why

- **Treat "prod is at least as new as us" as proof our bytes shipped.** This was the first
  draft and it is wrong; see the equality section above. Kept here because it is the
  attractive wrong answer, not a hypothetical one.
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

That draft is gone: there is no accessor to name carefully any more, because the
comparison never crosses a module boundary. `prodPublishesRunning()` reads the cache and
returns a verdict, so `cache.latest`'s shape is not something a caller can get wrong.
