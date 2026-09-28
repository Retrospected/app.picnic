'use strict';

const https = require('https')
const BaseClass = require('./baseclass.js')
const { parseAddProductResponse } = require('./cartresponse.js')
const { PICNIC_AGENT, PICNIC_DID } = require('./picnicheaders.js')
const { toError } = require('./errors.js')
const { refusal, UNAUTHORIZED, SECOND_FACTOR_REQUIRED } = require('./refusal.js')

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
          "x-picnic-did": PICNIC_DID,
          "x-picnic-agent": PICNIC_AGENT
        }
      }

      var req = https.request(options, (res) => {

        var content = "";

        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          content += chunk
        });

        res.on('end', () => {
          const refused = refusal(res.statusCode, content, "the order");
          if (refused !== null) return reject(refused);

          resolve(content)
        });
      }).on('error', (e) => {
        // without rejecting, a failed request left the poll hanging and said
        // nothing about it, so a connectivity problem looked like a quiet app
        reject(toError(e, "Retrieving the order from " + options.hostname + " failed"));
      });

      req.on('timeout', () => {
        // a socket timeout does not end the request by itself
        req.destroy(new Error("Picnic did not answer within " + options.timeout + "ms"));
      });

      req.write('["CURRENT"]');
      req.end();
    });
  }

  // The cart behind the "in your cart" side of the widget. Asked for on the
  // widget's behalf rather than on a timer, so it is deliberately quiet: a
  // refusal or a cart that cannot be read is answered with nothing to show
  // rather than with a failure the poll would have to deal with.
  getCart() {
    return this._get('/api/15/cart', "the cart");
  }

  // One delivery in full, which is where Picnic says when it actually arrived
  // and what came back in deposit. The summary the poll reads carries neither.
  getDelivery(deliveryId) {
    return this._get('/api/15/deliveries/' + encodeURIComponent(deliveryId), "the delivery");
  }

  // Where the van is: Picnic's live window and whether the route is being
  // driven. Answered with an empty body until a van has been assigned, which
  // lib/positionresponse.js reads as "nothing to say yet".
  getDeliveryPosition(deliveryId) {
    return this._get('/api/15/deliveries/' + encodeURIComponent(deliveryId) + '/position', "the delivery position");
  }

  // The payments taken from the account, newest first. None of them says
  // which delivery it was for: that takes asking about each one.
  getWalletTransactions() {
    return this._request('POST', '/api/15/wallet/transactions', "the payments", '{"page_number":1}');
  }

  // One payment, with the delivery it was for and what was refunded on it.
  getWalletTransaction(transactionId) {
    return this._get('/api/15/wallet/transactions/' + encodeURIComponent(transactionId), "the payment");
  }

  _get(path, subject) {
    return this._request('GET', path, subject, null);
  }

  _request(method, path, subject, body) {
    return new Promise((resolve, reject) => {
      var options = {
        hostname: this.homey.settings.get("url"),
        path: path,
        port: 443,
        method: method,
        timeout: 5000,
        headers: {
          "User-Agent": "okhttp/3.9.0",
          "Content-Type": "application/json; charset=UTF-8",
          "x-picnic-auth": this.homey.settings.get("x-picnic-auth"),
          "x-picnic-did": PICNIC_DID,
          "x-picnic-agent": PICNIC_AGENT
        }
      }

      var req = https.request(options, (res) => {
        var content = "";

        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          content += chunk
        });

        res.on('end', () => {
          // the same errors the order poll reacts to, so a token that went
          // stale while a dashboard was open is noticed the same way
          const refused = refusal(res.statusCode, content, subject);
          if (refused !== null) return reject(refused);

          resolve(content)
        });
      }).on('error', (e) => {
        reject(toError(e, "Retrieving " + subject + " from " + options.hostname + " failed"));
      });

      req.on('timeout', () => {
        req.destroy(new Error("Picnic did not answer the request for " + subject + " within " + options.timeout + "ms"));
      });

      if (body !== null) req.write(body);
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
        "x-picnic-did": PICNIC_DID,
        "x-picnic-agent": PICNIC_AGENT
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
          var analyticsContexts = JSON.parse(body)["body"]["child"]["analytics"]["contexts"]
          var productContext = analyticsContexts.find(c => c["data"] && c["data"]["product_ids"])
          var productIdData = productContext && productContext["data"]["product_ids"]
          var productId;
          if (Array.isArray(productIdData)) {
            productId = productIdData[0];
          } else if (productIdData && productIdData.type === "EXPRESSION" && typeof productIdData.expression === 'string') {
            var expressionMatch = productIdData.expression.match(/return (\["[^"]*"(?:,"[^"]*")*\])/)
            productId = expressionMatch ? JSON.parse(expressionMatch[1])[0] : undefined;
          }
          if (typeof productId == 'undefined') { return callback(new Error("Couldn't find item")); }
          return callback(productId);
        } catch (error) {
          return callback(new Error("Couldn't find item"));
        }
      });
    }).on('error', (e) => {
      self.homey.app.debug("ERROR: " + e.message)
      return callback(new Error("Couldn't find item"));
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
        "x-picnic-did": PICNIC_DID,
        "x-picnic-agent": PICNIC_AGENT
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

        const outcome = parseAddProductResponse(body, productId);

        if (outcome["name"] !== undefined) {
          return callback(outcome["name"]);
        }

        this.homey.app.debug("Adding the product did not work: " + outcome["error"]
          + (outcome["code"] ? ", error code " + outcome["code"] : "")
          + (outcome["reason"] ? ", " + outcome["reason"] : ""))
        this.homey.app.debug("Raw response: " + body)

        return callback(new Error(outcome["error"]));
      });
    }).on('error', (e) => {
      // the lock is released when a response arrives, so a request that never
      // gets one has to release it here or every later add product action
      // waits on a lock nothing will ever open
      this.homey.settings.set("additemLock", false)
      this.homey.app.debug("Adding the product failed: " + e.message)
      callback(new Error("Couldn't add item"));
    });
    req.write(json_data);
    req.end();
  }
}

module.exports = utils;
module.exports.UNAUTHORIZED = UNAUTHORIZED;
module.exports.SECOND_FACTOR_REQUIRED = SECOND_FACTOR_REQUIRED;
