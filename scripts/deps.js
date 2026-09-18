#!/usr/bin/env node
'use strict';

// Makes sure the app's dependencies are on disk before the Homey CLI is handed
// the app. The CLI checks the production dependency tree itself and refuses to
// build without it, with an error that names npm rather than what is missing:
//
//   Command failed: npm ls --parseable --all --only=prod
//   npm error missing: md5@^2.2.1, required by app.picnic@3.7.0
//   Error: This error may be fixed by running `npm install` in your app.
//
// A fresh clone is exactly that state, so every script here that goes on to
// call the CLI runs this first.
//
// Deliberately not "npm install every time": that would need the registry on
// every run, and a laptop on a train would then be unable to start an app
// whose dependencies are all sitting right there.

const { execFileSync, spawnSync } = require('child_process');
const path = require('path');

const appPath = path.join(__dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function dependenciesAreInstalled() {
  try {
    // the same question the CLI asks, without the deprecated flag it asks it with
    execFileSync(npm, ['ls', '--parseable', '--all', '--omit=dev'], { cwd: appPath, stdio: 'ignore' });
    return true;
  } catch (exception) {
    return false;
  }
}

if (dependenciesAreInstalled()) process.exit(0);

console.log('Installing the app dependencies, the Homey CLI needs them to build the app...');

const install = spawnSync(npm, ['install'], { cwd: appPath, stdio: 'inherit' });

if (install.status !== 0) {
  console.error('`npm install` did not finish. The Homey CLI cannot build the app without it.');
  process.exit(install.status === null ? 1 : install.status);
}
