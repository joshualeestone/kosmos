# room-attach: the project room's composer can carry a document too (#358)

The first route PR (#389) taught the per-agent thread and the project's
per-agent thread about attachments; the room composer posts to
`/api/project/<id>/room`, which fans out to every member. This teaches that
route and `messages.sendPost` the same: the attachment must be the project's;
the file's path rides as a trailer after the checks; the post record carries
the attachment and the room's rows serve it back, with link previews.
