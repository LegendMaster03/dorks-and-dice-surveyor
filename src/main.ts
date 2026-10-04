import { loadBootstrapConfig } from "./config.js";
import { log } from "./logging.js";
import { createSurveyorServer } from "./server.js";

const config = loadBootstrapConfig();
const server = createSurveyorServer();
server.listen(config.port, "0.0.0.0", () => {
    log("info", "surveyor.started", { port: config.port });
});

function shutdown(signal: string): void {
    log("info", "surveyor.stopping", { signal });
    server.close(error => {
        if (error) {
            log("error", "surveyor.stop_failed", { message: error.message });
            process.exitCode = 1;
        }
    });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
