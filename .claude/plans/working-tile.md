# working-tile: #369, a Fable session mid-turn classifies as working

## The defect, measured

2026-08-23 15:05 on the live fleet: my own pane and Mona Lisa's, both
mid-turn, read idle/unknown, and the board said "0 Working, 14 Idle". The
current Claude Code spinner line:

    · Improvising… (35s · ↓ 1.5k tokens · thought for 8s)
    · Canoodling… (4h 39m 45s · ↓ 673.5k tokens)

carries no "esc to interrupt" (the phrase the existing working rule keys
on), the pane-title spinner is not always present, and the ⏵⏵ footer stays
on screen DURING a turn, so the footer idle rule wins. The finished line
("✳ Cooked for 1m 33s") uses verbs absent from the enumerated finished
list, which is the same vocabulary trap.

## The fix

One structural rule in classify(), above the footer idle rule and below the
existing working rules: a line opening with a short glyph, one word ending
in an ellipsis, and a LIVE elapsed timer opening the parens. Structure, not
vocabulary: the gerund rotates, the ellipsis and timer do not. The finished
line has no parens and cannot match. Evidence carries the matched line.

The page half (the Working/Idle tiles floored with "N+" while any agent is
unknown) is already on main citing this card; this branch is the detector
half.

## Tests

engine/status.test.js: the two measured working lines classify working over
the footer; two finished lines with vocabulary the enumerated list misses
stay idle; the footer alone stays idle as the control proving the fixture
does not leak.

## Review bound

Two rounds maximum, declared before starting: one engine function, one
regex, false positives on echoed pane content are the risk to hunt.
