import test from 'node:test';
import assert from 'node:assert/strict';
import {splitObservedTJunctionSides} from '../dist/src/analysis/periodic-tiling/raster-t-junctions.js';

const P = (x,y) => ({x,y});

test('junction repair requires two distinct opposing polygon cells at an interior split', () => {
  const upper = [P(0,0),P(100,0),P(100,50),P(0,50)];
  const left = [P(0,53),P(50,53),P(50,103),P(0,103)];
  const right = [P(50,53),P(100,53),P(100,103),P(50,103)];
  const result = splitObservedTJunctionSides([upper,left,right]);
  assert.equal(result.status,'split');
  assert.equal(result.restoredVertices,1);
  assert.equal(result.polygons[0].length,5);
  assert.ok(result.polygons[0].some(p=>Math.abs(p.x-50)<.01 && p.y===50));
  assert.equal(result.polygons[1].length,4);
  assert.equal(result.polygons[2].length,4);
});

test('a displaced opposing endpoint cannot invent a T-junction', () => {
  const upper = [P(0,0),P(100,0),P(100,50),P(0,50)];
  // The opposing line overlaps almost the entire boundary, but raster
  // corner uncertainty displaces its two endpoints along the stroke.
  const lower = [P(8,53),P(108,53),P(108,103),P(8,103)];
  const result = splitObservedTJunctionSides([upper,lower]);
  assert.equal(result.status,'split');
  assert.equal(result.restoredVertices,0);
  assert.deepEqual(result.polygons,[upper,lower]);
});
