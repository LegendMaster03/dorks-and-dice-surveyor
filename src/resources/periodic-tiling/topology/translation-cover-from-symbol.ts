import { inspectDSymbol, type DSymbol } from "./d-symbol.js";

export type AbstractTranslationAdjacency = {
    edge: number;
    targetCell: number;
    reciprocalEdge: number;
    shift: readonly [number, number];
};
export type AbstractTranslationCell = {
    id: number;
    sides: number;
    boundary: readonly AbstractTranslationAdjacency[];
};
export type TranslationCoverFromSymbol =
    | { status: "constructed"; sourceSymbol: string; cells: readonly AbstractTranslationCell[];
        translationGenerators: 2; chamberCount: number; EulerCharacteristic: 0 }
    | { status: "unsupported" | "inconclusive" | "invalid"; reason: string };

/**
 * Construct a Z² translational chamber cover directly from a fully expanded,
 * unbranched, orientable torus D-symbol. No metric realization, image, named
 * pattern, or user-provided translation motif is required.
 *
 * A general symmetry-quotient D-symbol may encode mirrors or rotation
 * stabilizers and is NOT necessarily an unbranched translation presentation.
 * Such inputs are rejected explicitly, rather than being mistaken for a torus.
 *
 * The construction uses a tree/cotree decomposition of the cellular dual:
 * a spanning tree in the primal 1-skeleton, a disjoint spanning tree in the
 * dual, and the two remaining edges as H¹ generators. Dual-face closure
 * relations determine all primal-tree voltages exactly over Z².
 */
