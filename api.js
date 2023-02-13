'use strict';

module.exports = {
  async login({ homey, body }) {
    return await homey.app.login(body.username, body.password);
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
