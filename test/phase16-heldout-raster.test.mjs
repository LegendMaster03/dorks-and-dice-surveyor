import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { investigatePeriodicMotif } from '../dist/src/analysis/periodic-tiling/experimental-observer.js';
import { deriveTranslationMotif } from '../dist/src/resources/periodic-tiling/topology/motif.js';
import { evaluateOriginalRasterTranslations } from '../dist/src/analysis/periodic-tiling/original-edge-candidates.js';
import { observeMotifInteriors } from '../dist/src/analysis/periodic-tiling/motif-interiors.js';
import { refineRigidTranslationBasis } from '../dist/src/analysis/periodic-tiling/rigid-basis-refinement.js';
import { deriveObservedTopology } from '../dist/src/analysis/periodic-tiling/observed-topology.js';
import { verifyRigidMotifFit } from '../dist/src/analysis/periodic-tiling/global-motif-fit.js';

/**
 * Phase 16 held-out synthetic benchmark, independent of the detector's
 * topology-reconstruction and candidate-selection implementation.
 *
 * Fixed generator seeds are declared here rather than registered as supported
 * shapes; the detector receives only source-image pixels, never the seed,
 * generator parameters, basis, symbol, or expected cell geometry.
 *
 * Predeclared exploratory gate: among the four complete mixed-cell maps, at
 * least two must yield the EXACT polygon-witness D-symbol, with zero confident
 * wrong identities. Stress maps may be inconclusive but must not claim a wrong
 * identity. Both negative maps must be inconclusive or ambiguous.
 * This is a feasibility gate, NOT the final acceptance/calibration envelope.
 */
