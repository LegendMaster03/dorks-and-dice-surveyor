import type { IncomingMessage, ServerResponse } from "node:http";

export type SurveyorCapabilityDescriptor = {
    id: string;
    path: string;
    [key: string]: unknown;
};

export type SurveyorResource = {
    id: string;
    capabilities: readonly SurveyorCapabilityDescriptor[];
    matches(method: string | undefined, pathname: string): boolean;
    handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void>;
};
