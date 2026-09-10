import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { unseal } from './account-bundle.mjs';
const script = fileURLToPath(new URL('./instance-archive.mjs', import.meta.url));
test('streamed archives interoperate with account bundles and authenticate split restores before output', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enact-instance-test-'));
  try {
    const key = crypto.randomBytes(32), keyFile = path.join(dir, 'key');
    fs.writeFileSync(keyFile, key.toString('base64'), {mode:0o600});
    const payload = crypto.randomBytes(128 * 1024), file = path.join(dir, 'data.enc');
    const invoke = (mode, input) => spawnSync(process.execPath, [script, mode, keyFile, file], {input, maxBuffer:1024*1024});
    assert.equal(invoke('encrypt', payload).status, 0);
    const encrypted = fs.readFileSync(file);
    assert.deepEqual(unseal(encrypted, key), payload);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.notEqual(invoke('encrypt', payload).status, 0);
    assert.deepEqual(fs.readFileSync(file), encrypted);
    const hash = data => crypto.createHash('sha256').update(data).digest('hex');
    const parts = [encrypted.subarray(0,50000), encrypted.subarray(50000)].map((bytes,i) => {
      const name = `part-${i}`; fs.writeFileSync(path.join(dir,name),bytes);
      return {name,sha256:hash(bytes)};
    });
    fs.writeFileSync(file+'.parts.json',JSON.stringify({sha256:hash(encrypted),parts}));
    fs.unlinkSync(file);
    assert.deepEqual(invoke('decrypt').stdout,payload);
    fs.writeFileSync(path.join(dir,parts[0].name),'corrupted');
    const broken = invoke('decrypt'); assert.notEqual(broken.status,0);assert.equal(broken.stdout.length,0);
    fs.writeFileSync(file,encrypted);
    fs.writeFileSync(keyFile,crypto.randomBytes(32).toString('base64'));
    const wrongKey=invoke('decrypt');assert.notEqual(wrongKey.status,0);assert.equal(wrongKey.stdout.length,0);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
