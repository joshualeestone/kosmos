# #3419 (UI half): kill the needs_you "waiting on an answer" prompt; render the question as a thread bubble

Branch: `needsyou-banner-ui-3419`. Card: joshualeestone/kosmos#3419. UI half only; the engine
half (routing the question into the dialog as a message + the fragment-truncation fix) is ICK's
`#3455` (`needsyou-question-3419`), co-landed engine-first.

## The ask (card #3419, Josh, live 0.6.88)

Josh, as a white-collar end user, never wants the needs_you "waiting on an answer" prompt UI in the
agent dialog. When an agent has a pending question it should be injected into the regular dialog
thread as an ordinary message the user can answer in the composer or ignore. "No prompt box, no
'Clear this message', no 'It was waiting on an answer when this was sent.' line, ever."

## What the UI half does

1. **Remove the answer-menu subsystem from `web/index.html`**: the option-menu buttons (`#d-qopts`
   / `#d-qout`), the `#d-qask-text` question box and its `#2808` "Clear this message" / "Show full
   command" (`.qask-expand`) controls, the `TALK_*` answer-hold globals, the page `talkKey` copy of
   `optionsIn`, and the `chose` answer payload in `sendTalk` / the `.qopt` click handler. A
   needs_you question is an agent-authored thread bubble now (engine `withQuestionRow`, `#3455`).
2. **Collapse `#d-qask` to the #2129 folder-trust recovery only**: the box shows ONLY when
   `body.answerNote` is set (the folder-trust prompt), carrying a recovery-framed label + the
   one-click Trust & Restart. Every other state (a regular needs_you question, a stranded issue,
   nothing asking) shows nothing there; the question is a thread bubble.
3. **Repoint `ANSWER_WANTS_FOCUS`** to focus the composer (`#d-say`) — the answer lives there now,
   not the removed question box.
4. **Silence the placed-message delivery-status play-by-play** (`placedWords` -> `''`) on both the
   agent page and the Terminal tab, for every placed pane state (idle / mid-task / usage-limit),
   extending Josh's #402 "silent when it worked" ruling and the card's "no play-by-play about the
   agent's internal state" posture. Only the genuine did-not-deliver states (unconfirmed /
   could-not) still speak. (This extends the card's literal "waiting on an answer" line to the
   mid-task consequence too; flagged on the card as a reversible one-line copy call.)

## Test rework (this is the bulk of the branch)

The menu removal broke every test premised on the old banner+menu model. Reworked, not deleted
where the coverage still has a subject:

- `docs/browser-checks/render-talk.js`: reworked from the menu model to the thread-bubble model.
  Excised the menu axis; repointed question fixtures to the injected message-row shape (a
  `questionRow` helper mirroring `withQuestionRow`); dropped `optionsIn` from the reachability
  guard; added an arm asserting the question renders as a thread bubble with `#d-qask` hidden;
  preserved the #2519 golden-card reopen defense, the first-run-overlay/inert trap, the
  delivery-receipt-vs-verdict-per-row check, presence/history, light+dark, tick, scroll/clock/404,
  and composer send/paste. Inverted step 4b to guard #3419's silencing of the mid-task placed
  consequence.
- Deleted `docs/browser-checks/render-qask-clear-2808.js` + `web.qask-clear-clamp-2808.test.js`
  (both test the removed clear/expand controls); de-listed the browser check from
  `docs/browser-checks/README.md` and `tools/browser-checks.sh`; adjusted
  `browser-checks-reason-grep.test.js` EXPECTED_CATCH_SITES 91 -> 90.
- `server.test.js`: removed 4 page-menu pins (option button data attrs, the delegated `#d-qopts`
  listener, page `talkKey`, the `const opts` gate).
- `render-talk-fill-2622.js`: repointed its A9 overflow arm off the removed menu box to a long
  thread (which scrolls internally now).
- Updated the placed-receipt tests to the silenced play-by-play (`web.agent-answers`,
  `web.term-compose-967`) and the answerNote/menu tests off spellings the menu removal restructured
  (`web.qask-trust-restart-2129`, `web.trust-note-1629`, `web.links-everywhere`), preserving the
  guarantees (answerNote-as-text, pendingIds carried, did-not-deliver arms as the positive control).
- `render-thread.js` answer arm reworked to the thread-bubble model (question in `#d-dmthread`,
  focus to `#d-say`); it is engine-seam-gated (needs `#3455`'s `withQuestionRow` to render), so it
  validates only post-co-land. `browser-checks.yml` is advisory, so it does not block the PR.
- Cleaned the dead answer-menu question-box CSS + stale comments in `web/index.html`.

## Validation

Full node unit suite green (`node --test engine/*.test.js *.test.js`: 8085 tests, 0 fail).
`render-talk.js` and `render-talk-fill-2622.js` validated headless (exit 0, problems none).
`render-trust-restart-0644.js` green (the #2129 recovery still works). `render-thread.js`'s answer
arm is co-land-gated (advisory CI).

## Co-land

Engine-first: ICK's `#3455` merges, then this branch merges `main` in (getting `withQuestionRow`),
then this branch's CI runs green against engine+UI, then this branch merges. Splinter drives it.
Not cut-gating (rides 0.6.90).
