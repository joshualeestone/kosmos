---
pre_challenge: true
method: challenge-loop
branch: owncode-4699
diff_hash: dc5b340fa97b8eefcb398f1bc7b112ed0e9e956cb26e70d0646c539e37b63cfa
validation: passed (Mortals) on head 0ee3ee8fc, full suite, hash 88c34fc740a8, 13:39 CDT 2026-09-30; browser check 44 PASS / 0 FAIL on the same head; changes since are plans only
subdir_audit: passed
timestamp: 2026-09-30T19:48:33Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10 (sonnet, fable, (3 unrecorded), opus, sonnet, fable, opus, sonnet, fable, sonnet)
**Converged:** Yes (iterations 9 and 10 found no defect in the code; 9's one WARNING was that the browser check had never run, and it has now: 44/0)

Per-round detail is in .claude/plans/owncode-4699.md.

### Iteration 2 (fable)
- [WARNING] (fixed) three room notes in server.js federateOut still said "the external project" on own rooms.
- [WARNING] (fixed) the unchecked refusal printed the raw cause, which can carry a path.
- [NIT] (fixed) the "nothing is held" test asserts joinSnapshot is null after the refusal.

### Iteration 4 (opus, on the head merged with main)
- [WARNING] (fixed) uncheckedRefusal's anchor missed the tunnel's "Error: " prefix.
- [WARNING] (fixed) farSide said "your other computers" for an owner project with a guest.
- [WARNING] (fixed) the code's format number went back to 1 (my bump to 2 reversed).

### Iteration 5 (sonnet)
- [WARNING] (fixed) the other-account sentence looped the person in the likeliest real case.
- [WARNING] (fixed) any coordinator refusal without a slash was shown raw; review 4's pass-through withdrawn.
- [WARNING] (fixed) "your other computers" before a guest's seat.

### Iteration 6 (fable)
- [WARNING] (fixed) the waiting-computer matcher was anchored on the Mac connector's words; Windows says it differently.
- [WARNING] (fixed) "Allow it from one of your other computers" named no control; it now says where.

### Iteration 7 (opus)
- [WARNING] (fixed) a connector older than the account-computers route fails with "does not sign"; handled.
- [WARNING] (fixed) the browser check asserted the refusal with the join form closed.
- [CONVENTION] (fixed) one derivation of "this account's computers".

### Iteration 8 (sonnet)
- [WARNING] (fixed) an underivable computers' domain now fails with a sentence, not forever.
- [WARNING] (fixed) a refused check no longer deletes the earlier accepted check of the same code.

### Iteration 9 (fable)
- [WARNING] (closed by running it) the browser check had never run: it ran 12:44, 44/0.
- [CONVENTION] (fixed) account-computers.js required twice in federation.js.

### Iteration 10 (sonnet)
- [NIT] (not taken) old-code check before the account check: the advice still works.
- [NIT] (not taken) the maker's name is not checked against this service's domain: fails safe as other-account.

### Validation
- Mortals full suite PASSED on 0ee3ee8fc, hash 88c34fc740a8 (13:39 CDT).
- Browser check on 0ee3ee8fc: 44 PASS / 0 FAIL (12:44 CDT).
