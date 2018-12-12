'use strict';

const Homey = require('homey')
const utils = require('../utils.js')

module.exports.getOrderStatus = function () {
  return new Promise((resolve, reject) => {
     utils.getOrderStatus().then(orderEvent => {
    resolve(orderEvent)
  })
  .catch(error => {
    reject(error)
  })
})
};
