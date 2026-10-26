// What the dashboard widget has to show, derived from what the poll stored and
// from what Picnic said about the cart and the last delivery. Kept free of
// Homey APIs so it can be reasoned about and unit tested on its own, like the
// rest of the decision logic in this folder.

import type { Cart, CartSlot, NextSlots } from './cartresponse';
import type { Delivery, ReturnedContainer } from './deliveryresponse';
import type { Position } from './positionresponse';

// What the widget can be showing.
export type WidgetState = "empty" | "signed_out" | "stale" | "ordered" | "announced" | "underway"
  | "arriving" | "overdue" | "delivered" | "cart";

// The cart as lib/cartresponse.ts reads it. Whatever is missing from it leaves
// that part of the widget empty, the way a cart Picnic sent without it does.
export type StoredCart = Partial<Omit<Cart, "slot" | "nextSlots">> & {
  slot?: Partial<CartSlot> | null;
  nextSlots?: Partial<NextSlots> | null;
};

// What the app knows, as deriveDeliveryState is handed it. Everything that
// comes out of the settings may be missing, and is read as "not known".
export interface StoredDelivery {
  // the order_status setting
  orderStatus?: string | null;
  // the delivery window
  etaStart?: string | null;
  etaEnd?: string | null;
  // where the van is, as lib/positionresponse.ts reads it
  position?: Partial<Position> | null;
  // when the van was first seen on the road
  underwayAt?: string | null;
  // when the groceries arrived
  deliveredAt?: string | null;
  // the last moment the order can still be changed
  cutOffAt?: string | null;
  // whether the app can reach Picnic at all
  signInNeeded?: boolean;
  // the last moment Picnic answered a poll
  checkedAt?: string | null;
  cart?: StoredCart | null;
  // the delivered order as lib/deliveryresponse.ts reads it
  delivery?: Partial<Delivery> | null;
  // the moment to derive the state for
  now?: string;
}

export interface CartInView {
  totalPrice: number | null;
  productCount: number | null;
  minimumShort: number | null;
  slot: { windowStart: string | null, windowEnd: string | null, cutOffAt: string | null } | null;
  slotChosen: boolean;
  slotClosed: boolean;
}

export interface NextSlotsInView {
  windowStart: string;
  windowEnd: string | null;
  available: number;
  total: number;
}

export interface ChosenSlotInView {
  windowStart: string;
  windowEnd: string | null;
  cutOffAt: string;
}

export interface DeliveryInView {
  totalPrice: number | null;
  depositReturned: number | null;
  returned: ReturnedContainer[];
}

export interface DeliveryState {
  state: WidgetState;
  countdownTo: string | null;
  progress: number | null;
  etaStart: string | null;
  etaEnd: string | null;
  deliveredAt: string | null;
  cutOffAt: string | null;
  checkedAt: string | null;
  cart: CartInView | null;
  delivery: DeliveryInView | null;
  cartKnown: boolean;
  nextSlots: NextSlotsInView | null;
  chosenSlot: ChosenSlotInView | null;
}

// How long a delivered order stays on the dashboard: long enough to see that
// it came and what came back in deposit, short enough that the widget has
// moved on to the next order by the time anyone thinks about one.
export const DELIVERED_VISIBLE_FOR = 1000 * 60 * 60 * 4;

// How long what the app last heard from Picnic is still worth showing. The
// slowest poll runs every six hours, so this is four of them missed in a row:
// past that the widget would be retelling a state rather than reporting one,
// and an order that was delivered months ago would still be "on its way".
export const CONFIRMED_FOR = 1000 * 60 * 60 * 24;

// How long after its window a delivery can still be seen arriving. Picnic is
// never half a day late, so a delivery the app only notices later than that is
// the app catching up on one it lost track of, not groceries on the counter.
const DELIVERED_AFTER_WINDOW_WITHIN = 1000 * 60 * 60 * 12;

// How long the widget may go on showing a state without the app asking Picnic
// whether an order was placed since. Between deliveries the poll only runs
// every six hours, and an order placed in the Picnic app in between would
// otherwise not reach a dashboard until well after its deadline to add to it.
export const ORDER_MAX_AGE = 1000 * 60 * 5;

// The states in which the app is already following an order, on the poll's
// own faster schedule, and the one in which it cannot ask at all.
const FOLLOWING_OR_UNREACHABLE: string[] = ["ordered", "announced", "underway", "arriving", "overdue", "signed_out"];

