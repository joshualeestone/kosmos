# richfirstrun-8694: the rich browser-check board completes first run when it boots (kosmos#8694)

Test infrastructure only (tools/browser-checks.sh). The P11 rich board now POSTs /api/first-run/complete after
boot_board_rich, as the P5, P6, P8 and P10 boards already do, and as the comments beside its checks already say
("same first-run-complete board"). Not inside boot_board_rich: P12's click-first-run needs first run open.

Measured on a sandboxed rich board booted the runner's way (scratchpad harness, the same nine checks in order):
- with the change, full order: 9/9; #8691's selection order (list-row and fields skipped): 7/7.
- without the change, the selection order: 7/7, and update-abort plus survival alone: 2/2. Since #8691,
  render-detail-signedout-8662 closes the screen itself and no other check here depends on it.

So this removes no failure that exists today. It makes the board match what its comments promise, so the next check
written against them is not order-dependent the way render-detail-signedout-8662 was (PR #8691 went red on it).
Weakest premise: the benefit is only for checks not yet written.
