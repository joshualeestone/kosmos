# usagerules-5444: an empty usage history draws no box

Card: #5444 (the 0.7.26 design pass; found when the Token Usage loading screen was finally shot).

Finished means: while a first read of /api/usage is loading, after a failed read, and when there is no usage yet, Settings > Token Usage shows no empty bordered box under "Usage history" (it drew as two stacked hairlines over the method footnote's own, reading as broken for the up-to-a-minute a first read takes). Once the read answers, the history box is drawn with its rows as before.

Built: `#usage-history:empty { display: none; }`. The painter writes '' for no rows (clearAll on loading-first and on failure; usageHistoryHtml of no days), so :empty is exactly "nothing to show". A re-read keeps the previous rows until the new ones paint, so this changes nothing there. The heading and its hint stay, so the section still says what will appear.

Rejected: hiding the whole .usage-hist block while loading (the heading and hint explain what is coming, and the block would jump in later); a placeholder row (it would say something the spinner line above already says).

Check: render-token-usage-2617 gets three assertions: after a failed read no box; while a first read is held open no box (each read in the same moment as the section's heading being visible, so a hidden section cannot pass it, review 1); CONTROL once it answers the box is drawn with its three rows. Run on a sandboxed board with first run marked complete (as the runner's board 8 is): 124 ok. With the rule removed, the two new assertions go red and the control stays green.
