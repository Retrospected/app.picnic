// The part of the Homey SDK that app.js extends, for booting the app in a
// test. Everything it calls on this.homey is handed in by the test itself.
'use strict';

class SimpleClass {
  log() { }
  error() { }
}

class App extends SimpleClass { }

module.exports = { App, SimpleClass };
