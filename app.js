'use strict';

const Homey = require('homey');
const flowAction = require('./lib/flow/actions.js')
const flowTrigger = require('./lib/flow/triggers.js')

var http = require("https")
var md5 = require("md5")
const schedule = require('node-schedule');

const DEFAULT_POLL_INTERVAL = 1000 * 60 * 60 * 12 // 12 hours
const ORDERED_POLL_INTERVAL = 1000 * 60 * 60 * 1 // 1 hour
const DELIVERY_POLL_INTERVAL = 1000 * 60 * 1 // 1 minute

var runningInterval;

class Picnic extends Homey.App {

	onInit() {
		this.log('Picnic is running...')
		//flowAction.init()

		this.homey.settings.set("additemLock", false)

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
		
		// simulate fresh install
		// this.homey.settings.unset("order_status")
		// this.homey.settings.unset("delivery_eta_start")
		// this.homey.settings.unset("x-picnic-auth")
		// this.homey.settings.unset("username")
		// this.homey.settings.unset("password")

		// retrieve initial order info
		if (this.homey.settings.getKeys().indexOf("x-picnic-auth") != -1)
		{
			this.log("Auth found, retrieving order")
			this.pollOrder();
		}

		// start relevant interval
		if (this.homey.settings.get("order_status") == "order_placed") {
			this.log("Order found, updating poll interval")
			this.changeInterval(ORDERED_POLL_INTERVAL);
		}
		else if (this.homey.settings.get("order_status") == "order_announced") {
			this.log("Order announced")

			if (this.homey.settings.getKeys().indexOf("delivery_eta_start") != -1) {
				this.log("30 minutes before delivery we will increase polling interval");
				this.createDeliverySchedule(this.homey.settings.get("delivery_eta_start"));
			}

			this.log("Until delivery time, using ORDERED interval");
			this.changeInterval(ORDERED_POLL_INTERVAL);
		}
		else if (this.homey.settings.get("order_status") == "order_delivered") {
			this.log("No order found, updating poll interval")
			this.changeInterval(DEFAULT_POLL_INTERVAL);
		}
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
							
							this.log("Updating poll interval to "+ORDERED_POLL_INTERVAL/1000/60+" minutes");
							this.changeInterval(ORDERED_POLL_INTERVAL);
						}
						else if (orderEvent["event"] == 'delivery_announced') {
							this.log("Order changed to delivery_announced, firing trigger")
							var eta_start = orderEvent["eta2_start"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
							var eta_end = orderEvent["eta2_end"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
							var eta_date = orderEvent["eta2_start"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[0]

							let eta = { 'eta_start': eta_start, 'eta_end': eta_end, 'eta_date': eta_date }

							this._deliveryAnnouncedTrigger.trigger(eta)
							this.log("30 minutes before delivery we will increase polling interval");
							this.homey.settings.set("delivery_eta_start", orderEvent["eta2_start"])
							this.createDeliverySchedule(orderEvent["eta2_start"]);

							this.log("Until that time, using ORDERED interval");
							this.changeInterval(ORDERED_POLL_INTERVAL);

							//TODO FOR SDK3, this doesn't work
							/**
							Homey.ManagerCron.registerTask('delivery_announced_begin_time', new Date(eta_date + ' ' + eta_start))
								.then(task => {
									task.on('run', () => {
										this._deliveryAnnouncedTriggerBeginTime.trigger()
									})
								})
								.catch(() => this.log('cron task already exists'));

							Homey.ManagerCron.registerTask('delivery_announced_end_time', new Date(eta_date + ' ' + eta_end))
								.then(task => {
									task.on('run', () => {
										this._deliveryAnnouncedTriggerEndTime.trigger()
									})
								})
								.catch(() => this.log('cron task already exists'));
							 */
						}
						else if (orderEvent["event"] == 'groceries_delivered') {
							this.log("Order changed to groceries_delivered, firing trigger")
							var delivery_time = orderEvent["delivery_time"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
							var delivery_date = orderEvent["delivery_time"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[0]

							let delivery = { 'delivery_date': delivery_date, 'delivery_time': delivery_time }


							this._groceriesDelivered.trigger(delivery)
							this.changeInterval(DEFAULT_POLL_INTERVAL);
							
							this.homey.settings.unset("delivery_eta_start")
						}
					}
				})
				.catch (error => {
					if ( error == "Error: unauthorized" ) {
						this.log("ERROR: unauthorized, trying to retrieve new auth token.")
						this.login(this.homey.settings.get('username'), this.homey.settings.get('password'), function(callback) {
							this.log(callback)
							if (callback == "success") {
								this.log("Auth token succesfully renewed.")
								return Promise.resolve('Success');
							} else {
								return Promise.reject('ERROR: Re-authentication failed. Please check your credentials.');
							}
						});
					}
					else {
						this.log("ERROR: "+error)
						return Promise.reject('Error: an unexpected error occured.')
					}
				});
			}
		});
	}

	changeInterval(interval) {
		this.log("Changing polling interval to: "+interval/1000/60+" minutes");
		clearInterval(runningInterval);
		runningInterval = setInterval(this.pollOrder.bind(this), interval);
	}

	createDeliverySchedule(eta_start) {
		const deliveryStartMin30 = new Date(new Date(eta_start) - 1000*60*30);
		this.log("Increasing poll rate at " + deliveryStartMin30.toString())
		const job = schedule.scheduleJob(deliveryStartMin30, function(){
			this.changeInterval(DELIVERY_POLL_INTERVAL);
		});
	}

	async login(username, password) {
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
				"Content-Type": "application/json; charset=UTF-8",
				"client_id": "10100",
				"device_id": "open.app.picnic.homey"
			}
		}


		const req = http.request(options, (res) => {
			if (res.statusCode == 200) {
			this.homey.settings.set("x-picnic-auth", res.headers['x-picnic-auth'])
			this.homey.settings.set("username", username)
			this.homey.settings.set("password", password)
				this.pollOrder();
				return "success"
			}
			else {
				return 'Problem with request or authentication failed.';
			}
		});

		req.on('error', (e) => {
			return 'Problem with request or authentication failed.';
		});

		req.write(json_data);
		req.end();
	}

	async getOrderStatusFromSettings() {
		return this.homey.settings.get("order_status");
	}
	
	async resetOrderStatus() {
		this.homey.settings.set("order_status", "");
	}

	async status () {
		var options = {
			hostname: 'storefront-prod.nl.picnicinternational.com',
			port: 443,
			path: '/api/14/cart',
			method: 'GET',
			timeout: 1000,
			headers: {
				"User-Agent": "okhttp/3.9.0",
				"Content-Type": "application/json; charset=UTF-8",
				"x-picnic-auth": this.homey.settings.get("x-picnic-auth"),
				"x-picnic-did": "open.app.picnic.homey"
			}
		}

		const req = http.request(options, function (res) {
			if (res.statusCode == 200) {
				return "OK";
			}
			else {
				return "NOT OK";
			}
		});

		req.on('error', function (e) {
			return "NOT OK";
		});

		req.end();
	}
}

module.exports = Picnic;
