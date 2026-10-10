import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveTranslationMotif } from '../dist/src/resources/periodic-tiling/topology/motif.js';

const point=(x,y)=>({x,y});
const add=(a,b)=>point(a.x+b.x,a.y+b.y);
const sub=(a,b)=>point(a.x-b.x,a.y-b.y);

test('periodic mixed polygons sharing long rotated edges are not falsely classified as overlaps',()=>{
  // An unfamiliar affine square-plus-triangles arrangement. Repeated
  // coordinates are constructed via separate floating-point additions and
  // subtractions, as in the real source-image joint vertex fit.
  const origin=point(29.067,35.992),seam=point(98.637,54.925);
  const a=point(137.192,31.673),b=point(-15.836,68.596);
  const result=deriveTranslationMotif({units:'pixel',basis:[a,b],cells:[
    {id:'quadrilateral',polygon:[origin,seam,add(seam,b),add(origin,b)]},
    {id:'first-triangle',polygon:[sub(seam,a),origin,add(origin,b)]},
    {id:'second-triangle',polygon:[sub(seam,b),add(origin,a),seam]}
  ]});
  assert.equal(result.kind,'witness-verified');
  assert.equal(result.cells.length,3);
  assert.ok(result.cells.every(cell=>cell.boundary.length===cell.polygon.length));
});

test('real 0.02-unit interior overlap is still rejected despite exact motif area',()=>{
  assert.throws(()=>deriveTranslationMotif({
    units:'unit',
    basis:[point(2,0),point(0,1)],
    cells:[
      {id:'first',polygon:[point(0,0),point(1,0),point(1,1),point(0,1)]},
      {id:'overlapping',polygon:[
        point(.98,0),point(1.98,0),point(1.98,1),point(.98,1)]}
    ]
  }),/Polygon interiors overlap/);
});
