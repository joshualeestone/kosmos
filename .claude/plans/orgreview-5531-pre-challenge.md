---
pre_challenge: true
method: challenge-loop
branch: orgreview-5531
diff_hash: 12847e92b3f5b256267738b563be210ae8c1dc4592e4eec6ed7c86cab49ac1a4
validation: passed (Mortals full suite at d2916e447, hash 12847e92b3f5)
subdir_audit: passed
timestamp: 2026-10-09T04:36:37Z
iterations: 12
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 12, each a fresh blind reviewer, alternating Opus (odd) and Sonnet (even).
**Converged:** Yes, at iteration 10 on the stacked branch, and again at iteration 12 after the rebase onto main (iteration 11 reviewed the hand-merged rebase and found one real defect, fixed; iteration 12 found nothing new). **Total findings:** 0 BLOCKERs, 16 WARNINGs and CONVENTIONs fixed (2 declined or deferred with reasons, several duplicates), plus NITs as marked.
**Validation:** engine/orgenroll-5531.test.js and server.orgenroll-5531.test.js (75 pass); render-orgenroll-5531.js all checks including O15 and O15b; each fix's mutation made it fail; the browser-check surface gate passes; full suite on Mortals at the head named above.

## Ledger (verbatim, iteration by iteration)

# orgreview-5531 ledger (a0: Review what your company sees)
#### Iteration 1 (Opus) on 133f1623f
- [WARNING] (1) Accept sent no consentHash, so the coordinator stored no accepted words (only the local gate flipped). FIXED b019ac627 (stacked on consenthash-5531; Accept carries the SERVED hash; no served hash = no review; pinned; mutation reddens).
- [WARNING] (2) a lost Accept answer was recorded as accepted (status "here" was true before Accept). FIXED (review flag via ticket; lost answer records nothing, asks nothing, says press Accept again; pinned; mutation reddens).
- [WARNING] (3) review-mode failures pointed at a code / a Join button. FIXED (org_ticket -> Review button, O15 arm, mutation reddens; engine says Accept).
- [NIT] enrolledAt reset on Accept FIXED (pinned); Not now repeated "sends nothing" FIXED; no arms for status-unreachable / no-consent (kept).
#### Iteration 2 (Sonnet) on b019ac627
- [WARNING] (4) review Accept refused org_consent_changed told to type a join code. SELF-class of (3). FIXED (review refusals routed first; pinned; mutation reddens).
- [WARNING] (5) other coded refusals used "Nothing was joined". FIXED (same branch; pinned). Page: any coded review refusal restores the joined view (O15 arm; mutation reddens).
- [NIT] reviewHere not serialized (kept); reporting:true set on accept (FIXED); plan mutation note (kept).
#### Iteration 3 (Opus) on 5762f4cd4
- [WARNING] (6) server review-flag wiring unguarded (reviewer's scratch mutation stayed green). FIXED (server arm; both wiring mutations redden).
- [WARNING] (7) reviewHere did not refuse a Kosmos that reports (page-only). FIXED (engine refusal; pinned; mutation reddens).
- [NIT] dead sayFor FIXED; org_not_member wording FIXED; first-join reporting gap, unused re-armed ticket, header order (kept).
#### Iteration 4 (Sonnet) on 8c1fe3cbc
- [WARNING] (8) the review flag was trusted from any ticket ("not a current defect"). FIXED as a guard (review only with a record for this world; pinned; mutation reddens).
- [NIT] org-mismatch hint, two ifs, optimistic reporting (kept).
#### Iteration 5 (Opus) on ae14c68b4
- [WARNING] (9) review ticket with no record fell through into a codeless MOVE; a yes bound a new world on review words (reviewer probe). SELF (iter-4 guard). FIXED (refuse before sending or minting; org_not_here; arms for lost AND yes; mutation reddens).
- [WARNING] (10) the iter-4 arm pinned only the lost answer. FIXED (both answers, nothing sent, no id).
- [CONVENTION] (11) plan overstated the iter-4 guard. FIXED.
- [NIT] org_bad_world re-armed ticket; Review button not disabled (kept).
#### Iteration 6 (Sonnet) on 6e63af63a
- [WARNING] (12) page copied the mayReport rule (reporting:true). FIXED (re-read from the engine; O15 arm; mutation reddens).
- [WARNING] (13) refused review preview leaves the old ticket. DECLINED (same as a refused code preview; one board-wide ticket would cancel another screen's; enroll re-checks -> org_not_here).
- [NIT] Accept clears refused-leave note; button not disabled; reviewHere not serialized (kept).
#### Iteration 7 (Opus) on 68119a9dc
- [WARNING] (14) coded review refusal repainted stale state (org_not_here under "your work Kosmos"). FIXED (read back with the refusal line kept; O15 arm; both mutations redden).
- [NIT] asReview && move (FIXED comment); Accept-again advice when lasting; !rec.org unreachable; unset reporting until read-back; header order; premise outside repo (verified against relay main mac_enroll). Kept.
#### Iteration 8 (Sonnet) on 9c77316a5
- [WARNING] dup: reviewHere not serialized (reviews 2, 6). [WARNING] dup: org_bad_world re-armed ticket (3, 5).
- [CONVENTION] (15) plan headline quoted old Not now wording. FIXED.
- [NIT] unset reporting until read-back; review alias (kept).
#### Iteration 9 (Opus) on 80604977c: CONVERGED (no B/W/C)
- NITs taken (re-reviewed by 10): refused Review press reads state back (iter-7 class one step earlier; O15 arm; mutation reddens); Not now "on this computer"; fixture code matches its wording. Header order kept.
#### Iteration 10 (Sonnet) on c431ee28a: CONVERGED
- [WARNING] dup (reviews 2, 6, 8, fourth time): reviewHere outside oneAtATime. Kept as decided: Accept re-checks the record inside the queue (org_not_here), a stale hash is answered org_consent_changed; worst case a refused Accept.
- [NIT] asReview comment; ticket valid after Not now; strict === false (kept).
- ZERO NEW B/W/C -> CONVERGED at iteration 10.
- Iteration 11 (Opus, after rebase): [WARNING] (16) plusOrgReview missed backsUpNone from the rebase. FIXED (O15b; mutation: see next). NITs: header order, opener asserts (taken in O15b), plan note (to add).
  O15b mutation (review screen without the stated-empty line) reddens O15b (measured 23:35). Mortals PASSED at d2916e447 (hash 12847e92b3f5).
#### Iteration 12 (Sonnet) on d2916e447: CONVERGED
- [WARNING] dup (reviews 2, 6, 8, 10, fifth time): reviewHere outside oneAtATime. Kept as decided (Accept re-checks under the queue).
- [WARNING] page does not re-read state while the review words are open. DEFERRED: main's documented rule (plusOrgMaybe never polls while a consent is open); the reviewer: "the engine refuses that safely ... only costs an extra click".
- [NIT] asReview order comment; route-level arms for a code with a review ticket (kept).
- ZERO NEW actionable B/W/C -> CONVERGED at iteration 12.
