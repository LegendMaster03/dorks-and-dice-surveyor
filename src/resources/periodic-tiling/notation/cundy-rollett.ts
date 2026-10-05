import { PeriodicTilingNotationError } from "../types.js";

export type CundyRollettPolygonFactor = {
    sides: number;
    repeat: number;
};

export type CundyRollettVertex = {
    factors: CundyRollettPolygonFactor[];
    multiplicity: number;
};

export type CundyRollettNotation = {
    notation: "Cundy-Rollett";
    canonical: string;
    vertices: CundyRollettVertex[];
    variant?: number;
    regularVertex?: {
        polygonSides: number;
        polygonsAtVertex: number;
    };
};

const superscriptDigits: Record<string, string> = {
    "⁰": "0",
    "¹": "1",
    "²": "2",
    "³": "3",
    "⁴": "4",
    "⁵": "5",
    "⁶": "6",
    "⁷": "7",
    "⁸": "8",
    "⁹": "9"
};
const subscriptDigits: Record<string, string> = {
    "₀": "0",
    "₁": "1",
    "₂": "2",
    "₃": "3",
    "₄": "4",
    "₅": "5",
    "₆": "6",
    "₇": "7",
    "₈": "8",
    "₉": "9"
};
const maximumNotationLength = 4096;
const maximumNestingDepth = 16;
const angleTolerance = 1e-7;

export function parseCundyRollettNotation(raw: string): CundyRollettNotation {
    let source = normalizeInput(raw);
    let variant: number | undefined;

    // Published Cundy-Rollett tables distinguish otherwise non-unique tilings with
    // a subscript on the complete bracketed vertex list, for example
    // [3^6;3^4.6]_1 and [3^6;3^4.6]_2. This is not a polygon/vertex exponent.
    const bracketed = /^\[(.*)\](?:_([1-9][0-9]*))?$/.exec(source);
    if (bracketed) {
        source = bracketed[1];
        variant = bracketed[2] == null ? undefined : parsePositiveInteger(bracketed[2], "variant");
    } else if (source.includes("[") || source.includes("]")) {
        throw syntaxError("Square brackets must wrap the complete Cundy-Rollett expression, with an optional subscript variant.");
    }

    const vertexSources = splitVertices(source);
    if (vertexSources.length === 0 || vertexSources.some(value => value.length === 0)) {
        throw syntaxError("Cundy-Rollett notation must contain at least one vertex configuration.");
    }

    const vertices = canonicalizeVertices(vertexSources.map(parseVertex));
    const canonicalBody = vertices.map(serializeVertex).join(";");
    const canonical = variant == null ? canonicalBody : `[${canonicalBody}]_${variant}`;
    const regularVertex = variant == null && vertices.length === 1 && vertices[0].multiplicity === 1
        ? deriveRegularVertex(vertices[0].factors)
        : undefined;

    return {
        notation: "Cundy-Rollett",
        canonical,
        vertices,
        ...(variant == null ? {} : { variant }),
        ...(regularVertex == null ? {} : { regularVertex })
    };
}

function normalizeInput(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) throw syntaxError("Cundy-Rollett notation can not be empty.");
    if (trimmed.length > maximumNotationLength) {
        throw syntaxError(`Cundy-Rollett notation can not exceed ${maximumNotationLength} characters.`);
    }

    return trimmed
        .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, value => `^${[...value].map(character => superscriptDigits[character]).join("")}`)
        .replace(/[₀₁₂₃₄₅₆₇₈₉]+/g, value => `_${[...value].map(character => subscriptDigits[character]).join("")}`)
        .replace(/\^\{([0-9]+)\}/g, "^$1")
        .replace(/_\{([0-9]+)\}/g, "_$1")
        .replace(/\s+/g, "");
}

function splitVertices(source: string): string[] {
    const values: string[] = [];
    let depth = 0;
    let start = 0;

    for (let index = 0; index < source.length; index += 1) {
        const character = source[index];
        if (character === "(") {
            depth += 1;
            if (depth > maximumNestingDepth) throw syntaxError("Cundy-Rollett grouping is nested too deeply.");
        } else if (character === ")") {
            depth -= 1;
            if (depth < 0) throw syntaxError("Cundy-Rollett notation contains an unmatched ')'.");
        } else if (character === ";" && depth === 0) {
            values.push(source.slice(start, index));
            start = index + 1;
        }
    }

    if (depth !== 0) throw syntaxError("Cundy-Rollett notation contains an unclosed parenthesized expression.");
    values.push(source.slice(start));
    return values;
}

