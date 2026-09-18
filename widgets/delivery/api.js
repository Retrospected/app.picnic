'use strict';

module.exports = {
  // Everything the widget draws, in one call. It asks again every half minute
  // and is told about a change as it happens, so this is asked often enough
  // that it may not go to Picnic: it reads what the poll last wrote down.
  async getState({ homey }) {
    return await homey.app.getDeliveryWidgetState();
  }
};
