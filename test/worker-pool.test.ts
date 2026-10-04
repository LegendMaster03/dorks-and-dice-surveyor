import assert from "node:assert/strict";
import test from "node:test";
import { WorkerJobCancelledError, WorkerJobTimeoutError, WorkerPoolOverloadedError } from "../src/errors.js";
import { BoundedWorkerPool } from "../src/infrastructure/worker-pool.js";

test("worker count and queue are bounded with explicit overload", async () => {
    const pool = new BoundedWorkerPool<{ delayMs: number; value: number }, number>(
        new URL("./delay-worker.js", import.meta.url), 1, 1, 2000);
    try {
        const first = pool.run({ delayMs: 120, value: 1 });
        const second = pool.run({ delayMs: 10, value: 2 });
        await assert.rejects(pool.run({ delayMs: 10, value: 3 }), WorkerPoolOverloadedError);
        assert.deepEqual(pool.snapshot(), { workers: 1, busy: 1, queued: 1, queueLimit: 1 });
        assert.equal(await first, 1);
        assert.equal(await second, 2);
    } finally {
        await pool.close();
    }
});

test("running cancellation stops work and replaces the worker", async () => {
    const pool = new BoundedWorkerPool<{ delayMs: number; value: number }, number>(
        new URL("./delay-worker.js", import.meta.url), 1, 1, 2000);
    const controller = new AbortController();
    try {
        const pending = pool.run({ delayMs: 1000, value: 1 }, { signal: controller.signal });
        setTimeout(() => controller.abort(), 25);
        await assert.rejects(pending, WorkerJobCancelledError);
        assert.equal(await pool.run({ delayMs: 5, value: 4 }), 4);
    } finally {
        await pool.close();
    }
});

test("analysis timeout is bounded and capacity recovers", async () => {
    const pool = new BoundedWorkerPool<{ delayMs: number; value: number }, number>(
        new URL("./delay-worker.js", import.meta.url), 1, 0, 30);
    try {
        await assert.rejects(pool.run({ delayMs: 1000, value: 1 }), WorkerJobTimeoutError);
        assert.equal(await pool.run({ delayMs: 1, value: 5 }, { timeoutMs: 1000 }), 5);
    } finally {
        await pool.close();
    }
});