function parseVertex(source: string): CundyRollettVertex {
    if (!source) throw syntaxError("A Cundy-Rollett vertex configuration can not be empty.");

    const wholeRepeat = unwrapWholeRepeatedGroup(source);
    if (wholeRepeat != null) {
        const baseSides = new SequenceParser(wholeRepeat.body).parse();
        const baseAngle = angleSum(baseSides);
        const repeatedAngle = baseAngle * wholeRepeat.repeat;

        if (closesVertex(baseAngle)) {
            return {
                factors: factorsFromCanonicalCycle(baseSides),
                multiplicity: wholeRepeat.repeat
            };
        }
        if (closesVertex(repeatedAngle)) {
            return {
                factors: factorsFromCanonicalCycle(repeatSides(baseSides, wholeRepeat.repeat)),
                multiplicity: 1
            };
        }
        throw syntaxError(
            `Parenthesized Cundy-Rollett repetition '${source}' does not resolve to complete 360-degree Euclidean vertex configurations.`);
    }

    const sides = new SequenceParser(source).parse();
    if (!closesVertex(angleSum(sides))) {
        throw syntaxError(`Cundy-Rollett vertex configuration '${source}' does not close to 360 degrees.`);
    }
    return { factors: factorsFromCanonicalCycle(sides), multiplicity: 1 };
}

class SequenceParser {
    private index = 0;

    constructor(private readonly source: string) {}

    parse(): number[] {
        if (!this.source) throw syntaxError("A Cundy-Rollett polygon sequence can not be empty.");
        const sides = this.parseSequence(undefined, 0);
        if (this.index !== this.source.length) {
            throw syntaxError(`Unexpected token '${this.source[this.index]}' in Cundy-Rollett notation.`);
        }
        return sides;
    }

    private parseSequence(stop: string | undefined, depth: number): number[] {
        if (depth > maximumNestingDepth) throw syntaxError("Cundy-Rollett grouping is nested too deeply.");
        const sides: number[] = [];
        let expectFactor = true;

        while (this.index < this.source.length) {
            const character = this.source[this.index];
            if (stop != null && character === stop) break;

            if (expectFactor) {
                if (character === ".") throw syntaxError("Cundy-Rollett notation can not contain an empty polygon position.");
                appendRepeated(sides, this.parseTerm(depth), 1);
                expectFactor = false;
                continue;
            }

            if (character !== ".") {
                throw syntaxError(`Expected '.' between Cundy-Rollett polygon terms at position ${this.index + 1}.`);
            }
            this.index += 1;
            expectFactor = true;
        }

        if (expectFactor && sides.length > 0) {
            throw syntaxError("Cundy-Rollett notation can not end a polygon sequence with '.'.");
        }
        return sides;
    }

    private parseTerm(depth: number): number[] {
        if (this.source[this.index] === "(") {
            this.index += 1;
            const grouped = this.parseSequence(")", depth + 1);
            if (this.source[this.index] !== ")") {
                throw syntaxError("Cundy-Rollett notation contains an unclosed parenthesized polygon group.");
            }
            this.index += 1;
            if (grouped.length === 0) throw syntaxError("Cundy-Rollett polygon groups can not be empty.");
            const repeat = this.parseOptionalExponent();
            return repeatSides(grouped, repeat);
        }

        if (!isDigit(this.source[this.index])) {
            throw syntaxError(`Expected a polygon side count at position ${this.index + 1}.`);
        }
        const sides = this.parseInteger();
        if (sides < 3) throw syntaxError("Regular polygons in Cundy-Rollett notation must have at least 3 sides.");
        return repeatSides([sides], this.parseOptionalExponent());
    }

    private parseOptionalExponent(): number {
        if (this.source[this.index] !== "^") return 1;
        this.index += 1;
        if (!isDigit(this.source[this.index])) {
            throw syntaxError("A Cundy-Rollett exponent must contain a positive integer.");
        }
        return parsePositiveInteger(String(this.parseInteger()), "exponent");
    }

    private parseInteger(): number {
        const start = this.index;
        while (this.index < this.source.length && isDigit(this.source[this.index])) this.index += 1;
        const value = Number(this.source.slice(start, this.index));
        if (!Number.isSafeInteger(value)) throw syntaxError("Cundy-Rollett integers must be safe integers.");
        return value;
    }
}

function unwrapWholeRepeatedGroup(source: string): { body: string; repeat: number } | undefined {
    if (!source.startsWith("(")) return undefined;

    let depth = 0;
    for (let index = 0; index < source.length; index += 1) {
        const character = source[index];
        if (character === "(") depth += 1;
        else if (character === ")") {
            depth -= 1;
            if (depth === 0) {
                const suffix = source.slice(index + 1);
                if (suffix === "") {
                    return { body: source.slice(1, index), repeat: 1 };
                }
                const exponent = /^\^([1-9][0-9]*)$/.exec(suffix);
                if (!exponent) return undefined;
                return {
                    body: source.slice(1, index),
                    repeat: parsePositiveInteger(exponent[1], "repetition")
                };
            }
        }
    }
    return undefined;
}

