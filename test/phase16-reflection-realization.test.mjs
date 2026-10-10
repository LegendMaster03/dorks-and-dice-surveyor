import assert from 'node:assert/strict';
import test from 'node:test';
import { realizeOneChamberReflectionSymbol } from '../dist/src/resources/periodic-tiling/topology/reflection-realization.js';
import { validateWireTopologyWitness } from '../dist/src/resources/periodic-tiling/topology/witness-validation.js';

const vectors = [[3, 6, 2], [4, 4, 1], [6, 3, 1]];
function wire(cover) {
 return {contractVersion:1,provenance:'test-reflection-unfolding',quotientDsSymbol:cover.quotientSymbol,
 translationDsSymbol:cover.translationSymbol,motifCells:cover.cells.map(cell=>({id:cell.id,boundary:cell.boundary.map(edge=>({
 index:edge.edgeIndex,boundarySideIndex:edge.sideIndex,targetMotifCellId:edge.target.motifCell,
 targetTranslation:{u:edge.target.lattice[0],v:edge.target.lattice[1]},reciprocalInterfaceIndex:edge.reciprocalEdgeIndex
 }))}))};
}

test('one-chamber Euclidean reflection quotients unfold by D-symbol mathematics, not a registered geometry ID',()=>{
 for(const [p,q,motifCount] of vectors){
  const source=`<1:1,1,1:${p},${q}>`;
  const result=realizeOneChamberReflectionSymbol(source,{edgeLengthWorldUnits:1,units:'mile'});
  assert.equal(result.status,'realized',`${source}: ${result.reason}`);
  assert.equal(result.cover.quotientSymbol,source);
  assert.equal(result.cover.cells.length,motifCount);
  assert.equal(result.cover.cells.reduce((n,c)=>n+c.boundary.length,0),motifCount*p);
  assert.equal(result.cover.units,'mile');
  assert.equal(validateWireTopologyWitness(wire(result.cover)),true);
 }
});

test('metric constraints change only the embedding, not the D-symbol identity or cell connectivity',()=>{
 for(const [p,q] of vectors){
  const source=`<1:1,1,1:${p},${q}>`;
  const base=realizeOneChamberReflectionSymbol(source,{edgeLengthWorldUnits:1,units:'world'});
  const variant=realizeOneChamberReflectionSymbol(source,{edgeLengthWorldUnits:7,units:'meters',rotationDegrees:37});
  assert.equal(base.status,'realized',base.reason);
  assert.equal(variant.status,'realized',variant.reason);
  assert.equal(variant.cover.translationSymbol,base.cover.translationSymbol);
  assert.deepEqual(variant.cover.cells.map(c=>c.boundary.map(e=>[e.target.motifCell,...e.target.lattice])),
      base.cover.cells.map(c=>c.boundary.map(e=>[e.target.motifCell,...e.target.lattice])));
  const length=(p)=>Math.hypot(p.x,p.y);
  assert.ok(Math.abs(length(variant.cover.basis[0])/length(base.cover.basis[0])-7)<1e-5);
 }
});

test('general chamber quotients remain unresolved, invalid inputs never become geometric witnesses',()=>{
 const mixed='<2:1 2,1 2,2:4 4,4>';
 assert.equal(realizeOneChamberReflectionSymbol(mixed,{edgeLengthWorldUnits:1,units:'world'}).status,'unresolved-geometry');
 for(const invalid of ['garbage','<1:1,1,1:3,3>'])
  assert.equal(realizeOneChamberReflectionSymbol(invalid,{edgeLengthWorldUnits:1,units:'world'}).status,'unsupported');
 for(const invalidScale of [0,NaN,Infinity,-1,1e9])
  assert.equal(realizeOneChamberReflectionSymbol('<1:1,1,1:4,4>',{edgeLengthWorldUnits:invalidScale,units:'world'}).status,'unresolved-geometry');
});
