import test from 'node:test';
import assert from 'node:assert/strict';
import {realizeGeneralEuclideanQuotient} from '../dist/src/resources/periodic-tiling/topology/harmonic-metric-realization.js';
import {verifyPeriodicWitness,deriveTranslationMotif} from '../dist/src/resources/periodic-tiling/topology/motif.js';

const examples=[
 ['square', '<1:1,1,1:4,4>'],
 ['triangle', '<1:1,1,1:3,6>'],
 ['hexagon', '<1:1,1,1:6,3>'],
 ['two-chamber', '<2:1 2,1 2,2:4 4,4>'],
 ['checkerboard', '<16:2 7 6 10 12 11 15 16,3 5 9 12 13 14 15 16,4 6 8 11 12 10 16 15:4 4,4 4>'],
 ['mixed-square-triangle', '<20:2 7 6 10 12 13 15 17 20 19,3 5 9 12 10 13 16 18 19 20,4 6 8 11 12 14 15 17 19 20:3 3 4,5 5>'],
 ['mixed-quotient', '<10:2 5 4 6 7 8 10,1 4 6 5 9 10,3 5 7 8 9 10:3 3 4,5 5>'],
 ['nonedge-mixed-quotient','<14:2 5 7 9 11 13 14,1 4 6 8 10 12 14 13,3 5 4 6 7 8 9 14 11 13:6 4,3 4 4 3>']
];
const options={worldUnitsPerAbstractPeriod:1,units:'abstract'};

test('harmonic metric construction verifies polygon incidence and independently recomputes its symbol',()=>{
 const records=[];
 for(const [name,source] of examples){
  const result=realizeGeneralEuclideanQuotient(source,options);
  console.log('PHASE16_HARMONIC '+JSON.stringify({
    name,status:result.status,
    reason:result.status==='realized'?null:result.reason,
    faces:result.status==='realized'?result.cover.cells.length:null
  }));
  if(result.status==='realized'){
   const cover=result.cover;
   assert.equal(cover.kind,'witness-verified');
   const witness={basis:cover.basis,units:cover.units,
     cells:cover.cells.map(c=>({id:c.id,polygon:c.polygon}))};
   assert.equal(deriveTranslationMotif(witness).translationSymbol,cover.translationSymbol);
   assert.equal(verifyPeriodicWitness(source,witness).translationSymbol,cover.translationSymbol);
  }else assert.equal(result.status,'unresolved-geometry',name+': '+result.reason);
  records.push({name,status:result.status});
 }
 assert.equal(records.find(x=>x.name==='square').status,'realized');
 assert.equal(records.find(x=>x.name==='two-chamber').status,'realized');
 assert.ok(records.filter(x=>x.status==='realized').length>=3,
   'Independent harmonic realization must cover at least three Euclidean quotient presentations');
});

test('a verified polygon cover is scale- and rotation-equivariant',()=>{
 const source='<2:1 2,1 2,2:4 4,4>';
 const base=realizeGeneralEuclideanQuotient(source,options);
 const transformed=realizeGeneralEuclideanQuotient(source,{
   worldUnitsPerAbstractPeriod:7,units:'miles',rotationDegrees:37
 });
 assert.equal(base.status,'realized',base.reason);
 assert.equal(transformed.status,'realized',transformed.reason);
 assert.equal(base.cover.translationSymbol,transformed.cover.translationSymbol);
 const norm=v=>Math.hypot(v.x,v.y);
 assert.ok(Math.abs(norm(transformed.cover.basis[0])/norm(base.cover.basis[0])-7)<1e-8);
});

test('ill-posed metric and oversized quotient cannot fabricate polygons',()=>{
 for(const scale of [0, -1, NaN, Infinity, 1e12]){
  const invalid=realizeGeneralEuclideanQuotient('<1:1,1,1:4,4>',
   {worldUnitsPerAbstractPeriod:scale,units:'test'});
  assert.notEqual(invalid.status,'realized');
 }
 assert.notEqual(realizeGeneralEuclideanQuotient('<1:1,1,1:4,4>',options,1).status,'realized');
});
