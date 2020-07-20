'use strict';

const Homey = require('homey');
//TODO REWRITE SEE: https://apps-sdk-v3.developer.athom.com/tutorial-Web%20API.html
module.exports = [

  {
    method:         'POST',
    path:            '/login',
    requires_authorization: true,

    fn: function( args, callback ) {
      this.login( args.body.username, args.body.password, callback );
    }
  },
  {
    method:         'GET',
    path:            '/status',
    requires_authorization: true,
    fn: function( args, callback ) {
      this.status( function (res) {
        callback(null, res)
      })
    }
  },
  {
    method:         'GET',
    path:            '/order-status',
    requires_authorization: true,
    fn: function( args, callback ) {
      callback(null,this.homey.settings.get("order_status"));
    }
  },
  {
    method:         'GET',
    path:            '/reset-order-status',
    requires_authorization: true,
    fn: function( args, callback ) {
      callback(null,this.homey.settings.set("order_status", ""));
    }
  }
]
