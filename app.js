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
		
		Homey.ManagerSettings.set("additemLock", false)

		if (Homey.ManagerSettings.getKeys().indexOf("order_status") == -1) {
			Homey.ManagerSettings.set("order_status", null)
		}


		this._pollOrderInterval = setInterval(this.pollOrder.bind(this), POLL_INTERVAL);
		this.pollOrder();

		this._groceriesOrderedTrigger = new Homey.FlowCardTrigger('groceries_ordered').register()
		this._deliveryAnnouncedTrigger = new Homey.FlowCardTrigger('delivery_announced').register()
		this._groceriesDelivered = new Homey.FlowCardTrigger('groceries_delivered').register()
	}

	pollOrder() {
		return new Promise((resolve, reject) => {
			Homey.app.log("Polling for new order info")
			if (Homey.ManagerSettings.getKeys().indexOf("x-picnic-auth") > -1 && Homey.ManagerSettings.getKeys().indexOf("username") > -1 && Homey.ManagerSettings.getKeys().indexOf("password") > -1) {
				flowTrigger.getOrderStatus().then(orderEvent => {
					Homey.app.log("Processing order info")
					if ( orderEvent.toString() == "Error: unauthorized" ) {
						Homey.app.log("Error: unauthorized, please check your credentials")
						Homey.app.login(Homey.ManagerSettings.get('username'), Homey.ManagerSettings.get('password'), function(callBack) {
							return Promise.reject(new Error('Re-authentication failed.'));
						});
					}
					else if ( orderEvent instanceof Error ) {
						Homey.app.log("Order retrieving failed, connectivity issues?")
						return Promise.reject(new Error('Status could not be retrieved.'));
					}
					else {
						Homey.app.log("Order data succesfully retrieved")
						if (orderEvent["event"] == 'groceries_ordered') {
							Homey.app.log("Order changed to groceries_ordered, firing trigger")
							var eta_start = orderEvent["eta1_start"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
							var eta_end = orderEvent["eta1_end"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
							var eta_date = orderEvent["eta1_start"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[0]

							let data = { 'price': orderEvent["price"],  'eta_start': eta_start, 'eta_end': eta_end, 'eta_date': eta_date}
							Homey.app._groceriesOrderedTrigger.trigger(data)
						}
						else if (orderEvent["event"] == 'delivery_announced') {
							Homey.app.log("Order changed to delivery_announced, firing trigger")
							var eta_start = orderEvent["eta2_start"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
							var eta_end = orderEvent["eta2_end"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
							var eta_date = orderEvent["eta2_start"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[0]

							let eta = { 'eta_start': eta_start, 'eta_end': eta_end, 'eta_date': eta_date }
							Homey.app._deliveryAnnouncedTrigger.trigger(eta)
						}
						else if (orderEvent["event"] == 'groceries_delivered') {
							Homey.app.log("Order changed to groceries_delivered, firing trigger")
							var delivery_time = orderEvent["delivery_time"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
							var delivery_date = orderEvent["delivery_time"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[0]

							let delivery = { 'delivery_date': delivery_date, 'delivery_time': delivery_time }

							Homey.app._groceriesDelivered.trigger(delivery)
						}
					}
				})
				.catch (error => {
					Homey.app.log('Error: '+error)
					return Promise.reject(new Error('Order polling failed.'))
				});
			}
		});
	}

	login(username, password, callback) {
		var post_data = {
			key: username,
			secret: md5(password),
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
				Homey.ManagerSettings.set("username", username)
				Homey.ManagerSettings.set("password", password)
				return callback(null, "success")
			}
			else {
				return callback(new Error('Problem with request or authentication failed.'));
			}
		});

		req.on('error', (e) => {
			return callback(new Error('Problem with request or authentication failed.'));
		});

		req.write(json_data);
		req.end();
	}

	status (callback) {
		var options = {
			hostname: 'storefront-prod.nl.picnicinternational.com',
			port: 443,
			path: '/api/14/cart',
			method: 'GET',
			timeout: 1000,
			headers: {
				"User-Agent": "okhttp/3.9.0",
				"Content-Type": "application/json; charset=UTF-8",
				"x-picnic-auth": Homey.ManagerSettings.get("x-picnic-auth")
			}
		}

		const req = http.request(options, function (res) {
			if (res.statusCode == 200) {
				return callback ("OK");
			}
			else {
				return callback("NOT OK");
			}
		});

		req.on('error', function (e) {
			return callback("NOT OK");
		});

		req.end();
	}
}

module.exports = Picnic;
