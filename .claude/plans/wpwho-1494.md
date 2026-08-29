# wpwho-1494: the boot line now says WHICH process, because "something ran" is not the claim

## I weakened my own instrument twenty minutes after shipping it

I shipped #1519 saying a boot line proved **the board** had run. **It does not.**
Any process that reaches `snapshot()` against the real store announces,
**including a one-off `node -e` diagnostic.**

**Measured on the live machine: six boot lines in five minutes, and most were my
own throwaway checks while investigating this card.**

⇒ **A boot line proved SOMETHING ran, which is not the question anybody asks.**

## Recorded, not filtered

The obvious fix is to log only when some board flag is set. **That restores the
ambiguity for everything that is not the board**, which is the exact defect the
boot line exists to remove.

⇒ **Name the process instead.** Every signal kept, and the one the reader was
missing added.

```
script: "server.js"                 the board
script: "asboard.js"                some other script
script: "(no script, e.g. node -e)" a one-liner
pid:    71849
```

## ⚠️ The basename, never the arguments

**A full command line can carry a path, a token or a key**, and this file is
written to disk and read by people. **`server.js` is the whole of what a reader
needs.** A test asserts the field contains no path separator, and a second
asserts the module never reaches for more of `argv`.

## Perturbed

```
drop the script field   -> red
log the FULL path       -> red   (the basename test)
drop the pid            -> red
```

Suite 3014 pass, 0 fail.
