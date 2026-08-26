---
pre_challenge: true
method: challenge-loop
branch: connect-confirm
diff_hash: 3757043cb266616fb3c8227bfa127e0571a2370db388b31035fbfa631ca6f57f
subdir_audit: passed
timestamp: 2026-08-26T22:05:00Z
iterations: 3
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** No — round 3 returned no BLOCKER, and the bound was named before it ran: round 3 decides, round 4 is the hard stop.
**Fixed:** every BLOCKER and WARNING below.

## What this branch is for

Josh, watching a fresh install at 14:44: *"it downloaded 231MB without asking… total chaos."*
Pressing **Connect** on Claude now reveals a confirm under that row — what will be
installed, roughly how big — with **Confirm** and **Not now**.

## The three BLOCKERs, all mine, all in the same place: the gate

**Round 2 — the gate guarded one button, and not the one that matters.** The
confirm sat in the row button's listener. The button a clean Mac actually
presses is the footer primary in the no-subscription arm, and it called the
download directly. So the exact machine this panel exists to protect went
straight to 231MB with no warning while the row button beside it was gated.
⇒ The gate moved **inside `frConnectStart`**, so there is no ungated entry for a
new call site to forget.

**Round 2 — the retries were a cross-session bypass.** "Try again" and "Start
again" passed `confirmed: true`, reasoning that a person re-trying has already
agreed. In the same session they have. But the arms those buttons live on are
painted **on a fresh page load** from the persisted connect record, so somebody
who had seen no confirm at all could press "Start again" on an interrupted
download and begin ~230MB with nothing on screen saying so. **The session flag
does not survive a restart; the literal did.**
⇒ Gating on `FR_CONN_CONFIRMED` alone gets both cases right: a same-session
retry stays silent, a cross-session one asks.

**Round 2 — the panel asserted an install it cannot confirm will happen.** The
engine field it reads does not exist yet, so the check is constant-true. That is
a fine default for **asking** and wrong for **claiming**: a flat "we need to
install Claude Code first" is false on any Mac that already has it — including
the working Claude Max machine that screen spends three paragraphs protecting —
and could make someone decline a download that was never going to happen.
⇒ Conditional while unknown, flat once the engine can tell us.

## Round 3 — no blocker; four warnings, and the first is the worst kind

**A fix that could not fire.** `frClaudeConfirmOpen` took an opener argument
**nobody passed**, so it always fell back to the row button and the defect its
own comment claimed to have fixed was still live. ⚠️ A fix that cannot fire is
worse than no fix, because the comment stops the next person looking. Threaded
from all five call sites.

**The confirm sentence rendered as muted body copy.** `#firstrun .fr-confirm-t`
is (1,1,0) and lost every declaration to `#firstrun .fr-body p` at (1,1,1) — on
the one panel whose job is to be read. This file documents that trap twice
already, and this branch **caught it for the button and missed it for the
paragraph beside it**.

**The size was arm64's, stated unconditionally**, while the engine picks arm64
or x64 from `os.arch()`. On an Intel Mac the panel described a file that machine
would not download. Withheld there rather than guessed.

**The screen contradicted itself.** Claude's row went green with a check while
the GPT row two below still greyed out — opposite signals for one outcome, and
the exact greying Josh ruled against at 09:27. ⚠️ **My own test had forbidden a
shared mechanism and said nothing about the OpenAI row, so it locked the
divergence in rather than catching it.**

## The guard that was missing

Round 2's worst blocker had **no test at all** — I proved the fix by hand and
then found nothing would catch its return. Added and proven: **exactly one call
site may pass `confirmed: true`, and it must be the Confirm handler.**

## Five wrong anchors, one shape

`indexOf`/slice anchors that reached past the thing they named: one matched a
CSS rule instead of a row; one compared open/close counts and could never fire;
one measured the *next* listener, so deleting the behaviour under test left it
green; one overshot into the close function. **A fixed byte count is never the
right boundary for a thing that has one** — bounded at the next `function` now.

## Unproven, stated rather than buried

- **Nothing here has been pressed.** All three suites are green (7/7, 9/9,
  242/242) and the panel has not been clicked in a running app. The reveal,
  focus moves and the green state are pinned by tests and by a reviewer reading
  the cascade, not by a person using them.
- `frClaudeInstallNeeded` and `frClaudeDownloadBytes` read an engine field
  (`FR.connect.willInstall`) **that does not exist yet**. Both fall back
  honestly — ask when unknown, say "a large download" when the size is unknown —
  and Angel is adding the field. Until then the confirm always shows.
- The Intel branch uses a `navigator.userAgent` sniff as a stopgap. It is a
  proxy, not the engine's answer, and should go when the field lands.
