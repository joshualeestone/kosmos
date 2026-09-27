# tmuxsignin-4195: one module for the hidden-tmux sign-in plumbing (kosmos #4195)

Card: #4195 (claimed:johnnycage, Liu Kang m1605), from review of #3939 slice 3a. engine/musesignin.js
copies agysignin.js's tmux plumbing (convention 5).

## Finished looks like
- engine/tmuxsignin.js holds: homeSocket (per-home socket, test env override), tmuxBin with its cache
  and forgetTmuxBin, live (the gate, per owner), runTmux (the tmux call with its kosmosInternal
  marking, piped stderr, TMUX_CALL_MS), deliveryUnknown, shq.
- **Step 1 (this branch, off main):** agysignin.js uses it; engine/agysignin.test.js byte-identical to
  main and passing; each helper shown to fail a test when broken.
- **Step 2 (after #3939 slice 3a merges, or the Muse lane does it in their PR):** musesignin.js uses
  it; musesignin.test.js unchanged. musesignin.js is not on main yet (muse-ui-3939, in review).
- Not merged until after the 0.7.03 freeze (agy regression re-cut), and not before the Muse lane
  author says on #4195 whether they would rather import it themselves (Liu Kang m1607); if no answer
  by then, merge and point their branch at the module.

## Decisions
- **Designed from both copies**, not agysignin alone: the two differ only in the socket prefix and
  env var, the gate's owner name, and musesignin naming deliveryUnknown where agysignin inlines it.
  So homeSocket and live take those as arguments, and deliveryUnknown is musesignin's name.
- **agysignin keeps its own seams** (let tmux, setForTests, the REAL copy): it delegates to runTmux,
  so its tests swap tmux exactly as before and cannot tell.
- **The tmuxBin cache is shared** between the sign-ins: it caches the same binPaths().tmuxBin, and
  each start forgets it first, as agysignin did.
- **A new test file, engine/tmuxsignin.test.js**: breaking each helper in turn showed five breaks
  agysignin.test.js never noticed (they were as untested inside agysignin.js before this change):
  the kosmosInternal mark, the socket on every call, the signal half of deliveryUnknown, shq, and
  forgetTmuxBin. The new file catches all of them; the two existing test files stay unchanged.

## Mutation table (each helper broken in turn)
| Helper broken | agysignin.test.js fails | tmuxsignin.test.js fails | Result |
|---|---|---|---|
| homeSocket ignores the test's socket | 1 | 1 | RED |
| homeSocket drops the home hash | 2 | 1 | RED |
| live always allows | 1 | 1 | RED |
| live allows without the gate's report | 1 | 1 | RED |
| runTmux loses the kosmosInternal mark | 0 | 1 | RED |
| runTmux ignores the socket | 0 | 2 | RED |
| deliveryUnknown ignores timeouts | 2 | 1 | RED |
| deliveryUnknown ignores signals | 0 | 1 | RED |
| shq does not escape quotes | 0 | 1 | RED |
| forgetTmuxBin forgets nothing | 0 | 1 | RED |

Every break is caught by tmuxsignin.test.js on its own; five were never caught by agysignin.test.js.

## Checked before moving agy code
- The only agysignin.js change on main in the last day is #4065 (#3998). The 0.7.03 agy fix #4196
  touches engine/agyhooks.js and bin/agy-report-bridge.js, not agysignin.js. Asked Splinter/Baron on
  #4195 whether anything else in the fix touches it.

## Weakest part
musesignin.js's copy is read from an in-review branch; if round 12+ changes its plumbing, step 2 has
to fit that version, not the one read today.

## State (for a restarted session)
- Step 1 built and pushed; challenge-loop iteration 1 addressed (shared cache stated plainly, the gate
  test reaches production's fail-closed branch, agysignin's socket comment cut to a pointer, unused
  export dropped, consumer list for the no-copy check). Next: iteration 2, full suite, PR (held for
  0.7.03 and the Muse lane's answer on #4195).
