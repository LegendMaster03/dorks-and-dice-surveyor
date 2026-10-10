import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveTranslationMotif } from '../dist/src/resources/periodic-tiling/topology/motif.js';
import { compareDSymbols,projectChambers } from '../dist/src/resources/periodic-tiling/topology/equivalence.js';
import { inspectDSymbol } from '../dist/src/resources/periodic-tiling/topology/d-symbol.js';
import { verifyMetricChamberSymmetry as verify } from
    '../dist/src/resources/periodic-tiling/topology/metric-chamber-symmetry.js';
const p=(x,y)=>({x,y});
const motif=(a,b,points)=>deriveTranslationMotif({units:'pixel',basis:[a,b],
    cells:[{id:'cell',polygon:points.map(([x,y])=>p(x,y))}]});
const square=motif(p(1,0),p(0,1),[[0,0],[1,0],[1,1],[0,1]]);
const rectangle=motif(p(2,0),p(0,1),[[0,0],[2,0],[2,1],[0,1]]);
const skew=motif(p(1,0),p(.4,1),[[0,0],[1,0],[1.4,1],[.4,1]]);
const mixed=deriveTranslationMotif({units:'pixel',basis:[p(2,0),p(0,1)],
    cells:[{id:'square',polygon:[p(0,0),p(1,0),p(1,1),p(0,1)]},
        {id:'a',polygon:[p(1,0),p(2,0),p(2,1)]},
        {id:'b',polygon:[p(1,0),p(2,1),p(1,1)]}]});
const junction=deriveTranslationMotif({units:'pixel',basis:[p(2,0),p(0,1)],
    cells:[{id:'long',polygon:[p(0,0),p(1,0),p(1,1),p(0,1)]},
        {id:'low',polygon:[p(1,0),p(2,0),p(2,.5),p(1,.5)]},
        {id:'high',polygon:[p(1,.5),p(2,.5),p(2,1),p(1,1)]}]});

test('actual square metric admits all eight combinatorial chamber symmetries',()=>{
    const result=verify(square);
    assert.equal(result.status,'verified',result.reason);
    assert.equal(result.metricAutomorphisms,8);
    assert.equal(result.combinatorialAutomorphisms,8);
    assert.equal(result.metricQuotientDsSymbol,'<1:1,1,1:4,4>');
    assert.equal(result.quotientChambers,1);
    assert.equal(result.evidence,'complete-periodic-polygon-witness');
});
test('rectangle and oblique parallelogram forbid false combinatorial metric symmetries',()=>{
    const rect=verify(rectangle),oblique=verify(skew);
    assert.equal(rect.status,'verified',rect.reason);
    assert.equal(oblique.status,'verified',oblique.reason);
    assert.equal(rect.combinatorialAutomorphisms,8);
    assert.equal(rect.metricAutomorphisms,4);
    assert.equal(rect.quotientChambers,2);
    assert.equal(oblique.combinatorialAutomorphisms,8);
    assert.equal(oblique.metricAutomorphisms,2);
    assert.equal(oblique.quotientChambers,4);
    assert.notEqual(oblique.metricQuotientDsSymbol,'<1:1,1,1:4,4>');
    assert.equal(verify(skew,0.2).status,'unsupported',
        'A loose raster contour tolerance cannot be used as a symmetry proof');
});
test('mixed and T-junction witnesses retain valid Euclidean metric chamber quotients',()=>{
    for(const witness of [mixed,junction]){
        const result=verify(witness);
        assert.equal(result.status,'verified',result.reason);
        assert.ok(result.metricAutomorphisms>=1);
        assert.ok(result.metricAutomorphisms<=result.combinatorialAutomorphisms);
        assert.equal(result.translationDsSymbol,witness.translationSymbol);
        assert.equal(inspectDSymbol(result.metricQuotientDsSymbol).status,'euclidean');
        assert.ok(projectChambers(
            inspectDSymbol(witness.translationSymbol).symbol,
            inspectDSymbol(result.metricQuotientDsSymbol).symbol));
        assert.equal(compareDSymbols(witness.translationSymbol,result.metricQuotientDsSymbol,
            {commonCover:witness.translationSymbol}).status,'proven-equivalent');
    }
});
test('bad metric parameters cannot create false symmetry quotients',()=>{
    assert.equal(verify(square,NaN).status,'unsupported');
    assert.equal(verify(square,0).status,'unsupported');
    assert.equal(verify({...square,translationSymbol:'<1:1,1,1:4,4>'}).status,'inconclusive');
    assert.equal(verify({...square,basis:[p(1,0),p(1,0)]}).status,'unsupported');
});
