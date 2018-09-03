const Homey = require('homey')
const http = require('https')

exports.init = function () {
  Homey.ManagerSpeechInput.on('speechMatch', function( speech, onSpeechEvalData ) {

    speech.ask(Homey.__('speech.which_product'))
      .then( function(result) {
        searchItem(result, function(productId) {
          return addItemToCart(productId, function(result) {
            speech.say(Homey.__('speech.pre_added') +' '+ result + ' ' + Homey.__('speech.post_added'))
          });
        })
      })
      .catch( err => {
          return
      })
  })
}

function searchItem(data,callback) {
    var options = {
      hostname: 'storefront-prod.nl.picnicinternational.com',
      port: 443,
      path: '/api/14/search/?search_term='+data,
      method: 'GET',
      timeout: 1000,
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
        var productId = JSON.parse(body)[0]["items"][0]["id"]
        return callback(productId);
      });

      req.on('error', (e) => {
        Homey.app.log(e)
      });
    });
    req.end();
}

  //add product
  //https://storefront-prod.nl.picnicinternational.com/api/14/cart/add_product
  //POST
  //{"count":1,"product_id":"10573488"}

function addItemToCart (productId, callback) {

  var json_data = '{"count":1,"product_id":'+productId+'}'

  var options = {
    hostname: 'storefront-prod.nl.picnicinternational.com',
    port: 443,
    path: '/api/14/cart/add_product',
    method: 'POST',
    timeout: 1000,
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
      JSON.parse(body)["items"]
      .forEach(function (item) {
        if (item["items"][0]['id'] == productId) {
          return callback(item["items"][0]["name"])
        }
      })
    });

    req.on('error', (e) => {
      Homey.app.log(`problem with request: ${e.message}`);
    });
  });
  req.write(json_data);
  req.end();
}
