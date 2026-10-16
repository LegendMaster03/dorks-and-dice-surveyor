import assert from "node:assert/strict";
import test from "node:test";
import { derivePeriodicallyCorroboratedInteriorMask } from "../dist/src/analysis/periodic-tiling/edge-derived-interiors.js";
import { observeMotifInteriors } from "../dist/src/analysis/periodic-tiling/motif-interiors.js";
import { investigatePeriodicMotif } from "../dist/src/analysis/periodic-tiling/experimental-observer.js";

/** A lattice and straight-line strokes are supplied ONLY to make the fixture,
 * never as a named tiling or known model inside the recovery algorithm.
 */
function rasterWithInterruptedLines(width=720,height=720,oblique=false) {
    const basis=oblique?[{x:72,y:0},{x:36,y:63}]
        :[{x:72,y:0},{x:0,y:72}];
    const pixels=new Uint8Array(width*height).fill(245);
    const stroke=(p,q,index)=>{
        const steps=Math.ceil(Math.hypot(p.x-q.x,p.y-q.y)*2);
        for(let k=0;k<=steps;k++){
            // Drop differently placed chunks from the same global line.
            // Different repetitions retain the lost source evidence.
            if((k+index*17)%101<17)continue;
            const x=Math.round(p.x+(q.x-p.x)*k/steps);
            const y=Math.round(p.y+(q.y-p.y)*k/steps);
            for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
                const xx=x+dx, yy=y+dy;
                if(xx>=0&&yy>=0&&xx<width&&yy<height)
                    pixels[yy*width+xx]=18;
            }
        }
    };
    let index=0;
    for(let u=-3;u<15;u++)for(let v=-3;v<15;v++){
        const p={x:20+u*basis[0].x+v*basis[1].x,
                 y:20+u*basis[0].y+v*basis[1].y};
        stroke(p,{x:p.x+basis[0].x,y:p.y+basis[0].y},index++);
        stroke(p,{x:p.x+basis[1].x,y:p.y+basis[1].y},index++);
    }
    return {raster:{width,height,pixels},basis};
}
test("periodic gradient corroboration rebuilds a non-authoritative mask from interrupted source lines",()=>{
    const {raster,basis}=rasterWithInterruptedLines();
    const before=raster.pixels.slice();
    const masks=derivePeriodicallyCorroboratedInteriorMask(raster,basis);
    assert.equal(masks.status,"generated",masks.reason);
    assert.ok(masks.masks[0].darkFraction>0.005);
    const observed=observeMotifInteriors(masks.masks[0].raster,basis);
    assert.equal(observed.status,"observed",observed.reason);
    assert.deepEqual(raster.pixels,before,"Image evidence must never be modified");
});
test("periodic evidence segmentation uses arbitrary oblique translation bases",()=>{
    const {raster,basis}=rasterWithInterruptedLines(720,720,true);
    const result=derivePeriodicallyCorroboratedInteriorMask(raster,basis);
    assert.equal(result.status,"generated",result.reason);
    assert.ok(result.masks[0].darkFraction>0.005);
});
test("absent periodic source edges and invalid candidate bases cannot invent verified maps",()=>{
    const width=360,height=360;
    const raster={width,height,pixels:new Uint8Array(width*height).fill(240)};
    const basis=[{x:60,y:0},{x:0,y:60}];
    assert.notEqual(derivePeriodicallyCorroboratedInteriorMask(raster,basis).status,"generated");
    assert.equal(investigatePeriodicMotif(raster).status,"inconclusive");
    assert.equal(derivePeriodicallyCorroboratedInteriorMask(raster,[basis[0],basis[0]]).status,"unsupported");
});
