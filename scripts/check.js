'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
for (const folder of ['src', 'test', 'scripts']) {
  for (const name of fs.readdirSync(folder).filter(n => n.endsWith('.js'))) {
    execFileSync(process.execPath, ['--check', path.join(folder, name)], { stdio: 'inherit' });
  }
}
const manifest = require('../package.json');
const src = fs.readFileSync('src/extension.js', 'utf8');
for (const {command} of manifest.contributes.commands) {
  if (!src.includes(`command('${command}'`)) throw new Error(`Missing command: ${command}`);
}
console.log('JavaScript syntax and contributed command registrations passed.');
