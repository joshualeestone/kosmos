# found-gate-1493: the disk was only read for somebody we thought had no agents

## The loss was downstream, and `found()` was innocent

Splinter's discriminator settled that: the real `found()` against a five-arm
fixture returns the agent with `already = false`. So the agent was found and the
screen never asked.

## Where it went

`frPaintFleet` called `frFindAgents()` from **inside the `create` arm**, and
`engine/firstrun.js:165`:

```js
const path_ = !here.known ? 'unknown' : (here.count > 0 ? 'adopt' : 'create');
```

```
create    Kosmos believes you have none      -> disk WAS read
adopt     at least one agent running         -> disk NEVER read
unknown   the roster could not be read       -> disk NEVER read
```

**Two whole populations never had their disk read at all.**

⭐ **And the `unknown` case is perverse.** It means *"we could not ask tmux"*, and
the disk is precisely the source that does not need tmux. **The one state where
reading the disk is most valuable was the state that skipped it.**

⚠️ **And the `adopt` screen says "There is nothing to import and nothing to wait
for" while it is false.** Somebody with one running agent and two on disk is told
their fleet is complete.

## The change

**Start the search once, at the top, for every path.** Then each arm asks
`frFoundOffer()` before painting its own answer.

**`frFoundOffer()` is one function** rather than an inline filter in two places,
because the gate that decides whether to show the screen and the painter that
draws the rows must read the same list. Otherwise the heading counts one set and
the rows come from another.

**It filters `already !== true`**, so an agent Kosmos already holds is not offered
again with a button that would do nothing. On the `adopt` path most rows are that.

⚠️ **`!== true`, not `!already`.** `found()` leaves the flag undefined when the
roster could not be read, and that is exactly the `unknown` path. Treating
undefined as "already in" would hide every agent in the case this card is about.

## Every honest answer is unchanged

```
adopt,   nothing on disk    -> "You already have 2 agents here."   unchanged
adopt,   all already held   -> "You already have 2 agents here."   unchanged
unknown, nothing on disk    -> "We could not see what is on..."    unchanged
create,  search failed      -> "Create your first agent."          unchanged
```

## Perturbed, five arms

```
search only on create           -> the every-path test, red
adopt ignores the disk          -> the adopt test, red
unknown ignores the disk        -> the unknown test, red
already-held agents offered     -> the already test, red
unknown's flag read as a yes    -> the unknown-is-unknown test, red
```

## One thing found by running the suite rather than by reading

Adding a page-scope helper broke `web.found-undo.test.js` and `server.test.js`
with `ReferenceError: frFoundOffer is not defined`, **which reads as a product
defect and is not one.** `test-support/page.js` already carries the fix and says
why: `FOUND_PAINTER_FNS` exists because this happened three times in one day when
each harness kept its own list. **One entry in that list, both harnesses fixed.**

Suite 2965 pass, 0 fail.

## NOT done

**Nobody has opened this in a browser.** These run the real lifted functions
against a stub DOM, which is stronger than a source match and is not a browser.
