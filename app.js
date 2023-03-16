'use strict';

const Homey = require('homey');
const actions = require('./lib/actions.js')
const utils = require('./lib/utils.js')

var http = require("https")
var md5 = require("md5")
const schedule = require('node-schedule');

var DEFAULT_POLL_INTERVAL = 1000 * 60 * 60 * 12 // 12 hours
var ORDERED_POLL_INTERVAL = 1000 * 60 * 60 * 1 // 1 hour
var DELIVERY_POLL_INTERVAL = 1000 * 60 * 1 // 1 minute

const DEBUG = false

var runningInterval;

class Picnic extends Homey.App {

	onInit() {
		this.homey.log('Picnic is running...')

		if (DEBUG) {
			this.homey.log('DEBUG ENABLED')
			DEFAULT_POLL_INTERVAL = 1000 * 60 * 1 // 1 minute
			ORDERED_POLL_INTERVAL = 1000 * 30 * 1 // 30 seconds
			DELIVERY_POLL_INTERVAL = 1000 * 10 * 1 // 10 seconds
		}

		this.actions = new actions({homey: this.homey});
		this.actions.onInit();

		this.utils = new utils({homey: this.homey});

		this.homey.settings.set("additemLock", false)
		
		// simulate fresh install
		//this.homey.settings.unset("order_status")
		//this.homey.settings.unset("delivery_eta_start")
		//this.homey.settings.unset("x-picnic-auth")
		//this.homey.settings.unset("username")
		//this.homey.settings.unset("password")

		// retrieve initial order info
		if (this.homey.settings.getKeys().indexOf("x-picnic-auth") != -1)
		{
			this.debug("Auth found, retrieving order")
			this.pollOrder();
		}

		this._initFlowTriggers();
		this._initTimers();
	}

	async _initFlowTriggers() {
		this._groceriesOrderedTrigger = this.homey.flow
		.getTriggerCard('groceries_ordered')
		.registerRunListener();
		this._deliveryAnnouncedTrigger = this.homey.flow
		.getTriggerCard('delivery_announced')
		.registerRunListener();

		this._groceriesDelivered = this.homey.flow
		.getTriggerCard('groceries_delivered')
		.registerRunListener();

		this._deliveryAnnouncedTriggerBeginTime = this.homey.flow
		.getTriggerCard('delivery_announced_begin_time')
		.registerRunListener();

		this._deliveryAnnouncedTriggerEndTime = this.homey.flow
		.getTriggerCard('delivery_announced_end_time')
		.registerRunListener();
	}

	async _initTimers() {
		// start relevant interval
		if (this.homey.settings.get("order_status") == "order_placed") {
			this.debug("Order found, updating poll interval")
			this.homey.app.changeInterval(ORDERED_POLL_INTERVAL);
		}
		else if (this.homey.settings.get("order_status") == "order_announced") {
			this.debug("Order announced")

			if (this.homey.settings.getKeys().indexOf("delivery_eta_start") != -1) {
				this.debug("30 minutes before delivery we will increase polling interval");
				this.homey.app.createDeliverySchedule(this.homey.settings.get("delivery_eta_start"), this.homey.settings.get("delivery_eta_end"));
			}

			this.debug("Until delivery time, using ORDERED interval");
			this.homey.app.changeInterval(ORDERED_POLL_INTERVAL);
		}
		else if (this.homey.settings.get("order_status") == "order_delivered") {
			this.debug("No order found, updating poll interval")
			this.homey.app.changeInterval(DEFAULT_POLL_INTERVAL);
		}
	}

	debug(message) {
		try {
            if (DEBUG) {
                const debugMessage = `[debug] ${message}`;
                this.homey.log(debugMessage);
            }
        } catch (exception) {
            // when debug fails, we want a console.log
            this.homey.error(exception);
        }

	}

