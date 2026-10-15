import assert from "node:assert/strict";
import test from "node:test";
import { investigatePeriodicMotif } from "../dist/src/analysis/periodic-tiling/experimental-observer.js";

// Independent raster fixtures: the observer only receives pixels, not cell
// counts, vertices, shape names, or lattice vectors.
function image(width, height) {
    return { width, height, pixels: new Uint8Array(width * height).fill(255) };
}
function line(raster, x0, y0, x1, y1) {
    const steps = Math.ceil(Math.max(Math.abs(x1-x0),Math.abs(y1-y0))*2);
    for(let step=0;step<=steps;step++){
        const t=step/steps, x=Math.round(x0+(x1-x0)*t), y=Math.round(y0+(y1-y0)*t);
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
            const xx=x+dx,yy=y+dy;
            if(xx>=0&&xx<raster.width&&yy>=0&&yy<raster.height)
                raster.pixels[yy*raster.width+xx]=0;
        }
    }
}
function squareBoard() {
    const r=image(1152,1152),cell=128;
    for(let i=0;i<=9;i++){
        line(r,i*cell,0,i*cell,1151);
        line(r,0,i*cell,1151,i*cell);
    }
    return r;
}
function hexBoard() {
    const r=image(960,720),radius=60,dy=Math.sqrt(3)*radius;
    for(let u=-12;u<=12;u++)for(let v=-12;v<=12;v++){
        const cx=480+1.5*radius*u,cy=360+dy*(v+u/2);
        const points=Array.from({length:6},(_,i)=>{
            const angle=Math.PI*i/3;
            return [cx+radius*Math.cos(angle),cy+radius*Math.sin(angle)];
        });
        for(let i=0;i<6;i++)line(r,...points[i],...points[(i+1)%6]);
    }
    return r;
}
for(const [name,fixture] of [
    ["9x9 square printed-grid fixture",squareBoard],
    ["regular hex printed-grid fixture",hexBoard]
]){
    test(`experimentally observes the ${name} without supplied geometry`,()=>{
        const result=investigatePeriodicMotif(fixture());
        assert.equal(result.status,"consistent-candidate",
            `${name}: ${result.reason}; checked=${result.checkedHypotheses}`);
        assert.equal(result.metricRegistration.status,"registered");
        assert.equal(result.metricRegistration.sourceProjection.status,"supported");
    });
}
