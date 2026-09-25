---
pre_challenge: true
method: challenge-loop
branch: second-kind-3796
diff_hash: 80d714db12d9027e8b756d921299d632a7d026edf5e5a7602c47ebbb613348eb
subdir_audit: passed
timestamp: 2026-09-25T22:35:52Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 blind review passes (opus on addendum 3, opus on addenda 4 to 9; the #3808 base had its own sonnet pass), plus renders of every wizard state.
**Converged:** Yes. 0 blockers across all passes; every warning taken.

## Iteration 1 (opus, addendum 3)
- [WARNING] The recovery line pointed at "I lost my phone", which #1012 hid on a computer with no devices. Taken: #1012 reversed. Every account has a second step now (require_second, config.rs), and this is its only recovery.
- [WARNING] The empty-code message still said "phone". Taken: it follows the account's factor.
- [NIT] "•••" alone read badly. Taken: "your phone".
- [NIT] role=button on the toggle. Taken, plus Space.
- [NIT] SMS was not browser-driven. Covered by the route test and the page unit test.

## Iteration 2 (opus, addenda 4 to 9)
- [WARNING] A failed automatic register was a dead end. Taken: "could not connect as X" plus Try again.
- [WARNING] Sign out during the automatic register did not sign out (the connector had already written the identity). Taken: no way-out link while it runs.
- [WARNING] setupComplete lowercased after the #1010 recognition. Taken: now before.
- [WARNING] Focus was lost on the expired panel and during the automatic register. Taken.
- [WARNING] The 5s repaint could flash the connected flow mid-register. Taken: PLUS_SI_REGISTERING.
- [NIT] A trailing hyphen at submit. Taken. Copy is announced (now removed by addendum 10).
- [STRENGTH] Verified by the reviewer:
  - no register loop;
  - the refusal name is regex-bounded, and the coordinator still checks ownership;
  - PLUS_SI_LANDED cannot stick;
  - a wrong code stays on its step;
  - the #1012 reversal is justified.

## Measured
- Full suite on the merged tree 65fa18cd8: 9607 tests, 0 failed, exit 0. Addendum 10, which followed, is page-only (the landing reduced to one line). After it, the affected unit tests and render-plus-signin-3478 pass.
- Each new arm was perturbed red:
  - second-factor words (page, engine, route);
  - Start over, the email kept, the way-out label, the expired detection;
  - the #1012 reversal;
  - capitals (engine, page) and #1010 with a capital;
  - the owned address (engine, route, page), the landing guard, Try again;
  - #3827 (starts from off).
- Shots: ~/.cache/claude-handoffs/shots-3796/after3 (landing), after2 (second factor), after2-noaddr (choose address).

## Weakest premise
- Addenda 8 and 9 rely on the coordinator's account_address (relay #136, not yet deployed). Until then the path rests on the English wording of the coordinator's refusal ("already owns the name X"). If that sentence changes before #136 deploys, the fallback silently becomes the ordinary chooser, which the coordinator then refuses with its own words.
