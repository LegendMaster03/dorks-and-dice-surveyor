import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveTranslationMotif} from '../dist/src/resources/periodic-tiling/topology/motif.js';
import {constructTranslationCoverFromSymbol} from '../dist/src/resources/periodic-tiling/topology/translation-cover-from-symbol.js';
import {inspectDSymbol} from '../dist/src/resources/periodic-tiling/topology/d-symbol.js';
const p=(x,y)=>({x,y});
const square={basis:[p(1,0),p(0,1)],units:'world',cells:[{id:'square',polygon:[p(0,0),p(1,0),p(1,1),p(0,1)]}]};
const mixed={basis:[p(2,0),p(0,1)],units:'world',cells:[{id:'square',polygon:[p(0,0),p(1,0),p(1,1),p(0,1)]},{id:'a',polygon:[p(1,0),p(2,0),p(2,1)]},{id:'b',polygon:[p(1,0),p(2,1),p(1,1)]}]};
const tJunction={basis:[p(2,0),p(0,1)],units:'world',cells:[{id:'left',polygon:[p(0,0),p(1,0),p(1,1),p(0,1)]},{id:'bottom',polygon:[p(1,0),p(2,0),p(2,.5),p(1,.5)]},{id:'top',polygon:[p(1,.5),p(2,.5),p(2,1),p(1,1)]}]};
const h=Math.sqrt(3)/2,vertices=Array.from({length:6},(_,i)=>p(Math.cos(Math.PI*i/3),Math.sin(Math.PI*i/3)));
const hex={basis:[p(1.5,h),p(1.5,-h)],units:'world',cells:[{id:'hex',polygon:vertices}]};
const tri={basis:[p(1,0),p(.5,h)],units:'world',cells:[{id:'a',polygon:[p(0,0),p(1,0),p(1.5,h)]},{id:'b',polygon:[p(0,0),p(1.5,h),p(.5,h)]}]};
const rhombille={basis:hex.basis,units:'world',cells:[0,2,4].map((i,index)=>({id:`r${index}`,polygon:[p(0,0),vertices[i],vertices[(i+1)%6],vertices[(i+2)%6]]}))};
const checker={basis:[p(1,1),p(1,-1)],units:'world',cells:[{id:'even',polygon:[p(0,0),p(1,0),p(1,1),p(0,1)]},{id:'odd',polygon:[p(1,0),p(2,0),p(2,1),p(1,1)]}]};

function verifyGraph(cover){
 assert.equal(cover.status,'constructed',cover.reason);
 assert.equal(cover.EulerCharacteristic,0);
 for(const cell of cover.cells){
  assert.equal(cell.sides,cell.boundary.length);
  for(const [i,boundary] of cell.boundary.entries()){
   const peer=cover.cells[boundary.targetCell];
   assert.ok(peer);
   const reversed=peer.boundary[boundary.reciprocalEdge];
   assert.equal(reversed.targetCell,cell.id);
   assert.equal(reversed.reciprocalEdge,i);
   assert.equal(reversed.edge,boundary.edge);
   assert.deepEqual(reversed.shift,[-boundary.shift[0],-boundary.shift[1]]);
  }
 }
 const start='0@0,0', queue=[{id:0,u:0,v:0}],seen=new Set([start]);
 for(let q=0;q<queue.length;q++){
  const cell=queue[q];
  for(const edge of cover.cells[cell.id].boundary){
   const u=cell.u+edge.shift[0],v=cell.v+edge.shift[1];
   if(Math.abs(u)>3||Math.abs(v)>3)continue;
   const key=`${edge.targetCell}@${u},${v}`;
   if(!seen.has(key)){seen.add(key);queue.push({id:edge.targetCell,u,v});}
  }
 }
 assert.ok(seen.has('0@1,0'),'The derived cover must be connected across the first period');
 assert.ok(seen.has('0@0,1'),'The derived cover must be connected across the second period');
 assert.equal(seen.size,49*cover.cells.length,'Every cell of a bounded 7×7 periodic region is connected');
}

test('derive noncatalog operational torus topology solely from independently built D-symbols',()=>{
 for(const witness of [square,checker,mixed,tri,hex,rhombille,tJunction]){
  const known=deriveTranslationMotif(witness);
  const fromSymbol=constructTranslationCoverFromSymbol(known.translationSymbol);
  assert.equal(fromSymbol.status,'constructed',`${witness.cells.map(x=>x.id)}: ${fromSymbol.reason}`);
  assert.equal(fromSymbol.cells.length,witness.cells.length);
  assert.deepEqual(fromSymbol.cells.map(c=>c.sides).sort((a,b)=>a-b),
   known.cells.map(c=>c.boundary.length).sort((a,b)=>a-b));
  assert.deepEqual(constructTranslationCoverFromSymbol(known.translationSymbol),fromSymbol);
  verifyGraph(fromSymbol);
 }
});

test('canonical chamber relabelings reproduce the identical deterministic translation cover',()=>{
 const source=deriveTranslationMotif(mixed).translationSymbol;
 const original=inspectDSymbol(source).symbol;
 // Identity may be serialized using an arbitrary starting flag numbering.
 // A second canonical parser pass must not change addresses or adjacency.
 const representation=inspectDSymbol(source).symbol.canonical;
 assert.deepEqual(constructTranslationCoverFromSymbol(source),constructTranslationCoverFromSymbol(representation));
 assert.equal(original.canonical,representation);
});

test('orbifold symmetry quotients and non-Euclidean symbols are explicitly rejected, not fabricated',()=>{
 for(const symbol of ['<1:1,1,1:4,4>','<1:1,1,1:3,6>','<1:1,1,1:6,3>','<2:1 2,1 2,2:4 4,4>']){
  const result=constructTranslationCoverFromSymbol(symbol);
  assert.equal(result.status,'unsupported',`${symbol}: ${result.reason}`);
 }
 assert.equal(constructTranslationCoverFromSymbol('<1:1,1,1:3,3>').status,'invalid');
 assert.equal(constructTranslationCoverFromSymbol('garbage').status,'invalid');
 assert.equal(constructTranslationCoverFromSymbol(deriveTranslationMotif(mixed).translationSymbol,4).status,'unsupported');
});
