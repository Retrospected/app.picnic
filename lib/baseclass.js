'use strict';

const Homey = require('homey');

class BaseClass extends Homey.SimpleClass {
    constructor(...props) {
        super(...props);
    }
}

module.exports = BaseClass;
