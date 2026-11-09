# agentstates-8288: `kosmos agent list` says when an agent is stuck (kosmos#8288)

## Problem
Some agent states appear only on the app's cards, so an agent on a terminal cannot check them and its QA stops at
"cannot verify from here". The card's example is text stuck unsent in an agent's input box.

## Call
A field on the existing `kosmos agent list`, in both CLIs through engine/clilists.js. An indented line under an agent's
row, only while it is in such a state:
- text unsent in its input box since <local time>
- on one step since <local time>, with messages waiting behind it
- no message seen to reach it since <local time>
- restarted N times in the last half hour

Rejected: a new command (a second place to look for one thing about an agent), and a field in the row (it would change a
line people already read).

## Never the words
The list carries when, not what. Any agent on the computer can read it, and the text in another agent's box may be a
person's private words. The roster row is built field by field, so nothing else on a card can come along.

## Weakest premise
That these are the states wanted. They are what the app states as a sentence about stuck delivery. Sign-in and limit
states already show in the card word on the row. Others the page says in a sentence (a Kosmos helper that has given up,
how long an error has stood) are left out, so the PR addresses the card without closing it.

## Who can read it
An agent token reads this route for every agent on the board, including one on no shared project. The times are a small
widening, taken on purpose so a terminal seat can check what the page shows. No content travels.

## Idle only for unsent text
The page says it only for an idle card, because an agent at work may simply have words typed ahead.
