# usageagy-5158: Antigravity usage beside Claude, Codex, Gemini CLI and Grok (slice 3)

Card: kosmos#5158. GO: Josh 2026-10-03 11:23 ("we can start on the token usage stuff now and just see how far we get").
Stacked on slice 1 (PR #5163, `usageproviders-5158`). Merges after Monday with slices 1 and 2.

## What finished looks like
Settings > Token Usage counts Antigravity agents' tokens per day, per model and per agent, in the same four buckets as
every other provider, each model call counted once, on the day it was made. Claude's saved days are untouched; Antigravity
rides the providers file slice 1 added (`<day>.providers.v1.json`), so no new saved format.

## Where the numbers are (measured on this Mac 2026-10-03, read from COPIES of 25 conversations, 109 model calls)
- Home: `agytrust.agyHome()` (one home; agy has no per-account folders). Conversations: `<home>/conversations/<id>.db`.
- `gen_metadata(idx, data)`: one protobuf per model call. Model 1.19; usage 1.4: .2 uncached prompt, .5 cached prompt,
  .9 reply, .10 thoughts, .3 = .9 + .10 (held in 109 of 109). 1.4.1 (1318 in every call) and 1.4.6 (24 in every call)
  are constants, not tokens.
- NO time on a model call. The time is on its STEP: `steps.metadata` 1.1 = seconds (a protobuf Timestamp), and the step of
  type 15 that a call produced carries the call's idx at 20.3 (absent = 0, proto3). In 24 of 25 conversations the type-15
  steps' idx set equals the gen_metadata idx set exactly; the 25th has one call with NO token counts (a failed call,
  steps of type 17), so it adds nothing.
- Folder: `trajectory_metadata_blob` 1.1 (also 7) = the workspace as a `file://` URI, in 25 of 25.
  (`cache/last_conversations.json` maps only a folder's LATEST conversation, so it cannot place older ones.)

## Buckets
input = .2; cache_read = .5; output = .9 + .10 (thoughts are output, as for the other three); cache_creation = 0
(agy records no cache write).

## Once-only
One row per (conversation id, idx): the idx is gen_metadata's primary key, and each db is one conversation.

## Day
The linked step's time; a call with no linked step that still has tokens takes the earliest step time carrying its idx at
20.3, else the day the conversation file was created (review 1: a fixed day, never later than the call). A day is frozen only
from a complete scan, as slice 1 does: a db that cannot be opened while fresh keeps the scan incomplete.

## Decisions
- Day from the step link, not "credit to the day first seen" (the handoff's plan): that needed a stateful ledger and
  would put all past Antigravity usage on the day this update first runs. Rejected now that a per-call time exists.
- Weakest premise: the step link (type 15, field 20.3) and the workspace field are read raw, not documented. If agy moves
  them, calls fall back to the conversation's last write (a day that may be later) and the folder to "elsewhere";
  totals stay right.
- The reader is a 4th scanner in engine/usageproviders.js; the protobuf reading reuses agysession.js's helpers.
- 🛑 Ship with slice 1 in the SAME release. Slice 1 freezes each past day's providers file once; a release with slice 1
  and not this one would freeze past days without Antigravity, and this slice would never revisit them.
- Gemini CLI and Antigravity share model names (gemini-3.8-flash): their rows add in the per-model view, which is right
  (same model, same price); the per-agent view still separates them by folder.

## Review 1 (opus): 3 WARNINGs, all taken
- Opening a WAL db leaves an empty -wal, which the skip and the fallback day read as a write: both stats are taken
  BEFORE opening and an empty -wal is ignored; a call with no dated step takes the conversation file's CREATION day
  (mtime where none), which never moves, so a frozen day cannot lose or double a call. Test reads twice with a later
  -wal and a cold cache; its mutant (fallback on last write) fails it.
- Any error on the steps or folder read was treated as "no table" and the scan marked complete: only "no such table"
  is absent now; anything else marks the file bad (incomplete while fresh). The three reads share one snapshot.
- Every request decoded every call of every active conversation: decoded calls and step times are cached per file
  (inode + creation time), only rows from the last one read onward are read again, and the scan yields between
  conversations. Test: an appended call counts once, and a cold read agrees with the cached one.
- NITs taken: steps read ORDER BY idx and the earliest time kept; a step with no 20.3 names no call except through
  type 15 (so call 0 is not dated by the user's turn). The failed-call test is commented as pinning the outcome only.

## Review 2 (sonnet): 2 WARNINGs, both taken
- The cache's "rows from the last one read" cursor could not see a call committed late BELOW others, a rewound
  (deleted) call, or a step changed after it was read: now every read lists each call's idx and size (no blobs) and
  decodes only a call that is new, changed size, or the newest; a call gone from the file is dropped; steps are read in
  full every time (small) so a step time is never cached. Tests: a late lower call, a rewrite, an append and a deleted
  call each equal a cold read; a spy proves a decoded call is not decoded again. Residual, stated in the code: an older
  call rewritten at exactly the same byte length (none measured; agy writes a call once it completes).
- A call committed before its step would be frozen on the fallback day and move when the step lands: a scan with an
  undated call that has tokens, in a conversation written in the last 10 minutes, is shown but not frozen.
- Found while re-checking on the real copies: the measured failed call HAS a usage message (only the constant field,
  zero tokens), so "no usage" alone did not skip it; a call with no tokens is skipped before dating. Test reshaped to
  the measured failed call; its mutant fails it.
- NITs taken: a conversation deleted from a listed folder is forgotten. Not taken: a type-15 step whose 20.3 is not yet
  written is read as call 0 (proto3 cannot tell absent from 0); it can only touch call 0's day when call 0 has no step.

## Review 3 (opus): 2 WARNINGs, both taken
- A conversation that fails to open (busy mid-write) was judged stale by the db's own mtime, which agy leaves alone
  while it writes the -wal, so the scan could be frozen without it: freshness now takes the -wal's write too. Test: an
  old db with a fresh -wal that cannot be opened keeps the scan incomplete; its mutant fails it.
- The steps-error test could pass with the error swallowed (the freshness guard also fired): it now asserts the call was
  not filed, which the mutant does.
- NITs taken: no creation time (mtime fallback moves) means an undated call is never frozen; a -wal that cannot be
  stat'ed (not missing) marks the scan incomplete and the conversation is read; the plan's Day section names the
  creation day.

## Review 4 (sonnet): CLEAN (no BLOCKER, no WARNING)
- NITs not taken, each in the safe direction: the no-creation-time and unstat-able -wal branches have no test (both
  only ever mark a scan incomplete); a folder URI written after a conversation's first read would leave that day's calls
  under "elsewhere" (agy writes it at the conversation's start: present in 25 of 25 measured); a conversation that fails
  to open drops its cached calls from that one scan's display (the scan is not frozen).