function repeatSides(sides: number[], repeat: number): number[] {
    const result: number[] = [];
    for (let index = 0; index < repeat; index += 1) {
        result.push(...sides);
        if (angleSum(result) > 360 + angleTolerance) {
            throw syntaxError("Cundy-Rollett polygon repetition exceeds a complete Euclidean vertex.");
        }
    }
    return result;
}

function appendRepeated(target: number[], source: number[], repeat: number): void {
    for (let index = 0; index < repeat; index += 1) target.push(...source);
    if (angleSum(target) > 360 + angleTolerance) {
        throw syntaxError("Cundy-Rollett polygon sequence exceeds a complete Euclidean vertex.");
    }
}

function angleSum(sides: number[]): number {
    return sides.reduce((sum, polygonSides) => sum + 180 * (polygonSides - 2) / polygonSides, 0);
}

function closesVertex(angle: number): boolean {
    return Math.abs(angle - 360) <= angleTolerance;
}

function factorsFromCanonicalCycle(sides: number[]): CundyRollettPolygonFactor[] {
    const canonical = canonicalCycle(sides);
    const factors: CundyRollettPolygonFactor[] = [];
    for (const polygonSides of canonical) {
        const previous = factors.at(-1);
        if (previous?.sides === polygonSides) previous.repeat += 1;
        else factors.push({ sides: polygonSides, repeat: 1 });
    }
    return factors;
}

function canonicalCycle(sides: number[]): number[] {
    if (sides.length <= 1) return [...sides];
    const candidates: number[][] = [];
    const reversed = [...sides].reverse();
    for (const sequence of [sides, reversed]) {
        for (let offset = 0; offset < sequence.length; offset += 1) {
            candidates.push([...sequence.slice(offset), ...sequence.slice(0, offset)]);
        }
    }
    candidates.sort(compareNumberSequences);
    return candidates[0];
}

function compareNumberSequences(left: number[], right: number[]): number {
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
        if (left[index] !== right[index]) return left[index] - right[index];
    }
    return left.length - right.length;
}

function canonicalizeVertices(vertices: CundyRollettVertex[]): CundyRollettVertex[] {
    const sorted = vertices.map(vertex => ({
        factors: vertex.factors.map(factor => ({ ...factor })),
        multiplicity: vertex.multiplicity
    })).sort((left, right) => compareNumberSequences(expandFactors(left.factors), expandFactors(right.factors)));

    const result: CundyRollettVertex[] = [];
    for (const vertex of sorted) {
        const previous = result.at(-1);
        if (previous != null && sameFactors(previous.factors, vertex.factors)) {
            previous.multiplicity += vertex.multiplicity;
        } else {
            result.push(vertex);
        }
    }
    return result;
}

function expandFactors(factors: CundyRollettPolygonFactor[]): number[] {
    return factors.flatMap(factor => Array.from({ length: factor.repeat }, () => factor.sides));
}

function sameFactors(left: CundyRollettPolygonFactor[], right: CundyRollettPolygonFactor[]): boolean {
    return left.length === right.length
        && left.every((factor, index) => factor.sides === right[index].sides && factor.repeat === right[index].repeat);
}

function serializeVertex(vertex: CundyRollettVertex): string {
    const factors = serializeFactors(vertex.factors);
    return vertex.multiplicity === 1 ? factors : `(${factors})^${vertex.multiplicity}`;
}

function serializeFactors(factors: CundyRollettPolygonFactor[]): string {
    return factors.map(factor => factor.repeat === 1 ? String(factor.sides) : `${factor.sides}^${factor.repeat}`).join(".");
}

function deriveRegularVertex(factors: CundyRollettPolygonFactor[]): CundyRollettNotation["regularVertex"] {
    if (factors.length !== 1) return undefined;
    return {
        polygonSides: factors[0].sides,
        polygonsAtVertex: factors[0].repeat
    };
}

function parsePositiveInteger(raw: string, label: string): number {
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1) {
        throw syntaxError(`Cundy-Rollett ${label} must be a positive safe integer.`);
    }
    return value;
}

function isDigit(value: string | undefined): boolean {
    return value != null && value >= "0" && value <= "9";
}

function syntaxError(message: string): PeriodicTilingNotationError {
    return new PeriodicTilingNotationError("Cundy-Rollett", message);
}
