# listmarks-9188: a task's own title cannot print a row mark in `kosmos task list`

Card: kosmos#9188 (the task list's half of #9179; claimed by Mona Lisa 11-26 21:5x). Built on PigeonPete's
markwords-9179 (PR #9198, converged and validated, held only by the 0.8.27 cut) and rebased onto main once it merges.

## Done when

In all three list printers (Mac install/kosmos `task list`, Windows tools/windows/kosmos-cli.js taskList, and
engine/tasklist.js for the compact and across lists), an ordinary task's title that uses one of the list's mark words
prints QUOTED, said to be the task's own words, so it cannot pass for any mark whose words are in the list (review 3:
"never" overclaimed; the list is hand-built, see Weakest premise); a title with no mark word is unchanged; an install without engine/markwords.js prints as before. One test per surface, red without the change.

## Measured on the base first (the card is live)

On markwords-9179 (= main for these files), an open task titled "[on hold] ship the release" prints in both CLIs as
`[N] [on hold] ship the release`, exactly a held row; "tidy the docs [added by mara]" prints another agent's mark.

## The change

- engine/markwords.js (PigeonPete's, his two functions untouched): adds `usesListMarkWord(text)`: usesMarkWord, or
  one of the list's marks on the same folded copy, as whole words with the same gap rule. The marks, as of round 3
  (the code's LIST_PHRASES comment is the authority): bracketed "not run", "replaced by", "project paused" and
  "project is paused", "added by", "subtasks done", "repeats", "waits" (for, until, on), "woke:", "checks reported",
  "outside text", "waiting on a review / the person / a release", "until task N"; parenthesised "through #N" and
  "through task N", "under task", "owner:", "reported finished", "still to finish", "last activity", "quiet N",
  "left under closed", "no activity on record", "next run", "held by the person", "only the person can lift",
  "condition is met", "seen by the person"; and "done" as the first word (after a row label too) or in brackets or
  parentheses anywhere.
- engine/tasklist.js titleOf: a non-webhook title goes through usesListMarkWord / quoteOwnWords.
- install/kosmos `task list` (inline node): loads the module from `kosmos_engine_module markwords` through
  KOSMOS_MARKWORDS; a missing module leaves the title as before.
- tools/windows/kosmos-cli.js taskList: requires engineDir()/markwords.js the same way, same fallback.

## Decided

- One fold for all four surfaces (the instructions block and the three lists): the list's words are a superset of
  the instructions block's, in the same module, so they cannot drift apart.
- "done" only as the first word: it is the one common word among the marks, and "[done]" is printed only at the row's
  start; "subtasks done" is caught by "subtasks". Rejected: "done" anywhere (most titles that finish a thing would print
  quoted).
- Fixture titles in five older tests used mark words as labels ("Task built", "Task a-built", "waits for a task"):
  renamed to "ready" and "held for" (their tests check order, groups and holds, not the title).
- Review 1: the parenthesised marks with fixed words are in (below); an owner's bare name, "(otto)", has no word to
  test and is #9201.

## Weakest premise

That the word list is complete for today's list output. It is HAND-BUILT from the three printers and the wake words,
and every review round so far (1, 2 and 3) found marks it missed; a new mark added to any printer later needs its
words added to LIST_PHRASES too, and nothing enforces that. If a further round finds more, the fix may be a test that
renders every mark state through the printers and checks each mark's text is caught, instead of more hand-added words.

## Verified (round 0)

- cli.task-listmarks-9188.test.js (4): usesListMarkWord's marks and non-marks; the compact list; both CLIs against a
  real board (a forged prefix, a forged suffix, a plain control); an install without the module keeps the old output.
  Each surface put back to the base fails its test.
- Every cli.task-* test, server.webhooks-1307, the Windows CLI's 570/verbs/parity/shims tests, the #9179 test,
  tasklist.next-8576, the reachability and tree guards (533: 512 pass, 0 fail).

#### Iteration 1 (blind review, opus)

- [BLOCKER] taken: the word list missed "waits until" (a time wake prints `[waits until ...]`; I had only "waits for"),
  so "send the invoice [waits until tomorrow at 9am]" passed for a woken task. My stated weakest premise, the
  completeness of the list, was the defect. Now "waits" alone (for, until, and the compact list's "(waits on ...)").
  Re-read every mark the printers emit: added the compact, across and long lists' parenthesised marks with fixed words:
  "(through #N)", "(under task N)", "(owner: ...)", "(reported finished: ...)", "(still to finish: ...)",
  "(last activity ...)", "(quiet N days", ", left under closed task #N". Tested; dropping "waits" fails the test.
- [SHOULD-FIX] taken: a "[done]" after the row's own label ("[7] [done] x", "#3 [done] x") passed the first-word rule.
  Now a bracket or # and digits may come before it; a bare number ("3 done items") stays plain. Tested both ways.
- [SHOULD-FIX] split out: an owner's bare name in parentheses ("fix the login (otto)") has no fixed word; filed #9201.
- [NIT] taken: a comment on why tasklist.js needs no typeof guard (it ships beside markwords.js).
- [NIT] recorded, not built: no test of the Windows CLI with no markwords.js in its engine folder (the fallback is
  read correct, as the Mac one is tested); the agent nudges were not checked for titles printed beside marks.
cli.task-listmarks-9188 4 of 4 and the neighbouring set (533: 512 pass, 0 fail).

#### Iteration 2 (blind review of the whole branch, sonnet)

No BLOCKER. The reviewer listed every mark the three printers emit and ran about 100 titles: every bracket mark and
the parenthesised ones from round 1 are covered; the string-built regexes escape as intended; empty, 2M-character and
invisible-character titles run in under 40 ms.
- [SHOULD-FIX] taken: six compact/across-list marks were not covered: "(no activity on record)", "(next run ...)",
  "(its project is paused)" (my gap rule allows no letters, so "project paused" could not match it),
  "(held by the person)", "(only the person can lift it)", "(its hold's condition is met)". Added as phrases (a small
  phrase() helper joins the words with the gap); dropping "project is paused" fails the test.
- [NIT] taken: three phrases narrowed to the printers' exact words ("subtasks done", "woke:", "left under closed"), so
  "Fix subtasks rendering", "Woke up bug" and "Left under pressure" stay plain (tested).
- [NIT] recorded, not built: "(owner:otto)" with no space is a near-imitation only (the printer writes "owner: ");
  FIRST_DONE costs "Done with X" a quote in the compact lists, which never list closed rows; showLines quotes an
  "Under:" parent title that uses a mark word (as titleOf does everywhere); no test drives acrossLines, showLines, a
  closed task, or the Windows missing-module path; the remaining common words ("repeats", "waits", "replaced by",
  "not run", "owner:") quote some ordinary titles, the same cost #9179 accepted.
cli.task-listmarks-9188 4 of 4 and the neighbouring set (533: 512 pass, 0 fail).

#### Iteration 3 (blind review of the whole branch, opus)

No BLOCKER. Ran about 110 titles; the Mac half under bash 3.2; every printer wired the same way with the same
fallback; empty and "(no description)" titles as before; the five renamed fixtures check what they did.
- [SHOULD-FIX] taken: "[done]" anywhere but the first word printed plain ("Release notes [done]" read as closed).
  BRACKET_DONE: "done" in brackets or parentheses anywhere; a bare "done" still only as the first word.
- [SHOULD-FIX] taken: the built mark's "waiting on a review / the person / a release" was not covered.
- [SHOULD-FIX] taken: the long list's "(owner: X, through task N)": "through task N" now, beside "through #N".
- [NIT] taken: "(seen by the person" and a hold's "[until task N is closed]".
- Found while building it: my inline `//` comment on the "through" line swallowed the rest of that line, silently
  dropping "owner:", "reported finished" and "still to finish"; the round-1 test caught it (missed: reported finished),
  the comment is on its own line now. Each new rule has a mutation that fails exactly its case.
- [NIT] recorded, not built: "[dropped]" and "7. done x" lookalikes; "not run" is the most common needless quote ("do
  not run the migration"); a relative KOSMOS_HOME would make the module unfindable (titles print as before, no
  warning); titleOf also reaches `task show`'s header, its "Under:" field and the built-files list (untested here);
  no test of the Windows missing-module path, the across list or a closed row.
cli.task-listmarks-9188 4 of 4 and the neighbouring set (533: 512 pass, 0 fail).
