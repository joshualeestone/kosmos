# #1652: an agent as one portable file (the export half)

**Branch:** `agentfile-1652` · **Card:** kosmos#1652, Josh's ask

> *"we should add a fourth option on the create an agent for 'import my existing agent' then give
> them instructions or let them locate the file, they could also upload or share agents that way"*

## Scope: the format, made real. Not the button.

The card says it itself: **"the file format is the load-bearing decision here, not the button."** It
also names its own weakest premise: *"import without export is half a loop."*

⇒ **This builds export.** It produces a file, changes nothing on the machine, needs no browser, and it
is what turns a proposed format into one you can hold. **The button, the upload widget and
import-apply are not here.**

## What I measured before designing anything

```
SUBJECT   anything that exports or serialises an agent    0 files
CONTROL   files mentioning createAgent                    202
FOUND     an import path that already exists              engine/discover.js
```

⭐ **Kosmos already imports agents - from a FOLDER on this machine** (adoption, #1531). The missing
half is a portable **file**. This card is not "add an importer"; it is **"give the existing import a
portable input."**

**An agent reduces to very little.** `registerOnly()` needs a name, a folder and a displayName; the
folder holds the instructions. Every profile on this machine (27 of them) has fields drawn from:

```
dir  displayName  doctrineVersion  id  idInstall  instructionsWrite  provider  updatedAt
```

## The format, and why it is not a new one

**One Markdown file with `---` frontmatter.** A directory is not shareable - mail clients and chat
apps both eat them - and this exact shape is **already parsed by `engine/skills.js:readMeta`**, whose
own comment records the convention as *"read from a real skill on this machine"*. **It is Claude
Code's format, not ours.**

```
---
kosmos: agent
name: casey
provider: claude
---

# You are Casey Jones
...the instructions, verbatim...
```

**There is a test that round-trips the emitted file through `readMeta`**, so "we added no second
definition" is a measurement rather than a claim. `readMeta` is exported for it; the function is
otherwise unmoved.

📌 **The display name is deliberately NOT in the header.** It is already in the body and
`status.identityFromText` already parses it - the same call adoption uses. Putting it in both places
is two copies of one fact, and they would drift the first time somebody edited the instructions.

## 🛑 What does not travel, and the first reason is not privacy

| field | why |
|---|---|
| `id`, `idInstall` | `writeProfile` mints the id once and never rewrites it, *"an anchor that survives renames"*. **If it travelled, two people importing one file would BE the same agent.** |
| `dir` | a path on somebody else's machine |
| `updatedAt`, `instructionsWrite`, `doctrineVersion` | one install's bookkeeping |
| credentials | ✅ **free, and verified rather than assumed: there is no credential-shaped field in any of the 27 profiles.** They live elsewhere and were never part of what describes an agent. |

`provider` travels **as a hint**: the recipient may not have it connected, and refusing on it would
make a file unopenable for a reason the sender cannot see.

## The import contract is stated beside the writer

`IMPORT_CONTRACT` is exported and asserted, so whoever builds import is not inferring it from
examples. A file is one of ours only if it opens with frontmatter carrying `kosmos: agent`, has a
usable `name:`, and has a body that names somebody. ⚠️ **Anything else must be refused whole** - this
surface takes input from outside the machine, and a half-applied import leaves an agent with somebody
else's instructions.

## Verified by perturbation, five arms, each restored

| perturbation | result |
|---|---|
| let the identity anchor travel | **1 red** (the safety arm) |
| stop carrying the body verbatim | **1 red** |
| drop the self-identifying marker | **1 red** |
| allow a newline in a frontmatter value | **1 red** |
| export an agent with no instructions anyway | **1 red** |
| restored | **9 pass, 0 fail** |

Each perturbation **asserts that it applied** before its result counts - my first attempt at this
technique on another branch silently matched nothing and reported four confident greens.

⭐ The absence arms carry a **control**: the same containment check finds `provider`, which SHOULD be
there. Without it, "the id is absent" is equally consistent with an empty file.

## What I did not build, plainly

**No button, no upload, no import-apply.** Josh listed instructions first and a file path second;
this is the file half. **Import writes to the machine and deserves the format to exist first** - which
it now does, with a stated contract and a parser that already handles it.
