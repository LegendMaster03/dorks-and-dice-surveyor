import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {deriveTranslationMotif} from '../dist/src/resources/periodic-tiling/topology/motif.js';
import {investigatePeriodicMotif} from '../dist/src/analysis/periodic-tiling/experimental-observer.js';

// Geometry is independent mathematical test ground truth, never fed to detector.
// Each example uses a different fundamental-domain cell structure.
const P=(x,y)=>({x,y}),r=Math.sqrt(3)/2;
const hexVertices=Array.from({length:6},(_,j)=>P(Math.cos(Math.PI*j/3),Math.sin(Math.PI*j/3)));
const examples=[
 {name:'square',basis:[P(1,0),P(0,1)],
  cells:[[P(0,0),P(1,0),P(1,1),P(0,1)]],magnify:80},
 {name:'triangle',basis:[P(1,0),P(.5,r)],
  cells:[[P(0,0),P(1,0),P(1.5,r)],[P(0,0),P(1.5,r),P(.5,r)]],magnify:80},
 {name:'hexagon',basis:[P(1.5,r),P(1.5,-r)],
  cells:[hexVertices],magnify:45},
 {name:'rhombille',basis:[P(1.5,r),P(1.5,-r)],
  cells:[0,2,4].map(j=>[P(0,0),hexVertices[j],
    hexVertices[(j+1)%6],hexVertices[(j+2)%6]]),magnify:45}
];
function rasterize(e){
 const width=640,height=640,pixels=new Uint8Array(width*height).fill(255);
 const move=(p,u,v)=>[Math.round(39+e.magnify*(p.x+u*e.basis[0].x+v*e.basis[1].x)),
   Math.round(51+e.magnify*(p.y+u*e.basis[0].y+v*e.basis[1].y))];
 function stroke(a,b){
   const steps=Math.ceil(Math.max(Math.abs(b[0]-a[0]),Math.abs(b[1]-a[1]))*2);
   for(let j=0;j<=steps;j++){
     const x=Math.round(a[0]+(b[0]-a[0])*j/steps);
     const y=Math.round(a[1]+(b[1]-a[1])*j/steps);
     for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)
       if(x+dx>=0&&x+dx<width&&y+dy>=0&&y+dy<height)
         pixels[(y+dy)*width+x+dx]=0;
   }
 }
 for(let u=-14;u<=14;u++)for(let v=-14;v<=14;v++)
  for(const cell of e.cells){
    const poly=cell.map(p=>move(p,u,v));
    for(let j=0;j<poly.length;j++)stroke(poly[j],poly[(j+1)%poly.length]);
  }
 return {width,height,pixels};
}
test('no-hint generalized detector classifies or explicitly refuses the four canonical image families',()=>{
 const observations=[];
 for(const e of examples){
   const exact=deriveTranslationMotif({
     units:'world',basis:e.basis,cells:e.cells.map((points,i)=>({
       id:e.name+'-'+i,polygon:points
     }))
   });
   const started=performance.now();
   const detected=investigatePeriodicMotif(rasterize(e));
   const elapsedMs=Math.round(performance.now()-started);
   const actual=detected.status==='consistent-candidate'?detected.candidateDsSymbol:null;
   const correct=actual===exact.translationSymbol;
   const record={name:e.name,correct,status:detected.status,elapsedMs,
     segmentation:detected.segmentationProvenance??null,
     metricStatus:detected.metricRegistration?.status??null};
   observations.push(record);
   process.stdout.write('PHASE16_REGULAR '+JSON.stringify(record)+'\n');
   assert.ok(elapsedMs<=15000,e.name+' exceeded 15-second raster-analysis budget');
   assert.ok(actual===null||correct,
     e.name+' confidently produced the wrong no-hint periodic tiling D-symbol');
   if(actual!==null){
     assert.ok(detected.originalRasterEdgeSupport>=.83,
       e.name+' lacks source-raster line evidence');
     assert.ok(detected.maximumRigidVertexResidualPixels<=5,
       e.name+' exceeds image-space alignment drift');
   }
 }
 assert.equal(observations.length,4);
});
