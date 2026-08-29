# cascade-1476: assert the rule that governs, not the one that reads first

## Reproduced Vivienne's measurement before changing anything

```
delete the LATER  .pjcard-h rule (2880) = real behaviour change -> T1 STAYED GREEN
delete the EARLIER .pjcard-h rule (2829) = no visual effect     -> T1 WENT RED
change the EFFECTIVE margin-top to 99px  (2882)                 -> T2 STAYED GREEN
```

**Exactly inverted, both instances.**

## What actually governs, measured

`.pjcard-h { display: flex; ... }` is dead. The stacking is produced by a **grid**:

```
.pj-row            display: grid; grid-template-columns: minmax(0, 1fr) auto
.pj-row .pjcard-h  display: contents        <- dissolves the header
.pj-row .pjname    grid-column: 1 / -1; grid-row: 1
.pj-row .pjpill    grid-column: 2; grid-row: 2
```

⭐ **T1's own docblock already said `.pjcard-h` is dissolved to `display: contents`.**
The prose knew and the assertion did not.

## The fix

`test-support/cascade.js` answers *which rule wins*, and both tests assert through it.
`effective(page, selector, prop)` returns the last declaration of that property for that
selector **in the same conditional scope**.

## Proven both directions, which is the card's condition 2

```
delete the LATER rule  -> now RED     (was green)
delete the EARLIER one -> now GREEN   (was red)
break the effective display of .pjfaces -> RED
break the effective grid on .pj-row     -> RED
```

## The sweep, condition 3, shipped as a guard rather than run once

`web.cascade-shadowed-pins-1476.test.js` fails any test pinning a declaration a later
rule in the same scope overrides. **It catches main's real pre-fix state**, naming file,
property and what governs.

🛑 **AND IT NEEDED SCOPE AWARENESS TO BE SHIPPABLE.** The first version was scope-blind
and reported **two defects that are ordinary responsive overrides** (`.pjpill` at 56rem vs
52rem, `.dbody` at base vs 60rem vs 56rem). Shipping that would have put a red on two
correct tests. With scope tracking: **0 real findings**, 3 benign pins where the later rule
sets different properties.

## What I did not do

**Did not re-anchor any closing brace** (condition 4). Nothing here touches #1310's axis.
