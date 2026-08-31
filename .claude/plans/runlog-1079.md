# #1079: make the page-layer flake land somewhere by itself

**Branch:** `runlog-1079` · **Card:** kosmos#1079

## Scope: the blocker, not the diagnosis

The card asks for a cause and suggests *"run the layer without the rich board... one run each way."*
**I am not doing that, and I do not think it would settle anything.** A single retry is intermittent
by definition: a clean run without the rich board is what you would expect on most runs **with** it
too. Two runs cannot separate a contention effect from ordinary flake incidence.

**The real blocker is that nothing collects the data:**

```
RETRIED=()     an in-memory array
line 952       printed once at the summary
RUN_DIR        mktemp, discarded
```

⇒ Every retry observation depends on a person reading scrollback and filing a card. That is why this
card has one data point, from 07:04 on one day, and nothing since - **not because it has not
recurred, but because nothing would have recorded it if it had.**

## What this adds

`tools/lib/browser-run-log.sh`: one append-only line per run, in `key=value`, carrying the sha, the
checks ran, the retry count **and names**, the failure count, and **how many rich boards booted**.

⭐ **Every run, not every retry, and that is the whole design.** The card's hypothesis is a **rate**
question, so it needs runs-with-rich-board and runs-without, each with their retry counts. A log of
retries alone is a numerator with no denominator - the exact base-rate error this fleet published and
retracted this week, where a defect's distribution was reasoned about without ever dividing by the
population.

**It counts rich boards inside `boot_board_rich` itself**, not at the call sites. There are two
today, and a counter maintained per caller is one new caller away from being wrong.

**It records before the exit paths**, so a FAILED run lands in the log too. A log that only captures
successful runs cannot answer a question about when things go wrong.

🛑 **It can never fail a run.** Every path returns 0; the only symptom of a broken log is a line on
stderr. A release gate going red because a log directory was unwritable would be a worse defect than
the one this exists to measure.

## Verified, and the arm that mattered was not the logging

The runner has `set -u` and passes bash arrays. On a **clean** run every one of those arrays is
**empty**, and a naive `"${RETRIED[@]}"` under `set -u` is an unbound-variable error - which would
**red every clean page-layer run**, the exact opposite of the point. So the test exercises the
runner's own call shape, both empty and populated, rather than a convenient one.

**Perturbed three ways, each restored, each firing the right assertion:**

| perturbation | what fired |
|---|---|
| drop the `names=none` default | the clean-run shape arm, twice |
| stop recording the rich count | *"no rich count in: ... rich=0"* |
| make an unwritable path return non-zero | *"would fail the gate"* |
| restored | **9 passed, 0 failed** |

The test also carries a **control**: a sha that was never written must be absent, or every match
above is equally consistent with a matcher that matches anything.

📌 The test's own summary line was wrong on its first run - it stated 6 while emitting 7 - so it now
**counts** rather than asserting a total. A tool that miscounts its own output is the same defect one
layer up.

## ⚠️ What is NOT verified, and why

**I did not run the full page layer end to end**, so the log has never been written by a real run.
A colleague was running `tools/browser-checks.sh` at the time (attributed to her pane rather than by
walking to the tmux server, which mislabels every process on this box), and **adding a concurrent
browser run is precisely the contention this card is about.** Running it would have risked making her
run flaky to investigate flakiness.

⇒ **What is verified is the piece most likely to be wrong**: the call shape under `set -u`, with the
real arrays, plus the lib in isolation. **What would close the gap is one full run on a quiet
machine**, which also produces the log's first real line.
