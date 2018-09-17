'use strict';

const Homey = require('homey');
const flowSpeech = require('./lib/flow/speech.js')
const flowAction = require('./lib/flow/actions.js')
const flowTrigger = require('./lib/flow/triggers.js')

var http = require("https");
var md5 = require("md5")

const POLL_INTERVAL = 1000 * 60 * 5 //5min

class Picnic extends Homey.App {

		onInit() {
			this.log('Picnic is running...');
			flowSpeech.init()
			flowAction.init()

			if (Homey.ManagerSettings.getKeys().indexOf("order_status") == -1) {
				Homey.ManagerSettings.set("order_status", null)
			}

			this._groceriesOrderedTrigger = new Homey.FlowCardTrigger('groceries_ordered').register()
			this._deliveryAnnouncedTrigger = new Homey.FlowCardTrigger('delivery_announced').register()
			this._groceriesDelivered = new Homey.FlowCardTrigger('groceries_delivered').register()

			this._pollOrderInterval = setInterval(this.pollOrder.bind(this), POLL_INTERVAL);
			this.pollOrder();
	}

	pollOrder() {
		//Would be better to check if the logon session works, but instead just see if the x-picnic-auth key is configured
		if (Homey.ManagerSettings.getKeys().indexOf("x-picnic-auth") > -1) {

			flowTrigger.getOrderStatus( function(orderEvent) {
				if ( orderEvent instanceof Error ) { return Promise.reject(new Error('Status could not be retrieved.')); }

				if (orderEvent["event"] == 'groceries_ordered') {

					var eta_start = orderEvent["eta1_start"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
					var eta_end = orderEvent["eta1_end"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
					var eta_date = orderEvent["eta1_start"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[0]

					let data = { 'price': orderEvent["price"],  'eta_start': eta_start, 'eta_end': eta_end, 'eta_date': eta_date}
					Homey.app._groceriesOrderedTrigger.trigger(data)
				}
				else if (orderEvent["event"] == 'delivery_announced') {

					var eta_start = orderEvent["eta2_start"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
					var eta_end = orderEvent["eta2_end"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
					var eta_date = orderEvent["eta2_start"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[0]

					let eta = { 'eta_start': eta_start, 'eta_end': eta_end, 'eta_date': eta_date }
					Homey.app._deliveryAnnouncedTrigger.trigger(eta)
				}
				else if (orderEvent["event"] == 'groceries_delivered') {

					var delivery_time = orderEvent["delivery_time"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
					var delivery_date = orderEvent["delivery_time"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[0]

					let delivery = { 'delivery_date': delivery_date, 'delivery_time': delivery_time }

					Homey.app._groceriesDelivered.trigger(delivery)
				}
			})
		}
	}

	login(args, callback) {
		var post_data = {
			key: args.body.username,
			secret: md5(args.body.password),
			client_id: 1
		};

		var json_data = JSON.stringify(post_data)

		var options = {
			hostname: 'gateway-prod.global.picnicinternational.com',
			port: 443,
			path: '/api/14/user/login',
			method: 'POST',
			timeout: 1000,
			headers: {
				"User-Agent": "okhttp/3.9.0",
				"Content-Type": "application/json; charset=UTF-8"
			}
		}


		const req = http.request(options, (res) => {
			if (res.statusCode == 200) {
				Homey.ManagerSettings.set("x-picnic-auth", res.headers['x-picnic-auth'])

				return callback(null, "success")
			}
			else {
				return callback(new Error('Problem with request or authentication failed.'));
			}

			req.on('error', (e) => {
				return callback(new Error('Problem with request or authentication failed.'));
			});
		});

		req.write(json_data);
		req.end();
	}
}

module.exports = Picnic;
