import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectDSymbol } from '../dist/src/resources/periodic-tiling/topology/d-symbol.js';
import { projectChambers } from '../dist/src/resources/periodic-tiling/topology/equivalence.js';
import { deriveTranslationMotif } from '../dist/src/resources/periodic-tiling/topology/motif.js';
import { reduceCombinatorialChamberSymmetry as reduce } from
  '../dist/src/resources/periodic-tiling/topology/chamber-symmetry-reduction.js';

const p=(x,y)=>({x,y});
const square={basis:[p(1,0),p(0,1)],units:'pixel',
  cells:[{id:'plain',polygon:[p(0,0),p(1,0),p(1,1),p(0,1)]}]};
const mixed={basis:[p(2,0),p(0,1)],units:'pixel',cells:[
  {id:'one',polygon:[p(0,0),p(1,0),p(1,1),p(0,1)]},
  {id:'two',polygon:[p(1,0),p(2,0),p(2,1)]},
  {id:'three',polygon:[p(1,0),p(2,1),p(1,1)]}
]};
const junction={basis:[p(2,0),p(0,1)],units:'pixel',cells:[
  {id:'long',polygon:[p(0,0),p(1,0),p(1,1),p(0,1)]},
  {id:'short-a',polygon:[p(1,0),p(2,0),p(2,.5),p(1,.5)]},
  {id:'short-b',polygon:[p(1,.5),p(2,.5),p(2,1),p(1,1)]}
]};

test('maximal combinatorial automorphisms reduce regular square torus without a pattern catalog',()=>{
  const translation=deriveTranslationMotif(square).translationSymbol;
  const result=reduce(translation);
  assert.equal(result.status,'reduced');
  assert.equal(result.quotientDsSymbol,'<1:1,1,1:4,4>');
  assert.equal(result.sourceChambers,8);
  assert.equal(result.quotientChambers,1);
  assert.equal(result.automorphismCount,8);
  assert.equal(result.evidence,'combinatorial-only');
  const again=reduce(result.quotientDsSymbol);
  assert.equal(again.status,'reduced');
  assert.equal(again.quotientDsSymbol,result.quotientDsSymbol);
});

test('mixed and non-edge-to-edge motifs preserve a provable finite covering projection',()=>{
  for(const motif of [mixed,junction]){
    const translation=deriveTranslationMotif(motif).translationSymbol;
    const result=reduce(translation);
    assert.equal(result.status,'reduced');
    assert.ok(result.quotientChambers>=1);
    assert.ok(result.quotientChambers<=result.sourceChambers);
    assert.equal(result.sourceDsSymbol,translation);
    const original=inspectDSymbol(translation);
    const quotient=inspectDSymbol(result.quotientDsSymbol);
    assert.equal(quotient.status,'euclidean');
    assert.ok(projectChambers(original.symbol,quotient.symbol));
    assert.equal(reduce(result.quotientDsSymbol).quotientDsSymbol,
      result.quotientDsSymbol,'Canonical combinatorial reduction must be idempotent');
  }
});

test('a non-Euclidean or out-of-capacity symbol cannot produce a false symmetry identity',()=>{
  assert.equal(reduce('<1:1,1,1:4,5>').status,'invalid');
  assert.equal(reduce('bad input').status,'invalid');
  assert.equal(reduce('<8:2 7 6 8,3 5 7 8,4 6 5 8:4,4>',1).status,'unsupported-limit');
  assert.equal(reduce('<1:1,1,1:4,4>',99999).status,'unsupported-limit');
});
