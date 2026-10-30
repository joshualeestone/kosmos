# kosmos#7429: the Assigner and a review-only role

Card: https://github.com/joshualeestone/kosmos/issues/7429 (Ice Cream Kitty, night shift 2026-10-27).

## Problem
An outside user saw the automatic Assigner hand build tasks to an agent whose role on the project was review. engine/assigner.js never read the per-project role (`kosmos project role`, project.rolesHere).

## Call
- `projects.reviewOnlyHere(p, session)`: the WHOLE role is one review-only form ("reviewer", "code reviewer", "QA", "reviews", optionally followed by "only", or "only reviews"). Anything more is not review only: a wrong yes silently takes a builder out of hand-outs, a wrong no is today's behaviour.
- Such a member gets no hand-out (pick), no failover move, its own stalled part is not moved, it is not asked to draft goal tasks, and a part it holds does not lock its task tree (busyHold).
- The role route answers `reviewOnly: true`; both CLIs say what that does. The agents' project instructions name the forms.

## Rejected
Explaining the pick only in the hand-out (the person must undo it each time); a structured flag (a screen and migration for what the text says); routing review tasks to reviewers (tasks carry no kind).

## Weakest premise
Agents must write one of the exact forms; "reviews PRs" still gets work (the safe side).

## Done when
Assigner, projects, role and tasks tests green; full suite green apart from known load flakes; PR CI green.
