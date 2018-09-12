'use strict';

const Homey = require('homey');

module.exports = [

  {
    method:         'POST',
    path:            '/login',
    fn: function( args, callback ){
      Homey.app.login( args, callback );
    }
  }
]
