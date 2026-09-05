# #2140: order the Claude model picker most-powerful-first (item 10)

## The ask (Josh, 0.6.35 fresh-install feedback, verbatim on #2140)

Sort the model pickers most-powerful-first, per provider. This branch does the
**Claude half (item 10)**:

1. Fable 5.1
2. Fable 5
3. Opus 5
4. Opus 4.8
5. Sonnet
6. Haiku

## The change

`engine/create.js` `MODELS` array order IS the picker's display order - both the
create form (`applyCreateProviderUI` maps `CREATE_MODELS` to options in sequence)
and the detail change-model row render it in array order. So the change is:
reorder the array to Josh's sequence (only Fable 5.1 and Fable 5 swap; the rest
were already in this order), and add an engine test asserting the exact sequence
(Josh: "hermetically verifiable, assert the option order").

- **Default unchanged.** Sonnet 5 keeps `default: true`. Josh asked to reorder the
  menu, not to change which model is pre-selected - a separate call. The test
  pins both the order and that the default is still Sonnet.
- **One copy fix.** Fable 5's `why` said "The most capable"; with Fable 5.1 now
  above it, that is inaccurate, so it now reads "The previous Fable. Very
  capable, ...". Minimal and forced by the reorder, not scope creep.

## Scope split (per Renet, the carder, and confirmed with Splinter)

- **(a) not (b):** per-provider power-sort within each provider's menu, NOT a
  unified cross-provider picker. Josh's words sort within each provider, and the
  create form shows one provider at a time.
- **OpenAI half (item 9) is a separate follow-up PR, NOT blocked on Josh.**
  Splinter's ruling (2026-09-05): the order is already decided verbatim, and the
  live model ids are on the machine (Josh's running 0.6.35 picker already renders
  "5.6 Terra" etc. from his account - so the codebase's gpt-5/gpt-4o ranking
  prefixes are what is stale, not the fetch). The fix is a reversible design call
  that is mine: rank by numeric tier DESCENDING (5.6 > 5.5 > 5.4 > gpt-4.x), with
  Josh's within-tier order as the tie-break. Forward-compatible - an unrecognized
  higher-numbered model sorts to the TOP ("most powerful on top"), inverting the
  current unknown->last behavior. That ships on its own branch after this one.

## Weakest premise

That the default should stay Sonnet 5 rather than move to the most-powerful
(Fable 5.1). Josh's items 9/10 are explicitly about ORDER, not the default, and
changing the pre-selection silently changes behavior for everyone - so I kept the
default and documented it. A one-line change if Josh wants otherwise.
