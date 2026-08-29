# winfloor-570: the guard Renet's failure earned

## What happened to him

His parallel Windows builder's engine glob had no filter. It staged **137 `.js`
of which only 59 were real modules**, so **78 test files shipped to users.**

⭐ **And the part worth copying is why his own guard missed it.** He had a floor
of *"at least 50 engine files"*, **and the floor was satisfied by the test
files.**

⇒ **A count that the defect itself inflates cannot detect the defect.**

## The guard

Two assertions that **cannot both be satisfied by one mistake**:

```
_tests   = 0                      no test file ships, at all
_zipmods = repo's module count    EQUALITY, not a floor
```

**Equality is what makes shipping too many as loud as shipping too few.** A floor
is deaf in exactly the direction that bit him.

Verified by planting his defect: dropping the filter makes the build exit **1**
with *"the zip ships 78 test file(s); the engine glob lost its filter"*. **78 is
his number.**

## A refused build no longer leaves the thing it refused

Every content check runs **after** the zip is written, because they inspect the
zip. So a build that correctly refused **still left a 36 MB artifact on disk
carrying the exact defect it refused for.**

⚠️ **The exit code is what a script reads; the FILE is what a person reads, and
they were saying opposite things.** `refuse()` now removes both the zip and its
checksum.

## ⭐ My CRLF test went red on a correct builder

It matched **every** `printf '...\n'` in the script, including
`printf '%s\n' "$LISTING"` in the new guard, **which is shell plumbing that
never reaches a user.**

⇒ **The fix was to the TEST, not the product**: the artifact's bytes were
independently verified CRLF, by me and by Renet. The scan now reads only the
`{ ... } > "$STAGE/<name>"` blocks, **which is the population the claim is
about.**

## Perturbed, four arms

```
drop the no-test-files check   -> red
swap equality for a floor      -> red     <- his exact defect class
a refusal keeps the artifact   -> red
an LF line in a SHIPPED file   -> red
```

Suite 2997 pass, 0 fail.
