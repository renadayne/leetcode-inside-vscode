'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { RUNTIME_ALLOWLIST, SOURCE_ALLOWLIST } = require('./package');

const root = path.resolve(__dirname, '..');

for (const folder of ['src', 'test', 'scripts', 'media']) {
  const dir = path.join(root, folder);
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.js'))) {
    execFileSync(process.execPath, ['--check', path.join(dir, name)], { stdio: 'inherit' });
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const src = fs.readFileSync(path.join(root, 'src', 'extension.js'), 'utf8');

const commandIds = new Set();
for (const { command } of manifest.contributes.commands || []) {
  commandIds.add(command);
  if (!src.includes(`command('${command}'`)) {
    throw new Error(`Missing command registration in src/extension.js: ${command}`);
  }
}
if (!commandIds.has('lc.openGUI')) {
  throw new Error('Missing required OpenGUI command declaration: lc.openGUI');
}

for (const assetRel of ['media/dashboard.css', 'media/dashboard.js', 'src/dashboard.js']) {
  const assetPath = path.join(root, assetRel);
  if (!fs.existsSync(assetPath) || fs.statSync(assetPath).size === 0) {
    throw new Error(`Missing or empty dashboard asset: ${assetRel}`);
  }
}

const paletteMenu = manifest.contributes?.menus?.commandPalette;
if (!Array.isArray(paletteMenu) || paletteMenu.length === 0) {
  throw new Error('Missing contributes.menus.commandPalette entries in package.json');
}
if (paletteMenu.some(item => item.command === 'lc.openGUI' && item.when === 'false')) {
  throw new Error('lc.openGUI must remain visible in the Command Palette');
}

const containerIds = new Set();
for (const container of manifest.contributes?.viewsContainers?.activitybar || []) {
  containerIds.add(container.id);
  const iconPath = path.join(root, container.icon || '');
  if (!container.icon || !fs.existsSync(iconPath)) {
    throw new Error(`Missing view container icon asset: ${container.icon}`);
  }
}

for (const [containerId, views] of Object.entries(manifest.contributes?.views || {})) {
  if (!containerIds.has(containerId)) {
    throw new Error(`Views contributed to unknown container: ${containerId}`);
  }
  for (const view of views) {
    if (!src.includes(`'${view.id}'`)) {
      throw new Error(`Missing view registration in src/extension.js: ${view.id}`);
    }
  }
}

for (const items of Object.values(manifest.contributes?.menus || {})) {
  for (const item of items) {
    if (!commandIds.has(item.command)) {
      throw new Error(`Menu references undeclared command: ${item.command}`);
    }
  }
}

for (const rel of new Set([...RUNTIME_ALLOWLIST, ...SOURCE_ALLOWLIST])) {
  if (!fs.existsSync(path.join(root, rel))) {
    throw new Error(`Missing allowlisted package file: ${rel}`);
  }
}

console.log('JavaScript syntax, view/icon assets, package allowlist, and contributed command registrations passed.');
