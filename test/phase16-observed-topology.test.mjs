import test from 'node:test';
import assert from 'node:assert/strict';
import {observeMotifInteriors} from '../dist/src/analysis/periodic-tiling/motif-interiors.js';
import {deriveObservedTopology} from '../dist/src/analysis/periodic-tiling/observed-topology.js';
import {deriveTranslationMotif} from '../dist/src/resources/periodic-tiling/topology/motif.js';
import {investigatePeriodicMotif} from '../dist/src/analysis/periodic-tiling/experimental-observer.js';
import {verifyRigidMotifFit} from '../dist/src/analysis/periodic-tiling/global-motif-fit.js';

/** Rasterizes arbitrary periodic input polygons, without any detector catalog. */
function rasterize(basis, polygons, {width=640,height=640,angle=0,scale=1,phase=[29,37]}={}){
 const pixels=new Uint8Array(width*height).fill(255);
 const radians=angle*Math.PI/180,c=Math.cos(radians)*scale,s=Math.sin(radians)*scale;
 const worldToPixel=([x,y])=>[Math.round(phase[0]+x*c-y*s),Math.round(phase[1]+x*s+y*c)];
 function stroke(a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],steps=Math.max(Math.abs(dx),Math.abs(dy))*2;
  for(let i=0;i<=steps;i++){
   const x=Math.round(a[0]+dx*i/steps),y=Math.round(a[1]+dy*i/steps);
   for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
    const px=x+ox,py=y+oy;if(px>=0&&px<width&&py>=0&&py<height)pixels[py*width+px]=0;
   }
  }
 }
 for(let u=-9;u<=9;u++)for(let v=-9;v<=9;v++){
  const offset=[basis[0][0]*u+basis[1][0]*v,basis[0][1]*u+basis[1][1]*v];
  for(const poly of polygons){
   const points=poly.map(([x,y])=>worldToPixel([x+offset[0],y+offset[1]]));
   for(let i=0;i<points.length;i++)stroke(points[i],points[(i+1)%points.length]);
  }
 }
 const transform=([x,y])=>({x:x*c-y*s,y:x*s+y*c});
 return {raster:{width,height,pixels},basis:[transform(basis[0]),transform(basis[1])]};
}
const squareTriangles=[
 [[0,0],[64,0],[64,64],[0,64]],
 [[64,0],[128,0],[128,64]],
 [[64,0],[128,64],[64,64]]
];
const twoSquareFourTriangles=[
 [[0,0],[64,0],[64,64],[0,64]],
 [[64,64],[128,64],[128,128],[64,128]],
 [[64,0],[128,0],[64,64]],
 [[128,0],[128,64],[64,64]],
 [[0,64],[64,64],[64,128]],
 [[0,64],[64,128],[0,128]]
];

test('derive complete reciprocal chamber graph of an unfamiliar repeated square-triangle motif',()=>{
 const {raster,basis}=rasterize([[128,0],[0,64]],squareTriangles);
 const observed=observeMotifInteriors(raster,basis);
 const result=deriveObservedTopology(observed,basis);
 assert.equal(result.status,'derived',result.reason);
});
test('derive complete reciprocal chamber graph of independent six-cell mixed motif',()=>{
 const {raster,basis}=rasterize([[128,0],[0,128]],twoSquareFourTriangles);
 const observed=observeMotifInteriors(raster,basis);
 const result=deriveObservedTopology(observed,basis);
 assert.equal(result.status,'derived',result.reason);
});
test('derive repeatable chamber graph from rotated scaled original raster',()=>{
 const {raster,basis}=rasterize([[128,0],[0,64]],squareTriangles,{angle:13,scale:1.1});
 const observed=observeMotifInteriors(raster,basis,{contourTolerancePixels:3});
 const result=deriveObservedTopology(observed,basis,{maxInkGapPixels:8});
 assert.equal(result.status,'derived',result.reason);
});

test('derived raster chamber symbol equals independent polygonal ground truth for both mixed motifs',()=>{
 const p=(x,y)=>({x,y});
 for(const [basis,polygons] of [
    [[[128,0],[0,64]],squareTriangles],
    [[[128,0],[0,128]],twoSquareFourTriangles]
 ]){
   const polygonWitness={units:'pixel',basis:basis.map(([x,y])=>p(x,y)),cells:polygons.map((poly,i)=>({id:`cell-${i}`,polygon:poly.map(([x,y])=>p(x,y))}))};
   const known=deriveTranslationMotif(polygonWitness);
   const {raster,basis:originalBasis}=rasterize(basis,polygons);
   const observed=observeMotifInteriors(raster,originalBasis);
   const detected=deriveObservedTopology(observed,originalBasis);
   assert.equal(detected.status,'derived',detected.reason);
   assert.equal(detected.dsSymbol,known.translationSymbol);
 }
});

test('incomplete cropped evidence and T-junctions never silently claim a chamber identity',()=>{
 const tJunction=[
   [[0,0],[64,0],[64,64],[0,64]],
   [[64,0],[128,0],[128,32],[64,32]],
   [[64,32],[128,32],[128,64],[64,64]]
 ];
 const image=rasterize([[128,0],[0,64]],tJunction);
 const observation=observeMotifInteriors(image.raster,image.basis);
 if(observation.status==='observed') {
   const derived=deriveObservedTopology(observation,image.basis);
   assert.notEqual(derived.status,'derived', 'An unsplit T-junction must not be assigned one neighbor per whole side');
 } else assert.notEqual(observation.status,'detected');
 const small=rasterize([[128,0],[0,64]],squareTriangles,{width:154,height:148});
 const insufficient=observeMotifInteriors(small.raster,small.basis);
 if(insufficient.status==='observed') assert.notEqual(deriveObservedTopology(insufficient,small.basis).status,'derived');
 else assert.equal(insufficient.status,'inconclusive');
});

