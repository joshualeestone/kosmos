---
pre_challenge: true
method: challenge-loop
branch: help-tips-3574
diff_hash: e53e729eb2d6c0536450ddf671c43a2787675a4581ee4dd9a4d22c8152a1fdbf
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T22:34:50Z
iterations: 14
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 14
**Converged:** Yes (iteration 14's one WARNING duplicated a deferred iteration-10 entry; one NIT)
**Total findings:** 4 BLOCKERs, 43 WARNINGs, 6 CONVENTIONs, plus NITs (and validation reds found at 6g)
**Fixed:** 50 | **Deferred:** 3 | **Asked (awaiting user):** 0

Midway change of scope, on the record: Josh chose the step-through tour (the mock's Tour B) at 15:51
("I liked this style much better"), after iterations 1-6 had reviewed Tour A. The tour was rebuilt at
bbf4b3fe and iterations 7-14 reviewed B. origin/main was merged in twice (a672c736, 21d6fff0; merges, not
rebases, because 20+ commits each conflicted on the README row and the runner list); the second merge
brought no authored change, so no extra review round. The final 6j run passed on 21d6fff0 (clean tree,
after the #3634 syspolicyd fix lifted the full-suite hold).

### Per-Iteration Breakdown

#### Iteration 1 — opus
1 BLOCKER, 8 WARNINGs, 5 NITs. Self-generated: 0.
- [BLOCKER] ring tip pointed at a class nothing has --> FIXED 2cb7dfff (reads .agauge; T3)
- [WARNING] modal guard matched nothing (.rm-back/.fr-back) --> FIXED
- [WARNING] ? and user menu both open --> FIXED
- [WARNING] focus returned to a hidden item; resize rebuilt the card --> FIXED
- [WARNING] Settings switch painted On before reading --> FIXED (ships hidden)
- [WARNING] check's reset was a no-op (the API never un-sees) --> FIXED (store written directly; T6 real control)
- [WARNING] tour pins vs card text under consolidated --> FIXED (numbering from what is on screen)
- [WARNING] coverage gaps (ring, New agent, inside a project, narrow, dark) --> FIXED (T3-T12)
- [WARNING] Stop showing tips raced two PUTs --> FIXED (one write)

#### Iteration 2 — sonnet
1 WARNING, 2 CONVENTIONs. Self: 1.
- ring tip on cards with no ring --> FIXED a2296c96; TIP_IDS/TIPS parity test --> FIXED (control reds); surface annotation completed --> FIXED

#### Iteration 3 — opus
7 WARNINGs. Self: 3.
- tip over a dialog --> FIXED (steps aside; T13); ring arrow at a ringless card --> FIXED; card did not follow scroll --> FIXED (T14); ? stopPropagation broke other popovers --> FIXED; focus dropped on auto-tip close --> FIXED (T15); New agent tip covered the form --> FIXED (beside the heading); plan said fresh-install-only --> FIXED (plan states upgrades see it once)

#### Iteration 4 — sonnet
2 WARNINGs. Self: 0.
- update takeover (.upd-back) not in the dialog guard --> FIXED; 3s boot fallback never started tips --> FIXED

#### Iteration 5 — opus
3 WARNINGs. Self: 1.
- a dialog's Escape also closed the hidden tip --> FIXED (capture phase; T17 with control); auto tip outlived its screen --> FIXED (T16); no route tests --> FIXED (server.test.js)
- 6g reds (mine): bare-handler guard matched my `close`; the modal sweep counted aria-modal=false; the consolidated body grid counts static children --> FIXED (closeHelpMenu; aria-modal dropped; tip layer built at runtime)

#### Iteration 6 — sonnet
1 WARNING fixed (tip layer above dialog backdrops -> below every backdrop; T13 checks at once), 1 WARNING DEFERRED (re-add aria-modal=false: it is what broke the modal sweep; non-modal is the ARIA default; explained at the code), 1 CONVENTION fixed (plan listed no Settings tip).

#### Iteration 7 — opus (first on Tour B)
2 BLOCKERs, 4 WARNINGs, 1 CONVENTION. Self: 3.
- [BLOCKER] tour A's full-screen dim came back a tick later, dimmed the ringed place and took its click --> FIXED a0c0bdd5 (dim removed; the ring's shadow is the dim)
- [BLOCKER] T1 read the dim too early to see it --> FIXED (checks past a tick with elementFromPoint)
- tour never auto-showed in the consolidated layout --> FIXED (T12 reloads into it); auto tour unreachable by keyboard --> FIXED (takes focus); Stop showing tips let a tip slip in --> FIXED; Escape with focus on the ? did not close its menu --> FIXED; plan piece 3 described A --> FIXED

#### Iteration 8 — sonnet
1 BLOCKER, 1 WARNING. Self: 1.
- [BLOCKER] a click meant for a dialog over the tour ended the tour --> FIXED 8e1a5ca3 (T18)
- Skip, the x and click-outside unexercised --> FIXED (T18)

#### Iteration 9 — opus
5 WARNINGs. Self: 3.
- "this screen" answered with the ring on consolidated screens --> FIXED (T19); tour over Settings in consolidated --> FIXED; empty-places tour a dead control, focus stolen from a field --> FIXED; project/projects tips hidden targets in consolidated --> FIXED (rail fallback; project tip tab-layout only); Escape meant for a picker closed a tip --> FIXED (T20)

#### Iteration 10 — sonnet
1 WARNING fixed (surface line missing tip-eb, tip-x), 1 WARNING DEFERRED (store read-modify-write race: set() is synchronous read->rename and Node never interleaves one request's sync code; same pattern as engine/styles.js).

#### Iteration 11 — opus
1 BLOCKER, 3 WARNINGs. Self: 2.
- [BLOCKER] surface gate: three existing checks declare tokens the branch names --> FIXED e512c39a (all three run green on the branch; per-check trailers)
- burger/Kosmos switcher Escape --> FIXED; failed Stop showing tips save not rolled back --> FIXED; Settings tip did not say where the switch is --> FIXED

#### Iteration 12 — sonnet
1 WARNING fixed (the live-region announcement untested; T3 asserts it).

#### Iteration 13 — opus
2 WARNINGs. Self: 1.
- a header menu drew under a tip (the header is its own stacking layer) --> FIXED c409837f (T21); tour replaced from the ? came back --> FIXED (T22)

#### Iteration 14 — sonnet
1 WARNING (store race) = duplicate of the iteration-10 DEFERRED entry; 1 NIT.
**Converged** — no new actionable findings.

### Deferred (with reasons)
- Store race (iterations 10, 14): synchronous set(); no interleaving in Node.
- aria-modal on #tipcard (iteration 6): the modal sweep counts it; non-modal is the default.
- Plan filename timestamp (NIT): many plans in the tree omit it.

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, selection)
- ? menu announces aria-haspopup without menuitem roles (matches the user menu)
- a failed Settings-switch save shows no message
- a failed "seen" save is not rolled back in-session (commented; the tip may show once more)
- redundant [hidden] rules on the tip layer

### Strengths (across iterations)
- The store fails closed (unreadable -> ok:false, no tips, switch hidden, writes refused), ids are an allowlist pinned equal to the page's table, seen only grows, writes are atomic
- Every "shows once" / "shows nothing" arm has a control from the same state; the check covers both layouts, both themes, narrow width, focus, dialogs, pickers, header menus, scroll, and the single-write off switch
