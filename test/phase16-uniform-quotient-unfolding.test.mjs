import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {unfoldUniformEuclideanQuotient} from '../dist/src/resources/periodic-tiling/topology/uniform-quotient-unfolding.js';
import {inspectDSymbol} from '../dist/src/resources/periodic-tiling/topology/d-symbol.js';
import {projectChambers} from '../dist/src/resources/periodic-tiling/topology/equivalence.js';
import {validateWireTopologyWitness} from '../dist/src/resources/periodic-tiling/topology/witness-validation.js';

const corpus=JSON.parse(readFileSync(new URL('./fixtures/periodic-topology-v1.json',import.meta.url),'utf8'));
const regular=['<1:1,1,1:3,6>','<1:1,1,1:4,4>','<1:1,1,1:6,3>'];
const twoChamber='<2:1 2,1 2,2:4 4,4>';
const squareTorus=corpus.symbolCoverCases.find(x=>x.name==='square torus').dsSymbol;
const checkerTorus=corpus.symbolCoverCases.find(x=>x.name==='checkerboard torus').dsSymbol;

function verify(result,source) {
 assert.equal(result.status,'constructed',source+': '+result.reason);
 const quotient=inspectDSymbol(source,1024).symbol;
 const expanded=inspectDSymbol(result.translationDsSymbol,1024);
 assert.equal(expanded.status,'euclidean');
 assert.equal(expanded.symbol.fixedPointFree,true);
 assert.equal(expanded.symbol.weaklyOrientable,true);
 assert.equal(result.method,'connected-reflection-torus-fiber-product');
 assert.equal(result.chamberCount,expanded.symbol.chamberCount);
 assert.equal(result.sourceProjection.length,result.chamberCount+1);
 assert.ok(projectChambers(expanded.symbol,quotient));
 assert.equal(result.primitiveCells.reduce((s,c)=>s+2*c.boundary.length,0),result.chamberCount);
 for(const cell of result.primitiveCells)
  for(const [side,edge] of cell.boundary.entries()){
   assert.ok(Number.isSafeInteger(edge.shift[0])&&Number.isSafeInteger(edge.shift[1]));
   const other=result.primitiveCells[edge.targetCell];
   assert.ok(other);
   const back=other.boundary[edge.reciprocalEdge];
   assert.equal(back.targetCell,cell.id);
   assert.equal(back.reciprocalEdge,side);
   assert.deepEqual(back.shift,[-edge.shift[0],-edge.shift[1]]);
  }
 assert.equal(validateWireTopologyWitness({
   contractVersion:1,provenance:'test-uniform-fiber-product',
   quotientDsSymbol:result.sourceSymbol,
   translationDsSymbol:result.translationDsSymbol,
   motifCells:result.primitiveCells.map(cell=>({
    id:`cell-${cell.id}`,
    boundary:cell.boundary.map((edge,i)=>({
     index:i,boundarySideIndex:i,
     targetMotifCellId:`cell-${edge.targetCell}`,
     targetTranslation:{u:edge.shift[0],v:edge.shift[1]},
     reciprocalInterfaceIndex:edge.reciprocalEdge
    }))
   }))
 }),true);
}

test('one and two chamber reflection quotients independently produce primitive connected torus covers',()=>{
 for(const source of [...regular,twoChamber]){
  const result=unfoldUniformEuclideanQuotient(source);
  verify(result,source);
 }
});

test('nontrivial expanded quotients form stable common torus covers without changing identity',()=>{
 for(const source of [squareTorus,checkerTorus]){
  const result=unfoldUniformEuclideanQuotient(source);
  verify(result,source);
  assert.deepEqual(unfoldUniformEuclideanQuotient(source),result);
 }
});
test('mixed-degree Euclidean symbols remain unsupported, rather than misclassified',()=>{
 const mixed=corpus.symbolCoverCases.find(x=>x.name==='unlisted mixed square triangle torus').dsSymbol;
 const result=unfoldUniformEuclideanQuotient(mixed);
 assert.equal(result.status,'unsupported',result.reason);
 assert.match(result.reason,/nonuniform/i);
});
test('invalid, non-euclidean, and over-limit quotients fail closed',()=>{
 for(const source of ['bad','<1:1,1,1:3,3>']){
  assert.equal(unfoldUniformEuclideanQuotient(source).status,'invalid');
 }
 assert.equal(unfoldUniformEuclideanQuotient(twoChamber,8).status,'unsupported');
 assert.equal(unfoldUniformEuclideanQuotient(twoChamber,0).status,'unsupported');
 assert.equal(unfoldUniformEuclideanQuotient(twoChamber,5000).status,'unsupported');
});
