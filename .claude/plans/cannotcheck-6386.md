# cannotcheck-6386: the ran-out ending stops saying "nothing more is needed" (#6386)

## Measured before building (origin/main 8f2b6be756, relay e2896a984e)
The card's mechanism exists: #6404 shipped Check the code (relay #442, kosmos #6453). What was left of #6386:
the page still drew "and nothing more is needed" whenever `can_recheck` was false and the tries were not used up.
That sentence was true when nothing read peers.json. It no longer is: `openticket.rs`, `proxy.rs`, `devices.rs` and
`tlspin.rs` all read it. It is reachable: `can_recheck` is false under the unanswered cap (a day), with no key to pin a
hello to, with an older tunnel, and for the interim paint while a code still shows. The comment beside it also still
said nothing reads peers.

## The change
web/index.html, `plusJoinRanOutHtml`, the `!can` branch: only "<name> allowed this computer. Its code ran out before
The codes match was pressed here." The first sentence is one local shared by the three branches. Stale comments
removed. The hint for a refused press (`nothing_to_recheck`) becomes "The code cannot be checked right now.": the
tunnel refuses that way with tries left too, so "There is nothing to check here now." read as finished.
docs/browser-checks/render-connect-sheet-4637.js: the four #4794 assertions pin the new words, and a new arm pins the
refused press.

## Decided
- Call: say what is true and promise nothing.
- Rejected: "The code cannot be checked right now. Come back to this page later." (the first version, review 1). An
  ending is not polled and the load probe runs once, so coming back in an open window shows the same note; it is also
  false for the no-key and older-tunnel cases, wrong for the interim paint, and collides with the refusal hint.
- Rejected: a sentence naming the day's cap. The page cannot tell the cap from a missing key.
- Rejected: leaving the words because the case is rare. They tell a person a pairing is finished when it is not.
- Rejected: a re-read on returning to the section. It is new polling behaviour for a rare state.
- Weakest premise: saying nothing about what to do next. A person in the capped state is not told the button can return.
- Would change my mind: a tunnel field saying why the check is not offered, which would allow an exact sentence.

## Kept as it was
A later page load shows no ending unless `can_recheck` is true. That predates this branch and is the decision recorded
in joincode-4794 ("an ending is NOT shown on a later page load"). A capped computer gets the button on a load after the
cap lapses.

## Not done
The relay's doc comment on `confirm_expired` says "keeps nothing more is needed". That is a comment only, and relay
is about to freeze, so it stays for a separate one-line relay change.
Two real computers: #6404 closed with that uncovered; nothing here changes it.
