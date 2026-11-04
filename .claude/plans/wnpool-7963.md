# wnpool-7963: What's New pool items for 0.7.87 to 0.7.89 (kosmos#7963)

The pool had no item newer than 0.7.84, so five cuts of features reached neither the update window nor `kosmos whats-new`. Adds eight items, with `since` taken from the ancestry of each cut's bump commit: three window items and five notes-only items. Mona Lisa read the window copy. Review removed "Starred agents stay on top": #7684 changed only the iPhone, and iPhone people do not read this list. `web/whats-new.json` is the tool's output; it reaches people from the next cut, because What's New is baked into each build.

A Linux-only note is untagged: `build` refuses `platforms: ["linux"]`, which the window does not know. It names Linux, so nobody is misled.