// The bar is the van's trip: it fills from the van leaving to the end of the
// window, the last moment it is due, and never starts over on the way. A van
// first seen on the road by an app that did not write that moment down (a
// restart mid-route, or a window that opened before Picnic said anything about
// the van) leaves nothing to fill from, so the last hour before the window
// stands in for it.
const FALLBACK_UNDERWAY_HEAD_START = 1000 * 60 * 60;

// new Date(null) is the epoch rather than an invalid date, so an unset setting
// would read as a moment in 1970 instead of as "not known".
function moment(iso: unknown): number | null {
  if (typeof iso != 'string' || iso == "") return null;

  const parsed = new Date(iso).getTime();
  return isNaN(parsed) ? null : parsed;
}

function amount(value: unknown): number | null {
  return typeof value == 'number' && isFinite(value) ? value : null;
}

function clamp(fraction: number): number {
  if (fraction < 0) return 0;
  if (fraction > 1) return 1;
  return fraction;
}

// How far along we are between two moments, or null when the two do not
// describe a stretch of time that something can be along.
function progressBetween(from: number | null, until: number | null, now: number): number | null {
  if (from === null || until === null || until <= from) return null;
  return clamp((now - from) / (until - from));
}

// How far along the van's trip is: from the moment it left, or the hour before
// the window when that is not known, to the end of the window, or its start
// when the window has no end. The window's start is only a moment on the way,
// so the bar that was full there would have to empty again inside the window,
// which is exactly when the van is closest.
function tripProgress(underwayAt: number | null, start: number, end: number | null, now: number): number | null {
  const from = underwayAt !== null && underwayAt < start ? underwayAt : start - FALLBACK_UNDERWAY_HEAD_START;
  const until = end !== null && end > start ? end : start;

  return progressBetween(from, until, now);
}

// Picnic lets you keep adding to an order until the slot's cut off moment, so
// that moment is worth showing right up until it passes and worth nothing
// after. An order whose cut off is unknown simply does not mention one.
function cutOffAhead(cutOffAt: string | null | undefined, now: number): string | null {
  const at = moment(cutOffAt);
  if (at === null || at <= now) return null;
  return cutOffAt as string;
}

// The next day something can be delivered on, as the cart lists it, or null
// when the cart did not say. Worth knowing with an empty cart as much as with
// a full one, so it is kept apart from the cart itself.
function nextSlotsInView(cart: StoredCart | null | undefined): NextSlotsInView | null {
  if (cart === null || typeof cart != 'object') return null;

  const next = cart["nextSlots"];
  if (next === null || typeof next != 'object' || moment(next["windowStart"]) === null) return null;

  const available = amount(next["available"]);
  const total = amount(next["total"]);
  if (available === null || total === null || !(available > 0) || !(total >= available)) return null;

  return {
    "windowStart": next["windowStart"] as string,
    "windowEnd": moment(next["windowEnd"]) === null ? null : next["windowEnd"] as string,
    "available": available,
    "total": total
  };
}

// The delivery moment someone picked in Picnic's app while their cart is still
// empty, for as long as it can still be ordered for: it is what they have in
// mind, and says more than which slots happen to be free. Picnic's own
// suggestion is held for nobody, so it is not named.
function chosenSlotInView(cart: StoredCart | null | undefined, now: number): ChosenSlotInView | null {
  if (cart === null || typeof cart != 'object') return null;

  const slot = cart["slot"];
  if (slot === null || typeof slot != 'object' || slot["chosen"] !== true) return null;
  if (moment(slot["windowStart"]) === null || cutOffAhead(slot["cutOffAt"], now) === null) return null;

  return {
    "windowStart": slot["windowStart"] as string,
    "windowEnd": moment(slot["windowEnd"]) === null ? null : slot["windowEnd"] as string,
    "cutOffAt": slot["cutOffAt"] as string
  };
}

