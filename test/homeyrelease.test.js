'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { nextVersion, bumpFor, changelogFor, ships } = require('../scripts/homey-release.js');

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
  assert.strictEqual(changelogFor(message), 'Open Picnic when tapped');
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

test('the changelog is the title of the squashed pull request, without its type or number', () => {
  assert.strictEqual(changelogFor('fix: keep the login (#63)\n\n* fix: one\n* fix: two'), 'Keep the login');
});

test('a number in the middle of the title is not the pull request\'s', () => {
  assert.strictEqual(changelogFor('fix: keep (#12) apart (#63)'), 'Keep (#12) apart');
});

test('the scope and a "!" go with the type', () => {
  assert.strictEqual(changelogFor('feat: new feature xyz'), 'New feature xyz');
  assert.strictEqual(changelogFor('feat(widget)!: new feature xyz'), 'New feature xyz');
});

test('a title that follows no convention goes into the changelog as it is', () => {
  assert.strictEqual(changelogFor('Open Picnic when the widget is tapped'), 'Open Picnic when the widget is tapped');
});

test('a type with nothing after it is replaced by a changelog the CLI accepts', () => {
  assert.strictEqual(changelogFor('fix: x'), 'Test version built from master');
  assert.strictEqual(changelogFor('fix: x (#63)'), 'Test version built from master');
});

test('a title too short for the CLI is replaced by one it accepts', () => {
  assert.strictEqual(changelogFor('wip'), 'Test version built from master');
});

const HOMEYIGNORE = [
  '/test/',
  '/scripts/',
  '/Makefile',
  '/VERIFICATION.md',
  '/docs/',
  '/README.md',
  '/CHANGELOG.md',
  '/.editorconfig',
  '/.editorconfig-checker.json',
  '/.github/'
];

test('the code, the widget and what the app is built from ship', () => {
  ['app.js', 'api.js', 'lib/cutoff.js', 'widgets/delivery/public/index.html', 'locales/nl.json',
    'settings/index.html', 'assets/images/large.png', 'app.json', 'package.json', 'README.txt', 'LICENSE']
    .forEach(file => assert.strictEqual(ships(file, HOMEYIGNORE), true, file));
});

test('the .homey files ship, although the CLI leaves other dotfiles out', () => {
  ['.homeycompose/app.json', '.homeycompose/flow/triggers/delivery_soon.json', '.homeychangelog.json',
    '.homeyignore', '.homeyplugins.json']
    .forEach(file => assert.strictEqual(ships(file, HOMEYIGNORE), true, file));
});

test('what .homeyignore names stays out', () => {
  ['test/cutoff.test.js', 'test/support/homey.js', 'scripts/deps.js', 'Makefile', 'VERIFICATION.md',
    'docs/picnic-api.md', 'README.md', 'CHANGELOG.md', '.github/workflows/test.yml', '.editorconfig']
    .forEach(file => assert.strictEqual(ships(file, HOMEYIGNORE), false, file));
});

test('the other dotfiles stay out, as the CLI leaves them out', () => {
  ['.gitignore', '.gitattributes', 'widgets/delivery/.DS_Store']
    .forEach(file => assert.strictEqual(ships(file, HOMEYIGNORE), false, file));
});

test('an anchored pattern only matches at the root', () => {
  assert.strictEqual(ships('widgets/docs/help.md', HOMEYIGNORE), true);
  assert.strictEqual(ships('lib/Makefile', HOMEYIGNORE), true);
});

test('a pattern without a "/" in front matches at any depth, with wildcards', () => {
  assert.strictEqual(ships('widgets/delivery/notes.md', ['*.md']), false);
  assert.strictEqual(ships('lib/cutoff.js', ['*.md']), true);
  assert.strictEqual(ships('assets/raw/a/b.svg', ['assets/raw/**']), false);
});

test('a folder pattern leaves a file of the same name alone', () => {
  assert.strictEqual(ships('docs', ['/docs/']), true);
  assert.strictEqual(ships('docs.js', ['/docs/']), true);
});

test('comments and empty lines in .homeyignore are not patterns', () => {
  assert.strictEqual(ships('app.js', ['# the tests', '', '/test/']), true);
});

test('a .homeyignore that takes files back in with "!" errs on the side of a release', () => {
  assert.strictEqual(ships('test/cutoff.test.js', ['/test/', '!/test/fixture.json']), true);
});
