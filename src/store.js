'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { slug, LcError } = require('./api');

function filename(q) {
  if (!/^\d+$/.test(q.questionFrontendId)) throw new LcError('PATH', 'Invalid problem number.');
  return `${q.questionFrontendId}.${slug(q.titleSlug)}.cpp`;
}

class Store {
  constructor(root) { this.root = root; }
  async init() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    if ((await fs.lstat(this.root)).isSymbolicLink()) throw new LcError('PATH', 'The solutions directory must not be a symbolic link.');
  }
  file(q) { return path.join(this.root, filename(q)); }
  async safe(file, mustExist = false) {
    if (path.dirname(file) !== this.root) throw new LcError('PATH', 'Only registered LeetCode solution files can be used.');
    try {
      const st = await fs.lstat(file);
      if (!st.isFile() || st.isSymbolicLink()) throw new LcError('PATH', 'Refusing to use a linked or non-regular solution file.');
      const [realRoot, realFile] = await Promise.all([fs.realpath(this.root), fs.realpath(file)]);
      if (path.dirname(realFile) !== realRoot) throw new LcError('PATH', 'The solution is outside the LeetCode folder.');
    } catch (e) { if (e.code !== 'ENOENT' || mustExist) throw e; }
  }
  async readJSON(name, fallback) {
    const file = path.join(this.root, name);
    await this.safe(file);
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return fallback; throw new LcError('CACHE', 'Local problem metadata could not be read. Your C++ files are unchanged.'); }
  }
  async atomic(name, value) {
    const target = path.join(this.root, name);
    await this.safe(target);
    const tmp = `${target}.${process.pid}.${require('node:crypto').randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
      await fs.rename(tmp, target);
    } finally { await fs.unlink(tmp).catch(() => {}); }
  }
  async cache(q) {
    // Per-problem metadata avoids cross-window read/modify/write races.
    await this.atomic(`${filename(q)}.json`, q);
    const target = this.file(q);
    await this.safe(target);
    try { await fs.writeFile(target, q.starter + '\n', { flag: 'wx', mode: 0o600 }); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    return target;
  }
  async problems() {
    const names = await fs.readdir(this.root);
    const result = [];
    for (const name of names.filter(n => /^\d+\.[a-z0-9-]+\.cpp\.json$/.test(n))) {
      const q = await this.readJSON(name);
      if (q && name === filename(q) + '.json') result.push(q);
    }
    return result.sort((a,b) => Number(a.questionFrontendId) - Number(b.questionFrontendId));
  }
  async registered(file) {
    const name = path.basename(file);
    if (path.dirname(file) !== this.root || !/^\d+\.[a-z0-9-]+\.cpp$/.test(name)) throw new LcError('SELECTION', 'Open a LeetCode solution with Open Problem or Reopen Local Problem first.');
    const q = await this.readJSON(name + '.json');
    if (!q || filename(q) !== name) throw new LcError('SELECTION', 'This file is not a registered LeetCode solution.');
    await this.safe(file, true);
    return q;
  }
  async custom(q) {
    const file = path.join(this.root, filename(q) + '.input.txt');
    await this.safe(file);
    try { await fs.writeFile(file, q.exampleTestcases || q.sampleTestCase || '', { flag: 'wx', mode: 0o600 }); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    return file;
  }
  async acquire(job) {
    const file = path.join(this.root, 'pending.json');
    await this.safe(file);
    try { await fs.writeFile(file, JSON.stringify(job), { flag: 'wx', mode: 0o600 }); }
    catch (e) {
      if (e.code === 'EEXIST') throw new LcError('BUSY', 'An operation is already pending. Use Retrieve Pending Result before sending another.');
      throw e;
    }
  }
  pending() { return this.readJSON('pending.json', undefined); }
  async claimCompletion(token) {
    if (!/^[a-f0-9-]{36}$/.test(token)) throw new LcError('CACHE', 'Invalid pending operation record.');
    const file = path.join(this.root, `completed-${token}.json`);
    try { await fs.writeFile(file, '{}', { flag: 'wx', mode: 0o600 }); return true; }
    catch (e) { if (e.code === 'EEXIST') return false; throw e; }
  }
  async release() { await this.safe(path.join(this.root, 'pending.json')); await fs.unlink(path.join(this.root, 'pending.json')).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}

module.exports = { Store, filename };
