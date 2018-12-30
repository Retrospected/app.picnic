'use strict';

const Homey = require('homey')
const http = require('https')
const request = require('request')

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
      "x-picnic-auth": Homey.ManagerSettings.get("x-picnic-auth")
    }
  }
  Homey.app.log("* Searching items to cart")
  Homey.app.log("Searching "+options["path"])
  var body = ""
  var req = http.request(options, function (res) {

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
      Homey.app.log("Processing: "+productId)
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
    Homey.app.log("Sleeping because of itemLock")
    setTimeout(resolve, 1000)
  })

  if(!Homey.ManagerSettings.get("additemLock")){
    break
  }
}

  Homey.ManagerSettings.set("additemLock", true)
  var json_data = '{"count":1,"product_id":'+productId+'}'
  Homey.app.log("* Adding items to cart")
  Homey.app.log("Sending json:")
  Homey.app.log(json_data)
  var options = {
    hostname: 'storefront-prod.nl.picnicinternational.com',
    port: 443,
    path: '/api/14/cart/add_product',
    method: 'POST',
    timeout: 5000,
    headers: {
      "User-Agent": "okhttp/3.9.0",
      "Content-Type": "application/json; charset=UTF-8",
      "x-picnic-auth": Homey.ManagerSettings.get("x-picnic-auth")
    }
  }

  var body = ""
  var req = http.request(options, function (res) {

    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      body += chunk
    });

    res.on('end', function() {
      Homey.ManagerSettings.set("additemLock", false)
      Homey.app.log("Received server response")
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
      Homey.ManagerSettings.set("additemLock", false)
      callback(new Error('Couldnt add item'));
    });
  });
  req.write(json_data);
  req.end();
}


module.exports.getOrderStatus = function getOrderStatus() {
  return new Promise((resolve, reject) => {
    Homey.app.log("Building request")
    request({
      url: 'https://storefront-prod.nl.picnicinternational.com/api/14/my_store?depth=0',
      method: 'GET',
      headers: {
        "User-Agent": "okhttp/3.9.0",
        "Content-Type": "application/json; charset=UTF-8",
        "x-picnic-auth": Homey.ManagerSettings.get("x-picnic-auth")
      },
      json: true,
    }, (err, res, content) => {
      if (err) return reject(err);
      Homey.app.log("Order info received")
      if (typeof content["content"] !== 'undefined' && content["content"]) {
        content["content"].forEach( function(item){
          if (item["id"] == "USER_ASSISTANT") {
            item["items"].forEach(function(subitem){
              if (subitem["payload"]["type"] == "ORDER") {
                var order_status = Homey.ManagerSettings.get("order_status")
                Homey.app.log("Homey stored order status: "+order_status)
                if (subitem["payload"]["eta1"] != null && subitem["payload"]["eta2"] == null && subitem["payload"]["delivery_time"] == null)
                {
                  Homey.app.log("Retrieved status from picnic server: order_placed")
                  if (order_status != "order_placed") {
                    Homey.ManagerSettings.set("order_status", "order_placed")
                    return resolve({ "event": "groceries_ordered", "price": subitem["payload"]["total_price"]/100, "eta1_start": subitem["payload"]["eta1"]["start"], "eta1_end": subitem["payload"]["eta1"]["end"] })
                  }
                }
                else if (subitem["payload"]["eta2"] != null && subitem["payload"]["delivery_time"] == null) {
                  Homey.app.log("Retrieved status from picnic server: order_announced")
                  if (order_status != "order_announced") {
                    Homey.ManagerSettings.set("order_status", "order_announced")
                    return resolve({ "event": "delivery_announced", "eta2_start": subitem["payload"]["eta2"]["start"], "eta2_end": subitem["payload"]["eta2"]["end"] })
                  }
                }
                else if (subitem["payload"]["delivery_time"] != null) {
                  Homey.app.log("Retrieved status from picnic server: order_delivered")
                  if (order_status != "order_delivered") {
                    Homey.ManagerSettings.set("order_status", "order_delivered")
                    return resolve({ "event": "groceries_delivered", "delivery_time": subitem["payload"]["delivery_time"]["end"] })
                  }
                }
              }
            });
          }
        });
      }
    });
  });
}
