import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {seal,unseal,safePath,accountID,credentialRevision} from './account-bundle.mjs';

test('bundle encryption authenticates the payload and rejects another key',()=>{
  const key=crypto.randomBytes(32), payload=Buffer.from('private account content');
  const encrypted=seal(payload,key);
  assert.deepEqual(unseal(encrypted,key),payload);
  assert.equal(encrypted.includes(payload),false);
  assert.throws(()=>unseal(encrypted,crypto.randomBytes(32)));
  encrypted[25]^=1;
  assert.throws(()=>unseal(encrypted,key));
});

test('import paths cannot escape the output or traverse an existing symlink',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'enact-bundle-test-'));
  try {
    assert.equal(safePath(root,'workspaces/one/file.txt'),path.join(root,'workspaces/one/file.txt'));
    for(const relative of ['../secret','/absolute','a/../../secret','a\\b']) assert.throws(()=>safePath(root,relative));
    fs.symlinkSync(os.tmpdir(),path.join(root,'link'));
    assert.throws(()=>safePath(root,'link/secret'));
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('the imported identity cannot rename the original account with the same UUID',()=>{
  const source='96001b01-8424-4789-bb1d-260cdb38ddbc';
  const demo=accountID(source,'demo@deloittecn.com.cn');
  assert.notEqual(demo,source);
  assert.equal(demo,accountID(source,'DEMO@deloittecn.com.cn'));
  assert.notEqual(demo,accountID(source,'jaden@example.com'));
});

test('credential fingerprints retain Go struct ordering and change with the principal',()=>{
  const c={config:{credential_mode:'user'},endpoint:'https://source.invalid',kind:'mcp'};
  const secret={user_credentials:{old:{headers:{Authorization:'Bearer fixture'},roles:['reader']}}};
  const encoded='{"config":{"credential_mode":"user"},"endpoint":"https://source.invalid","kind":"mcp","secret":{"user_credentials":{"old":{"headers":{"Authorization":"Bearer fixture"},"roles":["reader"]}}}}';
  assert.equal(credentialRevision(c,secret),'sha256:'+crypto.createHash('sha256').update(encoded).digest('hex'));
  assert.notEqual(credentialRevision(c,secret),credentialRevision(c,{user_credentials:{new:secret.user_credentials.old}}));
});
