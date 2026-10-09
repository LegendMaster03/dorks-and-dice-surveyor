import assert from 'node:assert/strict';
import test from 'node:test';
import {refineRigidTranslationBasis} from '../dist/src/analysis/periodic-tiling/rigid-basis-refinement.js';

function observations(basis, classes=3, noise=0) {
 const interiors=[];
 for (let c=0;c<classes;c++)for(let u=0;u<5;u++)for(let v=0;v<5;v++) {
   const x=18+c*11 + u*basis[0].x+v*basis[1].x;
   const y=24+c*7 + u*basis[0].y+v*basis[1].y;
   const perturbX=noise*Math.sin(u*3+v*7+c*5), perturbY=noise*Math.cos(u*2+v*3+c*11);
   interiors.push({motifClass:c,centroid:{x:x+perturbX,y:y+perturbY},polygon:[],pixels:500});
 }
 return {status:'observed', classes:Array.from({length:classes},(_,id)=>({id,sideCount:4,examples:25})),interiors};
}

test('fits one continuous rigid lattice over repeated, independently phased motif cells',()=>{
 const angle=13*Math.PI/180, scale=1.1;
 const actual=[{x:128*Math.cos(angle)*scale,y:128*Math.sin(angle)*scale},
   {x:-64*Math.sin(angle)*scale,y:64*Math.cos(angle)*scale}];
 const proposed=[{x:Math.round(actual[0].x),y:Math.round(actual[0].y)},
   {x:Math.round(actual[1].x),y:Math.round(actual[1].y)}];
 const r=refineRigidTranslationBasis(observations(actual,3,0.3),proposed);
 assert.equal(r.status,'refined',r.reason);
 assert.ok(r.residualPixels<r.initialResidualPixels);
 assert.ok(r.residualPixels<.5);
 for(let k=0;k<2;k++)assert.ok(Math.hypot(r.basis[k].x-actual[k].x,r.basis[k].y-actual[k].y)<.2);
 assert.ok(r.translationSpread>=4);
});

test('refinement is invariant to input ordering and large absolute pixel phase',()=>{
 const actual=[{x:120.25,y:9.5},{x:-17.4,y:69.75}];
 const observed=observations(actual,2,0.2);
 const guess=[{x:120,y:10},{x:-17,y:70}];
 const r=refineRigidTranslationBasis(observed,guess);
 const swapped=refineRigidTranslationBasis({...observed,interiors:[...observed.interiors].reverse()},guess);
 assert.equal(r.status,'refined',r.reason);assert.equal(swapped.status,'refined',swapped.reason);
 for(let k=0;k<2;k++)for(const axis of ['x','y'])assert.ok(Math.abs(r.basis[k][axis]-swapped.basis[k][axis])<1e-9);
});

test('underconstrained, malformed, and inaccurate seeds fail without a made-up fitted basis',()=>{
 const observed=observations([{x:128,y:0},{x:0,y:64}]);
 assert.equal(refineRigidTranslationBasis(observed,[{x:150,y:0},{x:0,y:64}]).status,'inconclusive');
 assert.equal(refineRigidTranslationBasis(observed,[{x:0,y:0},{x:0,y:64}]).status,'unsupported');
 assert.equal(refineRigidTranslationBasis({...observed,interiors:observed.interiors.slice(0,5)},[{x:128,y:0},{x:0,y:64}]).status,'inconclusive');
 assert.equal(refineRigidTranslationBasis(observed,[{x:128,y:0},{x:0,y:64}],{maximumCorrectionPixels:Infinity}).status,'unsupported');
});