// The cart as the widget talks about it, or null when there is nothing in it
// or nothing known about it: either way there is no cart to show.
function cartInView(cart: StoredCart | null | undefined, now: number): CartInView | null {
  if (cart === null || typeof cart != 'object') return null;

  const total = amount(cart["totalPrice"]);
  const count = amount(cart["productCount"]);

  if (!(total !== null && total > 0) && !(count !== null && count > 0)) return null;

  const minimum = amount(cart["minimumOrderValue"]);
  const slot = cart["slot"] && typeof cart["slot"] == 'object' ? cart["slot"] : null;
  const chosen = slot !== null && slot["chosen"] === true;

  return {
    "totalPrice": total,
    "productCount": count,
    "minimumShort": minimum !== null && total !== null && total < minimum
      ? Math.round((minimum - total) * 100) / 100
      : null,
    // only a slot someone picked is worth naming: the one Picnic suggests by
    // itself is not held for anyone and changes as the day goes on
    "slot": slot !== null && chosen ? {
      "windowStart": moment(slot["windowStart"]) === null ? null : slot["windowStart"] as string,
      "windowEnd": moment(slot["windowEnd"]) === null ? null : slot["windowEnd"] as string,
      "cutOffAt": cutOffAhead(slot["cutOffAt"], now)
    } : null,
    "slotChosen": chosen,
    // a picked slot whose deadline went by without the cart being ordered:
    // that slot is gone, and saying "no slot picked" would be untrue
    "slotClosed": slot !== null && chosen && moment(slot["cutOffAt"]) !== null && (moment(slot["cutOffAt"]) as number) <= now
  };
}

/**
 * Translates what the app knows about the order into what the widget draws.
 *
 * @param stored what the poll wrote down, as ISO timestamps
 * @returns the state, the moments it is about and how far the bar is filled
 */
