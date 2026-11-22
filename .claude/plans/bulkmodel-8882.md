# kosmos#8882: Settings bulk move warns when a target's model limit is full

## Finished looks like
1. In Settings, Accounts, each bulk-move target where a moved agent's own model limit is at 70% or more (the mover's target rule, engine TARGET_MAX_PCT) is marked "(N% used, a model limit is in the way)", or "may be in the way" when only agents of unknown model are at stake.
2. Once picked, a line below the menu names the target, who would stop and why: "On <account>, the Fable limit is full for the week, so Lyra would stop there." (99.5%+, engine MODEL_FULL_PCT) or "... is at 72% for the week, so Lyra may stop there soon." Agents whose model Kosmos cannot tell are named too ("... may stop there", "too" only after another sentence). One reading per model family, the highest.
3. The person can still move them (their call: the limit may reset in an hour).
4. The click re-reads the target and refuses ("Nothing moved: <warning> Pick again.") only when something NEW came in the way since the menu was drawn: a family not drawn, a step from near to full, or an agent named now that was not. A percentage moving within its level, or an agent that left, does not refuse.
5. Same model match as the mover (acctModelKey mirrors engine/autobalance.js modelKey); the page's two levels are tested equal to the engine's.

## Calls
- Warn, not hide (the card's weakest premise: a full model limit may reset within the hour, so the person decides).
- Text only through esc() and textContent; the warning lives in a data attribute on each option and in an aria-live line kept in the page while empty; the menu and Move are described by the restart note and the warning.
- Refusal compares risks by family and level with the same cards on both sides (review 2), never the sentences, which carry a live percentage.

## Evidence
- render-account-usage-6108 browser check at e8dc1e71cd: 576 of 576 PASS, chromium and webkit, 1100 and 390, light and dark (local, headless). Cases: the sentence per level and edge (69.9, 70, 99.4, 99.5), highest reading per family, unknown-only wording, the target named, the engine's levels, what counts as new; on the page: the warning fills on a Fable-full pick and clears on a roomy pick and the placeholder (Ly<b>ra as text), a near limit gone full under the menu refuses the click and nothing is sent, and 72% to 73% moves (CONTROL).
- Mutations, each red: the change handler writes nothing (6 arms); the de-dup keeps the last reading; the new-risk rule always true; always false.
