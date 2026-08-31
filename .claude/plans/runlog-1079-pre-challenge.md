---
method: pre-challenge
branch: runlog-1079
diff_hash: 7893e034aba8c0d685b5bd391f1906e2c27d7920c8676772681524c4ee3b0048
explicit_override: true
---

# Pre-challenge: #1079 page-layer run log

**Override reason:** self-review, not a `/challenge-loop` run. Stated rather than relabelled.

## What I challenged in my own change

**1. Am I answering the card, or something adjacent?**
Something adjacent, deliberately, and the card comment says so in those words. The card asks for a
cause; I am removing the reason nobody can find one. **I refused its own suggested method** ("one run
each way") rather than performing it: a single retry is intermittent, so a clean run without the rich
board is what you would expect on most runs with it too. Two runs cannot separate a contention effect
from ordinary incidence, and running them would have looked like progress.

**2. Does the log answer the question it is collected for?**
Only if it has a denominator. **It logs every run, not every retry**, which is the difference between
"how often does this happen with rich boards versus without" and an anecdote pile. This fleet
published a wrong conclusion this week by reasoning about a numerator's distribution and never
dividing.

**3. What is the most likely way this breaks a release?**
**Not the logging.** `set -u` plus empty bash arrays on a clean run. A naive `"${RETRIED[@]}"`
there is an unbound-variable error that would red **every clean page-layer run**. That is now an
explicit test arm using the runner's own call shape, both empty and populated, and it passes.

**4. Can the arms fail?**
Three perturbations, each restored: dropping the `names=none` default, dropping the rich count, and
making an unwritable path return non-zero. Each fired the right assertion; restored is 9 of 9. The
suite also carries a control - a sha never written must be absent - so a match means something.

## Weakest premise, named

**The log has never been written by a real page-layer run.** A colleague was running
`tools/browser-checks.sh` while I worked, and adding a concurrent browser run is exactly the
contention this card is about; I was not willing to risk making her run flaky in order to investigate
flakiness. So the integration is verified at the **call shape** and the lib, not end to end.

⇒ **What would change my mind / close the gap:** one full run on a quiet machine, which also produces
the log's first real line. If the summary block never reaches `browser_run_log_append` for some
reason I have not foreseen, the log stays empty and **nothing else breaks** - which is the failure
mode I chose deliberately over any design that could red a gate.

📌 Attribution note, since I acted on it: I identified the running browser-checks by walking the
parent chain **to its pane** and stopping there. Walking one hop further reaches the tmux server,
whose argv names whichever session happened to start it and mislabels every process on this box.

## Verified before opening this PR

- node suite **3236/3236, fail 0, rc=0**
- shell suite **rc=0**, **0 FAIL lines** against a control of **487 PASS lines**, with the new test
  present **by name**
- 0 em dashes in the diff

## Known imprecision

`diff_hash` is computed against local `main`, which trails `origin/main`, so it binds more files
than this branch changes (kosmos#1472). I did not fast-forward shared `main`: it can invalidate a
colleague's in-flight proof, and over-binding costs fidelity on my own proof only.
