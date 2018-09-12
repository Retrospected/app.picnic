'use strict';

const Homey = require('homey')
const utils = require('../utils.js')

module.exports.getOrderStatus = function (callback) {
  utils.getOrderStatus(function(cb) {
    callback(cb)
  })
};
