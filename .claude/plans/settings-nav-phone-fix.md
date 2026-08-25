# settings-nav-phone-fix: the Settings nav stacks above the section at phone width again

Cut 6 of 0.5.24 went red on render-settings-nav ("[light]/[dark] at 420px the
nav sits above the section", navBottom 533 vs secTop 99). Confirmed by a
sandboxed run against origin/main c5b3112: 92 pass, those 2 fail.

## Cause

#770's first cut (PR #773) gave Settings an id-selector column rule up to 60rem
(`#panel-settings .dbody { 176px minmax(0,1fr) }`). At phone width the older
`@media (max-width: 56rem) { .dbody { minmax(0,1fr) } }` rule was meant to
stack the nav, but a class selector loses to an id selector whatever the
order, so the nav stayed beside the section.

## Finished looks like

- render-settings-nav.js passes in full on the branch (it did: 94 pass).
- render-settings-nav.js also renders the 56 to 60rem band (a 920px step:
  nav beside a fluid section wider than 544px), so the 60rem rule has an
  on-screen check for the first time.
- render-full-width.js is not wired into the runner and fails on the create
  form since 08-19 (kosmos #778); not this branch's to fix.
- web.settings-width.test.js pins that the 56rem block after the 60rem rule
  restates the Settings rule with the same specificity.

## The change

One rule inside the existing 56rem block, after the 60rem one:
`#panel-settings .dbody { grid-template-columns: minmax(0, 1fr); }` (no
`justify-content`: a single fluid track leaves nothing to place, and the 60rem
rule already sets stretch at every width the block covers).
Same specificity, later in the sheet, so it wins where it should and nowhere else.
