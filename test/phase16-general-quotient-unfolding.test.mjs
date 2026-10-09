import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { constructGeneralEuclideanTranslationCover } from '../dist/src/resources/periodic-tiling/topology/general-quotient-unfolding.js';
import { inspectDSymbol } from '../dist/src/resources/periodic-tiling/topology/d-symbol.js';
import { projectChambers } from '../dist/src/resources/periodic-tiling/topology/equivalence.js';
import { validateWireTopologyWitness } from '../dist/src/resources/periodic-tiling/topology/witness-validation.js';
import { constructOrientableChamberCover } from '../dist/src/resources/periodic-tiling/topology/orientation-cover.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/periodic-topology-v1.json',import.meta.url),'utf8'));

function prove(source,bound=1024){
 const result=constructGeneralEuclideanTranslationCover(source,bound);
 assert.equal(result.status,'constructed',source+': '+result.reason);
 const original=inspectDSymbol(source,2048).symbol;
 const lifted=inspectDSymbol(result.translationDsSymbol,2048);
 assert.equal(lifted.status,'euclidean');
 assert.equal(lifted.symbol.weaklyOrientable,true);
 assert.equal(lifted.symbol.fixedPointFree,true);
 assert.ok(projectChambers(lifted.symbol,original));
 assert.equal(result.sourceProjection.length,result.chamberCount+1);
 assert.equal(result.chamberCount,lifted.symbol.chamberCount);
 assert.ok(result.primitiveCells.length>=1);
 assert.equal(result.primitiveCells.reduce((s,c)=>s+2*c.boundary.length,0),result.chamberCount);
 validateWireTopologyWitness({
   contractVersion:1,
   provenance:'test:independent-orbifold-unfolding',
   quotientDsSymbol:result.sourceSymbol,
   translationDsSymbol:result.translationDsSymbol,
   motifCells:result.primitiveCells.map(cell=>({
     id:'general-'+cell.id,
     boundary:cell.boundary.map((edge,i)=>({
       index:i,boundarySideIndex:i,
       targetMotifCellId:'general-'+edge.targetCell,
       targetTranslation:{u:edge.shift[0],v:edge.shift[1]},
       reciprocalInterfaceIndex:edge.reciprocalEdge
     }))
   }))
 });
 return result;
}

test('cyclic orbifold holonomy unfolds square, triangular, and hexagonal reflections independently',()=>{
 const cases=[
  ['<1:1,1,1:4,4>',4],
  ['<1:1,1,1:3,6>',6],
  ['<1:1,1,1:6,3>',6],
  ['<2:1 2,1 2,2:4 4,4>',2]
 ];
 for(const [source,expectedSheet] of cases){
  const result=prove(source);
  assert.equal(result.cyclicSheetCount,expectedSheet,source);
  assert.ok(result.chamberCount<=48);
  assert.deepEqual(constructGeneralEuclideanTranslationCover(source),result);
 }
});

test('unbranched mixed-degree and checkerboard torus symbols remain their own primitive translation covers',()=>{
 for(const label of [
  'unlisted mixed square triangle torus',
  'rhombille three rhombi torus',
  'non edge to edge torus',
  'checkerboard torus'
 ]){
  const source=fixture.symbolCoverCases.find(c=>c.name===label).dsSymbol;
  const result=prove(source);
  assert.equal(result.cyclicSheetCount,1,label);
  const orientation=constructOrientableChamberCover(source);
  assert.equal(result.translationDsSymbol,orientation.coverSymbol,label);
 }
});

test('invalid and genuinely resource-bounded input fail without inventing a cover',()=>{
 assert.equal(constructGeneralEuclideanTranslationCover('garbage').status,'invalid');
 assert.equal(constructGeneralEuclideanTranslationCover('<1:1,1,1:3,3>').status,'invalid');
 assert.equal(constructGeneralEuclideanTranslationCover('<1:1,1,1:4,4>',8).status,'unsupported');
 assert.equal(constructGeneralEuclideanTranslationCover('<1:1,1,1:4,4>',0).status,'unsupported');
});
