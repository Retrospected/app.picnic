'use strict';

const Homey = require('homey')
const https = require('https')

module.exports.searchItem = function searchItem(data,callback) {
  var options = {
    hostname: 'storefront-prod.nl.picnicinternational.com',
    port: 443,
    path: '/api/14/search/?search_term='+encodeURIComponent(data.split(' ').join('+')),
    method: 'GET',
    timeout: 5000,
    headers: {
      "User-Agent": "okhttp/3.9.0",
      "Content-Type": "application/json; charset=UTF-8",
      "x-picnic-auth": this.homey.settings.get("x-picnic-auth")
    }
  }
  this.log("* Searching items to cart")
  this.log("Searching "+options["path"])
  var body = ""
  var req = https.request(options, function (res) {

    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      body += chunk
    });

    res.on('end', function() {
      var jsonBody = JSON.parse(body)[0]
      if (jsonBody === undefined || jsonBody["items"] === undefined || jsonBody["items"].length == 0) {
        return callback(new Error('Couldnt find item'));
      }

      var productId = jsonBody["items"][0]["id"]
      this.log("Processing: "+productId)
      if (typeof productId == 'undefined') { callback(new Error('Couldnt find item')); }
      return callback(productId);
    });

    req.on('error', (e) => {
      return callback(new Error('Couldnt find item'));
    });
  });
  req.end();
}


module.exports.addItemToCart = async function addItemToCart (productId, callback) {

  while(true){
  await new Promise(resolve => {
    this.log("Sleeping because of itemLock")
    setTimeout(resolve, 1000)
  })

  if(!this.homey.settings.get("additemLock")){
    break
  }
}

  this.homey.settings.set("additemLock", true)
  var json_data = '{"count":1,"product_id":'+productId+'}'
  this.log("* Adding items to cart")
  this.log("Sending json:")
  this.log(json_data)
  var options = {
    hostname: 'storefront-prod.nl.picnicinternational.com',
    port: 443,
    path: '/api/14/cart/add_product',
    method: 'POST',
    timeout: 5000,
    headers: {
      "User-Agent": "okhttp/3.9.0",
      "Content-Type": "application/json; charset=UTF-8",
      "x-picnic-auth": this.homey.settings.get("x-picnic-auth")
    }
  }

  var body = ""
  var req = https.request(options, function (res) {

    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      body += chunk
    });

    res.on('end', function() {
      this.homey.settings.set("additemLock", false)
      this.log("Received server response")

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


module.exports.getOrderStatus = function getOrderStatus() {
  return new Promise((resolve, reject) => {
    this.log("Building request")

    var options = {
      hostname: 'storefront-prod.nl.picnicinternational.com',
      path: '/api/14/my_store?depth=0',
      port: 443,
      method: 'GET',
      timeout: 5000,
      headers: {
        "User-Agent": "okhttp/3.9.0",
        "Content-Type": "application/json; charset=UTF-8",
        "x-picnic-auth": this.homey.settings.get("x-picnic-auth")
      }
    }

    var req = https.get(options, function (res) {

      var content = "";

      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        content += chunk
      });

      res.on('end', () => {
        this.log("Order info received")
        if (res.statusCode != 200) return reject ("Error: unauthorized");
        if (typeof content == 'undefined') return reject("No content received");
        var orderContent = JSON.parse(content)["content"];
        if (typeof orderContent !== 'undefined' && orderContent) {
          this.log(orderContent)
          orderContent.forEach( function(item){
            if (item["id"] == "USER_ASSISTANT") {
              item["items"].forEach(function(subitem){
                if (subitem["payload"]["type"] == "ORDER") {
                  var order_status = this.homey.settings.get("order_status")
                  this.log("Homey stored order status: "+order_status)
                  if (subitem["payload"]["eta1"] != null && subitem["payload"]["eta2"] == null && subitem["payload"]["delivery_time"] == null)
                  {
                    this.log("Retrieved status from picnic server: order_placed")
                    if (order_status != "order_placed") {
                      this.homey.settings.set("order_status", "order_placed")
                      return resolve({ "event": "groceries_ordered", "price": subitem["payload"]["total_price"]/100, "eta1_start": subitem["payload"]["eta1"]["start"], "eta1_end": subitem["payload"]["eta1"]["end"] })
                    }
                  }
                  else if (subitem["payload"]["eta2"] != null && subitem["payload"]["delivery_time"] == null) {
                    this.log("Retrieved status from picnic server: order_announced")
                    if (order_status != "order_announced") {
                      this.homey.settings.set("order_status", "order_announced")
                      return resolve({ "event": "delivery_announced", "eta2_start": subitem["payload"]["eta2"]["start"], "eta2_end": subitem["payload"]["eta2"]["end"] })
                    }
                  }
                  else if (subitem["payload"]["delivery_time"] != null) {
                    this.log("Retrieved status from picnic server: order_delivered")
                    if (order_status != "order_delivered") {
                      this.homey.settings.set("order_status", "order_delivered")
                      return resolve({ "event": "groceries_delivered", "delivery_time": subitem["payload"]["delivery_time"]["end"] })
                    }
                  }
                }
              });
            }
          });
        }
      });
    }).on('error', (e) => {
      this.log("Error thrown while obtaining order status");
      this.log(e);
      return new Error('Problem with order status request failed.');
    });
  });
}
