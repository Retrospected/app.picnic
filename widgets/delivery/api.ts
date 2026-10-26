import type { PicnicHomey } from '../../lib/baseclass';

// Everything the widget draws, in one call. It asks again every half minute
// and is told about a change as it happens, so this is asked often enough
// that it may not go to Picnic: it reads what the poll last wrote down.
export async function getState({ homey }: { homey: PicnicHomey }) {
  return await homey.app.getDeliveryWidgetState();
}

// The same, as fresh as Picnic can make it: for a widget that just came
// into view. The app decides how often that reaches Picnic.
export async function refresh({ homey }: { homey: PicnicHomey }) {
  return await homey.app.refreshDeliveryWidgetState();
}
