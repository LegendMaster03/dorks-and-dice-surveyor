import test from 'node:test';
import assert from 'node:assert/strict';
import {PUBLIC_IMAGE_CASES,validateManifest,verifyPinnedFixtureBytes}
  from '../research/phase16-public-image-corpus.mjs';

test('independent real-artwork corpus records exact licensed source and pinned original bytes',()=>{
  assert.equal(validateManifest(),true);
  assert.equal(PUBLIC_IMAGE_CASES.length,3);
  assert.ok(PUBLIC_IMAGE_CASES.some(c=>c.medium==='externally-authored-vector'
    && c.morphology.includes('non-edge-to-edge')));
  assert.ok(PUBLIC_IMAGE_CASES.filter(c=>c.medium==='photograph').length>=2);
  for(const item of PUBLIC_IMAGE_CASES){
    assert.match(item.source,/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    assert.match(item.sha1,/^[a-f0-9]{40}$/);
    assert.match(item.license,/^CC BY-SA /);
    assert.ok(item.author.length>0);
  }
});
test('real holdout asset substitution, corrupt hashes and malformed metadata fail closed offline',()=>{
  const known='a94a8fe5ccb19ba61c4c0873d391e987982fbbd3';
  assert.equal(verifyPinnedFixtureBytes(Buffer.from('test'),known),true);
  assert.equal(verifyPinnedFixtureBytes(Buffer.from('TEST'),known),false);
  assert.equal(verifyPinnedFixtureBytes(Buffer.alloc(0),known),false);
  assert.equal(verifyPinnedFixtureBytes(Buffer.from('test'),'not-a-hash'),false);
  assert.equal(validateManifest([...PUBLIC_IMAGE_CASES,PUBLIC_IMAGE_CASES[0]]),false);
  assert.equal(validateManifest(PUBLIC_IMAGE_CASES.map((c,i)=>i===0?{...c,
      source:'https://example.com/surprise.svg'}:c)),false);
  assert.equal(validateManifest(PUBLIC_IMAGE_CASES.map((c,i)=>i===0?{...c,
      sha1:'0'.repeat(40)}:c)),true,
    'An arbitrary but syntactically valid SHA-1 remains untrusted until actual bytes are checked');
  assert.equal(validateManifest(PUBLIC_IMAGE_CASES.map((c,i)=>i===0?{...c,
      license:'no-redistribution'}:c)),false);
});
