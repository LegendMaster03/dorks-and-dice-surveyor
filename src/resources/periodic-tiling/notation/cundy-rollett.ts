import { PeriodicTilingNotationError } from "../types.js";

export type CundyRollettPolygonFactor = {
    kind: "polygon";
    sides: number;
    repeat: number;
};

export type CundyRollettGroupFactor = {
    kind: "group";
    factors: CundyRollettFactor[];
    repeat: number;
};

export type CundyRollettFactor = CundyRollettPolygonFactor | CundyRollettGroupFactor;

export type CundyRollettNotation = {
    notation: "Cundy-Rollett";
    canonical: string;
    vertices: CundyRollettFactor[][];
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

export function parseCundyRollettNotation(raw: string): CundyRollettNotation {
    let source = normalizeInput(raw);
    let variant: number | undefined;

    const bracketed = /^\[(.*)\](?:\^([1-9][0-9]*))?$/.exec(source);
    if (bracketed) {
        source = bracketed[1];
        variant = bracketed[2] == null ? undefined : parsePositiveInteger(bracketed[2], "variant");
    } else if (source.includes("[") || source.includes("]")) {
        throw syntaxError("Square brackets must wrap the complete Cundy-Rollett expression.");
    }

    const vertexSources = splitTopLevel(source, ";");
    if (vertexSources.length === 0 || vertexSources.some(value => value.length === 0)) {
        throw syntaxError("Cundy-Rollett notation must contain at least one vertex configuration.");
    }

    const vertices = vertexSources.map(value => new FactorParser(value).parse());
    const canonicalBody = vertices.map(serializeFactors).join(";");
    const canonical = variant == null ? canonicalBody : `[${canonicalBody}]^${variant}`;
    const regularVertex = variant == null && vertices.length === 1
        ? deriveRegularVertex(vertices[0])
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

    return trimmed
        .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, value => `^${[...value].map(character => superscriptDigits[character]).join("")}`)
        .replace(/\^\{([0-9]+)\}/g, "^$1")
        .replace(/\s+/g, "");
}

class FactorParser {
    private index = 0;

    constructor(private readonly source: string) {}

    parse(): CundyRollettFactor[] {
        if (!this.source) throw syntaxError("A vertex configuration can not be empty.");
        const factors = this.parseSequence(undefined);
        if (this.index !== this.source.length) {
            throw syntaxError(`Unexpected token '${this.source[this.index]}' in Cundy-Rollett notation.`);
        }
        return normalizeAdjacentPolygons(factors);
    }

    private parseSequence(stop: string | undefined): CundyRollettFactor[] {
        const factors: CundyRollettFactor[] = [];
        let expectFactor = true;

        while (this.index < this.source.length) {
            const character = this.source[this.index];
            if (stop != null && character === stop) break;

            if (expectFactor) {
                if (character === ".") throw syntaxError("Cundy-Rollett notation can not contain an empty polygon position.");
                factors.push(this.parseFactor());
                expectFactor = false;
                continue;
            }

            if (character !== ".") {
                throw syntaxError(`Expected '.' between Cundy-Rollett polygon factors at position ${this.index + 1}.`);
            }
            this.index += 1;
            expectFactor = true;
        }

        if (expectFactor && factors.length > 0) {
            throw syntaxError("Cundy-Rollett notation can not end a sequence with '.'.");
        }
        return normalizeAdjacentPolygons(factors);
    }

    private parseFactor(): CundyRollettFactor {
        const character = this.source[this.index];
        if (character === "(") {
            this.index += 1;
            const factors = this.parseSequence(")");
            if (this.source[this.index] !== ")") {
                throw syntaxError("Cundy-Rollett notation contains an unclosed parenthesized group.");
            }
            this.index += 1;
            if (factors.length === 0) throw syntaxError("Cundy-Rollett groups can not be empty.");
            return { kind: "group", factors, repeat: this.parseOptionalExponent() };
        }

        if (!isDigit(character)) {
            throw syntaxError(`Expected a polygon side count at position ${this.index + 1}.`);
        }
        const sides = this.parseInteger();
        if (sides < 3) throw syntaxError("Regular polygons in Cundy-Rollett notation must have at least 3 sides.");
        return { kind: "polygon", sides, repeat: this.parseOptionalExponent() };
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

function splitTopLevel(source: string, separator: string): string[] {
    const values: string[] = [];
    let depth = 0;
    let start = 0;

    for (let index = 0; index < source.length; index += 1) {
        const character = source[index];
        if (character === "(") depth += 1;
        else if (character === ")") {
            depth -= 1;
            if (depth < 0) throw syntaxError("Cundy-Rollett notation contains an unmatched ')'.");
        } else if (character === separator && depth === 0) {
            values.push(source.slice(start, index));
            start = index + 1;
        }
    }

    if (depth !== 0) throw syntaxError("Cundy-Rollett notation contains an unclosed parenthesized group.");
    values.push(source.slice(start));
    return values;
}

function normalizeAdjacentPolygons(factors: CundyRollettFactor[]): CundyRollettFactor[] {
    const normalized: CundyRollettFactor[] = [];
    for (const factor of factors) {
        const previous = normalized.at(-1);
        if (factor.kind === "polygon" && previous?.kind === "polygon" && previous.sides === factor.sides) {
            previous.repeat += factor.repeat;
        } else {
            normalized.push(factor);
        }
    }
    return normalized;
}

function serializeFactors(factors: CundyRollettFactor[]): string {
    return factors.map(factor => {
        if (factor.kind === "polygon") {
            return factor.repeat === 1 ? String(factor.sides) : `${factor.sides}^${factor.repeat}`;
        }
        const group = `(${serializeFactors(factor.factors)})`;
        return factor.repeat === 1 ? group : `${group}^${factor.repeat}`;
    }).join(".");
}

function deriveRegularVertex(factors: CundyRollettFactor[]): CundyRollettNotation["regularVertex"] {
    const polygons: number[] = [];
    if (!flattenFactors(factors, polygons, 128) || polygons.length === 0) return undefined;
    const polygonSides = polygons[0];
    if (polygons.some(value => value !== polygonSides)) return undefined;

    const interiorAngle = 180 * (polygonSides - 2) / polygonSides;
    if (Math.abs(interiorAngle * polygons.length - 360) > 1e-9) return undefined;
    return { polygonSides, polygonsAtVertex: polygons.length };
}

function flattenFactors(factors: CundyRollettFactor[], output: number[], limit: number): boolean {
    for (const factor of factors) {
        for (let repetition = 0; repetition < factor.repeat; repetition += 1) {
            if (factor.kind === "polygon") output.push(factor.sides);
            else if (!flattenFactors(factor.factors, output, limit)) return false;
            if (output.length > limit) return false;
        }
    }
    return true;
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
