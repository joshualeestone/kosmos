# #3046 - Agent view: combine Profile + Instructions + Skills into one "Profile Info" tab

**Card:** kosmos#3046 (Josh 6.63 testing, for the 0.6.67 build). Cluster with #3047 (post-#3046 nav
reorder) and #3044 (header order); build order #3046 -> #3047 -> #3044. Evolves #2916.

**Repo:** agent-workforce. **File:** almost entirely `web/index.html` (the agent detail view).

## Josh's spec (verbatim)
Combine the instructions, the agent instructions, and the agent profile into a single tab called
"Profile Info". Take what is in Profile now (picture, name, what they do, reports to) on top, then the
instruction set underneath, then the skills boxes underneath that. All resolves to one tab "Profile Info".

## Current state (measured)
Nav (`#d-nav`, ~line 7962-7975): buttons `talk` / `model` (Model and Memory) / `instr` (Instructions) /
`profile` (Profile) / `term` (Advanced) / `remove`.
Sections in DOM order: talk(7975) model(8141) memory(8238) instr(8328) skills(8441) profile(8462)
term(8585) remove(8658).
Reveal machinery (~24839-24855):
```
DETAIL_SECTION_GROUPS = { model: ['model','memory'], instr: ['instr','skills'] }
DETAIL_SECTION_PILL   = { memory: 'model', skills: 'instr' }
```
`detailGo` reveals every section in the clicked pill's group (querySelectorAll over `#panel-detail .dsec`,
setting `hidden`), so revealed sections render in DOM ORDER; focus lands on `group[0]`.
The `profile` section (8462-8584) already holds picture + name (rename `d-rename`) + what-they-do +
reports-to. The `instr` pill carries a "(needs you)" dot; `skills` already folds under `instr` (#2916).

## Approach
Make `profile` the pill for a 3-section group `['profile','instr','skills']`, fold `instr`+`skills`
under it, remove the standalone `instr` and `profile` buttons in favor of one "Profile Info" button,
and reorder the DOM so the group renders profile -> instr -> skills.

## Checklist

1. **Reveal groups (JS ~24850).**
   - `DETAIL_SECTION_GROUPS`: replace the `instr` entry with `profile: ['profile','instr','skills']`
     (keep `model: ['model','memory']`). Drop the standalone `instr` group.
   - `DETAIL_SECTION_PILL`: `{ memory: 'model', instr: 'profile', skills: 'profile' }` (instr and
     skills both fold under the `profile` pill; memory unchanged).
   - Result: clicking Profile Info reveals profile+instr+skills, focus on `profile` (group[0], the top).

2. **DOM reorder (sections).** Move the whole `d-sec-profile` block (8462-8584) to immediately BEFORE
   `d-sec-instr` (8328), giving consecutive DOM order profile -> instr -> skills. Keep model+memory
   before them and term+remove after. Verify no id/anchor/painter depends on the old absolute order
   (painters write by id, per the file's own note, so a move is safe, but confirm).

3. **Nav buttons (`#d-nav` ~7967-7969).** Remove the separate `instr` button and the `profile` button;
   add ONE `<button data-go="profile" aria-controls="d-sec-profile d-sec-instr d-sec-skills">Profile Info</button>`
   carrying the "(needs you)" dot markup that was on Instructions (instructions-needs-you now lights the
   Profile Info pill). Nav position: leave roughly where Profile/Instructions were for now; #3047
   finalizes the order. Keep `talk`, `model`, `term`, `remove` buttons unchanged.

4. **Dot / needs-you painter (`detailDots`).** The instructions "(needs you)" signal must light the
   Profile Info pill now that `instr` folds under `profile`. Find `detailDots` (watches sections'
   hidden/needs-you) and confirm/repoint it so the profile pill's dot reflects the instr needs-you
   state; remove any dot wiring keyed on the now-gone `instr` pill.

5. **Group-reveal styling (#2916/#3045 CSS ~2234-2280).** The group-reveal CSS assumed TWO sibling
   `.dsec` cards (Model+Memory, Instr+Skills). Now the Profile Info group is THREE. Verify the stacked
   spacing/heading treatment renders cleanly for three cards; adjust if it hard-codes a two-card shape.

6. **Labels / aria.** Section `aria-label`s can stay (Profile/Instructions/Skills as sub-regions).
   Ensure the pill label is exactly "Profile Info". Any `d-nav-*` painter that set the old profile or
   instr button text is updated or removed.

7. **Skills lazy-load (`SKILLS_LOADED_FOR`, #2916 ~24328).** Skills reloads on the first Instructions
   visit today; ensure it still triggers on the first Profile Info visit (the reveal now comes through
   the profile pill, not instr). Repoint the load trigger to the profile-group open.

8. **Tests.** Update any test asserting the `instr` pill / the old `DETAIL_SECTION_GROUPS` shape / the
   separate Profile+Instructions buttons. Add/adjust a test that clicking Profile Info reveals all
   three sections in order and focuses profile.

9. **Web-change gates (do NOT skip; not visible in `node --test`, only full validation).**
   - #1720: a `web/index.html` change needs a `docs/browser-checks` assertion + runner + README
     registration. Add/extend a browser-check for the Profile Info consolidation.
   - #2518: the surface trailer must name the changed `.js` basename (or the web surface) per the guard.
   - emit-count guard: keep the emit count consistent.
   Run the full validation (not just `node --test`) to surface these.

10. **Browser verify (claude-fe).** This is a frontend change; verify in the running app via a
    `claude-fe` session (Playwright): open an agent, click Profile Info, confirm picture+name+what-they-do
    +reports-to on top, then the instruction set, then skills; confirm the old Instructions/Profile pills
    are gone and needs-you lights Profile Info. Capture evidence for the PR.

## Weakest premise
That the group-reveal is purely DOM-order driven (so a DOM move gives the stacked order) and that no
painter depends on the profile section's old DOM position. Both look true from the #2916 machinery and
the file's "painters write by id" note, but confirm at execution (step 2/4).

## Not in scope
#3047 (nav button ORDER - a separate reorder on top of this) and #3044 (header order). Deploy/cut is
0.6.67 (Splinter slots it; Josh scoping).
