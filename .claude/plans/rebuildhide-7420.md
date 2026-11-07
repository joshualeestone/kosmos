# rebuildhide-7420 (kosmos#7420): a rebuild does not show old messages

**Finished looks like:** when the chat's repair rebuilds a list, the person does not see the oldest rows, unless the end has not shown by 0.35 s after the last ask to go there, when the rows show as today. By video frames with a forced rebuild: control shows them, this does not, and the newest is showing afterwards every time. Clean opens are untouched because nothing here runs without a rebuild.

**Evidence:** video on the simulator, 11-07: after a rebuild the list shows "Friday 23 October, Message 42 of 260" for about two frames at 30 a second, then the newest. Josh's phone count on build 54: 2 rebuilds in 6 opens, so he may see this.

**Measured (8 videos, forced rebuild, alternating, 60 frames a second, first version of this change):** frames of the wrong rows 3 to 5 in the 3 readable recordings of today's code, 0 in the 3 readable with the hide; empty 3 to 4 frames with the hide. One recording each way started the count too late to read.

**Change:** while a rebuild is getting to its newest, the list has opacity 0 and takes no touches, until the end marker appears or 0.35 s after the last ask. Debug control: KOSMOS_SAMPLE_NOREBUILDHIDE.

**Rejected:** creating the new list already anchored at the end: its own comment records that a long list on iOS 27 then opened on estimated rows and stayed empty. Looking for a blank sooner (card): more rebuilds, and each carried this flash.

**Weakest premise:** that the end marker appears promptly on a real phone. If it does not, the empty stretch lasts up to about 0.75 s where today it would show old rows, and then they show anyway. A blank a little longer is judged better than a flash of the wrong messages. A phone is where that gets judged.

**Not covered:** this does not stop a blank happening or shorten the empty stretch before the rebuild. Rooms: `roomBlankLook` in RoomView.swift rebuilds the same way and should flash old posts too; unmeasured and untouched here. Nothing that shows while the list is hidden is touched: the top bar and composer stay.

**What would change my mind:** seeing a longer blank on a phone, or VoiceOver losing its place during the hide.
