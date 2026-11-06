# typedkeep-8092: Use short names keeps a name the person typed (#8092 follow-up)

The follow-up named on #8092 after its final review: Use short names replaced names the person had typed as well
as Kosmos's suggestions, and a replaced name came back only by retyping it.

Call (Mona Lisa): a name the person typed is theirs, so Use short names skips that row and says so ("Kept the name
you typed."). Typed means the box holds a name that is not empty and not Kosmos's suggestion (an emptied box, or the
suggestion typed back, spaces aside, is a suggestion; case counts). Another on a row, when it finds a free short name, makes
it a suggestion again, so a later Use short names may change it; with none free a typed name stays theirs.
Rejected: an undo (more UI for a rare slip; skipping typed rows removes the slip).
Weakest premise: that typing into a row means the person wants that name. A person who typed and then wants a short
one presses Another on that row.

Finished when: merged, checked in render-teamcreate-4557.js (typed name kept, the line says so; after Another the row
changes again), and seen in a served build.
