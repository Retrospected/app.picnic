'use strict';

const https = require('https')
const BaseClass = require('./baseclass.js')

class utils extends BaseClass {
  constructor({ homey }) {
    super();
    this.homey = homey;
  }

  getOrderStatus() {
    return new Promise((resolve, reject) => {
      this.homey.app.debug("Building request")

      var options = {
        hostname: this.homey.settings.get("url"),
        path: '/api/15/deliveries/summary',
        port: 443,
        method: 'POST',
        timeout: 5000,
        headers: {
          "User-Agent": "okhttp/3.9.0",
          "Content-Type": "application/json; charset=UTF-8",
          "x-picnic-auth": this.homey.settings.get("x-picnic-auth"),
          "x-picnic-did": "open.app.picnic.homey"
        }
      }

      var req = https.request(options, function (res) {

        var content = "";

        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          content += chunk
        });

        res.on('end', () => {
          if (res.statusCode == 401) reject("Error: unauthorized");
          resolve(content)
        });
      }).on('error', (e) => {
        this.log("Error thrown while obtaining order status");
        this.log(e);
      });

      req.write('["CURRENT"]');
      req.end();
    });
  }

  async searchItem(data, callback) {
    this.homey.app.debug("Searching product in the store")
    var options = {
      hostname: this.homey.settings.get("url"),
      port: 443,
      path: '/api/15/pages/search-page-results?search_term=' + encodeURIComponent(data.split(' ').join('+')),
      method: 'GET',
      timeout: 5000,
      headers: {
        "User-Agent": "okhttp/3.9.0",
        "Accept": "application/json; charset=UTF-8",
        "x-picnic-auth": this.homey.settings.get("x-picnic-auth"),
        "x-picnic-did": "open.app.picnic.homey",
        "x-picnic-agent": "30100;1.15.233-#15158"
      }
    }
    this.homey.app.debug("* Searching items to cart")
    this.homey.app.debug("Searching " + options["path"])
    this.homey.app.debug("With request headers:")
    for (const [key, value] of Object.entries(options.headers)) {
      this.homey.app.debug(`${key}: ${value}`);
    }
    var body = ""
    var self = this;

    var req = https.request(options, function (res) {

      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk
      });

      res.on('end', function () {
        try {
          self.homey.app.debug("Raw search results:")
          self.homey.app.debug(JSON.stringify(body))
          var productId = JSON.parse(body)["body"]["analytics"]["contexts"][0]["data"]["product_ids"][0]
          self.homey.app.debug("Found item with product id: " + productId)
          if (typeof productId == 'undefined') { return callback(new Error('Couldnt find item')); }
          return callback(productId);
        } catch (error) {
          return callback(new Error('Couldnt find item'));
        }
      });

      req.on('error', (e) => {
        self.homey.app.debug("ERROR: " + e.message)
        return callback(new Error('Couldnt find item'));
      });
    });
    req.end();
  }

  async addItemLock() {
    return new Promise(resolve => {
      const intervalId = setInterval(() => {
        if (!this.homey.settings.get("additemLock")) {
          clearInterval(intervalId);
          resolve();
        } else {
          this.homey.app.debug("Sleeping because of itemLock");
        }
      }, 1000);
    });
  }

  async addItemToCart(productId, callback) {

    await this.addItemLock();

    this.homey.settings.set("additemLock", true)
    var json_data = '{"count":1,"product_id":"' + productId + '"}'
    this.homey.app.debug("* Adding items to cart")
    this.homey.app.debug("Sending json:")
    this.homey.app.debug(json_data)
    var options = {
      hostname: this.homey.settings.get("url"),
      port: 443,
      path: '/api/15/cart/add_product',
      method: 'POST',
      timeout: 5000,
      headers: {
        "User-Agent": "okhttp/3.9.0",
        "Content-Type": "application/json; charset=UTF-8",
        "x-picnic-auth": this.homey.settings.get("x-picnic-auth"),
        "x-picnic-did": "open.app.picnic.homey",
        "x-picnic-agent": "30100;1.15.233-#15158"
      }
    }

    var body = ""
    var req = https.request(options, (res) => {

      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk
      });

      res.on('end', () => {
        this.homey.settings.set("additemLock", false)
        this.homey.app.debug("Received server response")

        if (typeof JSON.parse(body)["items"] !== 'undefined' && JSON.parse(body)["items"]) {
          JSON.parse(body)["items"]
            .forEach(function (item) {
              if (item["items"][0]['id'] == productId) {
                return callback(item["items"][0]["name"])
              }
            })
        }
        else if (JSON.parse(body)["error"]["code"] === "UNPROCESSABLE_ENTITY") {
          callback(new Error('Cart was locked'));
        }
        else {
          callback(new Error('Couldnt add item'));
        }
      });

      req.on('error', (e) => {
        this.homey.settings.set("additemLock", false)
        callback(new Error('Couldnt add item'));
      });
    });
    req.write(json_data);
    req.end();
  }
}

module.exports = utils;