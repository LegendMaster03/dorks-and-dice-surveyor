import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveTranslationMotif } from '../dist/src/resources/periodic-tiling/topology/motif.js';
import { constructTranslationCoverFromSymbol } from '../dist/src/resources/periodic-tiling/topology/translation-cover-from-symbol.js';
import { validateWireTopologyWitness, PeriodicWitnessValidationError } from '../dist/src/resources/periodic-tiling/topology/witness-validation.js';

const p = (x,y) => ({x,y});
const square = {basis:[p(1,0),p(0,1)],units:'world',cells:[{id:'square',polygon:[p(0,0),p(1,0),p(1,1),p(0,1)]}]};
const mixed = {basis:[p(2,0),p(0,1)],units:'world',cells:[{id:'square',polygon:[p(0,0),p(1,0),p(1,1),p(0,1)]},{id:'triangle-a',polygon:[p(1,0),p(2,0),p(2,1)]},{id:'triangle-b',polygon:[p(1,0),p(2,1),p(1,1)]}]};
const h=Math.sqrt(3)/2, hexVertices=Array.from({length:6},(_,i)=>p(Math.cos(Math.PI*i/3),Math.sin(Math.PI*i/3)));
const hex = {basis:[p(1.5,h),p(1.5,-h)],units:'world',cells:[{id:'hex',polygon:hexVertices}]};
const rhombille={basis:hex.basis,units:'world',cells:[0,2,4].map((i,index)=>({id:`r${index}`,polygon:[p(0,0),hexVertices[i],hexVertices[(i+1)%6],hexVertices[(i+2)%6]]}))};
const checker={basis:[p(1,1),p(1,-1)],units:'world',cells:[{id:'even',polygon:[p(0,0),p(1,0),p(1,1),p(0,1)]},{id:'odd',polygon:[p(1,0),p(2,0),p(2,1),p(1,1)]}]};

function toWire(cover){
 return {contractVersion:1,provenance:'independent-geometric-witness',quotientDsSymbol:cover.quotientSymbol,translationDsSymbol:cover.translationSymbol,
 motifCells:cover.cells.map(cell=>({id:cell.id,boundary:cell.boundary.map(edge=>({index:edge.edgeIndex,boundarySideIndex:edge.sideIndex,
 targetMotifCellId:edge.target.motifCell,targetTranslation:{u:edge.target.lattice[0],v:edge.target.lattice[1]},
 reciprocalInterfaceIndex:edge.reciprocalEdgeIndex}))}))};
}
function abstractWire(cover){
 return {contractVersion:1,provenance:'constructed-from-D-symbol',quotientDsSymbol:cover.sourceSymbol,translationDsSymbol:cover.sourceSymbol,
 motifCells:cover.cells.map(cell=>({id:`face-${cell.id}`,boundary:cell.boundary.map((edge,i)=>({index:i,boundarySideIndex:i,
 targetMotifCellId:`face-${edge.targetCell}`,targetTranslation:{u:edge.shift[0],v:edge.shift[1]},
 reciprocalInterfaceIndex:edge.reciprocalEdge}))}))};
}

const witness = (shape) => toWire(deriveTranslationMotif(shape));

test('independently constructed polygonal and abstract covers agree on complete structural validity',()=>{
 for(const [name,shape] of Object.entries({square,mixed,hex,rhombille,checker})){
  const geometric=witness(shape);
  assert.equal(validateWireTopologyWitness(geometric),true,name);
  const abstract=constructTranslationCoverFromSymbol(geometric.translationDsSymbol);
  assert.equal(abstract.status,'constructed',`${name}: ${abstract.reason}`);
  assert.equal(validateWireTopologyWitness(abstractWire(abstract)),true,name);
 }
});

test('a reciprocal but disconnected periodic sublattice is rejected',()=>{
 const specimen=witness(square);
 for(const edge of specimen.motifCells[0].boundary){edge.targetTranslation.u*=2; edge.targetTranslation.v*=2;}
 assert.throws(()=>validateWireTopologyWitness(specimen),/primitive/, 'The same D-symbol cannot certify doubled translation displacements');
});

test('a forged symbol is rejected despite perfectly reciprocal boundary records',()=>{
 const specimen=witness(square),alternate=witness(hex);
 specimen.translationDsSymbol=alternate.translationDsSymbol;
 specimen.quotientDsSymbol=alternate.translationDsSymbol;
 assert.throws(()=>validateWireTopologyWitness(specimen),/incidence/);
});

test('a consistent reciprocal edit that opens a vertex orbit is rejected',()=>{
 const specimen=witness(square);
 specimen.motifCells[0].boundary[0].targetTranslation={u:0,v:0};
 specimen.motifCells[0].boundary[2].targetTranslation={u:0,v:0};
 assert.throws(()=>validateWireTopologyWitness(specimen),/vertex orbit|primitive/i);
});

test('unsafe integer translations and disconnected cells do not pass structural verification',()=>{
 const noninteger=witness(square);
 noninteger.motifCells[0].boundary[0].targetTranslation.v=0.5;
 noninteger.motifCells[0].boundary[2].targetTranslation.v=-0.5;
 assert.throws(()=>validateWireTopologyWitness(noninteger),/exact wire integers/);
 const disconnected=witness(square);
 const copy=structuredClone(disconnected.motifCells[0]);
 copy.id='isolated';
 for(const boundary of copy.boundary)boundary.targetMotifCellId='isolated';
 disconnected.motifCells.push(copy);
 assert.throws(()=>validateWireTopologyWitness(disconnected),PeriodicWitnessValidationError);
});
