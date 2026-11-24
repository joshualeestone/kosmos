# handcheck-8960: promote-channel.sh refuses --force without a named hand check

Card: kosmos#8960. On the 0.8.19 prod promote (2026-11-23 22:06 CST) a wrapper's phase B passed `--force` whenever phase A held, and promote-channel.sh printed "promoting on the strength of a HAND verification" when none had been done. Splinter's call (22:18): the tool itself refuses, so no wrapper can get round it.

## Change
- `--force` now needs `--hand-check "<what you checked, and how>"` (also `--hand-check=<text>`). The text is whitespace-squeezed and must be 20 or more characters. Checked right after the family check, before the site is read or anything is written: a refusal is exit 1, "Nothing was written".
- `--hand-check` without `--force` is refused (it names what a forced promote rests on, so it means nothing alone).
- The named check is printed beside each of the three gates `--force` can pass (experience, agent-spawn, tunnel handshake), so the log says what the promote rested on.
- `--family win` keeps its own refusal of `--force` unchanged (the new rule sits after the family block).
- The HOLD messages that offer `--force` (FORCE_WORDS and the experience gate's two) now say `--hand-check` too.

## Tests
- tools/test-staging-channel-2036.sh: four new cases. No `--hand-check`: refused, nothing written. A check under 20 characters after squeezing: refused. `--hand-check` alone: refused. CONTROL: gate 2 plus `--force --hand-check=<text>` promotes and prints the named check.
- The existing `--force` calls in test-staging-channel-2036.sh (12), test-promote-named-7005.sh (9) and test-promote-linux-7281.sh (2) pass `--hand-check "$HC8960"`. Two wording assertions in 7005 follow the new HOLD text.
- test-promote-channel-win.sh is unchanged and passes, which shows the Windows refusal still comes first.

## Rejected
- An environment variable instead of an argument: it would leak across calls in a wrapper's shell, which is close to the auto-force this card is about.
- Checking the text's content (a version number, a board): too easy to satisfy mechanically and too easy to get wrong. Length only forces the operator to write something.

## Weakest premise
That 20 characters is enough to make a person stop and write a real sentence. It is a speed bump against a wrapper, not proof a check happened; the log line is what lets someone audit it afterwards.
