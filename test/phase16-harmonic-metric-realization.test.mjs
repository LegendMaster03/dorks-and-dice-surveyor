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

test('anisotropic oblique period fitting preserves a verified translation topology',()=>{
 const source='<2:1 2,1 2,2:4 4,4>';
 const reference=realizeGeneralEuclideanQuotient(source,options);
 const result=realizeGeneralEuclideanQuotient(source,{
   worldUnitsPerAbstractPeriod:2,units:'km',rotationDegrees:17,
   periodULength:4,periodVLength:3,periodAngleDegrees:65
 });
 assert.equal(reference.status,'realized',reference.reason);
 assert.equal(result.status,'realized',result.reason);
 assert.equal(result.cover.translationSymbol,reference.cover.translationSymbol);
 const {basis,cells,units}=result.cover;
 const norm=p=>Math.hypot(p.x,p.y);
 assert.ok(Math.abs(norm(basis[0])-4)<1e-8);
 assert.ok(Math.abs(norm(basis[1])-3)<1e-8);
 const angle=Math.acos((basis[0].x*basis[1].x+basis[0].y*basis[1].y)/
   (norm(basis[0])*norm(basis[1])))*180/Math.PI;
 assert.ok(Math.abs(angle-65)<1e-8);
 assert.equal(verifyPeriodicWitness(source,{basis,units,
   cells:cells.map(c=>({id:c.id,polygon:c.polygon}))}).translationSymbol,
   reference.cover.translationSymbol);
});

test('affine fitting also preserves unfamiliar mixed and non-edge-to-edge quotient incidences',()=>{
 const sources=examples.filter(([name])=>name==='mixed-quotient'
   || name==='nonedge-mixed-quotient');
 for(const [name,source] of sources){
   const baseline=realizeGeneralEuclideanQuotient(source,options);
   const fitted=realizeGeneralEuclideanQuotient(source,{
     worldUnitsPerAbstractPeriod:1,units:'world',
     periodULength:1.25,periodVLength:1.75,
     periodAngleDegrees:73,rotationDegrees:-22
   });
   assert.equal(baseline.status,'realized',name+': '+baseline.reason);
   assert.equal(fitted.status,'realized',name+': '+fitted.reason);
   assert.equal(fitted.cover.translationSymbol,baseline.cover.translationSymbol);
   assert.deepEqual(fitted.cover.cells.map(c=>c.boundary.length),
     baseline.cover.cells.map(c=>c.boundary.length));
 }
});

test('small but nondegenerate world-unit periods remain admissible under normalized proof',()=>{
 const source='<2:1 2,1 2,2:4 4,4>';
 const result=realizeGeneralEuclideanQuotient(source,{
   worldUnitsPerAbstractPeriod:1e-5,units:'km',
   periodULength:1.25e-5,periodVLength:2e-5,periodAngleDegrees:70,
   rotationDegrees:33
 });
 assert.equal(result.status,'realized',result.reason);
 const u=result.cover.basis[0],v=result.cover.basis[1];
 assert.ok(u.x*v.y-u.y*v.x>0);
 assert.ok(Math.abs(Math.hypot(u.x,u.y)-1.25e-5)<1e-12);
});

test('degenerate or unbounded requested periods never generate authoritative geometry',()=>{
 const source='<1:1,1,1:4,4>';
 for(const metric of [
   {periodULength:0},{periodVLength:-1},{periodAngleDegrees:0},
   {periodAngleDegrees:180},{periodAngleDegrees:NaN},
   {periodULength:Infinity},{periodVLength:1e12}
 ]){
   const result=realizeGeneralEuclideanQuotient(source,{...options,...metric});
   assert.notEqual(result.status,'realized',JSON.stringify(metric));
 }
});

test('ill-posed metric and oversized quotient cannot fabricate polygons',()=>{
 for(const scale of [0, -1, NaN, Infinity, 1e12]){
  const invalid=realizeGeneralEuclideanQuotient('<1:1,1,1:4,4>',
   {worldUnitsPerAbstractPeriod:scale,units:'test'});
  assert.notEqual(invalid.status,'realized');
 }
 assert.notEqual(realizeGeneralEuclideanQuotient('<1:1,1,1:4,4>',options,1).status,'realized');
});
