---
method: challenge-loop
branch: tkface-2762
timestamp: 2026-09-11T11:53:16Z
diff_hash: 4c9b7555806bebdae91727027120de8a2b63f89f4813de5f1aa5adc27375508c
---

# Pre-challenge proof: `tkface-2762` (kosmos#2762)

**Method detail:** blind adversarial challenge loop, five rounds, a fresh reviewer each
round, each given the diff, the plan, and a priority-ordered list of attack surfaces.
Every finding was re-derived by me before I acted on it.

⭐ **The headline of this loop is not a bug. It is that four of five rounds found a real
BLOCKER, and EVERY ONE OF THEM WAS IN A DEFENSIVE EXTRA I ADDED, never in the fix.** The
product change has been stable and independently confirmed since iteration 1. Round 4
recommended deleting that extra; I did.

#### Iteration 1

**1 BLOCKER, 4 WARNINGs, 2 NITs.**

**[BLOCKER] The fix was PARTIAL**, and this is the failure the card is most exposed to:
I fixed `tkFace` and stopped. The page has 18 avatar URLs. The question that sorts them
is *is its output painted through an identical-HTML repaint skip, or assigned straight to
`innerHTML`?* (`setIfChanged` IS `setLive`, which is `if (el.__lastLive === html)
return;`). Four were behind a skip and stale; only one was fixed.

**[WARNING] My own tests had two defects, both caught by running them.** `saveAvatar` was
called AFTER `fleet.install`, which builds the cards, so the avatar was invisible and
`hasAvatar` came back false. And two renders used project names containing
`Math.random()`, so the "markup changes" arm **passed because the NAME differed** and
proved nothing about the avatar. ⭐ Note (2) passed while (1) failed: had I written only
the interesting arm, I would have shipped a green vacuous test.

**Resolution:** `pjMember`, `projectCard`, `addAgentsHtml` fixed; `pjRoomRow` found on a
different surface and carded (#2770); `lrow` / `busyRow` / `face` verified clean (direct
`innerHTML` every poll, so the `<img>` is recreated and the `no-store` route refetches).

#### Iteration 2

**3 WARNINGs, 3 NITs.**

**[WARNING] The corrected overclaim never reached the line a person reads.** Round 1's
fix reached the code comments and the plan and skipped `release.sh`'s... (see the plan;
the analogous miss here was the emitted operator-facing string). The rule it violates is
this fleet's own: **ask what you EMIT, not just what you review.**

**[WARNING] `envFor`-style clearing by enumeration**: the guard named the variables that
had bitten, not the class, and the next one over escaped.

**[WARNING] The "what moves" table read as exhaustive** when it was not.

#### Iteration 3

**1 BLOCKER, 3 WARNINGs, 3 NITs.**

**[BLOCKER] `busted` was a NEGATIVE test and FAILED OPEN.** It asked "is `/avatar`
followed by a quote?" and called everything else cache-busted. Measured escapes:
`/avatar${avQ(a)}"` and `/avatar` + EOL. The realistic one is the next thing somebody
writes when they fix #2770 by routing URLs through one helper that returns `''` when
there is no version: bare at runtime, green in the check.

**[WARNING] Two carve-outs had no guards**, and one mattered: `youPicUrl()` is rendered
inside `pjRoomRow`, behind the same skip, and de-versioning it left the file green.

**[WARNING] Every line number the check reported was wrong**, computed on the
comment-stripped copy (44,975 raw vs 23,785 stripped). The location list is the check's
entire output when it fires.

#### Iteration 4

**2 BLOCKERs, 5 WARNINGs, 1 NIT, plus a judgement I asked for and could not make myself.**

**[BLOCKER] The round-3 numbering fix introduced a blind spot**: every code line carrying
an inline `/* … */` became invisible. Reported as 15 lines; **I measured 91.**

**[BLOCKER] All four "escape N is CAUGHT" controls ran a classifier the shipped path did
not use**, so they were systematically more sensitive than the thing they certified.
⭐ That is iteration 1's lesson recurring structurally: **a control that does not
resemble its subject certifies the blind spot.**

**It also failed CLOSED**: a correctly versioned URL wrapped across two lines was
rejected, with a message telling the author to add the `?v=` they had already added, and
whose easiest remedy was to add themselves to a carve-out list. **A guard that trains
people to carve themselves out of it is worse than no guard.**

⭐ **THE DECISIVE PATTERN: each fix opened a new surface.** The numbering fix created the
comment blind spot; the count guard created count-gaming; the no-window design created
the multi-line false positive. That is a check whose complexity exceeds what its subject
can support, not one two rounds from correct.

