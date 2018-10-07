'use strict';

const Homey = require('homey');

module.exports = [

  {
    method:         'POST',
    path:            '/login',
    fn: function( args, callback ) {
      Homey.app.login( args.body.username, args.body.password, callback );
    }
  },
  {
    method:         'GET',
    path:            '/status',
    fn: function( args, callback ) {
      Homey.app.status( function (res) {
        callback(null, res)
      })
    }
  }
]
