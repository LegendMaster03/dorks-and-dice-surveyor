import type { IncomingMessage, ServerResponse } from "node:http";

/** Public resource discovery entry; capability-specific metadata may be added by each resource. */
export type SurveyorCapabilityDescriptor = {
    id: string;
    path: string;
    [key: string]: unknown;
};

/** A separately routed HTTP resource that advertises its own capabilities. */
export type SurveyorResource = {
    id: string;
    capabilities: readonly SurveyorCapabilityDescriptor[];
    matches(method: string | undefined, pathname: string): boolean;
    handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void>;
};