function rng(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function polygonsFor(seed) {
  const random=rng(seed);
  const polygons=[];
  const modes=Array.from({length:6},()=>Math.floor(random()*3));
  // A 3-by-2 fundamental cell region with irregular independent choices.
  // The source has distinct square and triangle cell orbits by construction.
  modes[0]=0; modes[1]=1; modes[2]=2;
  for(let row=0;row<2;row++)for(let col=0;col<3;col++){
    const x=col*48,y=row*48;
    const a=[x,y],b=[x+48,y],c=[x+48,y+48],d=[x,y+48];
    const mode=modes[row*3+col];
    if(mode===0)polygons.push([a,b,c,d]);
    else if(mode===1)polygons.push([a,b,c],[a,c,d]);
    else polygons.push([a,b,d],[b,c,d]);
  }
  return {polygons,basis:[[144,0],[0,96]],modes};
}
function rasterize(polygons,basis,{width=640,height=640,rotation=0,scale=1,
    noise=0,seed=3,phase=[31,53],distractorCount=0}={}) {
  const pixels=new Uint8Array(width*height).fill(255);
  const rad=rotation*Math.PI/180,c=Math.cos(rad)*scale,s=Math.sin(rad)*scale;
  const pos=([x,y])=>[Math.round(phase[0]+x*c-y*s),Math.round(phase[1]+x*s+y*c)];
  const ink=(x,y)=>{if(x>=0&&x<width&&y>=0&&y<height) pixels[y*width+x]=0;};
  const draw=(a,b)=>{
    const dx=b[0]-a[0],dy=b[1]-a[1];
    const count=Math.max(1,Math.ceil(Math.max(Math.abs(dx),Math.abs(dy))*2));
    for(let step=0;step<=count;step++){
      const x=Math.round(a[0]+dx*step/count),y=Math.round(a[1]+dy*step/count);
      for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++)ink(x+ox,y+oy);
    }
  };
  // Clip ONLY at the raster border; never repair or warp the source image.
  for(let u=-9;u<=9;u++)for(let v=-9;v<=9;v++)
    for(const poly of polygons){
      const points=poly.map(([x,y])=>pos([x+basis[0][0]*u+basis[1][0]*v,
        y+basis[0][1]*u+basis[1][1]*v]));
      for(let side=0;side<points.length;side++)
        draw(points[side],points[(side+1)%points.length]);
    }
  const random=rng(seed);
  for(let i=0;i<distractorCount;i++){
    const x=Math.floor(random()*width), y=Math.floor(random()*height);
    const theta=random()*Math.PI*2, distance=9+random()*18;
    draw([x,y],[Math.round(x+Math.cos(theta)*distance),
      Math.round(y+Math.sin(theta)*distance)]);
  }
  if(noise>0)for(let i=0;i<pixels.length;i++)
    pixels[i]=Math.max(0,Math.min(255,
      Math.round(pixels[i]+noise*(random()*2-1))));
  return {width,height,pixels};
}
function witnessSymbol(shape){
  const {polygons,basis}=shape;
  return deriveTranslationMotif({
    units:'pixel',basis:basis.map(([x,y])=>({x,y})),
    cells:polygons.map((polygon,i)=>({
      id:`unregistered-${i}`,
      polygon:polygon.map(([x,y])=>({x,y}))
    }))
  }).translationSymbol;
}
function inspectSample(label,raster,expected){
  const started=performance.now();
  const result=investigatePeriodicMotif(raster,{
    translation:{minDistance:18,maxDistance:220,maxPairVotes:300_000}
  });
  const durationMs=Math.round(performance.now()-started);
  const observed=result.status==='consistent-candidate'
    ? result.candidateDsSymbol:null;
  const correct=observed!==null&&observed===expected;
  const wrong=observed!==null&&observed!==expected;
  const summary={label,status:result.status,correct,wrong,durationMs,
    checkedHypotheses:result.checkedHypotheses,
    edgeSupport:result.status==='consistent-candidate'
      ?Number(result.originalRasterEdgeSupport.toFixed(3)):null,
    maximumCornerDriftPixels:result.status==='consistent-candidate'
      ?Number(result.maximumRigidVertexResidualPixels.toFixed(2)):null};
  // Machine-readable diagnostic lines can be aggregated from CI output.
  process.stdout.write('PHASE16_HELDOUT '+JSON.stringify(summary)+'\\n');
  if(wrong)process.stderr.write(label+' produced an incorrect D-symbol: '+
    JSON.stringify({actual:observed,expected})+'\\n');
  if (!observed && label.startsWith('mixed-')) {
    const search=evaluateOriginalRasterTranslations(raster,
      {minDistance:18,maxDistance:220,maxPairVotes:300_000,maxHypotheses:5});
    const stages=[];
    for(const candidate of search.hypotheses){
      const interior=observeMotifInteriors(raster,candidate.basis);
      const fit=interior.status==='observed'
        ?refineRigidTranslationBasis(interior,candidate.basis):null;
      const basis=fit?.status==='refined'?fit.basis:candidate.basis;
      const topology=interior.status==='observed'
        ?deriveObservedTopology(interior,basis):null;
      const globalFit=topology?.status==='derived'
        ?verifyRigidMotifFit(raster,interior,basis):null;
      stages.push({
        det:Math.round(Math.abs(candidate.basis[0].x*candidate.basis[1].y-
          candidate.basis[0].y*candidate.basis[1].x)),
        interiors:interior.status,interiorReason:interior.reason,
        motifClasses:interior.classes?.length??0,
        topology:topology?.status??null,topologyReason:topology?.reason??null,
        rigid:globalFit?.status??null,rigidReason:globalFit?.reason??null
      });
    }
    process.stdout.write('PHASE16_STAGE '+JSON.stringify({
      label,search:search.status,searchReason:search.reason,stages
    })+'\\n');
  }
  return summary;
}
test('new seeded multi-orbit tilings: bounded correct identities, no confidently wrong motifs',()=>{
  const configs=[
    {seed:1907,rotation:0,scale:1,noise:0},
    {seed:2911,rotation:8,scale:1.1,noise:0},
    {seed:5023,rotation:-7,scale:1,noise:7},
    {seed:8011,rotation:0,scale:0.96,noise:0}
  ];
  const records=configs.map(cfg=>{
    const shape=polygonsFor(cfg.seed);
    return inspectSample('mixed-'+cfg.seed,
      rasterize(shape.polygons,shape.basis,{...cfg,seed:cfg.seed+47}),
      witnessSymbol(shape));
  });
  assert.ok(records.every(x=>!x.wrong),
    'A plausible but incorrect topology is not an acceptable research candidate');
  assert.ok(records.filter(x=>x.correct).length>=2,
    'At least two held-out multi-orbit motifs must reconstruct exactly');
});
test('crop and distractor stress are inconclusive or structurally correct, never confidently wrong',()=>{
  const configs=[
    {seed:14011,width:520,height:510,rotation:9,noise:0,phase:[11,21]},
    {seed:24109,width:640,height:640,rotation:-6,noise:9,distractorCount:16}
  ];
  const records=configs.map(cfg=>{
    const shape=polygonsFor(cfg.seed);
    return inspectSample('stress-'+cfg.seed,
      rasterize(shape.polygons,shape.basis,{...cfg,seed:cfg.seed+97}),
      witnessSymbol(shape));
  });
  assert.ok(records.every(x=>!x.wrong),
    'Partly obscured/cropped images must not produce incorrect authoritative-looking candidates');
});
test('texture-only and conflicting aperiodic strokes never produce a pattern identity',()=>{
  for(const seed of [311,719]){
    const random=rng(seed),width=480,height=480;
    const pixels=new Uint8Array(width*height);
    for(let i=0;i<pixels.length;i++)
      pixels[i]=seed===311?Math.round(255*random())
        :Math.round(160+70*(random()-.5));
    const result=inspectSample('negative-'+seed,{width,height,pixels},null);
    assert.equal(result.status==='consistent-candidate',false,
      'Gridless texture cannot be promoted to a geometric tiling identity');
  }
});
