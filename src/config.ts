export type SurveyorBootstrapConfig = {
    port: number;
};

export function loadBootstrapConfig(environment: NodeJS.ProcessEnv = process.env): SurveyorBootstrapConfig {
    const rawPort = environment.PORT ?? "8080";
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("PORT must be an integer between 1 and 65535.");
    }
    return { port };
}
