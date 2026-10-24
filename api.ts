import type { PicnicHomey } from './lib/baseclass';

// What Homey hands an API handler: the Homey the app runs in, and the request.
interface ApiRequest {
  homey: PicnicHomey;
  query: Record<string, string>;
  body: any;
}

export async function login({ homey, body }: ApiRequest) {
  await homey.app.setCountry(body.country);
  // someone is on the settings page waiting for it, so a code is worth an SMS
  return await homey.app.login(body.username, body.password, { requestedByUser: true });
}

export async function cancel2FA({ homey }: ApiRequest) {
  return await homey.app.cancelPendingVerification();
}

export async function verify2FA({ homey, body }: ApiRequest) {
  return await homey.app.verify2FACode(body.otp);
}

export async function status({ homey, query }: ApiRequest) {
  return await homey.app.getStatus();
}

export async function orderStatus({ homey, query }: ApiRequest) {
  return await homey.app.getOrderStatusFromSettings();
}

export async function resetOrderStatus({ homey, query }: ApiRequest) {
  await homey.app.resetOrderStatus();
  return "OK";
}
