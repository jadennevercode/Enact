#!/usr/bin/env node
// Stream backups directly to authenticated ciphertext; never stage plaintext.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { safePath, unseal } from './account-bundle.mjs';

const [command, keyPath, file] = process.argv.slice(2);
if (!['encrypt', 'decrypt'].includes(command) || !keyPath || !file) {
  throw new Error('Usage: instance-archive.mjs encrypt|decrypt KEY_FILE ARCHIVE_FILE');
}
const key = Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'base64');
if (key.length !== 32) throw new Error('Expected a 32-byte base64 key');
if (command === 'decrypt') {
  // Authenticate the complete payload before releasing any plaintext to stdout.
  let bytes;
  if (fs.existsSync(file)) bytes = fs.readFileSync(file);
  else {
    const manifest = JSON.parse(fs.readFileSync(file + '.parts.json', 'utf8'));
    bytes = Buffer.concat(manifest.parts.map(part => {
      const data = fs.readFileSync(safePath(path.dirname(file), part.name));
      if (crypto.createHash('sha256').update(data).digest('hex') !== part.sha256) {
        throw new Error('Encrypted part checksum mismatch');
      }
      return data;
    }));
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) {
      throw new Error('Encrypted archive checksum mismatch');
    }
  }
  process.stdout.write(unseal(bytes, key));
} else {
  const magic = Buffer.from('ENACTB01');
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(magic);
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeSync(fd, Buffer.concat([magic, nonce]));
    const output = fs.createWriteStream(file, { fd, autoClose: false });
    await pipeline(process.stdin, zlib.createGzip(), cipher, output);
    fs.writeSync(fd, cipher.getAuthTag());
  } catch (error) {
    fs.unlinkSync(file);
    throw error;
  } finally {
    fs.closeSync(fd);
  }
}