	async pollOrder() {
		return new Promise((resolve, reject) => {
			this.debug("Polling for new order info")
			if (this.homey.settings.getKeys().indexOf("x-picnic-auth") > -1 && this.homey.settings.getKeys().indexOf("username") > -1 && this.homey.settings.getKeys().indexOf("password") > -1) {
				this.getOrderStatus().then(orderEvent => {
					this.debug("Processing order info")
					if ( orderEvent.toString() == "Error: unauthorized" ) {
						this.debug("Error: unauthorized, please check your credentials")
						this.login(this.homey.settings.get('username'), this.homey.settings.get('password'), function(callBack) {
							return Promise.reject(new Error('Re-authentication failed.'));
						});
					}
					else if ( orderEvent instanceof Error ) {
						this.debug("Order retrieving failed, connectivity issues?")
						return Promise.reject(new Error('Status could not be retrieved.'));
					}
					else {
						this.debug("Order data succesfully retrieved, processing the following data:")
						if (orderEvent["event"] == 'groceries_ordered') {
							this.debug("Order changed to groceries_ordered, firing trigger")
							var eta_start = orderEvent["eta1_start"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
							var eta_end = orderEvent["eta1_end"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
							var eta_date = orderEvent["eta1_start"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[0]

							let data = { 'price': orderEvent["price"],  'eta_start': eta_start, 'eta_end': eta_end, 'eta_date': eta_date}

							this._groceriesOrderedTrigger.trigger(data)
							
							this.debug("Updating poll interval to "+ORDERED_POLL_INTERVAL/1000/60+" minutes");
							this.homey.app.changeInterval(ORDERED_POLL_INTERVAL);
						}
						else if (orderEvent["event"] == 'delivery_announced') {
							this.debug("Order changed to delivery_announced, firing trigger")
							var eta_start = orderEvent["eta2_start"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
							var eta_end = orderEvent["eta2_end"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
							var eta_date = orderEvent["eta2_start"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[0]

							let eta = { 'eta_start': eta_start, 'eta_end': eta_end, 'eta_date': eta_date }

							this._deliveryAnnouncedTrigger.trigger(eta)
							this.debug("30 minutes before delivery we will increase polling interval");
							this.homey.settings.set("delivery_eta_start", orderEvent["eta2_start"])
							this.homey.settings.set("delivery_eta_end", orderEvent["eta2_end"])
							this.createDeliverySchedule(orderEvent["eta2_start"], orderEvent["eta2_end"]);

							this.debug("Until that time, using ORDERED interval");
							this.homey.app.changeInterval(ORDERED_POLL_INTERVAL);

						}
						else if (orderEvent["event"] == 'groceries_delivered') {
							this.debug("Order changed to groceries_delivered, firing trigger")
							var delivery_time = orderEvent["delivery_time"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
							var delivery_date = orderEvent["delivery_time"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[0]

							let delivery = { 'delivery_date': delivery_date, 'delivery_time': delivery_time }


							this._groceriesDelivered.trigger(delivery)
							this.homey.app.changeInterval(DEFAULT_POLL_INTERVAL);
							
							this.homey.settings.unset("delivery_eta_start")
						}
					}
				})
				.catch (error => {
					if ( error == "Error: unauthorized" ) {
						this.debug("ERROR: unauthorized, trying to retrieve new auth token.")
						this.login(this.homey.settings.get('username'), this.homey.settings.get('password'), function(callback) {
							this.debug(callback)
							if (callback == "success") {
								this.debug("Auth token succesfully renewed.")
								return Promise.resolve('Success');
							} else {
								return Promise.reject('ERROR: Re-authentication failed. Please check your credentials.');
							}
						});
					}
					else {
						this.debug("ERROR: "+error)
						return Promise.reject('Error: an unexpected error occured.')
					}
				});
			}
		});
	}

	changeInterval(interval) {
		this.debug("Changing polling interval to: "+interval/1000/60+" minutes");
		clearInterval(runningInterval);
		runningInterval = setInterval(this.pollOrder.bind(this), interval);
	}

	createDeliverySchedule(eta_start, eta_end) {
		const deliveryStartMin30 = new Date(new Date(eta_start) - 1000*60*30);
		this.debug("Increasing poll rate at " + deliveryStartMin30.toString())
		
		// scheduling increase of the polling rate 30min before the delivery time 
		schedule.scheduleJob(deliveryStartMin30, () => {
			this.homey.app.changeInterval(DELIVERY_POLL_INTERVAL);
		});
		
		// schedule beginning of delivery window trigger
		schedule.scheduleJob(new Date(eta_start), () => {
			this.homey.app._deliveryAnnouncedTriggerBeginTime.trigger()
		});
		
		// schedule ending of delivery window trigger
		schedule.scheduleJob(new Date(eta_end), () => {
			this.homey.app._deliveryAnnouncedTriggerEndTime.trigger()
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
		
		return new Promise((resolve) => {
			const req = http.request(options, (res) => {
				if (res.statusCode == 200) {
				this.homey.settings.set("x-picnic-auth", res.headers['x-picnic-auth'])
				this.homey.settings.set("username", username)
				this.homey.settings.set("password", password)
					this.pollOrder();
					resolve("success");
				}
				else {
					resolve('Problem with request or authentication failed.');
				}
			});

			req.on('error', (e) => {
				resolve('Problem with request or authentication failed.');
			});

			req.write(json_data);
			req.end();
		});
	}

	async getOrderStatusFromSettings() {
		return this.homey.settings.get("order_status");
	}
	
	async resetOrderStatus() {
		this.homey.settings.set("order_status", "");
	}

	async getStatus () {
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
		return new Promise((resolve) => {
			const req = http.request(options, (res) => {
				if (res.statusCode == 200) {
					resolve("OK");
				}
				else {
					resolve("NOT OK");
				}
			});
	
			req.on('error', () => {
				resolve("NOT OK");
			});

			req.end();
		});
	}
	async getOrderStatus () {
		return new Promise((resolve, reject) => {
		   this.utils.getOrderStatus().then(content => {
			if (DEBUG) {
				this.debug("Order info received, raw json:")
				//this.debug(this.homey.settings.get("x-picnic-auth"))
				this.debug(content)
			}
			if (typeof content == 'undefined') return reject("No content received");
	
			if (JSON.parse(content)[0] != undefined)
			{
				if (JSON.parse(content)[0]["delivery_time"] != undefined && this.homey.settings.get("order_status") != "order_delivered")
				{
					this.debug("Retrieved status from picnic server: order_delivered")
					this.homey.settings.set("order_status", "order_delivered")
	
					return resolve({ "event": "groceries_delivered", "delivery_time": JSON.parse(content)[0]["delivery_time"]["end"] })
				}
				else if (JSON.parse(content)[0]["delivery_time"] == undefined && JSON.parse(content)[0]["eta2"] != undefined && this.homey.settings.get("order_status") != "order_announced")
				{
				  this.debug("Retrieved status from picnic server: order_announced")
				  this.homey.settings.set("order_status", "order_announced")
	
					return resolve({ "event": "delivery_announced", "eta2_start": JSON.parse(content)[0]["eta2"]["start"], "eta2_end": JSON.parse(content)[0]["eta2"]["end"] })
	
				}
				else if (JSON.parse(content)[0]["delivery_time"] == undefined && JSON.parse(content)[0]["eta2"] == undefined && this.homey.settings.get("order_status") != "order_placed")
				{
				  this.debug("Retrieved status from picnic server: order_placed")
				  this.homey.settings.set("order_status", "order_placed")
					var total_amount = 0;
					JSON.parse(content)[0]["orders"].forEach(function(order){ total_amount=total_amount+order["total_price"] });
					return resolve({ "event": "groceries_ordered", "price": total_amount/100, "eta1_start": JSON.parse(content)[0]["slot"]["window_start"], "eta1_end": JSON.parse(content)[0]["slot"]["window_end"] })
				}
				else
				{
				  this.debug("Order status didnt change, currently: "+this.homey.settings.get("order_status"))
				}
			}
			else if (JSON.parse(content).length == 0){
				this.debug("No order found, considering this as delivered, but not throwing the delivered trigger.")
				this.homey.settings.set("order_status", "order_delivered")
			}
		})
		.catch(error => {
		  reject(error)
		})
	  })
	};
}

module.exports = Picnic;
