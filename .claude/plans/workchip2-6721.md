# workchip2-6721: render-workchip-zero-2157 follows #6721's one-missed-poll rule

**Found.** PR #6797's browser-checks went red on render-workchip-zero-2157 ("a failed poll brings the tile BACK
showing ?"), in both engines. It fails the same on clean main (4757ec8324). Bisected: it passes at 4695cda373 and
fails from ed505997b9 (kosmos#6721, PR #6745): one unanswered status poll now keeps the board as it was and says
Reconnecting; only the second in a row is the not-answering state. The arm (mine, from #6649) failed the fetch once
and expected "?", which was the old rule.

**The call.** The product change is intended (#6721), so the check follows it: the arm fails the fetch twice and
expects the tile back with "?" after the second miss, and a new arm pins the first-miss behaviour (the hidden zero
tile stays hidden). Rejected: reverting #6721's rule, which was its own reviewed ruling, or deleting the arm, which
would leave a failed board able to claim none are working.

**Done when.** The check passes on main in both engines, and the first-miss arm fails on the page from before #6721.

## Tests run
- On this branch (main plus this change), chromium and webkit: 14/14 passed.
- Control, the page at 4695cda373 (before #6721) with the check as it stood at its first commit (19693263c2): the
  first-miss arm FAILS in both engines (afterOneMiss hidden=false count="?"), 12/14. Measured then, NOT re-run since:
  reviews 1 to 3 added the Reconnecting and miss-count assertions. A later blind review reads (not measured) that on
  that page the second-miss arm now fails too, because the Reconnecting element does not exist there yet: a side
  reason, not the rule. The first-miss arm is still the one that tells the two rules apart.
- On main before this change: 10/12, the two failed-poll arms red (the failure PR #6797 hit).

**Weakest premise.** That two misses is the whole rule. If #6721's threshold changes again, this arm moves with it.
