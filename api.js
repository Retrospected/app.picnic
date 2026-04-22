'use strict';

module.exports = {
  async login({ homey, body }) {
    await homey.app.setCountry(body.country);
    return await homey.app.login(body.username, body.password);
  },

  async generate2FA({ homey, body }) {
    try {
      return await homey.app.generate2FACode(body && body.channel ? body.channel : "SMS");
    } catch (e) {
      return (e && e.message) || "Failed to generate 2FA code";
    }
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
