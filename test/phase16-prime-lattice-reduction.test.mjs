import test from 'node:test';
import assert from 'node:assert/strict';
import {observeMotifInteriors} from '../dist/src/analysis/periodic-tiling/motif-interiors.js';
import {deriveObservedTopology} from '../dist/src/analysis/periodic-tiling/observed-topology.js';
import {recoverPrimitiveObservedLattice} from '../dist/src/analysis/periodic-tiling/primitive-lattice.js';

// A rectangular grid with deliberately oversized supplied search lattices.
// The image observations, not these test-only bases, decide which reductions
// are periods. No expected D-symbol or shape name enters the reduction kernel.
const P=(x,y)=>({x,y});
function imageAt(verticals){
  const width=640,height=640,pixels=new Uint8Array(width*height).fill(255);
  const stroke=(x,y)=>{
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
      const xx=x+dx,yy=y+dy;
      if(xx>=0&&xx<width&&yy>=0&&yy<height)pixels[yy*width+xx]=0;
    }
  };
  for(const x of verticals)for(let y=0;y<height;y++)stroke(x,y);
  for(let y=30;y<height;y+=60)for(let x=0;x<width;x++)stroke(x,y);
  return {width,height,pixels};
}
function witness(raster,basis) {
  const interior=observeMotifInteriors(raster,basis);
  assert.equal(interior.status,'observed',interior.reason);
  const topology=deriveObservedTopology(interior,basis);
  assert.equal(topology.status,'derived',topology.reason);
  return {basis,interior,topology,rasterSupport:1,rigidResidual:0};
}
test('a threefold geometric translation cover reduces to its proved primitive image period',()=>{
  const raster=imageAt(Array.from({length:11},(_,i)=>30+i*60));
  const oversized=witness(raster,[P(180,0),P(0,60)]);
  assert.equal(oversized.interior.classes.length,3);
  const reduced=recoverPrimitiveObservedLattice(raster,oversized);
  assert.equal(reduced.status,'verified',reduced.reason);
  assert.equal(reduced.reductions,1);
  assert.equal(reduced.candidate.interior.classes.length,1);
  assert.equal(Math.abs(reduced.candidate.basis[0].x*reduced.candidate.basis[1].y-
    reduced.candidate.basis[0].y*reduced.candidate.basis[1].x),3600);
});
test('differently sized neighboring cells cannot be merged by a false half period',()=>{
  const lines=[];
  for(let start=30;start<=630;start+=120)lines.push(start,start+40);
  const raster=imageAt(lines);
  const input=witness(raster,[P(120,0),P(0,60)]);
  assert.equal(input.interior.classes.length,2);
  const reduced=recoverPrimitiveObservedLattice(raster,input);
  assert.equal(reduced.status,'verified',reduced.reason);
  assert.equal(reduced.reductions,0);
  assert.equal(reduced.candidate.interior.classes.length,2);
});
