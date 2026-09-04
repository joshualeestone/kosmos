# Plan: Auto-save verbatim copy fix (#2054 QA)

Branch: `autosave-verbatim-2054`. Card: kosmos#2054. Lane: design/content (Mona Lisa).

## Goal

The built Settings > Automation > Auto-save hint reads Josh's ruled verbatim copy, not the plainer
phrasing he rejected.

## Why

Splinter directed a design-owner QA of the built #2054 Automation view against my approved design
(installkosmos.com/design/automation-consolidated). The build (PR #2068) is faithful on structure
(three wired slider sections, no dead controls, Recommender/Assigner/Daily correctly omitted since
their products are unbuilt) and has no warning boxes. One verbatim violation: the Auto-save hint
reads "Kosmos asks it to write its progress to a file, so a long piece of work is not lost as it
reaches the limit" - which is the exact plainer wording Josh corrected during the design pass. His
ruled verbatim (design page line 149) is "it will automatically be asked to write a handoff document
for its future self", and he made verbatim-only a standing rule (my daily report, 2026-09-03).

## Change

`web/index.html` #ah-row hint: replace the reworded/added sentence with Josh's verbatim
"When an agent's context is nearly full, it will automatically be asked to write a handoff document
for its future self. On by default." ("On by default" is the factual status note kept consistent
with the sibling Prompter/Agents-talking rows.)

## Test plan

Extend `docs/browser-checks/render-prompter-label-1843.js` (already navigates to the Automation
section, both themes) with two arms on the rendered Auto-save hint: it CARRIES "write a handoff
document for its future self" and does NOT contain "progress to a file". Positive control: fails
against origin/main (which has the rejected wording).

## Out of scope

Prompter and Agents-talking copy differ from the abbreviated #2054 layout mock, but the build's
fuller per-control copy is plausibly the authoritative verbatim from their own earlier passes (and
the Prompter build copy is arguably more accurate). Flagged on the card for Josh, not rewritten here.
