import { SurveyorRequestError } from "../../errors.js";
import {
    findPeriodicTilingsByCundyRollett,
    findPeriodicTilingByGomJauHogg
} from "./catalog.js";
import { parseCundyRollettNotation, parseGomJauHoggNotation } from "./notation/index.js";
import { PeriodicTilingNotationError, type PeriodicTilingDefinition } from "./types.js";

export type ImplementedPeriodicTilingDefinition = PeriodicTilingDefinition & {
    detectorId: NonNullable<PeriodicTilingDefinition["detectorId"]>;
};

export function selectPeriodicTiling(parameters: URLSearchParams): ImplementedPeriodicTilingDefinition {
    rejectDerivedSelectors(parameters);

    const crValues = parameters.getAll("crNotation");
    const gjhValues = parameters.getAll("gjhNotation");
    if (crValues.length > 1 || gjhValues.length > 1) {
        throw new SurveyorRequestError(
            400,
            "tiling_selector_count",
            "Periodic-tiling notation selectors may each be supplied at most once.");
    }
    if (crValues.length === 0 && gjhValues.length === 0) {
        throw new SurveyorRequestError(
            400,
            "tiling_selector_required",
            "Periodic tilings require crNotation or gjhNotation. crNotation is the preferred selector.");
    }

    const cr = crValues.length === 0 ? undefined : parseCundyRollett(crValues[0]);
    const gjh = gjhValues.length === 0 ? undefined : parseGomJauHogg(gjhValues[0]);
    const crCandidates = cr == null ? [] : findPeriodicTilingsByCundyRollett(cr.canonical);
    const gjhDefinition = gjh == null ? undefined : findPeriodicTilingByGomJauHogg(gjh.canonical);

    if (cr != null && crCandidates.length === 0 && gjh == null) {
        throw unregistered("Cundy-Rollett", cr.canonical);
    }
    if (gjh != null && gjhDefinition == null && cr == null) {
        throw unregistered("GomJau-Hogg", gjh.canonical);
    }
    if ((cr != null && crCandidates.length === 0) || (gjh != null && gjhDefinition == null)) {
        throw new SurveyorRequestError(
            501,
            "tiling_identity_unregistered",
            "The supplied notations are structurally valid, but Surveyor does not yet have enough catalog identity data to prove that they describe the same tiling.");
    }

    let selected: PeriodicTilingDefinition | undefined;
    if (gjhDefinition != null && cr != null) {
        if (!crCandidates.some(candidate => candidate.id === gjhDefinition.id)) {
            throw new SurveyorRequestError(
                400,
                "tiling_selector_conflict",
                "The supplied periodic-tiling notations resolve to different tilings.");
        }
        selected = gjhDefinition;
    } else if (gjhDefinition != null) {
        selected = gjhDefinition;
    } else if (crCandidates.length === 1) {
        selected = crCandidates[0];
    } else if (crCandidates.length > 1) {
        throw new SurveyorRequestError(
            400,
            "tiling_selector_ambiguous",
            "The supplied Cundy-Rollett notation identifies multiple registered tilings. Supply the GomJau-Hogg notation to disambiguate the requested tiling.");
    }

    if (!selected) {
        throw new SurveyorRequestError(500, "tiling_resolution_failure", "The periodic tiling could not be resolved.");
    }
    if (selected.detectorId == null) {
        throw new SurveyorRequestError(
            501,
            "tiling_not_implemented",
            `${selected.periodicTilingType} tiling '${selected.crNotation}' is recognized but not implemented by this Surveyor deployment.`);
    }

    return selected as ImplementedPeriodicTilingDefinition;
}

function parseCundyRollett(raw: string) {
    try {
        return parseCundyRollettNotation(raw);
    } catch (error) {
        if (error instanceof PeriodicTilingNotationError) {
            throw new SurveyorRequestError(400, "invalid_cr_notation", error.message);
        }
        throw error;
    }
}

function parseGomJauHogg(raw: string) {
    try {
        return parseGomJauHoggNotation(raw);
    } catch (error) {
        if (error instanceof PeriodicTilingNotationError) {
            throw new SurveyorRequestError(400, "invalid_gjh_notation", error.message);
        }
        throw error;
    }
}

function rejectDerivedSelectors(parameters: URLSearchParams): void {
    if (parameters.has("periodicTilingType") || parameters.has("shape") || parameters.has("sides")) {
        throw new SurveyorRequestError(
            400,
            "tiling_selector_invalid",
            "Periodic tilings are selected with crNotation and/or gjhNotation. periodicTilingType, shape, and sides are derived identity and are not request selectors.");
    }
}

function unregistered(notation: string, canonical: string): SurveyorRequestError {
    return new SurveyorRequestError(
        501,
        "tiling_identity_unregistered",
        `${notation} notation '${canonical}' is structurally valid, but Surveyor does not yet have a catalog identity or detector registration for it.`);
}
