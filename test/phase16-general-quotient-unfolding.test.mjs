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
  ['<2:1 2,1 2,2:4 4,4>',4]
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
 assert.equal(constructGeneralEuclideanTranslationCover('<1:1,1,1:3,6>',8).status,'unsupported');
 assert.equal(constructGeneralEuclideanTranslationCover('<1:1,1,1:4,4>',0).status,'unsupported');
});

test('nonuniform symmetry-reduced mixed polygon quotients unfold without a named shape',()=>{
 // Obtained independently as quotients of chamber automorphisms of the
 // shared 20-chamber square/triangle and 28-chamber non-edge-to-edge tori.
 // Their unequal face/vertex orders prohibit the regular-reflection shortcut.
 const quotients=[
  '<10:2 5 4 6 7 8 10,1 4 6 5 9 10,3 5 7 8 9 10:3 3 4,5 5>',
  '<10:2 5 6 8 10,3 4 6 9 10,2 5 7 8 10:3 4,5>',
  '<14:2 5 7 9 11 13 14,1 4 6 8 10 12 14 13,3 5 4 6 7 8 9 14 11 13:6 4,3 4 4 3>'
 ];
 for(const quotient of quotients){
  const result=prove(quotient);
  assert.ok(result.chamberCount>=20);
  assert.ok(result.primitiveCells.some(c=>c.sides!==result.primitiveCells[0].sides),
    'The uplift must retain different polygon side counts where supplied');
 }
});

test('shared general Euclidean quotient conformance corpus remains exact across languages',()=>{
 for(const sample of fixture.generalQuotientCases){
  const result=constructGeneralEuclideanTranslationCover(sample.dsSymbol,sample.chamberLimit??1024);
  assert.equal(result.status,sample.status,sample.name+': '+result.reason);
  if(result.status!=='constructed')continue;
  prove(sample.dsSymbol,sample.chamberLimit??1024);
  if(sample.cyclicSheets!==undefined)
    assert.equal(result.cyclicSheetCount,sample.cyclicSheets,sample.name);
 }
});
