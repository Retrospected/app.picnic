'use strict';

const Homey = require('homey');
const flowSpeech = require('./lib/flow/speech.js')
const flowAction = require('./lib/flow/actions.js')
const flowTrigger = require('./lib/flow/triggers.js')

var http = require("https")
var md5 = require("md5")

const POLL_INTERVAL = 1000 * 60 * 5 //5min

class Picnic extends Homey.App {

	onInit() {
		this.log('Picnic is running...');
		flowSpeech.init()
		flowAction.init()

		this.homey.settings.set("additemLock", false)

		if (this.homey.settings.getKeys().indexOf("order_status") == -1) {
			this.homey.settings.set("order_status", null)
		}


		this._pollOrderInterval = setInterval(this.pollOrder.bind(this), POLL_INTERVAL);
		this.pollOrder();

		this._groceriesOrderedTrigger = this.homey.flow
			.getDeviceTriggerCard('groceries_ordered')
			.registerRunListener();
		this._deliveryAnnouncedTrigger = this.homey.flow
			.getDeviceTriggerCard('delivery_announced')
			.registerRunListener();

		this._groceriesDelivered = this.homey.flow
			.getDeviceTriggerCard('groceries_delivered')
			.registerRunListener();

		this._deliveryAnnouncedTriggerBeginTime = this.homey.flow
			.getDeviceTriggerCard('delivery_announced_begin_time')
			.registerRunListener();

		this._deliveryAnnouncedTriggerEndTime = this.homey.flow
			.getDeviceTriggerCard('delivery_announced_end_time')
			.registerRunListener();
	}

	pollOrder() {
		return new Promise((resolve, reject) => {
			this.log("Polling for new order info")
			if (this.homey.settings.getKeys().indexOf("x-picnic-auth") > -1 && this.homey.settings.getKeys().indexOf("username") > -1 && this.homey.settings.getKeys().indexOf("password") > -1) {
				flowTrigger.getOrderStatus().then(orderEvent => {
					this.log("Processing order info")
					if ( orderEvent.toString() == "Error: unauthorized" ) {
						this.log("Error: unauthorized, please check your credentials")
						this.login(this.homey.settings.get('username'), this.homey.settings.get('password'), function(callBack) {
							return Promise.reject(new Error('Re-authentication failed.'));
						});
					}
					else if ( orderEvent instanceof Error ) {
						this.log("Order retrieving failed, connectivity issues?")
						return Promise.reject(new Error('Status could not be retrieved.'));
					}
					else {
						this.log("Order data succesfully retrieved")
						if (orderEvent["event"] == 'groceries_ordered') {
							this.log("Order changed to groceries_ordered, firing trigger")
							var eta_start = orderEvent["eta1_start"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
							var eta_end = orderEvent["eta1_end"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
							var eta_date = orderEvent["eta1_start"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[0]

							let data = { 'price': orderEvent["price"],  'eta_start': eta_start, 'eta_end': eta_end, 'eta_date': eta_date}
							this._groceriesOrderedTrigger.trigger(data)
						}
						else if (orderEvent["event"] == 'delivery_announced') {
							this.log("Order changed to delivery_announced, firing trigger")
							var eta_start = orderEvent["eta2_start"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
							var eta_end = orderEvent["eta2_end"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
							var eta_date = orderEvent["eta2_start"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[0]

							let eta = { 'eta_start': eta_start, 'eta_end': eta_end, 'eta_date': eta_date }
							this._deliveryAnnouncedTrigger.trigger(eta)

							//TODO
							Homey.ManagerCron.registerTask('delivery_announced_begin_time', new Date(eta_date + ' ' + eta_start))
								.then(task => {
									task.on('run', () => {
										this._deliveryAnnouncedTriggerBeginTime.trigger()
									})
								})
								.catch(() => Home.app.log('cron task already exists'));

							Homey.ManagerCron.registerTask('delivery_announced_end_time', new Date(eta_date + ' ' + eta_end))
								.then(task => {
									task.on('run', () => {
										this._deliveryAnnouncedTriggerEndTime.trigger()
									})
								})
								.catch(() => Home.app.log('cron task already exists'));
						}
						else if (orderEvent["event"] == 'groceries_delivered') {
							this.log("Order changed to groceries_delivered, firing trigger")
							var delivery_time = orderEvent["delivery_time"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
							var delivery_date = orderEvent["delivery_time"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[0]

							let delivery = { 'delivery_date': delivery_date, 'delivery_time': delivery_time }

							this._groceriesDelivered.trigger(delivery)
						}
					}
				})
				.catch (error => {
					this.log('Error: '+error)
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
				this.homey.settings.set("x-picnic-auth", res.headers['x-picnic-auth'])
				this.homey.settings.set("username", username)
				this.homey.settings.set("password", password)
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
				"x-picnic-auth": this.homey.settings.get("x-picnic-auth")
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
