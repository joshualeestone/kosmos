# issue-7342: a red pill never says Idle or Working (kosmos#7342)

Mona Lisa's ruling on the card (10-27 15:4x CDT): when the pill is red but the word would be Idle or Working, it says
Issue, the Mac's own red word for needs you. Any other word the Mac sent (Messages stuck, Keeps stopping) stays.

## Finished looks like
- Board.pillWord: Issue on a red (.problem) pill whose word would be Idle or Working; otherwise statusWord.
- Used where the word is coloured by the same state: the Agents row's pill (and its VoiceOver label), Today's row, and
  the DM header's status line. A list or chat not updating keeps the plain word (its colour is grey).

## Decisions
- Applied to Today and the DM header too, not only the Agents pill: they colour the same word red, so a red Idle was
  possible there as well. Weakest premise: Mona Lisa ruled on the pill; if she wants the header to keep the plain word,
  it is one line back.

## Verify
- iOS 16 typecheck; all nine LogicTests scripts (main: red Idle and red Working say Issue, a green Working and a plain
  Idle keep theirs, a Mac word such as Messages stuck stays).

## Review
- Round 1 (sonnet): 1 warning fixed: Today and the DM header colour the word by tone(), not pill(), so pillWord could put Issue in grey or green (a restart that failed, a crash loop, or the Mac's tone disagreeing). They now use toneWord, keyed on the tone they are drawn in; the Agents pill keeps pillWord. Test: over every red route found, Issue appears exactly where its colour is red, by either rule.
- Round 2 (sonnet): no blocker or warning. Nits fixed: a direct toneWord check (a red pill says Issue on the row while the Mac's quiet tone keeps a grey Idle on Today and the header, each matching its colour); a dead test assignment removed. Accepted: the row and Today can differ for one agent when the pill and the Mac's tone differ (each consistent with its own colour). CONVERGED.
