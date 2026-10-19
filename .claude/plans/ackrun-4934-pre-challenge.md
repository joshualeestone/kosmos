---
pre_challenge: true
method: challenge-loop
branch: ackrun-4934
diff_hash: 91f4c01b75632b12d8729fe252acca66dc319dc3c197408eba59b36c7f5f9e2b
validation: passed
subdir_audit: passed
timestamp: 2026-10-14T21:20:43Z
iterations: 15
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 15 (converged at iteration 15, zero new BLOCKER/WARNING/CONVENTION)
**Converged:** Yes
**Reviewer model rotation:** Opus (1,3,5,7,9,11,13,15) and Sonnet (2,4,6,8,10,12,14); convergence witnessed by both.

The loop ran 1-7 before the first PR, converging at 7. The PR was reviewed by the PM (Liu
Kang), who found a BLOCKER the blind loop had not: the ack-run refusal reused the `room_held`
code and wrote a stopped valve row, so every message about it (the CLI, the person's feed)
falsely said the room was HELD, when in fact only the ack-only post is refused and the next
content post is delivered at once. The loop was reopened (skill step 6e) and rounds 8-11
hardened that fix to convergence; the heavy suite passed and the fix was pushed.

The PM then RE-REVIEWED at that head, cleared the hold-honesty blocker, and ruled two more
changes as one problem: (1) drop the lexicon's bare `acknowledge` (an imperative like the
excluded `confirm`) and `done` (a status report, not agreement); (2) a second BLOCKER he
found by reading the code: the run counted every sender together with no sender dimension,
so a POLL (a person or agent asks the room "everyone ready?" and four fighters each answer
"yes") dropped the fourth answer and told its sender it only agreed with what was said,
recording nothing. An answer someone asked for was lost, the dangerous direction. The loop
was reopened again and rounds 12-15 implemented and hardened the sender-dimension fix to
convergence.

Every fixed finding was in the DANGEROUS direction (real content or a real participant
wrongly treated as a content-free acknowledgement loop, a requested answer dropped, or the
refusal falsely presented as a hold). The deferred findings are lexicon-tuning refinements to
the approved core, each judged defensible and flagged for the PM.

### Per-Iteration Breakdown

#### Iterations 1-7 (first loop, converged at 7; pre-PR)
**Reviewer models:** Opus 1/3/5/7, Sonnet 2/4/6.
Fixed (all dangerous-direction classifier gaps): non-Latin content read as ack (Latin-only
trim) -> `\p{L}\p{N}` trim; @mention stripped anywhere -> only a single leading one; lexicon
over-breadth ("it", bare "confirm") removed; a symbol/off-lexicon emoji skipped like
punctuation ("ok ❌") -> `\p{S}` is content; the symbol GLUED to a word ("ok❌") -> `\p{S}`
checked before the edge trim; the question-mark escape ASCII-only -> added full-width ？ and
Arabic ؟. Converged at 7 with zero new findings. (Full first-loop ledger preserved below.)