**I asked round 4 outright whether the file should ship at all**, because I could not
judge that impartially about something I had built. It said no, with reasoning. **I took
it and deleted it**, replacing ~300 lines of sweep with ~160 (most of it this history):
per-renderer assertions that each emits `/avatar?v=` sourced from `avatarVer`, plus a
PINNED count of avatar URLs whose failure message is a QUESTION rather than an
instruction.

**[WARNING] And round 4 corrected a premise of mine.** I had stated the four renderers
were covered by behavioural arms. **Only `tkFace` is.** `pjMember`, `projectCard` and
`addAgentsHtml` have no behavioural arm anywhere in the repo, which is why the
replacement pins `avatarVer` **by name** rather than merely `?v=`.

#### Iteration 5

**No BLOCKER.** Three WARNINGs, all about CLAIMS rather than the shipped fix, plus NITs.

It re-derived the product fix independently rather than reading the plan's table: all 18
avatar sites listed and each paint path traced. It confirmed `avatarVer` reaches all four
renderers non-zero, confirmed the browser arm does what it says, and **verified the
identity-leak double mutation in all three arms** (dropping either gate alone survives,
dropping both reds the stranger arm), which is the experiment that separates real
defence-in-depth from a guard plus dead code.

**[WARNING] The test file's header claimed the arms "cannot reject correct code".** That
is false, and measured: moving a URL into a helper reds that arm, and that shape is not
hypothetical because `youPicUrl()` on this page already uses it.

⭐ **Kept the behaviour, corrected the claim, and the distinction is the whole reason this
check is acceptable where the sweep it replaced was not.** The message says the ARM
stopped measuring, not that your code is wrong; the remedy is to repoint `MUST_VERSION`;
and there is NO carve-out list to escape into. The deleted sweep's easiest remedy was to
exempt yourself from it, which is the behaviour that makes a guard worse than nothing.

**[WARNING] This plan described the DELETED sweep in the present tense**, against its own
standard, stated 100 lines above: *"a plan that disagrees with its own branch is worse
than no plan."* Corrected; the shipped file has zero references to that machinery.

**[NIT, taken]** The control built its own bounded matcher rather than the arms'. That is
the exact shape of round 4's second BLOCKER, so it is now one shared `boundedMatcher()`.

**[NIT, taken]** The count pin also counts 6 `fetch()` calls and 4 `/api/you/avatar`
lines, so an unrelated fetch moves it. Said so in the failure message rather than leaving
it to be discovered.

### Final Ledger

| measurement | result |
|---|---|
| `bash tools/run-tests.sh` | **exit 0, 6088 tests, 6080 pass, 0 fail, 8 skipped** (all Windows-only, by design) |
| `bash tools/browser-checks.sh` | **exit 0, 1873 PASS, 0 FAIL** |
| a real browser observed | `avatar?v=1789125283244` |

📌 **That last row is the one that matters.** Before this card, `grep -c 'avatar?v='` over
the entire browser-check log returned **0**: no browser check had ever looked at a member
face URL, because no project-member fixture had an avatar. That is how #2762 shipped with
1873 passing assertions on the surface.

**Mutants on the shipped check, each applied alone with a green control between:**

| mutant | arms killed |
|---|---|
| `tkFace` de-versioned | 5/7 |
| `pjMember` de-versioned | 6/7 |
| `addAgentsHtml` de-versioned | 6/7 |
| `youPicUrl` de-versioned | 6/7 |
| a NEW bare avatar URL appears | 5/7 |
| `tkFace` version from a TYPO'd property | 5/7 |
| `projectCard` version from a TYPO'd property | 6/7 |
| `addAgentsHtml` version from a TYPO'd property | 6/7 |
| a brace-in-string that over-captures `fnSource` | 5/7 |

### What I would disclose against my own work

- **Three of the four fixed renderers have NO behavioural coverage.** `pjMember`,
  `projectCard` and `addAgentsHtml` are guarded only by a source-shape assertion. It pins
  `avatarVer` by name so a typo cannot ship as `?v=undefined`, but **nobody has watched
  those three refresh in a browser.** `tkFace` has both unit and real-browser arms.
- **`pjRoomRow` is still stale**, deliberately, and carded as #2770 with the open question
  that is its real work: a message row is not a member row, so there is no `avatarVer` to
  pass through yet.
- **THREE substring traps in this one card**: a carve-out count keyed on a substring
  matched two lines; a paint guard matched an unrelated second site; and
  `a.avatarVersion` CONTAINS `a.avatarVer`, so `includes()` passed the exact typo the
  assertion existed to catch. **Word-bound every identifier match.**
- **One browser check (`render-role-limit`) failed in an earlier harness run.** It is
  contention, and the usual "not in my diff" test was WEAK here because this change does
  touch the page that check renders. What settled it: the same code passed at load 4.55
  having failed at 11.98, which isolates load as the variable. Corroborated by #2760,
  filed independently, naming that check as a known starver.
