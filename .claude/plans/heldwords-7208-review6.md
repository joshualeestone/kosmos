# heldwords-7208 review, round 6 (blind CTO lens)

Branch heldwords-7208 at 0e3dce372d, against origin/main. Counts: 0 BLOCKER, 0 WARNING, 1 NIT.

The round 5 fixes are right. The "is the kept row hidden" probe now goes through the same dmWho path as the
person's real row, and the connection_lost arm names the message box when the box also blocks the message. Nothing
new worth fixing in the product code; one small honesty point in the new browser case.

## [NIT] 1. The new browser case's `shown` half reads a different row than the one it just sent
docs/browser-checks/render-dm-held-5805.js:144 (`shown: [...].some((x) => /ship it/.test(x.textContent))`) and :146
(the cleanup filter's `m.text !== 'ship it'`)

The fetch stub answers POST /thread with `__sendAnswer` but never adds the sent row to `window.__fx.messages`, so the
"ship it" send is never in the thread. `/ship it/` instead matches the BASE fixture's held row "ship it tonight"
(line 27). So `shown === false` proves the search "you" hides the person's EARLIER row, not the one just sent, and the
cleanup filter entry for 'ship it' removes nothing (as the 'one more' and 'send the invoice tonight' entries before it
also remove nothing).

Failure scenario: none in the product. A later reader trusts `shown` as "the new row is out of sight" and leans on it;
if the BASE row is ever renamed or dropped, `shown` stays false for any search and the half reads green while
checking nothing. The line half is the load-bearing assertion and it is sound (control below).

Fix: either append the sent row in the stub (`window.__fx.messages.push({ at, text: JSON.parse(opts.body).text,
delivery: ... })` on POST /thread) so `shown` reads the new row, or send a text that no fixture row contains and
match it exactly, or drop the `shown` half and say the line is what is checked.

## Checked and found clean

- Measured: `node --test web.inputkeep-6774.test.js web.limitdm-5805.test.js` (cwd the worktree): tests 11, pass 11,
  fail 0, rc=0.
- Measured: docs/browser-checks/render-dm-held-5805.js, HEADED=0: rc=0, 21 PASS lines, "all passed", "no page errors".
- Measured control for the round 5 fix: a scratch copy of web/index.html with the probe put back to
  `[{ from: 'you', text }]` (substitution count 1) and the same check run on it: rc=1, exactly one FAIL, "a search that
  hides the person's own row says where it went {"line":"","shown":false}". So the new case goes red on the old code
  and green on the new.
- Reasoned: probe shape. `talkFilterRows([{ text }])` gives dmWho `from` undefined; with CURRENT set (always, inside
  sendTalk's thread) that goes to tskAgentName(undefined), which returns '' unless a LAST card has no sessionName, the
  same '' the real `from: null` row gets. The only divergence is with no CURRENT ('undefined' versus 'null'), which
  cannot happen on this path.
- Reasoned: connection_lost with the box. `box` covers heldFor 'input' and a row behind one kept for the box; with
  behind it reads "This delivers after the messages ahead of it, when X is connected again and its message box is
  clear." Correct. The unit case added (heldFor 'input', connection_lost) pins it. The `stopped` arm still omits the
  box; a restarted agent comes back with an empty box, so that is not an over-promise and not raised.
- Measured: the unit test's source-regex for the probe was updated to `\[\{ text \}\]` and passes; the old shape no
  longer appears in web/index.html (grep in the control copy found it only after my substitution).
- Measured: literal em dash in added lines of `git diff origin/main...HEAD`: 0 (a planted control line returned 1), so
  round 5 NIT 3 is fixed. Two added lines in review4.md and review5.md name the entity spellings (&mdash; and so on)
  as part of describing the sweep; those are names, not dashes, and are internal plan files, so not raised.
- Measured: `git merge-tree --write-tree origin/main HEAD` rc=0.
- Not re-raised: rounds 1 to 5 findings, all taken.
