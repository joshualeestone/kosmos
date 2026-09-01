# frozenroots-1443: the data root was frozen at require time

> 📌 Renamed from `lazyroot-1443.md` when the branch was renamed to
> `frozenroots-1443`. The plan did not follow the branch, so
> `find .claude/plans -name '*<branch>*'` found nothing and the branch read as
> having no plan at all. The stale `lazyroot-1443-pre-challenge.md` beside it is
> a proof for the OLD branch name: its hash cannot match this branch and the
> gate ignores it. A fresh proof is written as `frozenroots-1443-pre-challenge.md`.


## The defect, and it makes a sandbox seam a lie

`store.ROOT` was a module-level constant, so with `AGENT_WORKFORCE_DATA` set
**after** `store` had been required, it still answered
`~/Library/Application Support/AgentWorkforce`.

⇒ **A fixture that sandboxes late writes to the operator's real machine while
believing it is isolated.**

⭐ **And the ordering was never something a test author could control.**
`ping.js` requires `store` at its own top for `ROOT`, so a fixture that requires
anything which transitively reaches `ping` has already frozen the root before its
own first line runs. "Set it at the top of your file" was never a rule anyone
could follow reliably.

## The change

`root()`, `avatarsDir()`, `profilesDir()`, resolved per call. `ROOT`, `AVATARS`
and `PROFILES` stay exported as **enumerable getters**, so 94 references across
39 files keep working unchanged and `{...store}` still carries them.

⚠️ **The derived two are the half that is easy to miss.** Making `ROOT` lazy and
leaving `AVATARS = path.join(ROOT, ...)` at module level re-freezes it one line
down, **and the fix would look done.**

## The allowlist is now empty, and that is what enforces it

`tools/check-frozen-roots.js` carried `engine/store.js:ROOT` as its one named
debt. **Removed, not annotated as fixed**: an allowlist carrying resolved entries
stops being a debt list and becomes decoration, and its own design says it should
shrink to nothing.

⚠️ **Removing it is what makes the fix enforced.** While the entry stood,
re-freezing that root would have been **skipped by name**.

Verified with a control: with the list empty the checker exits **0** on the tree,
and **1** on a planted `const FROZEN2 = os.homedir()`, naming it.

## Perturbed, four arms

```
freeze ROOT again           -> the late-sandbox test, red
re-freeze only the DERIVED  -> the derived-paths test, red
memoise on first read       -> the changes-back control, red
make the getters hidden     -> the 39-files test, red
```

⭐ **The memoise arm is the one worth having.** A one-shot cache passes every
"does a late sandbox work" assertion and still freezes on first read: **the same
defect with a slower fuse.**

## ⭐ Seven tests went red and the fix looked complete

`ReferenceError: AVATARS is not defined`. I had replaced the internal uses I
found by grep and **not proved I had found them all**: two more sat at lines 119
and 201.

⇒ The closing check is a script that strips comments and asserts **exactly one**
bare-constant line remains, which is the `defineProperty` loop itself.

Suite 2993 pass, 0 fail.