export function constructTranslationCoverFromSymbol(source: string, limit = 1024): TranslationCoverFromSymbol {
    const unsupported = (reason: string): TranslationCoverFromSymbol => ({status:"unsupported",reason});
    const inconclusive = (reason: string): TranslationCoverFromSymbol => ({status:"inconclusive",reason});
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2048) return unsupported("Invalid bounded chamber limit");
    const check = inspectDSymbol(source, limit);
    if (check.status === "limit-exceeded") return unsupported("D-symbol exceeds bounded chamber capacity");
    if (check.status !== "euclidean") return {status:"invalid",reason:`A valid Euclidean D-symbol is required (${check.status})`};
    const symbol: DSymbol = check.symbol;
    if (!symbol.fixedPointFree || !symbol.weaklyOrientable)
        return unsupported("A finite unbranched orientable torus presentation is required; a symmetry quotient needs unfolding");
    const [s0,s1,s2]=symbol.involutions, n=symbol.chamberCount;

    // Enumerate graph orbits deterministically by least chamber index.
    function partition(i:number,j:number): {orbits:number[][];which:number[]} {
        const which = new Array<number>(n+1).fill(-1), orbits:number[][]=[];
        for(let start=1;start<=n;start++) {
            if(which[start]!==-1)continue;
            const id=orbits.length,items=[start];which[start]=id;
            for(let k=0;k<items.length;k++)for(const next of [symbol.involutions[i][items[k]],symbol.involutions[j][items[k]]]){
                if(which[next]===-1){which[next]=id;items.push(next);}
            }
            items.sort((a,b)=>a-b);orbits.push(items);
        }
        return {orbits,which};
    }
    const faces=partition(0,1), edges=partition(0,2), vertices=partition(1,2);
    const F=faces.orbits.length,E=edges.orbits.length,V=vertices.orbits.length;
    if(F<1 || E<1 || V<1 || V-E+F!==0)
        return unsupported("The chamber quotient is not a combinatorial torus");
    if(E>1024||F>256||V>512) return unsupported("Torus quotient exceeds bounded construction limits");
    for(const orbit of faces.orbits) {
        const m=symbol.m01[orbit[0]];
        if(orbit.length!==2*m || orbit.some(c=>symbol.m01[c]!==m))
            return unsupported("A face is locally branched under the supplied symmetry group");
    }
    for(const orbit of vertices.orbits) {
        const m=symbol.m12[orbit[0]];
        if(orbit.length!==2*m || orbit.some(c=>symbol.m12[c]!==m))
            return unsupported("A vertex is locally branched under the supplied symmetry group");
    }
    for(const orbit of edges.orbits) if(orbit.length!==4)
        return unsupported("A quotient edge has a stabilizer; its translation cover must be unfolded first");

    type Edge = {id:number;faceA:number;faceB:number;vertexA:number;vertexB:number;
        source:ReadonlySet<number>; voltage:[number,number]|null};
    const graph: Edge[] = [];
    for(let e=0;e<E;e++) {
        const root=edges.orbits[e][0], sourceFlags=new Set([root,s0[root]]);
        const opposite=new Set([s2[root],s2[s0[root]]]);
        if(sourceFlags.size!==2 || opposite.size!==2 || [...sourceFlags].some(c=>opposite.has(c)))
            return unsupported("The chamber edge has invalid endpoint or side orientation");
        const faceA=faces.which[root],faceB=faces.which[s2[root]];
        const vertexA=vertices.which[root],vertexB=vertices.which[s0[root]];
        if([...sourceFlags].some(c=>faces.which[c]!==faceA) ||
            [...opposite].some(c=>faces.which[c]!==faceB))
            return unsupported("The quotient does not define two consistent cell sides per edge");
        graph.push({id:e,faceA,faceB,vertexA,vertexB,source:sourceFlags,voltage:null});
    }

    // Dual-face relations: walk s2 then s1 around each primal vertex.
    const constraints: Array<Map<number,number>>=[];
    for(const orbit of vertices.orbits){
        const coefficients=new Map<number,number>();
        let chamber=orbit[0],count=0;
        do {
            const e=edges.which[chamber], edge=graph[e];
            coefficients.set(e,(coefficients.get(e)??0)+(edge.source.has(chamber)?1:-1));
            chamber=s1[s2[chamber]];
            if(++count>n) return unsupported("Vertex rotation did not close");
        } while(chamber!==orbit[0]);
        if(count*2!==orbit.length) return unsupported("Vertex rotation has an inconsistent chamber orbit");
        constraints.push(coefficients);
    }

    // Stable spanning tree of primal vertices. Loops are excluded automatically.
    function forest(size:number){
        const parent=Array.from({length:size},(_,i)=>i);
        function root(i:number):number {while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;}
        return {join:(a:number,b:number):boolean=>{a=root(a);b=root(b);if(a===b)return false;parent[b]=a;return true;}};
    }
    const primal=forest(V), primalTree=new Set<number>();
    for(const edge of graph)if(primal.join(edge.vertexA,edge.vertexB))primalTree.add(edge.id);
    if(primalTree.size!==V-1) return inconclusive("Primal vertex graph is disconnected");

    const dual=forest(F), dualTree=new Set<number>();
    for(const edge of graph){
        if(primalTree.has(edge.id))continue;
        if(dual.join(edge.faceA,edge.faceB))dualTree.add(edge.id);
    }
    if(dualTree.size!==F-1) return inconclusive("The complementary dual graph is disconnected");
    const generators=graph.filter(edge=>!primalTree.has(edge.id)&&!dualTree.has(edge.id));
    if(generators.length!==2) return inconclusive("The torus tree/cotree complement does not have two generators");
    graph[generators[0].id].voltage=[1,0];
    graph[generators[1].id].voltage=[0,1];
    for(const e of dualTree)graph[e].voltage=[0,0];

    // Solve remaining dual-face closure constraints leaf-to-root over a primal
    // spanning tree. This never guesses voltages or uses floating-point math.
    const adjacent=Array.from({length:V},()=>[] as {vertex:number;edge:number}[]);
    for(const e of primalTree){const edge=graph[e];
        adjacent[edge.vertexA].push({vertex:edge.vertexB,edge:e});
        adjacent[edge.vertexB].push({vertex:edge.vertexA,edge:e});
    }
    const parents=new Array<number>(V).fill(-1), parentEdges=new Array<number>(V).fill(-1);
    const order=[0];parents[0]=0;
    for(let cursor=0;cursor<order.length;cursor++)for(const next of adjacent[order[cursor]]){
        if(parents[next.vertex]!==-1)continue;
        parents[next.vertex]=order[cursor];parentEdges[next.vertex]=next.edge;order.push(next.vertex);
    }
    if(order.length!==V) return inconclusive("Primal spanning tree is not connected");
    for(let i=order.length-1;i>=1;i--){
        const vertex=order[i], e=parentEdges[vertex],coefficient=constraints[vertex].get(e)??0;
        if(Math.abs(coefficient)!==1) return unsupported("Cannot orient an unbranched primal-tree edge in the dual boundary");
        let x=0,y=0;
        for(const [k,multiplicity] of constraints[vertex]){
            if(k===e)continue;
            const voltage=graph[k].voltage;
            if(!voltage) return inconclusive("Dual-face elimination encountered an unassigned tree edge");
            x+=multiplicity*voltage[0];y+=multiplicity*voltage[1];
        }
        graph[e].voltage=[-x/coefficient,-y/coefficient];
    }
    for(let vertex=0;vertex<V;vertex++){
        let x=0,y=0;
        for(const [e,sign] of constraints[vertex]){
            const voltage=graph[e].voltage;
            if(!voltage)return inconclusive("A periodic boundary voltage remains unresolved");
            x+=sign*voltage[0];y+=sign*voltage[1];
        }
        if(x!==0||y!==0)return inconclusive("The inferred torus voltages do not close around a vertex");
    }

    // Enumerate each face boundary in combinatorial cyclic order, not edge-id
    // order, and derive the opposite cell and signed periodic displacement.
    const cells:AbstractTranslationCell[]=[];
    for(const orbit of faces.orbits){
        const face=faces.which[orbit[0]],sides=orbit.length/2;
        const sideFlags:number[]=[];
        let chamber=orbit[0];
        for(let i=0;i<sides;i++){
            if(faces.which[chamber]!==face) return inconclusive("A face walk left its source orbit");
            sideFlags.push(chamber);
            chamber=s1[s0[chamber]];
        }
        if(chamber!==orbit[0])
            return unsupported("A face's ordered boundary is ambiguous");
        const boundary=sideFlags.map((flag,side):AbstractTranslationAdjacency=>{
            const edge=graph[edges.which[flag]],positive=edge.source.has(flag);
            const voltage=edge.voltage!;
            return {edge:edge.id,targetCell:positive?edge.faceB:edge.faceA,reciprocalEdge:-1,
                shift:positive?[voltage[0],voltage[1]]:[-voltage[0],-voltage[1]]};
        });
        cells.push({id:face,sides,boundary});
    }
    for(const cell of cells)for(const side of cell.boundary){
        const neighbor=cells[side.targetCell];
        const reciprocal=neighbor.boundary.filter(b=>b.edge===side.edge &&
            b.shift[0]===-side.shift[0] && b.shift[1]===-side.shift[1]);
        if(reciprocal.length!==1)return inconclusive("The translation cover has a nonreciprocal boundary");
        // Each edge is unique in a given face, even when its other face is itself.
        side.reciprocalEdge=neighbor.boundary.indexOf(reciprocal[0]);
    }
    return {status:"constructed",sourceSymbol:symbol.canonical,cells,translationGenerators:2,
        chamberCount:n,EulerCharacteristic:0};
}
