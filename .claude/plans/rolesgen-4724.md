# rolesgen-4724

Card: joshualeestone/kosmos#4724. A role the person chooses on the New Agent import link survives the open's late
roles answer: `personChoseRole()` in web/index.html bumps ROLES_GEN, so that answer returns at
`if (gen !== ROLES_GEN) return;` before `paint()` (which runs pickMode and clears PICKED). Browser check: K14 in
docs/browser-checks/render-newagent-paths-4556.js, with a no-choice CONTROL.

## Review round 1

WARNING (blind review): `loadRoles` sets "Loading…" (an aria-live status) before an open's refetch of an incomplete
menu, and only `paint()` cleared it. After a person's choice the superseded answer returned early, so the status
stayed on screen and the roles the refetch brought never reached the menu. The catch path did the same.

Fix: a superseded answer now runs `keepChoice()` in loadRoles: it clears the status, builds or repaints the picker
from the new roles (buildPicker / paintPathOptions, updateRecPill) and never calls pickMode, so the choice stands.
The menu's selected value is put back; if the chosen role is missing from the new menu, the old menu is kept
(nothing said). A failed fetch that is superseded does the same when a menu is held; with none held it returns as
before. NIT: a comment at ROLES_GEN says personChoseRole() supersedes in-flight paints.

Weakest premise: keepChoice also runs when a newer CALL (not a person) superseded the answer. That caller paints
right after on the same shared fetch, so the extra repaint is redundant, not harmful; it was chosen over tracking
who superseded to keep the change small.

Test: K14 gains a role only the late answer carries (ROLES_EXTRA) and asserts the answer was consumed, the status is
empty, the late role is in the menu, and the chosen value is still selected. Check: 146 passed, problems none.
Mutations, each red only on the new assertion (4 of 146): M1 fix reverted (msg "Loading…", late role missing);
M2 no status clear; M3 no menu refresh; M4 selected value not restored (showed director); M5 harness never consumes
the extra (consumed false). Tree restored and cmp-verified after each. Four guard tests: 21 pass.
