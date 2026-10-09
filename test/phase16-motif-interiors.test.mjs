import test from 'node:test';
import assert from 'node:assert/strict';
import {observeMotifInteriors} from '../dist/src/analysis/periodic-tiling/motif-interiors.js';

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

test('observes three distinct mixed motif interiors from the original unwarped raster',()=>{
 const {raster,basis}=rasterize([[128,0],[0,64]],squareTriangles);
 const result=observeMotifInteriors(raster,basis);
 assert.equal(result.status,'observed',result.reason);
 assert.deepEqual(result.classes.map(c=>c.sideCount).sort(),[3,3,4]);
 assert.ok(result.classes.every(c=>c.examples>=8));
});
test('independent six-cell mixed motif is not restricted to known named tilings',()=>{
 const {raster,basis}=rasterize([[128,0],[0,128]],twoSquareFourTriangles);
 const result=observeMotifInteriors(raster,basis);
 assert.equal(result.status,'observed',result.reason);
 assert.deepEqual(result.classes.map(c=>c.sideCount).sort(),[3,3,3,3,4,4]);
});
test('rotated and scaled original raster still yields multiple geometric cell classes',()=>{
 const {raster,basis}=rasterize([[128,0],[0,64]],squareTriangles,{angle:13,scale:1.1});
 const result=observeMotifInteriors(raster,basis,{contourTolerancePixels:3});
 assert.equal(result.status,'observed',result.reason);
 assert.deepEqual(result.classes.map(c=>c.sideCount).sort(),[3,3,4]);
});
test('ambiguous blank, textured, invalid and oversized rasters cannot claim detected topology',()=>{
 const blank={width:128,height:128,pixels:new Uint8Array(128*128).fill(255)};
 assert.equal(observeMotifInteriors(blank,[{x:32,y:0},{x:0,y:32}]).status,'inconclusive');
 const texture={width:128,height:128,pixels:new Uint8Array(128*128).fill(120)};
 assert.equal(observeMotifInteriors(texture,[{x:32,y:0},{x:0,y:32}]).status,'inconclusive');
 assert.equal(observeMotifInteriors(blank,[{x:32,y:0},{x:64,y:0}]).status,'unsupported');
 assert.equal(observeMotifInteriors(blank,[{x:32,y:0},{x:0,y:32}],{maxPixels:100}).status,'unsupported');
});

test('existing Sobel evidence feeds translation candidates and subsequent mixed-cell segmentation',async()=>{
 const {evaluateOriginalRasterTranslations}=await import('../dist/src/analysis/periodic-tiling/original-edge-candidates.js');
 const {raster}=rasterize([[128,0],[0,64]],squareTriangles);
 const translations=evaluateOriginalRasterTranslations(raster,{minDistance:25,maxDistance:150,maxPairVotes:300_000});
 assert.equal(translations.status,'candidates',translations.reason);
 const expectedArea=128*64;
 const candidate=translations.hypotheses.find(h=>{
  const [a,b]=h.basis;
  const det=Math.abs(a.x*b.y-a.y*b.x);
  return Math.abs(det-expectedArea)/expectedArea<.05;
 });
 assert.ok(candidate,'The detected lattice must preserve the independently specified translation area');
 const cells=observeMotifInteriors(raster,candidate.basis);
 assert.equal(cells.status,'observed',cells.reason);
 assert.deepEqual(cells.classes.map(c=>c.sideCount).sort(),[3,3,4]);
});
