// The part of the Homey SDK that app.ts extends, for booting the app in a
// test. Everything it calls on this.homey is handed in by the test itself.

class SimpleClass {
  log() { }
  error() { }
}

class App extends SimpleClass { }

// One plain object, as the real module is. Written as ES exports it would be
// marked as an ES module, and the app's `import Homey from 'homey'` would then
// look for a default export that is not there.
export = { App, SimpleClass };