export function deriveDeliveryState(stored: StoredDelivery): DeliveryState {
  const now = moment(stored["now"]) || Date.now();
  const etaStart = moment(stored["etaStart"]);
  const etaEnd = moment(stored["etaEnd"]);
  const deliveredAt = moment(stored["deliveredAt"]);
  const cart = cartInView(stored["cart"], now);

  const nothing: DeliveryState = {
    "state": "empty",
    "countdownTo": null,
    "progress": null,
    "etaStart": null,
    "etaEnd": null,
    "deliveredAt": null,
    "cutOffAt": null,
    "checkedAt": null,
    "cart": null,
    "delivery": null,
    // whether the cart was asked about at all, so an empty widget can tell
    // "the cart is empty" apart from "nothing is known about the cart"
    "cartKnown": stored["cart"] !== null && typeof stored["cart"] == 'object',
    // the next chance to have something delivered, in every state: it is
    // what an empty widget has to say, and what a cart without a slot needs
    "nextSlots": nextSlotsInView(stored["cart"]),
    // the slot picked for an empty cart, which an empty widget names instead
    "chosenSlot": null
  };

  // Nothing the app knows about the order means anything while it cannot ask
  // Picnic about it, and a widget saying "no delivery planned" would be
  // claiming something it cannot know.
  if (stored["signInNeeded"] === true) return { ...nothing, "state": "signed_out" };

  // The same goes for a state Picnic has not confirmed in a long time: it is
  // what the app was last told, not what is going on. Never confirmed at all
  // counts too, which is where an app that has been failing to poll since
  // before it started keeping track of this ends up.
  const checkedAt = moment(stored["checkedAt"]);
  if (checkedAt === null || now - checkedAt > CONFIRMED_FOR) {
    return { ...nothing, "state": "stale", "checkedAt": checkedAt === null ? null : stored["checkedAt"] as string };
  }

  const orderStatus = stored["orderStatus"];

  if (orderStatus == "groceries_ordered" || orderStatus == "delivery_announced") {
    const announced = orderStatus == "delivery_announced";
    const cutOffAt = cutOffAhead(stored["cutOffAt"], now);

    // The van on its road, when Picnic says it is. Its live window is the
    // one to count down to then: the announced window was a plan, this is
    // the van. A position without a window keeps the announced one.
    const position = stored["position"] && typeof stored["position"] == 'object' && stored["position"]["inProgress"] === true
      ? stored["position"]
      : null;
    const liveStart = (position !== null && moment(position["etaStart"]) !== null ? position["etaStart"] : stored["etaStart"]) ?? null;
    const liveEnd = (position !== null && moment(position["etaEnd"]) !== null ? position["etaEnd"] : stored["etaEnd"]) ?? null;
    const start = position !== null ? moment(liveStart) : etaStart;
    const end = position !== null ? moment(liveEnd) : etaEnd;

    const window = {
      "etaStart": liveStart,
      "etaEnd": liveEnd,
      // the van being on its way is the cut off having passed whatever the
      // stored moment says, so only a delivery that is still ahead mentions one
      "cutOffAt": null,
      // what is in the cart while the order is open is what has yet to be
      // added to it, which only means something until the order closes
      "cart": null
    };

    // Both ends unknown leaves only the fact that something was ordered.
    if (start === null) {
      return {
        ...nothing, ...window,
        "state": "ordered",
        "etaStart": null,
        "etaEnd": null,
        "cutOffAt": cutOffAt,
        "cart": cutOffAt === null ? null : cart
      };
    }

    if (now < start) {
      // Until the van leaves, a delivery is a pending order however precise
      // the window Picnic announced for it, and nothing draws near yet: the
      // bar is for the van on the road, from the moment it left.
      if (position === null) {
        return {
          ...nothing, ...window,
          "state": announced ? "announced" : "ordered",
          "countdownTo": liveStart,
          "cutOffAt": cutOffAt,
          "cart": cutOffAt === null ? null : cart,
          "progress": null
        };
      }

      return {
        ...nothing, ...window,
        "state": "underway",
        "countdownTo": liveStart,
        "progress": tripProgress(moment(stored["underwayAt"]), start, end, now)
      };
    }

    if (end !== null && now <= end) {
      return {
        ...nothing, ...window,
        "state": "arriving",
        "progress": tripProgress(moment(stored["underwayAt"]), start, end, now)
      };
    }

    // Past the window with the order still open. Picnic is late, or it
    // delivered and the next poll has not seen it yet.
    return { ...nothing, ...window, "state": "overdue", "progress": 1 };
  }

  // an app that lost track of an order sees it as delivered the moment it
  // catches up, which says when the app noticed rather than when it arrived
  const caughtUp = deliveredAt !== null && etaEnd !== null && deliveredAt - etaEnd > DELIVERED_AFTER_WINDOW_WITHIN;

  const delivery = stored["delivery"] && typeof stored["delivery"] == 'object' ? stored["delivery"] : null;

  // A delivery is worth showing when the app can place it: it knows the window
  // the groceries were coming in, or Picnic itself said when they arrived.
  // Neither means the moment on it is only the moment the app looked, which is
  // not something to tell anyone the groceries came at.
  const known = etaStart !== null || etaEnd !== null || (delivery !== null && moment(delivery["deliveredAt"]) !== null);

  if (deliveredAt !== null && known && !caughtUp && now - deliveredAt < DELIVERED_VISIBLE_FOR && now >= deliveredAt) {

    return {
      ...nothing,
      "state": "delivered",
      "etaStart": stored["etaStart"] || null,
      "etaEnd": stored["etaEnd"] || null,
      "deliveredAt": stored["deliveredAt"] as string,
      "delivery": delivery === null ? null : {
        "totalPrice": amount(delivery["totalPrice"]),
        "depositReturned": amount(delivery["depositReturned"]),
        "returned": Array.isArray(delivery["returned"]) ? delivery["returned"] : []
      }
    };
  }

  // Nothing ordered, or nothing ordered any more: what is left to say is what
  // is in the cart, and when it would be delivered if it were ordered now.
  if (cart !== null) return { ...nothing, "state": "cart", "cart": cart };

  return { ...nothing, "chosenSlot": chosenSlotInView(stored["cart"], now) };
}

/**
 * Whether a widget showing this state should have the app ask Picnic about
 * orders now, rather than wait for the next poll.
 *
 * @param state what the widget shows, as deriveDeliveryState names it
 * @param checkedAt the last moment Picnic answered a poll
 * @param now the moment to decide for, in milliseconds
 * @param cartEmptied whether the cart just went from something to nothing
 * @param maxAge how old an answer may be, ORDER_MAX_AGE unless someone asked for a fresh one
 */
export function orderCheckDue(state: string, checkedAt: unknown, now: number, cartEmptied: boolean, maxAge?: number): boolean {
  if (FOLLOWING_OR_UNREACHABLE.indexOf(state) != -1) return false;

  // a cart that was just emptied is most likely an order that was just
  // placed, which is worth asking about right away
  if (cartEmptied === true) return true;

  const at = moment(checkedAt);
  return at === null || now - at >= (maxAge === undefined ? ORDER_MAX_AGE : maxAge);
}