#### Iteration 8
**Reviewer model:** sonnet (loop reopened after PM review)
**New findings:** 1 BLOCKER-class parity gap, 2 WARNINGs, NITs
- [WARNING] Windows CLI (tools/windows/kosmos-cli.js) had no `ack_only` branch, so on Windows
  (the incident's own platform, 0.7.38) the refusal fell through to "re-post when the room is
  ready", a soft hold claim --> FIXED: honest ack_only branch + hand-back + the cut-reply
  retry variant, matching install/kosmos; a test now reads that file too.
- [WARNING] chat.js ran the filename/path regex on the full text before any length gate,
  quadratic on a long unbroken token (~2s on a 64KB post) --> FIXED: ACK_MAX_CHARS (200)
  checked first, bounding every regex (now <0.3ms on 64KB). This is the "no ReDoS" claim.
- [NIT->FIXED] the doctrine text, the ACK_RUN_LIMIT comment, chat.js comments and a test title
  still said the room is "held"; the doctrine is agent-facing and teaches the false term -->
  reworded to "stops passing on"; doctrine re-derived (doctrine-past.js) and re-pinned (v32).
  Also added `¿` to the question set and a lim.on=off coverage test.

#### Iteration 9
**Reviewer model:** opus
**New findings:** 1 WARNING, 1 NIT
- [WARNING] the ack check returned `ack_only` BEFORE the volume valve, so in a room already
  at/over the volume cap the ack_only copy ("goes through straight away") was contradicted one
  post later by the volume `room_held` --> FIXED: compute the volume budget (with the
  #4786/#5260 progress allowance) ABOVE the ack block and emit ack_only only when
  `arrivals + charged <= allowed`; at/over budget the ack block is skipped and the volume valve
  returns the genuine hold. Added an over-budget test (room_held) with an under-budget control
  (ack_only). Moving the allowance up also reunited it with its #4786 comment (a round-8 nit).
- [NIT] `/[$%£€]/` misses full-width ％/‰ (Po category) --> DEFERRED: negligible (a percent sign
  with no digit carries no numeric info; any real figure trips the digit escape; currency `\p{S}`
  signs are caught).

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 3 WARNINGs, NITs
- [WARNING] the run scan counted only local `kind: 'post'` rows, so a federated `external`
  content post between acks did not break the run --> FIXED: the scan now includes `external`
  rows, classified by text like any post (outside content breaks the run, an outside ack
  extends it). Added a test with an external-ack control.
- [WARNING] the under-budget gate uses THIS post's `charged`; a later content post reaching
  strictly more recipients could tip the volume valve at the exact boundary --> DOCUMENTED: a
  one-recipient edge, and the room_held it then gets is itself honest; the gate carries no slack.
- [WARNING] lexicon `done`/`acknowledge` carry info or read as imperatives (`acknowledge` like
  the excluded `confirm`) --> DEFERRED to the PM (the lexicon-tuning family the PM ruled a
  follow-up in review round 1). The approved comment keeps `done`/`yes` knowingly, so not
  changed here; the `acknowledge`-vs-`confirm` inconsistency and the `done` completion-signal
  risk are flagged specifically for the PM's ruling.

#### Iteration 11
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs (2 NITs, both non-gating)
**Converged**: the external-row scan verified correct and safe (a text-less external row errs
toward delivery), every classifier escape re-probed (~50 inputs), the not-a-hold invariants and
the under-budget gate verified, the doctrine fingerprint/length recomputed and matched, and
all touched + doctrine test files green. NITs: the lexicon standalone words (deferred family);
ACK_RUN_LIMIT declared after its one use (no runtime effect, mirrors ROOM_HELD_REFUSAL).

#### Iteration 12 (loop reopened after PM RE-REVIEW; PM ruled the lexicon + a sender-dimension BLOCKER)
**Reviewer model:** sonnet
**New findings:** 1 WARNING (dangerous direction), CONVENTION + NITs.
Implemented the PM ruling first: dropped `acknowledge`/`done` from the lexicon, and added the
sender dimension (a run is a loop only when a sender repeats; a poll of distinct answerers is
delivered), with both required test arms. The blind round then found: [WARNING] the run keyed a
sender on `from`, a capped display NAME, so two outsiders sharing a name (or an outsider whose
name equals a local agent's) read as a false repeat and a poll's answer was dropped in federated
rooms -> FIXED (keyed on the stable `member` id, namespaced, empty excluded; later simplified in
15). [CONVENTION] the lexicon comment implied `ack` was excluded -> reworded (`ack`/`acked` stay
as the acknowledgement token). [NIT] no classifier test pinned the lexicon change -> added.

#### Iteration 13
**Reviewer model:** opus
**New findings:** 1 BLOCKER-class (dangerous direction).
[WARNING, treated as blocker] the back-and-forth test gated on "any sender repeats ANYWHERE in the
run", which punished the NEXT arrival rather than the repeater: once one sender double-acked, a
brand-new distinct answerer's first reply was refused and dropped with nothing stored -> FIXED:
refuse only when the INCOMING sender is already in the trailing run (continuing its own loop). A
first-time answerer is delivered even when others have repeated. Added a poison-case test with a
control. This refines the PM's literal "at least one sender appears twice" to "the INCOMING sender
appears twice", serving the same intent and both his arms (flagged to the PM).

#### Iteration 14
**Reviewer model:** sonnet
**New findings:** 1 WARNING (dead code), CONVENTION + NITs.
[WARNING] the `member`-keyed external identity was DEAD: the incoming post is always a local agent
and external identities were namespaced apart, so an external row could never match the incoming
and never changed a verdict; the federated test passed for the wrong reason -> FIXED by simplifying
to the real rule (only a LOCAL prior sender can be the incoming local agent repeating; external
rows count toward run LENGTH, not who-is-repeating; no namespacing needed). [CONVENTION] two
comments still said "at least one sender repeats" -> aligned to the incoming-sender rule. Replaced
the federated test with a discriminating one (an outsider sharing a local name does not refuse the
local agent's first ack).

#### Iteration 15
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs (NITs only, all non-gating).
**Converged**: traced the data flow (`from` == stored `.from` == sessionName), confirmed a
first-time answerer can never be refused and a two-party loop is always caught, verified external
rows affect length not repetition, all three comments consistent with the code, the tests
discriminate with real controls and correct time-ordering, no ReDoS and no security concern; ran
the targeted suite green. NITs: the large-room poll bound (intended tradeoff, volume-valve
backstopped); the pre-existing standalone lexicon words (deferred family).

### Final Ledger (continuation rounds 12-15, after the PM re-review)

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| K | 12 | PM-RULING | chat.js lexicon | PM | drop bare `acknowledge` (imperative) and `done` (status) | FIXED | removed from ACK_WORDS; pinned as content in chat.test.js |
| L | 12 | PM-BLOCKER | messages.js | PM | run had no sender dimension; a poll dropped a requested answer | FIXED | a run is a loop only on a repeating sender; poll delivered; both arms tested |
| M | 12 | WARNING | messages.js | SELF | sender keyed on display `from`; federated false repeat dropped a poll answer | FIXED | keyed on stable identity (simplified in 14 to local-sender-only) |
| N | 12 | CONVENTION | chat.js lexicon | SELF | comment implied `ack` excluded | FIXED | reworded; `ack`/`acked` stay as the ack token |
| O | 13 | BLOCKER | messages.js | SELF | "any repeat in run" punished the next arrival, dropping a first-time answer | FIXED | refuse only when the INCOMING sender is already in the run |
| P | 14 | WARNING | messages.js | SELF | member-keyed external identity was dead code; test passed for the wrong reason | FIXED | simplified to local-prior-sender rule; discriminating test |
| Q | 14 | CONVENTION | messages.js / chat.js | SELF | two comments said "any sender repeats" | FIXED | aligned to the incoming-sender rule |
| R | 15 | NIT | messages.js / chat.js lexicon | SELF | large-room poll bound; standalone lexicon words | DEFERRED | intended tradeoff (volume valve); lexicon family flagged for PM |

### Final Ledger (continuation rounds 8-11; the first-loop 15-row ledger is preserved in the
section below)

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| A | 8 | WARNING | tools/windows/kosmos-cli.js | BRANCH | no ack_only branch; Windows fell to "re-post when the room is ready" | FIXED | honest ack_only branch + retry + hand-back + test |
| B | 8 | WARNING | chat.js | SELF | filename regex quadratic on a long token (~2s/64KB) | FIXED | ACK_MAX_CHARS checked before the regexes |
| C | 8 | NIT->FIX | defaults.js / messages.js / chat.js / tests | BRANCH | "hold"/"held" wording for a non-hold feature | FIXED | reworded to "stops passing on"; doctrine re-derived + re-pinned v32 |
| D | 9 | WARNING | messages.js | SELF | ack_only before the volume valve over-promised "goes through" | FIXED | gate ack_only on arrivals+charged <= allowed; else room_held |
| E | 9 | NIT | chat.js | SELF | `/[$%£€]/` misses full-width ％/‰ | DEFERRED | negligible; digit escape + `\p{S}` cover real cases |
| F | 10 | WARNING | messages.js | SELF | federated `external` content did not break the run | FIXED | include `external` rows in the scan, classified by text |
| G | 10 | WARNING | messages.js | SELF | gate uses this post's charge; next post's may differ | DOCUMENTED | one-recipient edge; room_held then is honest; no slack |
| H | 10 | WARNING | chat.js lexicon | BRANCH | `done`/`acknowledge` carry info / read as imperative | DEFERRED | PM lexicon-tuning ruling; `done`/`yes` kept knowingly; flagged |
| I | 11 | NIT | chat.js lexicon | BRANCH | standalone to/me/same/got/right/sounds | DEFERRED | same lexicon family; bounded by the 4-gate; refused post handed back |
| J | 11 | NIT | messages.js | BRANCH | ACK_RUN_LIMIT declared after its use | NOTED | no runtime effect; mirrors ROOM_HELD_REFUSAL placement |

### Outstanding questions (ASKED, still unresolved)
None. The lexicon-tuning items (H, I, E) are deferred under the PM's standing round-1 ruling
that lexicon/coverage refinements are follow-ups, and are flagged for the PM's decision; they
do not block convergence.

### Deferred design refinements for the PM (reversible; follow-up cards)
1. Progress-allowance interaction with the ack trigger (from the first loop).
2. The ack refusal is not surfaced in the board held-strip/Reopen (moot now that it is not a
   hold and writes no valve row).
3. Any-sender vs distinct-sender run (from the first loop).
4. Lexicon tuning: `done`/`acknowledge`/the standalone short words, and the requested yes/no
   poll where a run of answers is refused. The `acknowledge`-vs-excluded-`confirm` inconsistency
   is the sharpest; `done` is a completion signal that a busy poll could drop. The approved
   comment keeps `done`/`yes` knowingly, so this is the PM's call.

### First-loop ledger (iterations 1-7), preserved

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | CONVENTION | .claude/plans/ | BRANCH | no plan file for this branch | RESOLVED | untracked plan file + PR "Plan" section (gate convention) |
| 2 | 1 | WARNING | messages.js ack-hold | BRANCH | not surfaced via roomHeld held-strip/Reopen | RESOLVED | moot: it is not a hold and writes no valve row |
| 3 | 2 | BLOCKER | chat.js classifier | BRANCH | non-Latin content classified as ack | FIXED | 510b40730 (\p{L}\p{N} trim) |
| 4 | 2 | WARNING | chat.js | BRANCH | @mention stripped anywhere, not only leading | FIXED | 510b40730 |
| 5 | 2 | WARNING | chat.js | BRANCH | lexicon too broad (do it / confirm) | FIXED | 510b40730 |
| 6 | 2 | WARNING | messages.test.js | BRANCH | thin coverage | FIXED | 510b40730 |
| 7 | 3 | WARNING | messages.js | BRANCH | ack bypasses #4786 progress allowance | DEFERRED | fix has an evasion hole; narrow; PM-flagged |
| 8 | 4 | WARNING | chat.js loop | SELF | a symbol token (❌) skipped like punctuation | FIXED | 4774df72f |
| 9 | 4 | WARNING | messages.test.js | BRANCH | coverage (reopen reset, held-accepts-content) | FIXED | 4774df72f |
| 10 | 4 | WARNING | messages.js | BRANCH | content-resets-run / filler evasion | DEFERRED | approved spec; inherent to closed lexicon |
| 11 | 4 | WARNING | chat.js lexicon | BRANCH | under-coverage (thank you, lgtm) | DEFERRED | safe direction; PM-flagged (now superseded by H) |
| 12 | 5 | WARNING | chat.js | BRANCH | question-mark escape ASCII-only | FIXED | a59c90f80 |
| 13 | 6 | BLOCKER | chat.js loop | SELF | a symbol GLUED to an ack word slipped through | FIXED | f7c3daa2a |
| 14 | 6 | WARNING | messages.js stale-held/convoRow | BRANCH | valve row read by held-tell/UI | RESOLVED | moot: no valve row is written |
| 15 | 6 | WARNING | messages.js distinct-sender | BRANCH | single agent's 4 acks held | DEFERRED | any-sender defensible; PM-flagged |

### Strengths (across all iterations)
- Every new-information signal is on the content (return false) side; the dangerous direction is
  gated solely by the closed lexicon + 200-char ceiling + 5-word cap + 4-consecutive-run
  threshold + the under-volume-budget gate, robust under hostile input (non-Latin, full-width,
  negation symbols, VS16/ZWJ, 64KB) with NO ReDoS (the char ceiling bounds the regexes).
- The refusal is honestly NOT a hold: a distinct `ack_only` code, honest copy on BOTH CLIs
  (macOS/Linux and Windows, main + cut-reply retry + hand-back), no valve row, no refused row,
  roomHeld() stays null, and it is emitted only when the room is under the volume budget so the
  "goes through straight away" promise always holds (over budget yields the genuine room_held).
- No stored isAck flag: the run is recomputed from stored text on read, so the verdict cannot
  drift; the run scan includes federated external posts, classified by text.
- A poll is not a loop: the incoming ack is refused only when its OWN sender already appears in the
  trailing run (a back-and-forth it is continuing). Distinct senders each answering once -- a poll
  like "everyone ready?" -> four "yes"es -- are delivered; a first-time answerer is never refused
  even when others have repeated; two agents trading acks are still caught by the trader's own
  repeat; a poll that grows past the volume budget is held by the volume valve, not here.
- The doctrine bump is internally consistent end to end (DOCTRINE_VERSION 32, version-log entry,
  pinned fp 73e44376fbc76c20 == doctrine-past v32 sha256 prefix, length 28522), and the doctrine
  text teaches "stops passing on", never "hold".
- Tests carry working negative controls at every boundary, including the room_held CLI-copy
  control on both CLIs, the over-budget vs under-budget control, and the external content vs
  external ack control.

### Final validation (6j): full heavy suite on the converged head
- **Head:** f4219b20a027ab61de9d7b583789de5027cbc767 (converged at iteration 15; diff_hash above)
- **Command:** `unset KOSMOS_AGENT_TOKEN; bash tools/run-tests.sh` (token unset so the 3
  server.subtasks-3861 tests do not false-red)
- **Result:** GREEN. HEAVY_EXIT=0. Node: tests 20598, pass 20346, skip 252, fail 0,
  cancelled 0, todo 0 (20346 + 252 = 20598, fully accounted). Shell: 232/232 passed.
- Two-signal gate: exit code AND the tally fully accounts for every test (pass + skip + fail +
  cancelled = total), so this is not a killed-suite false green.
- (An earlier rounds-8-11 head, 4194d48d7, passed the heavy suite before the PM re-review: node
  20593 tests, 20341 pass, 252 skip, 0 fail, 0 cancelled, exit 0. This run re-validates the
  converged head after the rounds-12-15 changes.)
