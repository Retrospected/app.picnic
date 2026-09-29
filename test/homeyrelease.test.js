'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { nextVersion, changelogFor } = require('../scripts/homey-release.js');

test('the version in the repository goes out when no build has it yet', () => {
  assert.strictEqual(nextVersion('3.9.0', ['3.8.0', '3.8.1']), '3.9.0');
});

test('the first publish of an app with no builds takes the version in the repository', () => {
  assert.strictEqual(nextVersion('3.8.1', []), '3.8.1');
});

test('a version a build already has is followed by the next patch', () => {
  assert.strictEqual(nextVersion('3.8.1', ['3.8.0', '3.8.1']), '3.8.2');
});

test('the next patch counts from the highest build, not from the repository', () => {
  assert.strictEqual(nextVersion('3.8.1', ['3.8.1', '3.8.4', '3.8.2']), '3.8.5');
});

test('versions are compared as numbers, not as text', () => {
  assert.strictEqual(nextVersion('3.8.1', ['3.8.9', '3.8.10']), '3.8.11');
});

test('a build without a plain version is left out of the count', () => {
  assert.strictEqual(nextVersion('3.8.1', [undefined, 'beta', '3.8.1']), '3.8.2');
});

test('a merged pull request is described by its title', () => {
  const message = 'Merge pull request #59 from rvanlaak/chore/widget-url\n\nenh(widget): open Picnic when tapped\n';
  assert.strictEqual(changelogFor(message), 'enh(widget): open Picnic when tapped');
});

test('a commit pushed straight to master is described by its subject', () => {
  assert.strictEqual(changelogFor('fix: keep the login\n\nlonger story'), 'fix: keep the login');
});

test('a message too short for the CLI is replaced by one it accepts', () => {
  assert.strictEqual(changelogFor('wip'), 'Test version built from master');
});
