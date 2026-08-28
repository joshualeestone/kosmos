# rollback-provider-1401: a refused adoption leaves no provider behind

## The problem

`connect()` stamps `provider: 'openai'` on the profile BEFORE the job is written, and the failure
rollback lists only two keys:

```js
store.writeProfile(name, { dir: before.dir || null, displayName: before.displayName || null });
```

`writeProfile` is a MERGE (`{ ...had, ...patch }`, engine/store.js:180), so **a merge cannot clear
a key by omitting it.** Measured before fixing:

```
after the rollback: {"dir":null,"displayName":null,"provider":"openai",...}
```

⇒ `server.js` derives a card's runner from `profile.provider`, so a REFUSED adoption can leave the
board describing an agent that was never adopted, has no job and will never start, as an OpenAI
one. The comment above that rollback says it exists so nothing is left claiming an agent exists,
and it was leaving exactly that.

## The fix

Name the key, because omission cannot clear it, and RESTORE rather than blank:

```js
store.writeProfile(name, {
  dir: before.dir || null,
  displayName: before.displayName || null,
  provider: before.provider || null,
});
```

`null` clears it - measured, not assumed.

## How it is verified

Three arms, because two of them can be satisfied by the wrong fix:

- a refused adoption leaves **no** provider
- CONTROL: a **successful** adoption still records it - otherwise the fix is satisfied by never
  stamping at all, which would undo #1351
- an agent that **already had** a provider keeps it through a failed re-adoption

## What I expect to be wrong about

**The third arm may be unprovable if I cannot construct it.** `before.provider` is undefined in
every existing test, so "restored" and "blanked" are indistinguishable and a perturbation replacing
`before.provider || null` with a flat `null` will SURVIVE. If the pre-existing-provider case turns
out to be unreachable, the honest move is to simplify the code to `provider: null` and delete the
"restored, not blanked" claim from the comment rather than leave an unprovable assertion in it.

## Scope

`engine/discover.js` and `engine/discover.adopt.test.js` only.
