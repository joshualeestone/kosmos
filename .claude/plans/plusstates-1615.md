# plusstates-1615: redo the coordinator flow to match the design

Josh, 2026-08-30 12:54: the coordinator toggle was sketched to prove the connection was
possible and is now being treated as the product. Everything live is redone to match the
designed flow.

## The governing rule, which inverts the usual one

> "i dont care if the app side is ready yet for it to be fully working, i want to see all
> the design implemented and then we make the product work based on the design"

Ship the designed UI even where the backing function does not exist. A page that looks
finished and does nothing is the requested state.

⚠️ **The one thing it does NOT permit is a page that MISLEADS.** An inert control is fine;
a link that says it opens something and lands on a 404 is not. That distinction is what a
blind review caught me breaking.

## Scope, taken from the design rather than guessed

`chaoskosmos-site/design/plus-flow.html` section 5 specifies Settings > Plus Account as
three states. Section 6 lists what exists; re-measured on today's main with a control, and
it was still accurate: state 3 built, states 1 and 2 not, the link absent.

⇒ Build states 1 and 2. Leave state 3 alone.

## Four places the design and the code disagreed

Each recorded in the markup rather than silently decided.

- **price**: the mock shows a figure; a shipped guard forbids one here, the markup records a
  price sentence going false that way once, and the number is Josh's alone. NO PRICE.
- **"this Mac"**: the mock says it; `engine/machine.test.js` forbids it in every speaking
  file because Kosmos is not Mac-only, and the page says "this computer" 112 times. CODE WINS.
- **no-controls guard**: it encoded the exact rule Josh inverted. SCOPED to state 1, where it
  still holds, rather than deleted.
- **`/+?from=app`**: the designed link target 404s. Left on `/plus`, dependency carded.
