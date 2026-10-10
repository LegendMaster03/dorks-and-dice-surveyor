import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {inspectDSymbol} from '../dist/src/resources/periodic-tiling/topology/d-symbol.js';
import {compareDSymbols,projectChambers} from '../dist/src/resources/periodic-tiling/topology/equivalence.js';
import {verifyPeriodicWitness,deriveTranslationMotif,enumerateCells,addressKey,adjacentAddress} from '../dist/src/resources/periodic-tiling/topology/motif.js';
const p=(x,y)=>({x,y});
const square={basis:[p(1,0),p(0,1)],units:'mile',cells:[{id:'square',polygon:[p(0,0),p(1,0),p(1,1),p(0,1)]}]};
const skew={basis:[p(1,0),p(.4,1)],units:'mile',cells:[{id:'square',polygon:[p(0,0),p(1,0),p(1.4,1),p(.4,1)]}]};
const checker={basis:[p(1,1),p(1,-1)],units:'mile',cells:[{id:'even',polygon:[p(0,0),p(1,0),p(1,1),p(0,1)]},{id:'odd',polygon:[p(1,0),p(2,0),p(2,1),p(1,1)]}]};
const mixed={basis:[p(2,0),p(0,1)],units:'mile',cells:[{id:'square',polygon:[p(0,0),p(1,0),p(1,1),p(0,1)]},{id:'a',polygon:[p(1,0),p(2,0),p(2,1)]},{id:'b',polygon:[p(1,0),p(2,1),p(1,1)]}]};
const tJunction={basis:[p(2,0),p(0,1)],units:'mile',cells:[{id:'left',polygon:[p(0,0),p(1,0),p(1,1),p(0,1)]},{id:'bottom',polygon:[p(1,0),p(2,0),p(2,.5),p(1,.5)]},{id:'top',polygon:[p(1,.5),p(2,.5),p(2,1),p(1,1)]}]};
const s1='<1:1,1,1:4,4>', s2='<2:1 2,1 2,2:4 4,4>';
test('D-symbol classification distinguishes syntax, axioms, curvature and limits',()=>{
 assert.equal(inspectDSymbol(s1).status,'euclidean');
 assert.equal(inspectDSymbol('<1:1,1,1:3,6>').status,'euclidean');
 assert.equal(inspectDSymbol('<1:1,1,1:6,3>').status,'euclidean');
 assert.equal(inspectDSymbol(s2).status,'euclidean');
 assert.equal(inspectDSymbol('<1:1,1,1:4,5>').status,'non-euclidean');
 assert.equal(inspectDSymbol('<1:1,1,1:3,3>').geometry,'spherical');
 assert.equal(inspectDSymbol('<1:1,1,1:6,6>').geometry,'hyperbolic');
 assert.equal(inspectDSymbol('<3:2 3,1 2 3,1 3:4 4,4 4>').status,'structure-invalid'); // apparent K=0
 assert.equal(inspectDSymbol('<1:2,1,1:4,4>').status,'structure-invalid');
 assert.equal(inspectDSymbol('garbage').status,'syntax-invalid');
 assert.equal(inspectDSymbol(s2,1).status,'limit-exceeded');
 assert.equal(inspectDSymbol('x'.repeat(131_073)).status,'limit-exceeded');
 assert.equal(inspectDSymbol(null).status,'syntax-invalid');
 assert.equal(inspectDSymbol('<1.1:1:1,1,1:4,4>').symbol.canonical,s1);
});
test('operational motifs prove D-symbol projections without named registrations',()=>{
 const one=verifyPeriodicWitness(s1,square), two=verifyPeriodicWitness(s2,checker);
 assert.equal(one.cells[0].boundary.length,4);
 assert.equal(two.cells.length,2);
 assert.equal(two.quotientSymbol,s2);
 assert.equal(compareDSymbols(s1,s2).status,'inconclusive');
 assert.equal(compareDSymbols(s1,s2,{commonCover:two.translationSymbol}).status,'proven-equivalent');
 assert.equal(compareDSymbols(s1,'<1:1,1,1:3,6>').status,'structurally-incompatible');
 assert.equal(compareDSymbols(s1,s1).status,'exact-identity');
 assert.equal(compareDSymbols(s1,s1,{leftMetric:[{key:'cellSide',unit:'m',min:1,max:1}],rightMetric:[{key:'cellSide',unit:'m',min:2,max:2}]}).status,'metrically-incompatible');
 assert.ok(projectChambers(inspectDSymbol(two.translationSymbol).symbol,inspectDSymbol(s1).symbol));
});
test('geometric shape may vary without changing combinatorial square topology',()=>{
 const a=verifyPeriodicWitness(s1,square);
 const b=verifyPeriodicWitness(s1,skew);
 assert.equal(a.quotientSymbol,b.quotientSymbol);
 assert.notDeepEqual(a.basis,b.basis);
});
test('triangle, hexagon, and rhombille operational witnesses are independent of registered detectors',()=>{
 const h=Math.sqrt(3)/2;
 const vertices=Array.from({length:6},(_,i)=>p(Math.cos(Math.PI*i/3),Math.sin(Math.PI*i/3)));
 const hex={basis:[p(1.5,h),p(1.5,-h)],units:'mile',cells:[{id:'hexagon',polygon:vertices}]};
 const triangle={basis:[p(1,0),p(.5,h)],units:'mile',cells:[
  {id:'triangle-a',polygon:[p(0,0),p(1,0),p(1.5,h)]},
  {id:'triangle-b',polygon:[p(0,0),p(1.5,h),p(.5,h)]}
 ]};
 const rhombille={basis:hex.basis,units:'mile',cells:[0,2,4].map((i,index)=>({
  id:`rhombus-${index}`,polygon:[p(0,0),vertices[i],vertices[(i+1)%6],vertices[(i+2)%6]]
 }))};
 assert.equal(verifyPeriodicWitness('<1:1,1,1:3,6>',triangle).cells.length,2);
 assert.equal(verifyPeriodicWitness('<1:1,1,1:6,3>',hex).cells[0].boundary.length,6);
 const cover=deriveTranslationMotif(rhombille);
 assert.equal(cover.cells.length,3);
 assert.deepEqual(cover.cells.map(c=>c.boundary.length),[4,4,4]);
 assert.equal(inspectDSymbol(cover.translationSymbol).status,'euclidean');
 assert.equal(cover.translationSymbol,
  '<24:2 7 6 10 14 16 18 20 17 19 24 23,3 5 9 12 13 15 17 19 21 22 24 23,4 6 8 11 14 15 18 21 22 19 23 24:4 4 4,3 6 3>');
});
test('a noncatalog mixed triangle/quadrilateral motif reconstructs deterministic incidence',()=>{
 const a=deriveTranslationMotif(mixed);
 const b=deriveTranslationMotif(mixed);
 assert.equal(a.translationSymbol,b.translationSymbol);
 assert.equal(a.cells.length,3);
 assert.deepEqual(a.cells.map(c=>c.boundary.length),[4,3,3]);
 assert.equal(verifyPeriodicWitness(a.translationSymbol,mixed).translationSymbol,a.translationSymbol);
 assert.equal(inspectDSymbol(a.translationSymbol).status,'euclidean');
 const ids=enumerateCells(a,-2,2,-1,1).map(addressKey);
 assert.equal(ids.length,45); assert.equal(new Set(ids).size,45);
 assert.throws(()=>enumerateCells(a,-1000,1000,-1000,1000));
 assert.throws(()=>enumerateCells(a,0,99999,0,99999,Number.MAX_SAFE_INTEGER),/maximum safe cell count/);
 assert.throws(()=>enumerateCells(a,Number.MIN_SAFE_INTEGER,Number.MAX_SAFE_INTEGER,0,0));
 assert.throws(()=>addressKey({motifCell:'a',lattice:[Number.MAX_SAFE_INTEGER+1,0]}));
 for(const cell of a.cells)for(const edge of cell.boundary){
  const from={motifCell:cell.id,lattice:[7,-4]};
  const next=adjacentAddress(from,edge);
  const reciprocal=a.cells.find(c=>c.id===next.motifCell).boundary[edge.reciprocalEdgeIndex];
  assert.equal(addressKey(adjacentAddress(next,reciprocal)),addressKey(from));
 }
});
test('periodic T-junction splits boundaries into reciprocal interfaces',()=>{
 const a=deriveTranslationMotif(tJunction);
 assert.equal(a.cells[0].boundary.length,6);
 assert.equal(a.cells[1].boundary.length,4);
 assert.equal(a.cells[2].boundary.length,4);
 assert.equal(inspectDSymbol(a.translationSymbol).status,'euclidean');
});
test('invalid witnesses fail rather than silently adapting topology',()=>{
 assert.throws(()=>verifyPeriodicWitness('<1:1,1,1:3,6>',square),/does not project/);
 assert.throws(()=>deriveTranslationMotif({...square,basis:[p(1,0),p(2,0)]}),/linearly independent/);
 assert.throws(()=>deriveTranslationMotif({...square,cells:[...square.cells,{id:'dup',polygon:square.cells[0].polygon}]}));
 assert.throws(()=>deriveTranslationMotif({...square,cells:[{id:'square',polygon:[p(0,0),p(1,0),p(0,1),p(1,1)]}]}));
 assert.throws(()=>deriveTranslationMotif({...square,cells:[{id:'square',polygon:[p(0,0),p(1.1,0),p(1.1,1),p(0,1)]}]}));
});
test('versioned fixture vectors remain independently readable',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/periodic-topology-v1.json',import.meta.url),'utf8'));
 assert.equal(fixture.contractVersion,1);
 for(const item of fixture.cases) assert.equal(inspectDSymbol(item.dsSymbol).status,item.classification,item.name);
 const common=fixture.commonCover;
 assert.equal(compareDSymbols(common.left,common.right,{commonCover:common.witness}).status,common.expected);
 for(const item of fixture.addressCases) assert.equal(addressKey(item),item.key);
});
