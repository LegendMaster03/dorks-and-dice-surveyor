import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { constructOrientableChamberCover } from '../dist/src/resources/periodic-tiling/topology/orientation-cover.js';
import { inspectDSymbol } from '../dist/src/resources/periodic-tiling/topology/d-symbol.js';
import { projectChambers } from '../dist/src/resources/periodic-tiling/topology/equivalence.js';
import { constructTranslationCoverFromSymbol } from '../dist/src/resources/periodic-tiling/topology/translation-cover-from-symbol.js';
const corpus=JSON.parse(readFileSync(new URL('./fixtures/periodic-topology-v1.json',import.meta.url),'utf8'));

test('generic orientation double removes mirrors without inventing rotational unbranching',()=>{
 for(const entry of corpus.orientationCoverCases){
  const result=constructOrientableChamberCover(entry.dsSymbol,entry.chamberLimit??1024);
  assert.equal(result.status,entry.status,`${entry.name}: ${result.reason}`);
  if(result.status!=='constructed')continue;
  assert.equal(result.isTrivial,entry.isTrivial,entry.name);
  assert.equal(result.construction,'connected-orientation-double');
  const cover=inspectDSymbol(result.coverSymbol,2048);
  const original=inspectDSymbol(entry.dsSymbol,2048);
  assert.equal(cover.status,'euclidean');
  assert.equal(cover.symbol.fixedPointFree,true);
  assert.equal(cover.symbol.weaklyOrientable,true);
  assert.ok(projectChambers(cover.symbol,original.symbol));
  assert.equal(result.chamberCount,cover.symbol.chamberCount);
  assert.equal(result.sourceProjection.length,result.chamberCount+1);
  assert.deepEqual(constructOrientableChamberCover(entry.dsSymbol,entry.chamberLimit??1024),result);
  if(entry.isTrivial){
   assert.equal(result.remainingBranchedOrbits,0);
   assert.equal(constructTranslationCoverFromSymbol(result.coverSymbol).status,'constructed');
  } else {
   assert.ok(result.remainingBranchedOrbits>0,
    'Orientation removal alone must not be mislabeled a translation torus');
   assert.equal(constructTranslationCoverFromSymbol(result.coverSymbol).status,'unsupported');
  }
 }
});

test('orientation doubling is an idempotent connected cover operation',()=>{
 for(const original of corpus.orientationCoverCases.filter(x=>x.status==='constructed')){
  const first=constructOrientableChamberCover(original.dsSymbol);
  assert.equal(first.status,'constructed');
  const second=constructOrientableChamberCover(first.coverSymbol);
  assert.equal(second.status,'constructed');
  assert.equal(second.coverSymbol,first.coverSymbol);
  assert.equal(second.isTrivial,true);
 }
});
