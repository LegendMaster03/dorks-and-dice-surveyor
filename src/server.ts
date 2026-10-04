import { createServer as createHttpServer, type Server } from "node:http";

export function createSurveyorServer(): Server {
    return createHttpServer((request, response) => {
        const url = new URL(request.url ?? "/", "http://surveyor.local");
        if (request.method === "GET" && url.pathname === "/health/live") {
            return json(response, 200, { status: "live", service: "surveyor" });
        }
        if (request.method === "GET" && url.pathname === "/health/ready") {
            return json(response, 200, { status: "ready", service: "surveyor", acceptingWork: true });
        }
        if (request.method === "GET" && url.pathname === "/") {
            return json(response, 200, {
                service: "Dorks & Dice Surveyor",
                apiVersion: "bootstrap",
                capabilities: []
            });
        }
        return json(response, 404, { error: "not_found" });
    });
}

function json(response: import("node:http").ServerResponse, statusCode: number, value: unknown): void {
    const body = JSON.stringify(value);
    response.writeHead(statusCode, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(body)
    });
    response.end(body);
}
