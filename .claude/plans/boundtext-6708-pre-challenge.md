---
method: challenge-loop
branch: boundtext-6708
diff_hash: c2fa027df6d9d206a957a601dbda2f5677e79a7a56e296749a0d52c198cd4f1f
timestamp: 2026-10-20T14:04:45Z
subdir_audit: passed
iterations: 5
converged: true
---

# Challenge-loop proof: boundtext-6708 (kosmos#6708: a bound code says which account can use it)

Four blind iterations (iterations 3 and 4 on Sonnet and Opus; the models of 1 and 2 were not recorded). Iteration 4 returned no BLOCKER or WARNING, so it converged. A design review (Mona Lisa, approved) then added two
optional changes, which iteration 5 reviewed: again no BLOCKER or WARNING.
Stacked on fedfield-6681 (kosmos#6701, unmerged); the hash covers origin/main...HEAD, so it includes slice 2.

## Iteration 1
[WARNING] the sentence rested on the TYPED address, so an older coordinator that ignores email would leave the sheet promising a restriction that does not exist (now rests on the coordinator's echo only)
[WARNING] the address entered the copied text uncleaned (now through the same line cleaner; an injection arm added)

## Iteration 2
[WARNING] no page arm pinned "echo, not typed": B7's control types no address (a page block added; mutant boundTo-from-typed is red on exactly its two arms)
[NIT] a hostile echo could carry words after a space (the engine passes only an address shape)

## Iteration 3 (Sonnet)
[WARNING] the shape gate let bidi, zero-width and tag characters through, so the done step could show a reordered address (\p{C} refused, 254-byte cap; mutant back to \S is red)
[NIT] the B7 control did not prove the done step was drawn (asserted)
[NIT] the email: 42 arm cannot isolate the typeof guard (left: harmless)

## Iteration 4 (Opus)
No new issues at WARNING or above.
[NIT] the no-echo arm did not prove the done step was drawn (asserted)
[NIT] the plan did not say kosmos-relay #502 makes it live (stated)
[NIT] the page does not clean the echo itself (left on purpose: the engine is the only route that hands it one; stated in the plan)

## Design review (Mona Lisa: approve, two optional notes, both taken)
- bold the address on the done step (built from DOM nodes, never HTML; mutant: no bold element, red on exactly that arm)
- the invitation says "If that is not your Kosmos+ email, ask for a new code."

## Iteration 5 (Sonnet, the design-review commit)
No new issues at WARNING or above.
[NIT] the bold check counted elements, not weight (now computed font-weight >= 600)
[NIT] the unbound control did not pin "no bold" (now asserts no strong element)

## Evidence
- engine/federation.test.js: 18 pass, 0 fail.
- docs/browser-checks/render-federation-invite-4649.js: all arms passed after each round.
- Design shots: ~/work/design-shots/kosmos-6708/ (fed-invite-bound, 4 shots, 0 overflow, 0 errors), posted on the card.
