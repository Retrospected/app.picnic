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

class Picnic extends Homey.App {

	onInit() {
		this.log('Picnic is running...')
		flowAction.init()

		Homey.ManagerSettings.set("additemLock", false)

		this._groceriesOrderedTrigger = new Homey.FlowCardTrigger('groceries_ordered').register()
		this._deliveryAnnouncedTrigger = new Homey.FlowCardTrigger('delivery_announced').register()
		this._groceriesDelivered = new Homey.FlowCardTrigger('groceries_delivered').register()

		this._deliveryAnnouncedTriggerBeginTime = new Homey.FlowCardTrigger('delivery_announced_begin_time').register()
		this._deliveryAnnouncedTriggerEndTime = new Homey.FlowCardTrigger('delivery_announced_end_time').register()
		
		// simulate fresh install
		// Homey.ManagerSettings.unset("order_status")
		// Homey.ManagerSettings.unset("delivery_eta_start")
		// Homey.ManagerSettings.unset("x-picnic-auth")
		// Homey.ManagerSettings.unset("username")
		// Homey.ManagerSettings.unset("password")

		// retrieve initial order info
		if (Homey.ManagerSettings.getKeys().indexOf("x-picnic-auth") != -1)
		{
			Homey.app.log("Auth found, retrieving order")
			this.pollOrder();
		}

		// start relevant interval
		if (Homey.ManagerSettings.get("order_status") == "order_placed") {
			Homey.app.log("Order found, updating poll interval")
			this.changeInterval(ORDERED_POLL_INTERVAL);
		}
		else if (Homey.ManagerSettings.get("order_status") == "order_announced") {
			Homey.app.log("Order announced")

			if (Homey.ManagerSettings.getKeys().indexOf("delivery_eta_start") != -1) {
				Homey.app.log("30 minutes before delivery we will increase polling interval");
				this.createDeliverySchedule(Homey.ManagerSettings.get("delivery_eta_start"));
			}

			Homey.app.log("Until delivery time, using ORDERED interval");
			this.changeInterval(ORDERED_POLL_INTERVAL);
		}
		else if (Homey.ManagerSettings.get("order_status") == "order_delivered") {
			Homey.app.log("No order found, updating poll interval")
			this.changeInterval(DEFAULT_POLL_INTERVAL);
		}
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
							
							Homey.app.log("Updating poll interval to "+ORDERED_POLL_INTERVAL/1000/60+" minutes");
							this.changeInterval(ORDERED_POLL_INTERVAL);
						}
						else if (orderEvent["event"] == 'delivery_announced') {
							Homey.app.log("Order changed to delivery_announced, firing trigger")
							var eta_start = orderEvent["eta2_start"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
							var eta_end = orderEvent["eta2_end"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
							var eta_date = orderEvent["eta2_start"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[0]

							let eta = { 'eta_start': eta_start, 'eta_end': eta_end, 'eta_date': eta_date }
							Homey.app._deliveryAnnouncedTrigger.trigger(eta)
							Homey.app.log("30 minutes before delivery we will increase polling interval");
							Homey.ManagerSettings.set("delivery_eta_start", orderEvent["eta2_start"])
							this.createDeliverySchedule(orderEvent["eta2_start"]);

							Homey.app.log("Until that time, using ORDERED interval");
							this.changeInterval(ORDERED_POLL_INTERVAL);

							Homey.ManagerCron.registerTask('delivery_announced_begin_time', new Date(eta_date + ' ' + eta_start))
								.then(task => {
									task.on('run', () => {
										Homey.app._deliveryAnnouncedTriggerBeginTime.trigger()
									})
								})
								.catch(() => Homey.app.log('cron task already exists'));

							Homey.ManagerCron.registerTask('delivery_announced_end_time', new Date(eta_date + ' ' + eta_end))
								.then(task => {
									task.on('run', () => {
										Homey.app._deliveryAnnouncedTriggerEndTime.trigger()
									})
								})
								.catch(() => Homey.app.log('cron task already exists'));
						}
						else if (orderEvent["event"] == 'groceries_delivered') {
							Homey.app.log("Order changed to groceries_delivered, firing trigger")
							var delivery_time = orderEvent["delivery_time"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[1].slice(0, -3)
							var delivery_date = orderEvent["delivery_time"].replace(/T/, ' ').replace(/\..+/, '').split(' ')[0]

							let delivery = { 'delivery_date': delivery_date, 'delivery_time': delivery_time }

							Homey.app._groceriesDelivered.trigger(delivery)

							Homey.app.log("Updating poll interval to "+DEFAULT_POLL_INTERVAL/1000/60+" minutes");
							this.changeInterval(DEFAULT_POLL_INTERVAL);
							
							Homey.ManagerSettings.unset("delivery_eta_start")
						}
					}
				})
				.catch (error => {
					if ( error == "Error: unauthorized" ) {
						Homey.app.log("Error: unauthorized, trying to retrieve new auth token.")
						Homey.app.login(Homey.ManagerSettings.get('username'), Homey.ManagerSettings.get('password'), function(callback) {
							Homey.app.log(callback)
							if (callback == "success") {
								Homey.app.log("Auth token succesfully renewed.")
								return Promise.resolve('Success');
							} else {
								return Promise.reject(new Error('Error: Re-authentication failed. Please check your credentials.'));
							}
						});
					}
					else {
						return Promise.reject(new Error('Error: an unexpected error occured.'))
					}
				});
			}
		});
	}

	changeInterval(interval) {
		Homey.app.log("Changing polling interval to every: "+interval/1000/60+" minutes");
		clearInterval();
		setInterval(this.pollOrder.bind(this), interval);
	}

	createDeliverySchedule(eta_start) {
		const deliveryStartMin30 = new Date(new Date(eta_start) - 1000*60*30);
		Homey.app.log("Increasing poll rate at " + deliveryStartMin30.toString())
		const job = schedule.scheduleJob(deliveryStartMin30, function(){
			this.changeInterval(DELIVERY_POLL_INTERVAL);
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
				this.pollOrder();
				return callback("success")
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
