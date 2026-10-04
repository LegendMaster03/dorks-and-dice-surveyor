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

    const vertexSources = splitVertices(source);
    if (vertexSources.length === 0 || vertexSources.some(value => value.length === 0)) {
        throw syntaxError("Cundy-Rollett notation must contain at least one vertex configuration.");
    }

    const parsedVertices = vertexSources.map(parseVertex);
    const vertices = combineAdjacentEquivalentVertices(parsedVertices);
    const canonicalBody = vertices.map(serializeVertex).join(";");
    const canonical = variant == null ? canonicalBody : `[${canonicalBody}]^${variant}`;
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

    return trimmed
        .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, value => `^${[...value].map(character => superscriptDigits[character]).join("")}`)
        .replace(/\^\{([0-9]+)\}/g, "^$1")
        .replace(/\s+/g, "");
}

function splitVertices(source: string): string[] {
    const values: string[] = [];
    let depth = 0;
    let start = 0;

    for (let index = 0; index < source.length; index += 1) {
        const character = source[index];
        if (character === "(") depth += 1;
        else if (character === ")") {
            depth -= 1;
            if (depth < 0) throw syntaxError("Cundy-Rollett notation contains an unmatched ')'.");
        } else if (character === ";" && depth === 0) {
            values.push(source.slice(start, index));
            start = index + 1;
        }
    }

    if (depth !== 0) throw syntaxError("Cundy-Rollett notation contains an unclosed parenthesized vertex configuration.");
    values.push(source.slice(start));
    return values;
}

function parseVertex(source: string): CundyRollettVertex {
    if (!source) throw syntaxError("A Cundy-Rollett vertex configuration can not be empty.");

    let factorSource = source;
    let multiplicity = 1;
    if (source.startsWith("(")) {
        const match = /^\((.*)\)\^([1-9][0-9]*)$/.exec(source);
        if (!match) {
            throw syntaxError("A parenthesized Cundy-Rollett vertex configuration must be followed by a positive multiplicity exponent.");
        }
        factorSource = match[1];
        multiplicity = parsePositiveInteger(match[2], "vertex multiplicity");
    } else if (source.includes("(") || source.includes(")")) {
        throw syntaxError("Parentheses may only wrap a complete repeated vertex configuration.");
    }

    return {
        factors: parsePolygonFactors(factorSource),
        multiplicity
    };
}

function parsePolygonFactors(source: string): CundyRollettPolygonFactor[] {
    if (!source) throw syntaxError("A Cundy-Rollett vertex configuration can not be empty.");
    const rawFactors = source.split(".");
    if (rawFactors.some(value => value.length === 0)) {
        throw syntaxError("Cundy-Rollett notation can not contain an empty polygon position.");
    }

    const factors = rawFactors.map(parsePolygonFactor);
    const normalized: CundyRollettPolygonFactor[] = [];
    for (const factor of factors) {
        const previous = normalized.at(-1);
        if (previous?.sides === factor.sides) previous.repeat += factor.repeat;
        else normalized.push({ ...factor });
    }
    return normalized;
}

function parsePolygonFactor(source: string): CundyRollettPolygonFactor {
    const match = /^([0-9]+)(?:\^([1-9][0-9]*))?$/.exec(source);
    if (!match) {
        throw syntaxError(`Invalid Cundy-Rollett polygon factor '${source}'.`);
    }

    const sides = Number(match[1]);
    if (!Number.isSafeInteger(sides) || sides < 3) {
        throw syntaxError("Regular polygons in Cundy-Rollett notation must have at least 3 sides.");
    }
    const repeat = match[2] == null ? 1 : parsePositiveInteger(match[2], "polygon exponent");
    return { sides, repeat };
}

function combineAdjacentEquivalentVertices(vertices: CundyRollettVertex[]): CundyRollettVertex[] {
    const normalized: CundyRollettVertex[] = [];
    for (const vertex of vertices) {
        const previous = normalized.at(-1);
        if (previous != null && sameFactors(previous.factors, vertex.factors)) {
            previous.multiplicity += vertex.multiplicity;
        } else {
            normalized.push({
                factors: vertex.factors.map(factor => ({ ...factor })),
                multiplicity: vertex.multiplicity
            });
        }
    }
    return normalized;
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
    const { sides: polygonSides, repeat: polygonsAtVertex } = factors[0];
    const interiorAngle = 180 * (polygonSides - 2) / polygonSides;
    if (Math.abs(interiorAngle * polygonsAtVertex - 360) > 1e-9) return undefined;
    return { polygonSides, polygonsAtVertex };
}

function parsePositiveInteger(raw: string, label: string): number {
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1) {
        throw syntaxError(`Cundy-Rollett ${label} must be a positive safe integer.`);
    }
    return value;
}

function syntaxError(message: string): PeriodicTilingNotationError {
    return new PeriodicTilingNotationError("Cundy-Rollett", message);
}
