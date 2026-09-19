#!/usr/bin/env node
'use strict';

// Validates the app the way the App Store does, without the Homey CLI and
// without a Homey anywhere near: homey-lib is what the CLI validates with and
// it is a dev dependency here, so this runs wherever the tests run.
//
// It reads app.json, which is generated. Run `npm run compose` first when the
// change was made in .homeycompose or in a widget's widget.compose.json.

const path = require('path');

const LEVELS = ['debug', 'publish', 'verified'];

async function main() {
  const level = process.argv[2] || 'publish';

  if (!LEVELS.includes(level)) {
    console.error('Unknown validation level "' + level + '". Use one of: ' + LEVELS.join(', ') + '.');
    process.exit(1);
  }

  var App;

  try {
    App = require('homey-lib').App;
  } catch (exception) {
    console.error('homey-lib is missing. Run `npm install` first.');
    process.exit(1);
  }

  try {
    await new App(path.join(__dirname, '..')).validate({ level });
  } catch (error) {
    console.error('The app is not valid at the "' + level + '" level:');
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  }

  console.log('The app is valid at the "' + level + '" level.');
}

main();
