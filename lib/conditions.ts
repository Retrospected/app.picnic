import type Homey from 'homey';
import BaseClass, { type PicnicHomey } from './baseclass';

export default class Conditions extends BaseClass {

  private _groceriesOrderedCondition?: Homey.FlowCard;

  constructor({homey}: { homey: PicnicHomey }) {
    super();
    this.homey = homey;
  }

  async onInit() {
    this.homey.app.debug("INIT Conditions")

    this._groceriesOrderedCondition = this.homey.flow
    .getConditionCard('groceries_ordered')
    .registerRunListener(async () => {
      const order_status = this.homey.settings.get("order_status");
      if (order_status == "groceries_ordered" || order_status == "delivery_announced"){
        return true;
      } else {
        return false;
      }
    });
  }
}
