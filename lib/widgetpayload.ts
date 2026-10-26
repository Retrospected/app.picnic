// What the dashboard widget is handed: the state lib/deliverystate.ts derives,
// put in the words and the times the widget shows. Built by
// getDeliveryWidgetState in app.ts and read by widgets/delivery/public/index.html,
// which has no types of its own, so this is the one place the two are written
// down side by side.

import type { WidgetState } from './deliverystate';

// A delivery moment someone picked, and the deadline to order for it.
export interface WidgetSlot {
  day: string;
  window: string;
  cutOffAt: string | null;
  cutOffTime: string;
  cutOffDay: string;
  cutOffLabel: string;
}

export interface DeliveryWidgetPayload {
  state: WidgetState;
  // the moment Homey thinks it is, which the widget counts down from
  now: string;
  countdownTo: string | null;
  progress: number | null;
  day: string;
  window: string;
  windowEnd: string | null;
  deliveredTime: string;
  cutOffAt: string | null;
  cutOffLabel: string;
  price: number | null;
  orderCount: number | null;
  deposit: {
    returned: number | null,
    containers: { name: string, quantity: number }[]
  } | null;
  cart: {
    totalPrice: number | null,
    productCount: number | null,
    minimumShort: number | null,
    slotChosen: boolean,
    slotClosed: boolean,
    slot: WidgetSlot | null
  } | null;
  cartKnown: boolean;
  chosenSlot: WidgetSlot | null;
  nextSlots: {
    day: string,
    time: string,
    window: string,
    available: number,
    total: number
  } | null;
  checkedLabel: string;
  locale: string | undefined;
  // the widget's words by key, with __n__ where a number goes
  labels: Record<string, string>;
}
