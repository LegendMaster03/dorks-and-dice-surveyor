import assert from 'node:assert/strict';
import test from 'node:test';
import { investigatePeriodicMotif } from '../dist/src/analysis/periodic-tiling/experimental-observer.js';
import { deriveTranslationMotif } from '../dist/src/resources/periodic-tiling/topology/motif.js';

// The motif definition is test data only: none of these combinations is
// registered as a production shape, and the detector receives only a raster.
function polygonsFor(pattern){
 const polys=[];
 for(let row=0;row<2;row++)for(let col=0;col<2;col++){
  const x=col*64,y=row*64,a=[x,y],b=[x+64,y],c=[x+64,y+64],d=[x,y+64];
  const mode=pattern[row*2+col];
  if(mode===0)polys.push([a,b,c,d]);
  else if(mode===1)polys.push([a,b,c],[a,c,d]);
  else polys.push([a,b,d],[b,c,d]);
 }return polys;
}
function rasterize(polys,{angle=0,scale=1,noise=0,ink=0}={}){
 const width=640,height=640,pixels=new Uint8Array(width*height).fill(255);
 const rad=angle*Math.PI/180,c=Math.cos(rad)*scale,s=Math.sin(rad)*scale;
 const transform=([x,y])=>[Math.round(29+x*c-y*s),Math.round(37+x*s+y*c)];
 function stroke(a,b){const dx=b[0]-a[0],dy=b[1]-a[1],steps=Math.max(Math.abs(dx),Math.abs(dy))*2;
  for(let i=0;i<=steps;i++){
   const x=Math.round(a[0]+dx*i/steps),y=Math.round(a[1]+dy*i/steps);
   for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
    const px=x+ox,py=y+oy;
    if(px>=0&&px<width&&py>=0&&py<height)pixels[py*width+px]=ink;
   }
  }
 }
 for(let u=-9;u<=9;u++)for(let v=-9;v<=9;v++){
  for(const poly of polys){
   const vertices=poly.map(([x,y])=>transform([x+128*u,y+128*v]));
   for(let i=0;i<vertices.length;i++)stroke(vertices[i],vertices[(i+1)%vertices.length]);
  }
 }
 if(noise){for(let i=0;i<pixels.length;i++){
   const perturb=(Math.sin((i+123)*1.618)*43758.5453)%1;
   pixels[i]=Math.max(0,Math.min(255,Math.round(pixels[i]+noise*perturb)));
 }}
 return {width,height,pixels};
}
const patterns=[[0,1,2,0],[1,2,0,2],[2,0,1,1]];
const options={translation:{minDistance:25,maxDistance:200,maxPairVotes:300_000},
 interiors:{contourTolerancePixels:3},topology:{maxInkGapPixels:8}};

test('unregistered mixed arrangements remain structurally correct under rotation, scaling and faint strokes',()=>{
 for(const pattern of patterns){
  const polys=polygonsFor(pattern);
  const expected=deriveTranslationMotif({units:'pixel',basis:[{x:128,y:0},{x:0,y:128}],
    cells:polys.map((poly,i)=>({id:`shape-${i}`,polygon:poly.map(([x,y])=>({x,y}))}))});
  for(const variant of [{},{angle:11,scale:1.12},{ink:65}]){
   const result=investigatePeriodicMotif(rasterize(polys,variant),options);
   assert.equal(result.status,'consistent-candidate',`${pattern},${JSON.stringify(variant)}: ${result.reason}`);
   assert.equal(result.candidateDsSymbol,expected.translationSymbol);
  }
 }
});

test('strong-gradient fallback recovers a noisy mixed motif without inventing identities for harder cases',()=>{
 for(const [index,pattern] of patterns.entries()){
  const polygons=polygonsFor(pattern);
  const expected=deriveTranslationMotif({units:'pixel',basis:[{x:128,y:0},{x:0,y:128}],
    cells:polygons.map((poly,i)=>({id:`shape-${i}`,polygon:poly.map(([x,y])=>({x,y}))}))});
  const result=investigatePeriodicMotif(rasterize(polygons,{noise:15}),options);
  if(index===0)assert.equal(result.status,'consistent-candidate',result.reason);
  assert.ok(result.status==='inconclusive'||result.status==='consistent-candidate');
  if(result.status==='consistent-candidate')assert.equal(result.candidateDsSymbol,expected.translationSymbol);
 }
});

test('noise without repeated ink geometry never becomes a valid observed D-symbol',()=>{
 const width=512,height=512,pixels=new Uint8Array(width*height);
 for(let i=0;i<pixels.length;i++)pixels[i]=Math.round(255*Math.abs(Math.sin((i+47)*17.13)));
 const result=investigatePeriodicMotif({width,height,pixels},options);
 assert.notEqual(result.status,'consistent-candidate');
});
