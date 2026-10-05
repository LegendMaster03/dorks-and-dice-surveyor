import { PeriodicTilingNotationError } from "../types.js";

export type GomJauHoggPlacementPhase = {
    polygons: number[];
};

export type GomJauHoggTransform = {
    operation: "m" | "r";
    angleDegrees?: number;
    origin?: {
        kind: "c" | "v" | "h";
        index: number;
    };
};

export type GomJauHoggNotation = {
    notation: "GomJau-Hogg";
    canonical: string;
    placement: GomJauHoggPlacementPhase[];
    transforms: GomJauHoggTransform[];
};

const transformPattern = /^([mr])([0-9]+(?:\.[0-9]+)?)?(?:\(([cvh])([1-9][0-9]*)\))?$/;
const seedPolygonSides = new Set([3, 4, 6, 8, 12]);
const maximumNotationLength = 4096;

export function parseGomJauHoggNotation(raw: string): GomJauHoggNotation {
    const trimmed = raw.trim();
    if (!trimmed) throw syntaxError("GomJau-Hogg notation can not be empty.");
    if (trimmed.length > maximumNotationLength) {
        throw syntaxError(`GomJau-Hogg notation can not exceed ${maximumNotationLength} characters.`);
    }

    const source = trimmed.replace(/\s+/g, "").toLowerCase();
    const stages = source.split("/");
    if (stages.length < 3 || stages.some(stage => stage.length === 0)) {
        throw syntaxError("GomJau-Hogg notation requires a polygon-placement stage followed by at least two transformation stages.");
    }

    const placement = parsePlacement(stages[0]);
    const transforms = stages.slice(1).map(parseTransform);
    const canonical = [serializePlacement(placement), ...transforms.map(serializeTransform)].join("/");
    return { notation: "GomJau-Hogg", canonical, placement, transforms };
}

function parsePlacement(source: string): GomJauHoggPlacementPhase[] {
    const phases = source.split("-");
    if (phases.length === 0 || phases.some(phase => phase.length === 0)) {
        throw syntaxError("GomJau-Hogg polygon-placement phases can not be empty.");
    }

    return phases.map((phase, phaseIndex) => {
        const tokens = phase.split(",");
        if (tokens.some(token => !/^[0-9]+$/.test(token))) {
            throw syntaxError(`GomJau-Hogg placement phase ${phaseIndex + 1} must contain comma-separated polygon side counts.`);
        }
        const polygons = tokens.map(token => Number(token));
        if (polygons.some(value => !Number.isSafeInteger(value))) {
            throw syntaxError("GomJau-Hogg polygon side counts must be safe integers.");
        }
        if (phaseIndex === 0) {
            if (polygons.length !== 1 || !seedPolygonSides.has(polygons[0])) {
                throw syntaxError("The GomJau-Hogg seed phase must contain exactly one of 3, 4, 6, 8, or 12 polygon sides.");
            }
        } else if (polygons.some(value => value !== 0 && value < 3)) {
            throw syntaxError("GomJau-Hogg placement values after the seed must be 0 or a polygon with at least 3 sides.");
        }
        return { polygons };
    });
}

function parseTransform(source: string): GomJauHoggTransform {
    const match = transformPattern.exec(source);
    if (!match) {
        throw syntaxError(`Invalid GomJau-Hogg transformation stage '${source}'.`);
    }

    const originIndex = match[4] == null ? undefined : Number(match[4]);
    if (originIndex != null && !Number.isSafeInteger(originIndex)) {
        throw syntaxError("GomJau-Hogg transformation-origin indices must be safe integers.");
    }
    const origin = match[3] == null
        ? undefined
        : { kind: match[3] as "c" | "v" | "h", index: originIndex! };
    let angleDegrees = match[2] == null ? undefined : Number(match[2]);
    if (angleDegrees != null && (!Number.isFinite(angleDegrees) || angleDegrees < 0 || angleDegrees > 360)) {
        throw syntaxError("GomJau-Hogg transformation angles must be between 0 and 360 degrees.");
    }

    // The published grammar defaults an omitted angle to 180 degrees only for a
    // centered transform. Eccentric transforms such as r(h1) infer their angle from
    // the selected centroid, vertex, or edge midpoint and must retain the omission.
    if (angleDegrees == null && origin == null) angleDegrees = 180;

    return {
        operation: match[1] as "m" | "r",
        ...(angleDegrees == null ? {} : { angleDegrees }),
        ...(origin == null ? {} : { origin })
    };
}

function serializePlacement(phases: GomJauHoggPlacementPhase[]): string {
    return phases.map(phase => phase.polygons.join(",")).join("-");
}

function serializeTransform(transform: GomJauHoggTransform): string {
    const angle = transform.angleDegrees == null ? "" : String(transform.angleDegrees);
    const origin = transform.origin == null ? "" : `(${transform.origin.kind}${transform.origin.index})`;
    return `${transform.operation}${angle}${origin}`;
}

function syntaxError(message: string): PeriodicTilingNotationError {
    return new PeriodicTilingNotationError("GomJau-Hogg", message);
}
