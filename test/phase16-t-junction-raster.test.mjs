import test from 'node:test';
import assert from 'node:assert/strict';
import { splitObservedTJunctionSides } from '../dist/src/analysis/periodic-tiling/raster-t-junctions.js';
import { observeMotifInteriors } from '../dist/src/analysis/periodic-tiling/motif-interiors.js';
import { deriveObservedTopology } from '../dist/src/analysis/periodic-tiling/observed-topology.js';
import { deriveTranslationMotif } from '../dist/src/resources/periodic-tiling/topology/motif.js';
import { investigatePeriodicMotif } from '../dist/src/analysis/periodic-tiling/experimental-observer.js';

const tJunction = [
  [[0,0],[64,0],[64,64],[0,64]],
  [[64,0],[128,0],[128,32],[64,32]],
  [[64,32],[128,32],[128,64],[64,64]]
];
const sourcePolys = tJunction.map(poly => poly.map(([x,y]) => ({x,y})));

function rasterize(polygons, {width=640,height=640,basis=[[128,0],[0,64]]}={}) {
  const pixels=new Uint8Array(width*height).fill(255);
  function draw([ax,ay],[bx,by]) {
    const n=Math.max(Math.abs(bx-ax),Math.abs(by-ay))*2;
    for(let k=0;k<=n;k++){
      const x=Math.round(ax+(bx-ax)*k/n),y=Math.round(ay+(by-ay)*k/n);
      for(let xx=-1;xx<=1;xx++)for(let yy=-1;yy<=1;yy++){
        if(x+xx>=0&&y+yy>=0&&x+xx<width&&y+yy<height)
          pixels[(y+yy)*width+x+xx]=0;
      }
    }
  }
  for(let u=-7;u<=7;u++)for(let v=-12;v<=12;v++){
    for(const poly of polygons){
      const vertices=poly.map(([x,y])=>[x+basis[0][0]*u+basis[1][0]*v+29,y+basis[0][1]*u+basis[1][1]*v+37]);
      for(let i=0;i<vertices.length;i++)draw(vertices[i],vertices[(i+1)%vertices.length]);
    }
  }
  return {width,height,pixels};
}

test('T-junction normalization inserts a collinear vertex only with opposing boundary evidence',()=>{
  const result=splitObservedTJunctionSides(sourcePolys);
  assert.equal(result.status,'split',result.reason);
  assert.deepEqual(result.polygons.map(p=>p.length),[5,4,4]);
  assert.equal(result.restoredVertices,1);
  const p=result.polygons[0][2];
  assert.ok(Math.abs(p.x-64)<.01&&Math.abs(p.y-32)<.01);
  const noNeighbor=splitObservedTJunctionSides([sourcePolys[0]]);
  assert.equal(noNeighbor.status,'split');
  assert.equal(noNeighbor.restoredVertices,0);
  const separated=sourcePolys.map((poly,i)=>i===0?poly:poly.map(({x,y})=>({x:x+16,y})));
  const unsupported=splitObservedTJunctionSides(separated);
  assert.equal(unsupported.restoredVertices,0);
});

test('periodic image reconstructs subdivided non-edge-to-edge T-junctions and a verified chamber graph',()=>{
  const raster=rasterize(tJunction);
  const basis=[{x:128,y:0},{x:0,y:64}];
  const observed=observeMotifInteriors(raster,basis);
  assert.equal(observed.status,'observed',observed.reason);
  assert.deepEqual(observed.classes.map(c=>c.sideCount).sort((a,b)=>a-b),[4,4,6]);
  const derived=deriveObservedTopology(observed,basis);
  assert.equal(derived.status,'derived',derived.reason);
  const expected=deriveTranslationMotif({
    units:'pixel',basis,cells:sourcePolys.map((polygon,i)=>({id:`t-${i}`,polygon}))
  });
  assert.equal(derived.dsSymbol,expected.translationSymbol);
  assert.ok(derived.cells.some(cell=>cell.sides===6));
});

test('unregistered staggered-brick lattice reconstructs a second T-junction topology with oblique translations',()=>{
  const brick=[[[0,0],[96,0],[96,32],[0,32]]];
  const motifBasis=[[96,0],[48,32]];
  const raster=rasterize(brick,{basis:motifBasis});
  const basis=motifBasis.map(([x,y])=>({x,y}));
  const observed=observeMotifInteriors(raster,basis);
  assert.equal(observed.status,'observed',observed.reason);
  assert.deepEqual(observed.classes.map(c=>c.sideCount),[6]);
  const topology=deriveObservedTopology(observed,basis);
  assert.equal(topology.status,'derived',topology.reason);
  const expected=deriveTranslationMotif({
    units:'pixel',basis,
    cells:brick.map((poly,i)=>({id:`brick-${i}`,polygon:poly.map(([x,y])=>({x,y}))}))
  });
  assert.equal(topology.dsSymbol,expected.translationSymbol);
  assert.equal(topology.cells.length,1);
  assert.equal(topology.cells[0].boundaries.length,6);
});

test('unhinted original-raster pipeline derives T-junction topology without supplied lattice vectors',()=>{
 const raster=rasterize(tJunction);
 const result=investigatePeriodicMotif(raster,{
   translation:{minDistance:20,maxDistance:200,maxPairVotes:300_000}
 });
 const expected=deriveTranslationMotif({
   units:'pixel',basis:[{x:128,y:0},{x:0,y:64}],
   cells:sourcePolys.map((polygon,i)=>({id:`free-${i}`,polygon}))
 });
 assert.equal(result.status,'consistent-candidate',result.reason);
 assert.equal(result.candidateDsSymbol,expected.translationSymbol);
 assert.ok(result.originalRasterEdgeSupport>=0.83);
});

test('no-hint raster exploration of staggered oblique bricks cannot invent a conflicting topology',()=>{
  const brick=[[[0,0],[96,0],[96,32],[0,32]]];
  const raster=rasterize(brick,{basis:[[96,0],[48,32]]});
  const expected=deriveTranslationMotif({
    units:'pixel',basis:[{x:96,y:0},{x:48,y:32}],
    cells:[{id:'brick-oblique',polygon:brick[0].map(([x,y])=>({x,y}))}]
  });
  const result=investigatePeriodicMotif(raster,{
    translation:{minDistance:18,maxDistance:175,maxPairVotes:300_000}
  });
  assert.ok(result.status==='consistent-candidate'||result.status==='inconclusive',result.reason);
  if(result.status==='consistent-candidate'){
    assert.equal(result.candidateDsSymbol,expected.translationSymbol);
    assert.equal(result.metricRegistration?.sourceProjection?.status,'supported');
  }else{
    assert.match(result.reason,/Incomplete source polygon projection|Incomplete metric witness/,
      'Observed topology is not a verified whole-image projection');
  }
});

test('T-junction reconstruction remains bounded for hostile or excessive contours',()=>{
 const invalid=splitObservedTJunctionSides([[{x:NaN,y:0},{x:0,y:1},{x:1,y:1}]]);
 assert.equal(invalid.status,'inconclusive');
 const limit=splitObservedTJunctionSides(sourcePolys,{maxPolygonSides:3});
 assert.equal(limit.status,'inconclusive');
});
