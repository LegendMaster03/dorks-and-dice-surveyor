import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createSurveyorServer } from "../src/server.js";

async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
    const server = createSurveyorServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP server address.");
    try {
        await run(`http://127.0.0.1:${address.port}`);
    } finally {
        server.close();
        await once(server, "close");
    }
}

test("liveness is lightweight", async () => {
    await withServer(async baseUrl => {
        const response = await fetch(`${baseUrl}/health/live`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { status: "live", service: "surveyor" });
    });
});

test("readiness reports work acceptance", async () => {
    await withServer(async baseUrl => {
        const response = await fetch(`${baseUrl}/health/ready`);
        assert.equal(response.status, 200);
        const body = await response.json() as { status: string; acceptingWork: boolean };
        assert.equal(body.status, "ready");
        assert.equal(body.acceptingWork, true);
    });
});
