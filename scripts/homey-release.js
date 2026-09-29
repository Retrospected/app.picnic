#!/usr/bin/env node
'use strict';

// What .github/workflows/deploy-test.yml needs around `homey app publish` to
// turn every merge to master into a Test version on Homey, without a person in
// the Developer Tools:
//
//   node scripts/homey-release.js prepare              picks the version and writes it
//   node scripts/homey-release.js promote              moves that build from Draft to Test
//   node scripts/homey-release.js apply <version> <commit>
//                                                      writes a version and its changelog
//
// `prepare` and `promote` talk to Athom's API as the owner of the Personal
// Access Token in HOMEY_PAT, the same token the publish action is given.
//
// The version follows the title of the commit that was merged, which with
// squash and merge is the title of the pull request, read as a conventional
// commit: a "!" after the type or a "BREAKING CHANGE:" in the message is a
// major release, "feat" a minor one, and everything else a patch, "fix",
// "chore" and "test" as much as a title that follows no convention at all.
//
// It counts from the highest of the version in the commit that is published,
// the one on master by now, and the highest build Homey has, since Homey takes
// every version only once and only ever a higher one. That title is also the
// changelog of the new version. `apply` writes both into .homeycompose/app.json,
// app.json, package.json and .homeychangelog.json, which `prepare` does for the
// build and the workflow does again on master, to commit them there.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const appPath = path.join(__dirname, '..');
const composePath = path.join(appPath, '.homeycompose', 'app.json');
const manifestPath = path.join(appPath, 'app.json');
const packagePath = path.join(appPath, 'package.json');
const changelogPath = path.join(appPath, '.homeychangelog.json');

// the client the Homey CLI identifies itself with, which is what a Personal
// Access Token is issued to use
const CLI_CLIENT_ID = '64691b4358336640a5ecee5c';
const CLI_CLIENT_SECRET = 'ed09f559ae12b1522d00431f0bf7c5755603c41e';

// a fresh build is processed before it can go anywhere
const PROMOTE_ATTEMPTS = 20;
const PROMOTE_INTERVAL = 15 * 1000;

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version));
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(a, b) {
  const [pa, pb] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

// the title of what was merged: the commit's subject, or with a merge commit
// the title of the pull request, which GitHub puts under its first line
function titleOf(commitMessage) {
  const lines = String(commitMessage).split('\n').map(line => line.trim()).filter(Boolean);
  const subject = lines[0] || '';
  return /^Merge pull request #\d+/.test(subject) && lines[1] ? lines[1] : subject;
}

// major, minor or patch, after the conventional commit the title is
function bumpFor(commitMessage) {
  const match = /^(\w+)(\([^)]*\))?(!)?:/.exec(titleOf(commitMessage));

  if ((match && match[3]) || /^BREAKING[ -]CHANGE:/m.test(commitMessage)) return 'major';
  if (match && match[1].toLowerCase() === 'feat') return 'minor';
  return 'patch';
}

// the version to publish, given the versions it could count from, those of
// the repository and those of every build Homey already has
function nextVersion(versions, bump) {
  const [major, minor, patch] = parseVersion(versions
    .filter(version => parseVersion(version) !== null)
    .reduce((a, b) => compareVersions(a, b) >= 0 ? a : b));

  if (bump === 'major') return (major + 1) + '.0.0';
  if (bump === 'minor') return major + '.' + (minor + 1) + '.0';
  return major + '.' + minor + '.' + (patch + 1);
}

