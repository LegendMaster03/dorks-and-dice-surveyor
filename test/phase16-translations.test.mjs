import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverTranslations } from '../dist/src/analysis/periodic-tiling/translations.js';
function fixture(mixed=true) {
 const width=512,height=512;
 const edges=new Map();
 const base=[mixed?112:64,64],poly=mixed?[
 [[0,0],[64,0],[64,64],[0,64]],
 [[64,0],[112,0],[112,64]],
 [[64,0],[112,64],[64,64]]
 ]:[[[0,0],[64,0],[64,64],[0,64]]];
 for(let u=-1;u<7;u++)for(let v=-1;v<10;v++)for(const points of poly)for(let j=0;j<points.length;j++){
  const [ax,ay]=points[j],[bx,by]=points[(j+1)%points.length];
  const dx=bx-ax,dy=by-ay,steps=Math.max(Math.abs(dx),Math.abs(dy));
  const normal=(Math.atan2(dx,-dy)+Math.PI)%Math.PI;
  for(let n=0;n<=steps;n++){
   const x=Math.round(13+u*base[0]+ax+dx*n/steps),y=Math.round(25+v*base[1]+ay+dy*n/steps);
   if(x>=2&&y>=2&&x<width-2&&y<height-2)edges.set(`${x},${y}`,{x,y,normal});
  }
 }
 const samples=[...edges.values()].sort((a,b)=>a.y-b.y||a.x-b.x);
 return {width,height,strength:new Float32Array(width*height),samples};
}
test('mixed motif yields independent translated candidates',()=>{
 const r=discoverTranslations(fixture(),{minDistance:20,maxDistance:150});
 assert.equal(r.status,'candidates');
 assert.ok(r.hypotheses.length>0);
});
test('nonperiodic evidence is inconclusive',()=>{
 const f=fixture(false);
 f.samples=f.samples.filter((p,i)=>((p.x*31+p.y*23+i*19)%10)<2);
 const r=discoverTranslations(f,{minDistance:20,maxDistance:150});
 assert.equal(r.status,'inconclusive');
});

test('rigid rotated and scaled mixed motifs retain a coherent two-vector translation basis',()=>{
 const source=fixture();
 for (const [angleDegrees,scale] of [[14,1],[17,1.1]]) {
  const theta=angleDegrees*Math.PI/180,cos=Math.cos(theta)*scale,sin=Math.sin(theta)*scale;
  const transformed=new Map();
  for(const sample of source.samples){
   const x=Math.round(256+(sample.x-256)*cos-(sample.y-256)*sin);
   const y=Math.round(256+(sample.x-256)*sin+(sample.y-256)*cos);
   if(x<2||y<2||x>=510||y>=510)continue;
   transformed.set(`${x},${y}`,{x,y,normal:(sample.normal+theta+Math.PI)%Math.PI});
  }
  const field={width:512,height:512,strength:new Float32Array(512*512),samples:[...transformed.values()]};
  const analysis=discoverTranslations(field,{minDistance:20,maxDistance:155});
  assert.equal(analysis.status,'candidates');
  // Any unimodular change of translation basis is equivalent; compare lattice area.
  const actual=analysis.hypotheses.some(candidate=>{
   const [a,b]=candidate.basis;
   const area=Math.abs(a.x*b.y-a.y*b.x);
   return Math.abs(area-112*64*scale*scale)<112*64*scale*scale*.05;
  });
  assert.ok(actual,`No accurate lattice area at ${angleDegrees} degrees`);
 }
});
test('candidate exploration rejects nonfinite and nonpositive search limits',()=>{
 const field=fixture();
 assert.throws(()=>discoverTranslations(field,{maxDistance:Infinity}),RangeError);
 assert.throws(()=>discoverTranslations(field,{minDistance:NaN}),RangeError);
 assert.throws(()=>discoverTranslations(field,{maxPairVotes:-1}),RangeError);
});
test('strong repetition restricted to one corner is not enough for a global translation',()=>{
 const local=fixture();
 // Preserve a correct local grid but remove evidence from distant image regions.
 local.samples=local.samples.filter(sample=>sample.x<180&&sample.y<180);
 const result=discoverTranslations(local,{minDistance:20,maxDistance:150});
 assert.equal(result.status,'inconclusive');
});
