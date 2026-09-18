# What still has to be verified

What is known about the Picnic calls is in [docs/picnic-api.md](docs/picnic-api.md);
the widget follows the Homey SDK documentation and passes
`homey app validate --level publish`. This is what is left open: each item
needs a real account, a real delivery or a real dashboard to settle.

## Picnic

- [ ] **What a returned container is worth.** `returned_containers` entries are
  read with `price` per unit, so the deposit shown back is the sum of
  `price * quantity`. No response seen so far had a non-empty list; if `price`
  turns out to be the line total, the widget overstates the refund. Check it
  under `make run` against a delivery whose deposit has been counted.
- [ ] **When the deposit is counted.** It only shows once Picnic has counted
  what went back, and the widget drops a delivery four hours after it arrived.
  If counting usually takes longer, nobody sees it there, and it belongs in a
  notification or a flow trigger instead.
- [ ] **The van on the road.** "Onderweg" and the bar now come from
  `GET /deliveries/{id}/position` saying `scenario_in_progress`, as the public
  clients model it; nothing of it has been seen from this account yet. Check
  under `make run` on a delivery morning: that the answer is empty until the
  van leaves, that it then carries the live window, and roughly how long
  before the window that is (the guess it replaces was two to three hours).
- [ ] **A slot that is full.** The widget counts `delivery_slots[].is_available` per day for "3 van 12 vrij". Every slot on every cart seen so far was available, so it is not known whether Picnic marks a full one `false` or leaves it out, in which case the count only ever says "12 van 12". Watch a busy day under `make run`.
- [ ] **Politeness.** While a dashboard shows the widget, the cart and, with no
  order being followed, the order summary are each fetched at most once every
  five minutes, and a made delivery at most once every ten. Confirm Picnic does
  not rate limit any of them.
- [ ] **A delivery noticed long after its window.** The widget no longer shows
  it as delivered, but the "groceries delivered" trigger still fires when the
  app catches up, stamped with the moment it noticed. Decide whether a trigger
  that late should fire at all.

## Homey

- [ ] **Realtime events.** The app announces a new state with
  `homey.api.realtime` and the widget listens with `Homey.on`; the docs never
  say outright that the one reaches the other. If it does not, the widget still
  asks again every 30 seconds.
- [ ] **Preview images.** Drawn to the guidelines (1024×1024, transparent, no
  text, simple shapes), but worth one look in the widget picker itself, in both
  themes.
