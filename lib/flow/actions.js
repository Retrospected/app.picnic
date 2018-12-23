'use strict';

const Homey = require('homey')
const utils = require('../utils.js')

exports.init = function () {
  let actionAddProduct = new Homey.FlowCardAction('add_product').register().registerRunListener(onAddProduct)
};

function onAddProduct(args, callback) {
  return new Promise((resolve, reject) => {
    utils.searchItem(args["product"], function(productId) {
      if ( productId instanceof Error ) { return reject('Item not found'); }
      utils.addItemToCart(productId, function(result) {
        if ( result instanceof Error ) {
          return reject('Item could not be added')
        }
        else {
          resolve(true)
        }
      });
    });
  });
}
