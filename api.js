'use strict';

module.exports = {
  async login({ homey, body }) {
    await homey.app.setCountry(body.country);
    // someone is on the settings page waiting for it, so a code is worth an SMS
    return await homey.app.login(body.username, body.password, { requestedByUser: true });
  },

  async generate2FA({ homey, body }) {
    try {
      return await homey.app.generate2FACode(body && body.channel ? body.channel : "SMS");
    } catch (e) {
      // the status code Picnic refused with is in the app log: the page only
      // needs to know that this way out is closed and which one is left
      homey.app.info("Sending another 2FA code failed: " + ((e && e.message) || "no reason given"));
      return "resend_failed";
    }
  },

  async cancel2FA({ homey }) {
    return await homey.app.cancelPendingVerification();
  },

  async verify2FA({ homey, body }) {
    return await homey.app.verify2FACode(body.otp);
  },

  async status({ homey, query }) {
    return await homey.app.getStatus();
  },

  async orderStatus ({ homey, query }) {
    return await homey.app.getOrderStatusFromSettings();
  },

  async resetOrderStatus ({ homey, query }) {
    await homey.app.resetOrderStatus();
    return "OK";
  }
}
