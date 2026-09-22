#!/usr/bin/env node
'use strict';

// Checks every file in the repository against .editorconfig, so the rules an
// editor applies while you type are the same ones CI applies afterwards, on
// whichever editor and whichever operating system the file was written.
//
// The rules themselves are not repeated here: the official editorconfig
// parser resolves them per file, the same parser the editor plugins use. This
// only reads what it says and reports where a file disagrees.
//
// Which files: the ones git tracks, minus the ones git considers binary, and
// minus anything .editorconfig marks as not ours with `charset = unset`.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, '..');

function trackedFiles() {
  try {
    const listed = execFileSync('git', ['ls-files', '-z'], { cwd: appPath, maxBuffer: 32 * 1024 * 1024 });
    return listed.toString('utf8').split('\0').filter(Boolean);
  } catch (exception) {
    console.error('git is needed to list the files to check, and it did not answer.');
    process.exit(1);
  }
}

function isBinary(contents) {
  // the rule git itself uses: a NUL byte in the first 8000 means binary
  return contents.slice(0, 8000).includes(0);
}

function checkFile(file, properties) {
  const problems = [];
  const raw = fs.readFileSync(path.join(appPath, file));

  if (isBinary(raw)) return problems;

  const text = raw.toString('utf8');
  const report = (line, message) => problems.push(file + ':' + line + ' ' + message);

  if (properties.charset === 'utf-8' && text.charCodeAt(0) === 0xfeff) {
    report(1, 'starts with a byte order mark, which utf-8 does not need');
  }

  if (properties.end_of_line === 'lf' && text.includes('\r')) {
    const line = text.slice(0, text.indexOf('\r')).split('\n').length;
    report(line, 'ends its lines with CRLF, and .editorconfig asks for LF');
  } else if (properties.end_of_line === 'crlf' && /(^|[^\r])\n/.test(text)) {
    report(text.split(/(^|[^\r])\n/)[0].split('\n').length, 'ends a line with LF, and .editorconfig asks for CRLF');
  }

  if (text.length > 0) {
    if (properties.insert_final_newline === true && !text.endsWith('\n')) {
      report(text.split('\n').length, 'has no newline at the end of the file');
    }
    if (properties.insert_final_newline === false && text.endsWith('\n')) {
      report(text.split('\n').length - 1, 'ends with a newline, and .editorconfig asks for none');
    }
  }

  const lines = text.split(/\r\n|\n/);
  // a file ending in a newline splits into a last empty piece that is not a line
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  lines.forEach((line, index) => {
    const number = index + 1;

    if (properties.trim_trailing_whitespace === true && /[ \t]+$/.test(line)) {
      report(number, 'has trailing whitespace');
    }

    const indent = (line.match(/^[ \t]*/) || [''])[0];

    if (properties.indent_style === 'space' && indent.includes('\t')) {
      report(number, 'is indented with a tab, and .editorconfig asks for spaces');
    }
    if (properties.indent_style === 'tab' && / /.test(indent) && line.trim() !== '') {
      report(number, 'is indented with spaces, and .editorconfig asks for tabs');
    }

    if (properties.max_line_length && line.length > properties.max_line_length) {
      report(number, 'is longer than the ' + properties.max_line_length + ' characters .editorconfig allows');
    }
  });

  return problems;
}

async function main() {
  var editorconfig;

  try {
    editorconfig = require('editorconfig');
  } catch (exception) {
    console.error('The editorconfig package is missing. Run `npm install` first.');
    process.exit(1);
  }

  const files = trackedFiles();
  const problems = [];

  for (const file of files) {
    const full = path.join(appPath, file);

    // a file git tracks but the working tree does not have, mid-rebase say
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;

    const properties = await editorconfig.parse(full);

    // nothing said about it at all: not ours to have an opinion on
    if (Object.keys(properties).length === 0) continue;

    problems.push(...checkFile(file, properties));
  }

  if (problems.length > 0) {
    console.error(problems.join('\n'));
    console.error('\n' + problems.length + ' file' + (problems.length === 1 ? '' : 's') +
      ' disagree with .editorconfig. Most editors fix these on save once they read it.');
    process.exit(1);
  }

  console.log('All ' + files.length + ' files agree with .editorconfig.');
}

main();
