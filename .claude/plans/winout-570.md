# winout-570: two Windows-package fixes, one of them found by using it

## 1. An absolute output directory was silently joined to the repo root

`mkdir -p "$REPO/$OUT"` with `$OUT=/tmp/x` produced
`/Users/.../agent-workforce//tmp/x`, **created it, wrote a 36 MB zip into it, and
printed that path as if it were what you asked for.**

⇒ **Nothing failed.** The artifact simply was not where the caller said.

⭐ **And the symptom was as far from the cause as it gets.** My verification
script looked in the requested directory, found nothing, extracted an empty
`node.exe`, and **reported the bundled runtime CORRUPTED.** A wrong location
surfaced as a wrong checksum.

Absolute wins, relative stays repo-relative, so `dist` is unchanged.

## 2. The warning has to be in a FILENAME, because a README cannot reach her

Splinter's point, and it is the `can-they-see-it-at-the-moment-they-act` shape:

**The SmartScreen dialog appears on the double-click, before a single line we
ship has run.** Nothing inside the package can speak at that moment. The one
surface that exists is the **folder listing**.

⇒ `! READ ME FIRST - Windows will warn you.txt`.

⚠️ **The `!` is load-bearing and I had it wrong.** My first version was
`READ ME FIRST...` and **the comment I wrote claimed it sorted above
`Kosmos.cmd`.** It does not: `K` comes before `R`, so the launcher was listed
first and the warning second. **I found it by printing the sorted listing rather
than by re-reading my own sentence.**

### What the file now says, and why each line is there

- **The dialog's only visible button is "Don't run".** The way past is behind
  "More info", which does not look like a button. Somebody who has not been told
  stops there, **and we learn nothing about the installer because it never ran.**
- **Mark of the Web.** A file arriving inside a downloaded zip can be blocked by
  something that is a property of **how it arrived**, not of what it contains.
  Right-click, Properties, Unblock.
- **It is not a fault.** "Signing is a certificate we have not bought, not a
  problem with the software."

## Two free checks, done, that needed no Windows box

```
node.exe survives the zip round trip
  ours after round trip   3602f2bb1a10f2cb...  92,825,416 bytes
  nodejs.org original     3602f2bb1a10f2cb...  92,825,416 bytes   IDENTICAL
  CONTROL (truncated)     differs, so the check can say no

CRLF in the shipped artifact
  Kosmos.cmd      13 of 13
  open-board.cmd   4 of 4
  the warning txt 20 of 20
  CONTROL (an LF file)  0, so the check can tell them apart
```

Renet reached the CRLF result independently on the same artifact, with his own
control.

## Perturbed, five arms

```
revert the outdir join         -> the absolute-outdir test, red
drop the ! so it sorts second  -> the warning-reaches-her test, red
drop the Don't-run warning     -> same, red
drop the Mark-of-the-Web note  -> same, red
drop the Unblock instruction   -> same, red
```

Suite 2995 pass, 0 fail.
