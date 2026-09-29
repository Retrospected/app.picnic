#!/usr/bin/env node
'use strict';

// What .github/workflows/deploy-test.yml needs around `homey app publish` to
// turn every merge to master into a Test version on Homey, without a person in
// the Developer Tools:
//
//   node scripts/homey-release.js prepare    picks the version and the changelog
//   node scripts/homey-release.js promote    moves that build from Draft to Test
//
// Both talk to Athom's API as the owner of the Personal Access Token in
// HOMEY_PAT, the same token the publish action is given.
//
// Homey takes every version only once, and only ever a higher one, so each
// publish needs a version no build has had. `prepare` takes the version in
// .homeycompose/app.json when no build has it yet, which is how a release
// someone bumped by hand goes out under its own number, and otherwise the
// patch after the highest build there is. It writes that version into the
// working tree of the CI run only: nothing is committed back, so the version
// in the repository stays what the last person to bump it made it.
//
// The CLI refuses to publish in headless mode without a changelog for the
// version, so for a version the repository has no changelog for, `prepare`
// writes one from the pull request that was merged.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const appPath = path.join(__dirname, '..');
const composePath = path.join(appPath, '.homeycompose', 'app.json');
const manifestPath = path.join(appPath, 'app.json');
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

// the version to publish, given the one in the repository and those of every
// build Homey already has
function nextVersion(current, published) {
  const versions = published.filter(version => parseVersion(version) !== null);
  if (versions.length === 0) return current;

  const highest = versions.reduce((a, b) => compareVersions(a, b) >= 0 ? a : b);
  if (compareVersions(current, highest) > 0) return current;

  const [major, minor, patch] = parseVersion(highest);
  return major + '.' + minor + '.' + (patch + 1);
}

// what a tester reads about a build: the title of the pull request that was
// merged, which GitHub puts under the "Merge pull request" line, or the commit
// itself when it went in some other way
function changelogFor(commitMessage) {
  const lines = String(commitMessage).split('\n').map(line => line.trim()).filter(Boolean);
  const subject = lines[0] || '';
  const text = /^Merge pull request #\d+/.test(subject) && lines[1] ? lines[1] : subject;

  // the CLI turns down anything of three characters or fewer
  return text.length > 3 ? text : 'Test version built from master';
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function setVersion(file, version) {
  const text = fs.readFileSync(file, 'utf8');
  const updated = text.replace(/("version"\s*:\s*")[^"]*(")/, '$1' + version + '$2');
  fs.writeFileSync(file, updated);
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

async function prepare() {
  const appId = readJson(composePath).id;
  const current = readJson(composePath).version;
  const { builds } = await getBuilds(appId);
  const version = nextVersion(current, builds.map(build => build.version));

  if (version !== current) {
    setVersion(composePath, version);
    setVersion(manifestPath, version);
  }

  const changelog = readJson(changelogPath);
  if (!changelog[version] || !changelog[version].en) {
    const message = execFileSync('git', ['log', '-1', '--format=%B'], { cwd: appPath, encoding: 'utf8' });
    changelog[version] = { en: changelogFor(message) };
    fs.writeFileSync(changelogPath, JSON.stringify(changelog, null, 2) + '\n');
  }

  console.log('Publishing ' + appId + '@' + version + ': ' + changelog[version].en);
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
  const commands = { prepare, promote };
  const command = commands[process.argv[2]];

  if (!command) {
    console.error('Use one of: ' + Object.keys(commands).join(', ') + '.');
    process.exit(1);
  }

  command().catch(error => {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  });
}

module.exports = { nextVersion, changelogFor };
