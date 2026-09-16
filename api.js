'use strict';

module.exports = {
  async login({ homey, body }) {
    await homey.app.setCountry(body.country);
    // someone is on the settings page waiting for it, so a code is worth an SMS
    return await homey.app.login(body.username, body.password, { requestedByUser: true });
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
