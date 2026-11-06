# dotsguardwords-8058: the dots guard's messages say what it really checks

Follow-up to #8082 (#8058), whose proof deferred round 7's wording findings to a commit after the merge.

Finished looks like: every message and comment on the guard in ios/LogicTests/sweep/main.swift is true about what the
code checks (four names, // comment lines skipped, a renamed type or a hand-made spinner not caught), the comment-line
filter is computed once, behaviour is unchanged (same offenders, pull to refresh pinned at 10 + 1), and the alldots plan
line names KosmosOrb as the guard matches it.

Checks: all iOS logic suites; both arms by hand (a // line naming ProgressView passes, a code line fails).
