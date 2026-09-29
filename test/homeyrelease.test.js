'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { nextVersion, bumpFor, changelogFor } = require('../scripts/homey-release.js');

test('a fix is a patch release', () => {
  assert.strictEqual(bumpFor('fix(login): keep the session (#63)'), 'patch');
});

test('chore, test and the other types are patch releases', () => {
  ['chore: bump deps', 'test: cover the cut-off', 'docs: readme', 'refactor(widget): split'].forEach(title => {
    assert.strictEqual(bumpFor(title), 'patch', title);
  });
});

test('a title that follows no convention is a patch release', () => {
  assert.strictEqual(bumpFor('Open Picnic when the widget is tapped'), 'patch');
});

test('a feat is a minor release', () => {
  assert.strictEqual(bumpFor('feat(widget): open Picnic when tapped (#62)'), 'minor');
});

test('the type is read whatever its case', () => {
  assert.strictEqual(bumpFor('Feat: open Picnic when tapped'), 'minor');
});

test('a "!" after the type is a major release', () => {
  assert.strictEqual(bumpFor('feat!: drop firmware 12.2'), 'major');
  assert.strictEqual(bumpFor('fix(api)!: new login flow'), 'major');
});

test('a BREAKING CHANGE in the message is a major release', () => {
  assert.strictEqual(bumpFor('feat: new login\n\nBREAKING CHANGE: sign in again'), 'major');
});

test('a merge commit is read by the title of its pull request', () => {
  const message = 'Merge pull request #59 from rvanlaak/chore/widget-url\n\nfeat(widget): open Picnic when tapped\n';
  assert.strictEqual(bumpFor(message), 'minor');
  assert.strictEqual(changelogFor(message), 'feat(widget): open Picnic when tapped');
});

test('a patch counts on from the version in the repository', () => {
  assert.strictEqual(nextVersion(['3.8.1'], 'patch'), '3.8.2');
});

test('a minor release starts its patches over', () => {
  assert.strictEqual(nextVersion(['3.8.1'], 'minor'), '3.9.0');
});

test('a major release starts its minors and patches over', () => {
  assert.strictEqual(nextVersion(['3.8.1'], 'major'), '4.0.0');
});

test('the next version counts from the highest there is, compared as numbers', () => {
  assert.strictEqual(nextVersion(['3.8.1', '3.8.10', '3.8.9'], 'patch'), '3.8.11');
});

test('a build Homey has above the repository is counted from', () => {
  assert.strictEqual(nextVersion(['3.8.1', '3.8.1', '3.8.4'], 'minor'), '3.9.0');
});

test('what is not a plain version is left out of the count', () => {
  assert.strictEqual(nextVersion(['3.8.1', null, undefined, 'beta'], 'patch'), '3.8.2');
});

test('the changelog is the title of the squashed pull request', () => {
  assert.strictEqual(changelogFor('fix: keep the login (#63)\n\n* fix: one\n* fix: two'), 'fix: keep the login (#63)');
});

test('a title too short for the CLI is replaced by one it accepts', () => {
  assert.strictEqual(changelogFor('wip'), 'Test version built from master');
});