test('the original-image detector stages derive independently specified mixed D-symbol candidates without a supplied shape or basis',()=>{
 for(const [basis,polygons] of [
    [[[128,0],[0,64]],squareTriangles],
    [[[128,0],[0,128]],twoSquareFourTriangles]
 ]){
   const groundTruth=deriveTranslationMotif({units:'pixel',basis:basis.map(([x,y])=>({x,y})),
     cells:polygons.map((poly,i)=>({id:`cell-${i}`,polygon:poly.map(([x,y])=>({x,y}))}))});
   const {raster}=rasterize(basis,polygons);
   const result=investigatePeriodicMotif(raster,{translation:{minDistance:25,maxDistance:200,maxPairVotes:300_000}});
   assert.equal(result.status,'consistent-candidate',result.reason);
   assert.equal(result.candidateDsSymbol,groundTruth.translationSymbol);
   assert.ok(result.matchedHypotheses>=2);
   assert.ok(result.originalRasterEdgeSupport>=0.83);
   assert.ok(result.maximumRigidVertexResidualPixels<=5);
 }
});
test('a blank raster does not produce a candidate D-symbol',()=>{
 const raster={width:128,height:128,pixels:new Uint8Array(128*128).fill(255)};
 const result=investigatePeriodicMotif(raster);
 assert.equal(result.status,'inconclusive');
 assert.equal(result.checkedHypotheses,0);
});
test('a rotated and scaled mixed raster can derive its candidate symbol without a supplied basis',()=>{
 const {raster}=rasterize([[128,0],[0,64]],squareTriangles,{angle:13,scale:1.1});
 const result=investigatePeriodicMotif(raster,{translation:{minDistance:25,maxDistance:200,maxPairVotes:300_000},interiors:{contourTolerancePixels:3},topology:{maxInkGapPixels:8}});
 assert.equal(result.status,'consistent-candidate',result.reason);
 const groundTruth=deriveTranslationMotif({units:'pixel',basis:[{x:128,y:0},{x:0,y:64}],cells:squareTriangles.map((poly,i)=>({id:`cell-${i}`,polygon:poly.map(([x,y])=>({x,y}))}))});
 assert.equal(result.candidateDsSymbol,groundTruth.translationSymbol);
});
function constructUnregisteredMotif(pattern){
 const polys=[];
 for(let row=0;row<2;row++)for(let col=0;col<2;col++){
  const x=col*64,y=row*64;
  const a=[x,y],b=[x+64,y],c=[x+64,y+64],d=[x,y+64];
  const mode=pattern[row*2+col];
  if(mode===0)polys.push([a,b,c,d]);
  else if(mode===1)polys.push([a,b,c],[a,c,d]);
  else polys.push([a,b,d],[b,c,d]);
 }
 return polys;
}
test('independently constructed mixed polygon combinations share the same raster-derived and geometric chamber symbols',()=>{
 for(const pattern of [[0,1,2,0],[1,2,0,2],[2,0,1,1]]){
  const polygons=constructUnregisteredMotif(pattern),basis=[[128,0],[0,128]];
  const expected=deriveTranslationMotif({units:'pixel',basis:basis.map(([x,y])=>({x,y})),cells:polygons.map((poly,i)=>({id:`unique-${i}`,polygon:poly.map(([x,y])=>({x,y}))}))});
  const {raster,basis:knownBasis}=rasterize(basis,polygons);
  const obs=observeMotifInteriors(raster,knownBasis);
  const top=deriveObservedTopology(obs,knownBasis);
  assert.equal(top.status,'derived',`${pattern}: ${top.reason||obs.reason}`);
  assert.equal(top.dsSymbol,expected.translationSymbol,`pattern ${pattern}`);
 }
});

test('malformed motif observations cannot throw or manufacture a Euclidean identity',()=>{
 const inconsistent={status:'observed',classes:[{id:0,sideCount:4,examples:2}],interiors:[
   {polygon:[{x:0,y:0},{x:1,y:0},{x:1,y:1}],pixels:500,centroid:{x:0.5,y:0.5},representative:true,motifClass:0}],consideredComponents:2};
 const result=deriveObservedTopology(inconsistent,[{x:64,y:0},{x:0,y:64}]);
 assert.equal(result.status,'unsupported');
});

test('one globally rigid motif reproduces original image ink across distant regions',()=>{
 for(const transforms of [{}, {angle:13,scale:1.1}]){
  const {raster,basis}=rasterize([[128,0],[0,64]],squareTriangles,transforms);
  const regions=observeMotifInteriors(raster,basis,transforms.angle?{contourTolerancePixels:3}:{});
  const fit=verifyRigidMotifFit(raster,regions,basis);
  assert.equal(fit.status,'supported',fit.reason);
  assert.ok(fit.originalRasterEdgeSupport>=0.83);
  assert.ok(fit.supportedRegions>=4);
 }
});
test('a distorted translation basis is rejected by the original-image global rigid residual',()=>{
 const {raster,basis}=rasterize([[128,0],[0,64]],squareTriangles);
 const observed=observeMotifInteriors(raster,basis);
 const perturbed=[{x:basis[0].x+2.5,y:0},basis[1]];
 const result=verifyRigidMotifFit(raster,observed,perturbed);
 assert.equal(result.status,'inconclusive');
});
