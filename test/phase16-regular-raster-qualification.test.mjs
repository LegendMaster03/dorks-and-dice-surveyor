import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {deriveTranslationMotif} from '../dist/src/resources/periodic-tiling/topology/motif.js';
import {investigatePeriodicMotif} from '../dist/src/analysis/periodic-tiling/experimental-observer.js';
import {inspectDSymbol} from '../dist/src/resources/periodic-tiling/topology/d-symbol.js';
import {projectChambers} from '../dist/src/resources/periodic-tiling/topology/equivalence.js';
import {evaluateOriginalRasterTranslations} from '../dist/src/analysis/periodic-tiling/original-edge-candidates.js';
import {observeMotifInteriors} from '../dist/src/analysis/periodic-tiling/motif-interiors.js';
import {deriveObservedTopology} from '../dist/src/analysis/periodic-tiling/observed-topology.js';

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
   const raster=rasterize(e);
   const started=performance.now();
   const detected=investigatePeriodicMotif(raster);
   const elapsedMs=Math.round(performance.now()-started);
   let failedStages=null;
   if(detected.status!=='consistent-candidate'){
     const candidates=evaluateOriginalRasterTranslations(raster,{maxHypotheses:5});
     failedStages=candidates.status!=='candidates'
       ?{status:candidates.status,reason:candidates.reason}
       :candidates.hypotheses.map((h,index)=>{
          const observed=observeMotifInteriors(raster,h.basis);
          const topology=observed.status==='observed'
            ?deriveObservedTopology(observed,h.basis):null;
          return {index,basis:h.basis,interior:observed.status,
            interiorReason:observed.reason,classes:observed.classes.length,
            topology:topology?.status??null,topologyReason:topology?.reason??null};
       });
   }
   const actual=detected.status==='consistent-candidate'?detected.candidateDsSymbol:null;
   const correct=actual===exact.translationSymbol;
   // Different translation-domain size is not automatically a wrong tiling.
   // Require an independent chamber covering map AND the matching lattice
   // index; otherwise an unequal D-symbol is a false positive, not an alias.
   let verifiedLargerCover=false;
   if(actual!==null&&!correct){
     const a=inspectDSymbol(actual,2048),target=inspectDSymbol(exact.translationSymbol,2048);
     const inputArea=Math.abs((e.basis[0].x*e.basis[1].y
       -e.basis[0].y*e.basis[1].x)*e.magnify*e.magnify);
     const [u,v]=detected.basis;
     const outputArea=Math.abs(u.x*v.y-u.y*v.x);
     const chamberRatio=a.status==='euclidean'&&target.status==='euclidean'
       ?a.symbol.chamberCount/target.symbol.chamberCount:NaN;
     const areaRatio=outputArea/inputArea;
     verifiedLargerCover=Number.isSafeInteger(chamberRatio)&&chamberRatio>1
       &&Math.abs(chamberRatio-areaRatio)<.06
       &&Boolean(projectChambers(a.symbol,target.symbol));
   }
   const record={name:e.name,correct,verifiedLargerCover,
     status:detected.status,elapsedMs,
     segmentation:detected.segmentationProvenance??null,
     metricStatus:detected.metricRegistration?.status??null,
     candidateSymbol:actual,expectedSymbol:exact.translationSymbol,
     candidateBasis:detected.status==='consistent-candidate'?detected.basis:null,
     candidateCellSides:detected.status==='consistent-candidate'
       ?detected.motifCells.map(c=>c.polygonAnalysisPixels.length):null,
     metricProjection:detected.metricRegistration?.sourceProjection?.status??null,
     metricReason:detected.metricRegistration?.reason??null,
     reason:detected.reason??null,failedStages};
   observations.push(record);
   process.stdout.write('PHASE16_REGULAR '+JSON.stringify(record)+'\n');
   assert.ok(elapsedMs<=15000,e.name+' exceeded 15-second raster-analysis budget');
   assert.ok(actual===null||correct||verifiedLargerCover,
     e.name+' confidently produced a different unproved tiling topology');
   if(actual!==null){
     assert.ok(detected.originalRasterEdgeSupport>=.83,
       e.name+' lacks source-raster line evidence');
     assert.ok(detected.maximumRigidVertexResidualPixels<=5,
       e.name+' exceeds image-space alignment drift');
   }
 }
 assert.equal(observations.length,4);
 assert.equal(observations.find(x=>x.name==='square')?.correct,true,
   'The original single-orbit square raster must reconstruct exactly');
 assert.equal(observations.find(x=>x.name==='rhombille')?.verifiedLargerCover,true,
   'The known doubled rhombille lattice must have an independent exact cover proof');
});
