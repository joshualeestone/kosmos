# renameoffer-7968: the folder offer has to be seen on the path people take

Card: #7968. Found by a reviewer of What's New: after typing a name and pressing Save, the offer was above the screen for a second, then a timer moved to the project page, which does not show it. My browser check renamed by API, so it never saw this.

## Change
A Save that changed the name, when the offer now applies, stays on settings, brings the offer into view and puts focus on its button. Every other Save returns to the project as before (#3134). The check now goes through Save, with a description-only Save as the control.

## Decisions
- **Call: stay and show it, rather than move the offer up the page or into the project page.** The offer only matters at this moment. Rejected: a permanent place near the name field, which would push the form down for a rare act; and a line on the project page, which adds a second place to offer one thing.
- **Call: focus goes to the sentence, not the button,** so a second press of Save's key cannot rename a folder. It starts with "Saved.", since the line beside Save is out of view. A later repaint drops that word, which is fine by then.
- **Weakest premise:** that a person understands the page stayed on purpose. The sentence is meant to say enough.
- **What would change my mind:** a person pressing nothing and not knowing they can leave. The back control is the page's usual one.
