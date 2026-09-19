# Picnic API, as this app uses it

Picnic has no public API. This is what the app calls and what was established
about the answers, from a real Dutch account, the maintained clients
([python-picnic-api2](https://github.com/codesalatdev/python-picnic-api),
[picnic-api](https://github.com/MRVDH/picnic-api)) and Home Assistant's Picnic
integration. Anything not confirmed is marked so.

## Basics

- **Base URL** `https://storefront-prod.{nl|de}.picnicinternational.com/api/15`
- **Amounts** are integer cents. **Moments** are ISO 8601 strings with an
  offset, e.g. `2026-07-15T14:15:00.000+02:00`.
- **Headers** on every call, from `lib/picnicheaders.js`:

  | Header | Value |
  | --- | --- |
  | `x-picnic-auth` | the session token, from the login response header |
  | `x-picnic-agent` | `30100;1.236.1-15553;` — Picnic's Android app id and a version of it |
  | `x-picnic-did` | `open.app.picnic.homey` |

  **The version in `x-picnic-agent` changes the answers.** Picnic works the
  cart out for the app version a client claims. As `1.15.233` the cart lacked
  BundelBonus deals and folded the Family discount into the line prices, and
  `total_price` came out 0,28 above what the Picnic app showed for the same
  cart. As `1.236.1` all three amounts matched the Picnic app to the cent. When
  totals drift again, move this forward first.

## Signing in

| Call | Body | Answer |
| --- | --- | --- |
| `POST /user/login` | `{ key, secret: md5(password), client_id: 30100 }` | 200, token in the `x-picnic-auth` response header, `second_factor_authentication_required` in the body |
| `POST /user/2fa/generate` | `{ channel: "SMS" }` | 2xx; Picnic sends a code |
| `POST /user/2fa/verify` | `{ otp: "123456" }` | 2xx, a new token in `x-picnic-auth`; a wrong code is `OTP_NOT_VALID` |

A token whose second factor has not been verified is refused on **every** call
with HTTP 403 and `{"error":{"code":"TWO_FACTOR_AUTHENTICATION_REQUIRED"}}`.
Logging in again does not fix that; a verified code does. (Seen on a real
account; none of the public clients handle this code.) A token Picnic no longer
accepts at all is HTTP 401. `lib/refusal.js` tells the two apart.

## Deliveries

**`POST /deliveries/summary`**, body `["CURRENT"]` (or `["COMPLETED"]`, or `[]`
for all). A list of deliveries, newest first:

| Field | Meaning |
| --- | --- |
| `delivery_id` | what to ask `GET /deliveries/{id}` about |
| `status` | `CURRENT`, `COMPLETED`, `CANCELLED` |
| `slot.window_start`, `slot.window_end` | the slot that was booked |
| `slot.cut_off_time` | until when the order can still be changed; matches Picnic's FAQ rule of 13:00 the day before a morning slot and 23:00 the day before a later one, which `lib/cutoff.js` falls back on |
| `eta2.start`, `eta2.end` | the delivery moment, once Picnic announces it (~20 minutes wide) |
| `delivery_time.start`, `.end` | when the driver arrived and left |
| `orders[].total_price` | per order; a delivery can carry several, and Home Assistant sums them the same way. Whether it includes deposit is not documented |

A delivered order usually **drops out** of `["CURRENT"]` rather than turning up
with a `delivery_time`, which is why the app reads an empty list as "delivered"
— but only when it was following an order: for anyone else it just means
nothing is running.

**`GET /deliveries/{id}`**: the same delivery in full, including:

| Field | Meaning |
| --- | --- |
| `orders[].checkout_total_price` | what was paid for each order. Adding to a placed order adds an order to the delivery, so the delivery's total is the sum |
| `orders[].items[].items[].decorators[]` | each article's `{ type: "QUANTITY", quantity }`: summed, the number of products in the order. Picnic states no total for a placed order the way `total_count` does for the cart |
| `orders[].total_deposit`, `orders[].deposit_breakdown[]` | deposit paid, `{ type: BAG\|DEFAULT, value, count }` |
| `returned_containers[]` | `{ type, localized_name, quantity, price }`, filled in once the hub has counted what went back. **Unconfirmed**: whether `price` is per unit (as the app assumes) or per line |

## Payments

What was taken from the account for a delivery is not in the delivery: it is
the order less what Picnic refunded for products that did not come and less
the deposit that went back, and only the wallet has it. Neither call has been
seen live yet; the shape is the one the TypeScript (`MRVDH/picnic-api`) and C#
(`Jerome1998/Picnic.Api`) clients model.

**`POST /wallet/transactions`**, body `{ "page_number": 1 }`: payments, newest
first, as `{ id, amount_in_cents, status, timestamp, transaction_type, … }`.
None of them says which delivery it was for.

**`GET /wallet/transactions/{id}`**: one payment in full.

| Field | Meaning |
| --- | --- |
| `delivery_id` | the delivery it was for |
| `amount_in_cents` | what was taken. **Unconfirmed** whether it is written as positive or negative, so the app takes its size |
| `transaction_status` | not known which values it takes |
| `refunded_items[]`, `article_issue_refunds[]` | what was refunded; shape unknown |
| `returned_containers[]`, `deposits[]` | as on the delivery |

The app looks through the newest three payments for the one with the delivery's
id, while the widget shows that delivery, and asks about that one payment from
then on.

## Where the van is

**`GET /deliveries/{id}/position`**: the van on its route. Not seen live yet;
the shape is the one the typed Go client and Home Assistant model, and Home
Assistant notes it is "only available shortly before the actual delivery" and
answers with an **empty body** until then, which `lib/positionresponse.js`
reads as "nothing to say yet" rather than as a failure.

| Field | Meaning |
| --- | --- |
| `scenario_in_progress` | `true` while the route is being driven: the van is on its way. This, not `eta2`, is what makes a delivery "onderweg"; `eta2` is the twenty minute window Picnic announces the day before (seen at 14:00 for a slot the next morning) |
| `eta_window.start`, `.end` | the live window, about twenty minutes wide, refined as the van drives; beats `eta2` while the van is on the road |
| `eta` | the moment of arrival, in milliseconds since the epoch |
| `scenario_ts` | the moment along the route the van is at, in milliseconds; a key into `/scenario` |
| `query_interval` | how often Picnic's app asks again, in milliseconds (10000 in the example seen) |

**`GET /deliveries/{id}/scenario`**: the planned route as `{ ts, lat, lng }`
points, plus the driver's name and photo and the destination address. Not
used: it is personal data with nothing on it a dashboard needs.

The app asks for the position from three hours before the announced window,
at most once a minute, and only while a dashboard shows the widget.

## Cart

**`GET /cart`**

| Field | Meaning |
| --- | --- |
| `total_price`, `checkout_total_price` | the cart after all discounts; equal on every cart seen |
| `total_savings` | promotion discounts |
| `membership_savings` | the Family discount, shown apart by the Picnic app |
| `total_count` | number of products (a line of 4 counts 4) |
| `items[]` | order lines: `price`, `display_price`, `decorators[]`, and the articles in `items[]` |
| `items[].decorators[]` | `{ type: "PROMO", text: "1+1 gratis" \| "Family" \| "BundelBonus" \| "25% korting" }` and `{ type: "PRICE", display_price }`, the line price after it |
| `selected_slot` | `{ slot_id, state }`: `EXPLICIT` once someone picked a slot, `IMPLICIT` for Picnic's own suggestion, which is not held for anyone (both seen on real carts; one client also mentions `ACTIVE`, not seen) |
| `delivery_slots[]` | `{ slot_id, window_start, window_end, cut_off_time, minimum_order_value, is_available, selected, reserved }`; look the selected slot up here by `slot_id` |
| `delivery_slots[].minimum_order_value` | the minimum for that slot, absent on past ones. Confirmed: 4500 on the slot the Picnic app said was "available from €45" |
| `delivery_slots[].is_available` | whether the slot can still be booked. The app counts these per day (the date in `window_start`, which carries the slot's own offset) for "3 of 12 free" and takes the first day with one open. Two weeks of 12–15 slots a day, one- and two-hour windows overlapping, on every cart seen; **unconfirmed** what a full slot looks like, since none has been seen yet: `false` here, or dropped from the list |

On a real cart (agent `1.236.1`): lines 43,60 − `total_savings` 9,27 −
`membership_savings` 1,47 = `total_price` 32,86, which is what the Picnic app
showed.

Other cart calls the app makes: `POST /cart/add_product` with
`{ count, product_id }` answers with the whole cart, or the same cart and
`UNPROCESSABLE_ENTITY` when it is locked. Product search is
`GET /pages/search-page-results?search_term=…`.

## Seeing what Picnic answers

Under `make run` (and only then: Homey sets `process.env.DEBUG` to `'1'` for
`homey app run`), the app logs every cart, summary and delivery answer with
personal details blanked out, via `lib/debuglog.js`. Open the widget or let the
poll run, then read the `Picnic answered …` lines in the `make run` output.