function changelogFor(commitMessage) {
  const title = titleOf(commitMessage);

  // the CLI turns down anything of three characters or fewer
  return title.length > 3 ? title : 'Test version built from master';
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// the first "version" in each of these files is the app's own
function setVersion(file, version) {
  const text = fs.readFileSync(file, 'utf8');
  const updated = text.replace(/("version"\s*:\s*")[^"]*(")/, '$1' + version + '$2');
  fs.writeFileSync(file, updated);
}

function git(...args) {
  return execFileSync('git', args, { cwd: appPath, encoding: 'utf8' });
}

// the version on master by now, which may be ahead of the commit published
// when something else was merged in the meantime
function versionOnMaster() {
  try {
    return JSON.parse(git('show', 'origin/master:.homeycompose/app.json')).version;
  } catch (exception) {
    return null;
  }
}

function output(name, value) {
  console.log(name + '=' + value);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, name + '=' + value + '\n');
}

async function appsApi() {
  const pat = process.env.HOMEY_PAT;
  if (!pat) throw new Error('HOMEY_PAT is not set.');

  const { AthomCloudAPI, AthomAppsAPI } = require('homey-api');
  const Token = require('homey-api/lib/AthomCloudAPI/Token');

  const cloud = new AthomCloudAPI({
    clientId: CLI_CLIENT_ID,
    clientSecret: CLI_CLIENT_SECRET,
    autoRefreshTokens: false,
    token: new Token({ access_token: pat })
  });

  return {
    api: new AthomAppsAPI(),
    $token: await cloud.createDelegationToken({ audience: 'apps' })
  };
}

async function getBuilds(appId) {
  const { api, $token } = await appsApi();
  const builds = await api.getBuilds({ $token, appId });
  return { api, $token, builds: Array.isArray(builds) ? builds : Object.values(builds || {}) };
}

function apply(version, commit) {
  if (parseVersion(version) === null) throw new Error('"' + version + '" is not a version.');
  const message = git('log', '-1', '--format=%B', commit || 'HEAD');

  [composePath, manifestPath, packagePath].forEach(file => setVersion(file, version));

  // a changelog someone wrote for this version themselves is left as it is
  const changelog = readJson(changelogPath);
  if (!changelog[version] || !changelog[version].en) {
    changelog[version] = { en: changelogFor(message) };
    fs.writeFileSync(changelogPath, JSON.stringify(changelog, null, 2) + '\n');
  }

  console.log(readJson(composePath).id + '@' + version + ': ' + changelog[version].en);
}

async function prepare() {
  const { id: appId, version: current } = readJson(composePath);
  const message = git('log', '-1', '--format=%B', 'HEAD');
  const { builds } = await getBuilds(appId);

  const bump = bumpFor(message);
  const version = nextVersion([current, versionOnMaster(), ...builds.map(build => build.version)], bump);

  console.log('A ' + bump + ' release, from "' + titleOf(message) + '".');
  apply(version, 'HEAD');
  output('version', version);
}

async function promote() {
  const { id: appId, version } = readJson(composePath);

  for (let attempt = 1; ; attempt++) {
    const { api, $token, builds } = await getBuilds(appId);
    const build = builds.find(candidate => candidate.version === version);

    if (!build) throw new Error('Homey has no build of ' + appId + '@' + version + '.');

    const buildId = String(build.id !== undefined ? build.id : build._id);

    try {
      await api.updateBuildChannel({ $token, appId, buildId, channel: 'test' });
      console.log('Build ' + buildId + ' of ' + appId + '@' + version + ' is now the Test version.');
      output('build', buildId);
      return;
    } catch (error) {
      if (attempt >= PROMOTE_ATTEMPTS) throw error;
      console.log('Build ' + buildId + ' cannot go to Test yet (' + (error && error.message) + '), trying again shortly.');
      await new Promise(resolve => setTimeout(resolve, PROMOTE_INTERVAL));
    }
  }
}

if (require.main === module) {
  const commands = { prepare, promote, apply: () => apply(process.argv[3], process.argv[4]) };
  const command = commands[process.argv[2]];

  if (!command) {
    console.error('Use one of: ' + Object.keys(commands).join(', ') + '.');
    process.exit(1);
  }

  Promise.resolve().then(command).catch(error => {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  });
}

module.exports = { nextVersion, bumpFor, changelogFor };
