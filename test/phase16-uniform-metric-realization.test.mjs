import test from 'node:test';
import assert from 'node:assert/strict';
import {realizeUniformEuclideanQuotient} from '../dist/src/resources/periodic-tiling/topology/uniform-metric-realization.js';
import {deriveTranslationMotif,verifyPeriodicWitness} from '../dist/src/resources/periodic-tiling/topology/motif.js';

const cases=[
 ['<1:1,1,1:3,6>',2],
 ['<1:1,1,1:4,4>',1],
 ['<1:1,1,1:6,3>',1],
 ['<2:1 2,1 2,2:4 4,4>',2],
 ['<8:2 7 6 8,3 5 7 8,4 6 5 8:4,4>',1],
 ['<16:2 7 6 10 12 11 15 16,3 5 9 12 13 14 15 16,4 6 8 11 12 10 16 15:4 4,4 4>',2]
];

test('metric realizations unfold regular symmetry quotients with proof of polygon closure and primitive periods',()=>{
 for(const [symbol] of cases){
  const r=realizeUniformEuclideanQuotient(symbol,{edgeLengthWorldUnits:1,units:'world'});
  assert.equal(r.status,'realized',symbol+': '+r.reason);
  const cover=r.cover;
  assert.equal(cover.quotientSymbol,symbol);
  assert.equal(cover.kind,'witness-verified');
  assert.equal(cover.cells.reduce((n,c)=>n+c.polygon.length,0)>0,true);
  const derived=deriveTranslationMotif({
    basis:cover.basis,units:cover.units,
    cells:cover.cells.map(c=>({id:c.id,polygon:c.polygon}))
  });
  assert.equal(derived.translationSymbol,cover.translationSymbol);
  assert.equal(verifyPeriodicWitness(symbol,{
    basis:cover.basis,units:cover.units,
    cells:cover.cells.map(c=>({id:c.id,polygon:c.polygon}))
  }).translationSymbol,cover.translationSymbol);
 }
});

test('metric constraints alter embedding without changing graph identity',()=>{
 const symbol='<2:1 2,1 2,2:4 4,4>';
 const base=realizeUniformEuclideanQuotient(symbol,{edgeLengthWorldUnits:1,units:'world'});
 const moved=realizeUniformEuclideanQuotient(symbol,{edgeLengthWorldUnits:6,units:'miles',rotationDegrees:37});
 assert.equal(base.status,'realized',base.reason);
 assert.equal(moved.status,'realized',moved.reason);
 assert.equal(moved.cover.translationSymbol,base.cover.translationSymbol);
 assert.deepEqual(moved.cover.cells.map(c=>c.boundary.map(e=>[e.target.motifCell,...e.target.lattice])),
  base.cover.cells.map(c=>c.boundary.map(e=>[e.target.motifCell,...e.target.lattice])));
 const mag=p=>Math.hypot(p.x,p.y);
 assert.ok(Math.abs(mag(moved.cover.basis[0])/mag(base.cover.basis[0])-6)<1e-5);
});

test('mixed degrees, ill-posed geometry and over-limit covers are never fabricated',()=>{
 const mixed='<20:2 7 6 10 12 13 15 17 20 19,3 5 9 12 10 13 16 18 19 20,4 6 8 11 12 14 15 17 19 20:3 3 4,5 5>';
 assert.notEqual(realizeUniformEuclideanQuotient(mixed,{edgeLengthWorldUnits:1,units:'world'}).status,'realized');
 for(const input of [0,-1,NaN,Infinity,1e9]){
  assert.notEqual(realizeUniformEuclideanQuotient('<2:1 2,1 2,2:4 4,4>',{edgeLengthWorldUnits:input,units:'world'}).status,'realized');
 }
 assert.notEqual(realizeUniformEuclideanQuotient('<2:1 2,1 2,2:4 4,4>',{edgeLengthWorldUnits:1,units:'world'},8).status,'realized');
});

test('equivalent input chamber relabeling and repeated construction are geometrically deterministic',()=>{
 const symbol='<16:2 7 6 10 12 11 15 16,3 5 9 12 13 14 15 16,4 6 8 11 12 10 16 15:4 4,4 4>';
 const options={edgeLengthWorldUnits:1,units:'world'};
 const first=realizeUniformEuclideanQuotient(symbol,options);
 const second=realizeUniformEuclideanQuotient(symbol,options);
 assert.equal(first.status,'realized',first.reason);
 assert.deepEqual(first,second);
 assert.ok(first.cover.cells.length>1,'Checkerboard topology must retain distinct cell addresses');
});
