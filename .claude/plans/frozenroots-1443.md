# frozenroots-1443: the data root was frozen at require time

> 📌 Renamed from `lazyroot-1443.md` when the branch was renamed to
> `frozenroots-1443`. The plan did not follow the branch, so
> `find .claude/plans -name '*<branch>*'` found nothing and the branch read as
> having no plan at all. `lazyroot-1443-pre-challenge.md` sits beside it and is
> KEPT. I removed it for one round on the grounds that it is a proof for the old
> branch name whose hash cannot match this branch, and that was wrong on the
> convention: `main` retains 291 such files, including ones for branches that no
> longer exist, so they are a record rather than a live gate. The mitigation I
> offered (the `lazyroot-1443` branch keeps its own copy) also leaned on an
> unmerged local branch surviving the repo's own cleanup, which is not a copy
> anybody should rely on.
> A fresh proof WILL BE written as `frozenroots-1443-pre-challenge.md` by the
> challenge-loop gate at PR time. It does not exist yet.


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

## The allowlist carries exactly one entry, and that is what enforces it

> 🛑 CORRECTED. This heading read "the allowlist is now empty" and this branch
> falsifies it: extending the guard to `server.js` surfaces `GATE_LOG`, which is
> DELIBERATE (the install gate's log must outlive the sandbox the gate deletes),
> so it is listed in `KNOWN` and printed on every run. The principle is unchanged
> and is the reason the entry is printed rather than hidden: an allowlist that
> hides its entries is the defect this class is about.

`tools/check-frozen-roots.js` carried `engine/store.js:ROOT` as its one named
debt. **Removed, not annotated as fixed**: an allowlist carrying resolved entries
stops being a debt list and becomes decoration, and its own design says it should
shrink to nothing.

⚠️ **Removing it is what makes the fix enforced.** While the entry stood,
re-freezing that root would have been **skipped by name**.

> 📌 CORRECTED: an earlier line here said "with the list empty the checker exits 0
> on the tree", which contradicts the heading above. The allowlist is NOT empty:
> it carries `server.js:GATE_LOG`. Measured now, both arms: with KNOWN emptied the
> CI invocation goes RED on server.js (exit 1); with the entry it exits 0 and
> prints the entry. So the allowlist hides something that would otherwise fail,
> which is the whole reason it is printed rather than silent.

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

Suite 3462 pass, 0 fail (2993 was the figure when this plan was first written).


## What this branch does beyond the store.js change

`engine/store.js` making `ROOT`/`AVATARS`/`PROFILES` lazy is already on `main`, so
it is not in this diff. This branch is the CONSUMER sweep plus the guard that keeps
it true, and the plan did not describe either until the second challenge-loop
iteration said so.

**The consumer sweep.** 23 engine modules held module-level constants derived from
a root, so they froze at require time even though `store.ROOT` had become lazy. Each
is now a per-call resolver, with every export kept as a getter (`get FILE() { return
file(); }`) so no consumer changed.

**The one that mattered: `engine/tokendoor.js`.** `makeTokenDoor` is called at
require time by `tokendoors.js`, so all 18 doors held a frozen path into
`secrets/env`, where `connect()` writes a token and `forget()` unlinks one. A
late-seam test would have deleted an operator's real API token and passed. BOTH
guards were blind to it, which is the finding worth more than the fix: the static
guard anchored declarations to column 0, and the behavioural probe walked
`Object.keys` on a `Map`, which enumerates as `[]`.

**The guard, and every widening was forced by a measured blind spot:**
- `SOURCES` knew only `store.ROOT`, while this file's own `GETTERS` list named all
  three getters. Widened to AVATARS and PROFILES.
- The arrow-scope rule counted a comma inside the arrow's OWN call as a member
  separator, so `() => path.join(BASE, store.ROOT)` was reported as frozen. Now
  depth-aware.
- The declaration terminator stripped `//` without knowing about strings, so
  `const U = 'https://x/a';` ran on and misattributed the NEXT line's freeze to `U`.
- A BLOCK-BODIED arrow resolver was truncated at its first interior `;`, so it was
  never recognised as a resolver and downstream freezes went silent.
- The destructure-is-the-freeze arm was single-line while the alias scan beside it
  was multi-line, so a wrapped `const {\n ROOT,\n} = store` was silent.
- Capturing one of the ~23 NEW getters this branch creates (`limits.FILE`) refreezes
  a root, and the guard could not see it. Detected now wherever the getter appears in
  the initializer, not only as a bare access: `path.join(limits.FILE,'x')` and
  `limits.FILE + '.tmp'` are freezes too and were silent under the first version.
  The false-positive protection is the PATH-SHAPED name filter plus an exclusion for
  `process.env.X`, which the widening immediately tripped on in
  `tools/check-block-delivery.js`. Re-verified to add zero findings across all 146
  non-test .js in the repo, with a control proving the sweep does produce findings.

**Scope.** The CI invocation was `check-frozen-roots.js engine`, which confined
enforcement to one directory while `server.js` is the largest `store.ROOT` consumer.
Now `engine server.js tools bin native-app deploy web light install`.

**The probe.** `engine.lateseam-1443.test.js` loads each engine module with the seam
set AFTER require and inspects resolved values, catching what source text cannot. It
had only a negative arm (a module exporting `null` passed vacuously) and a load floor
of 30 against a population of 68. It now names any module it cannot load, asserts
none skipped, and requires at least 24 modules to each resolve a path.

**Two instruments, disjoint blind spots.** Neither is coverage alone, and the
tokendoor freeze sat in the overlap. That is stated in the tool rather than left
implied, including the column-0 gap that is NOT closed and why closing it naively
would fire on correct code.
