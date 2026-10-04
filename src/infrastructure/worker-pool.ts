import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { WorkerJobCancelledError, WorkerJobTimeoutError, WorkerPoolOverloadedError } from "../errors.js";
import type { WorkerRequestEnvelope, WorkerResponseEnvelope } from "../analysis/hex-grid/worker-contract.js";

type PendingJob<TRequest, TResponse> = {
    id: string;
    payload: TRequest;
    resolve: (value: TResponse) => void;
    reject: (error: Error) => void;
    signal?: AbortSignal;
    timeoutMs: number;
    timeout: NodeJS.Timeout | null;
    abortListener: (() => void) | null;
};

type WorkerSlot<TRequest, TResponse> = {
    worker: Worker;
    current: PendingJob<TRequest, TResponse> | null;
};

export class BoundedWorkerPool<TRequest, TResponse> {
    private readonly slots: WorkerSlot<TRequest, TResponse>[] = [];
    private readonly queue: PendingJob<TRequest, TResponse>[] = [];
    private closed = false;

    public constructor(
        private readonly workerUrl: URL,
        workerCount: number,
        private readonly queueLimit: number,
        private readonly defaultTimeoutMs: number) {
        if (!Number.isInteger(workerCount) || workerCount < 1) throw new Error("workerCount must be at least 1.");
        if (!Number.isInteger(queueLimit) || queueLimit < 0) throw new Error("queueLimit must be non-negative.");
        for (let index = 0; index < workerCount; index++) this.slots.push(this.createSlot());
    }

    public get canAccept(): boolean {
        return !this.closed && (this.slots.some(slot => slot.current === null) || this.queue.length < this.queueLimit);
    }

    public snapshot(): { workers: number; busy: number; queued: number; queueLimit: number } {
        return {
            workers: this.slots.length,
            busy: this.slots.filter(slot => slot.current !== null).length,
            queued: this.queue.length,
            queueLimit: this.queueLimit
        };
    }

    public run(payload: TRequest, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<TResponse> {
        if (this.closed) return Promise.reject(new WorkerJobCancelledError());
        if (options.signal?.aborted) return Promise.reject(new WorkerJobCancelledError());
        const idle = this.slots.find(slot => slot.current === null);
        if (!idle && this.queue.length >= this.queueLimit) return Promise.reject(new WorkerPoolOverloadedError());

        return new Promise<TResponse>((resolve, reject) => {
            const job: PendingJob<TRequest, TResponse> = {
                id: randomUUID(),
                payload,
                resolve,
                reject,
                signal: options.signal,
                timeoutMs: options.timeoutMs ?? this.defaultTimeoutMs,
                timeout: null,
                abortListener: null
            };
            if (idle) this.start(idle, job);
            else {
                this.bindAbort(job, null);
                this.queue.push(job);
            }
        });
    }

    public async close(): Promise<void> {
        this.closed = true;
        for (const job of this.queue.splice(0)) this.finish(job, new WorkerJobCancelledError());
        await Promise.all(this.slots.map(async slot => {
            if (slot.current) this.finish(slot.current, new WorkerJobCancelledError());
            slot.current = null;
            await slot.worker.terminate();
        }));
    }

    private createSlot(): WorkerSlot<TRequest, TResponse> {
        const slot = { worker: new Worker(this.workerUrl), current: null } as WorkerSlot<TRequest, TResponse>;
        slot.worker.on("message", (message: WorkerResponseEnvelope<TResponse>) => this.onMessage(slot, message));
        slot.worker.on("error", error => this.onWorkerFailure(slot, error));
        slot.worker.on("exit", code => {
            if (!this.closed && code !== 0 && slot.current) this.onWorkerFailure(slot, new Error(`Analysis worker exited with code ${code}.`));
        });
        return slot;
    }

    private start(slot: WorkerSlot<TRequest, TResponse>, job: PendingJob<TRequest, TResponse>): void {
        if (job.signal?.aborted) {
            this.finish(job, new WorkerJobCancelledError());
            this.dispatch();
            return;
        }
        slot.current = job;
        this.bindAbort(job, slot);
        job.timeout = setTimeout(() => this.cancelRunning(slot, job, new WorkerJobTimeoutError()), job.timeoutMs);
        const message: WorkerRequestEnvelope<TRequest> = { jobId: job.id, payload: job.payload };
        slot.worker.postMessage(message);
    }

    private bindAbort(job: PendingJob<TRequest, TResponse>, slot: WorkerSlot<TRequest, TResponse> | null): void {
        if (!job.signal) return;
        const listener = () => {
            if (slot) this.cancelRunning(slot, job, new WorkerJobCancelledError());
            else {
                const index = this.queue.indexOf(job);
                if (index >= 0) this.queue.splice(index, 1);
                this.finish(job, new WorkerJobCancelledError());
            }
        };
        job.abortListener = listener;
        job.signal.addEventListener("abort", listener, { once: true });
    }

    private onMessage(slot: WorkerSlot<TRequest, TResponse>, message: WorkerResponseEnvelope<TResponse>): void {
        const job = slot.current;
        if (!job || message.jobId !== job.id) return;
        slot.current = null;
        if (message.ok) this.finish(job, null, message.result);
        else this.finish(job, new Error(message.error));
        this.dispatch();
    }

    private onWorkerFailure(slot: WorkerSlot<TRequest, TResponse>, error: Error): void {
        const job = slot.current;
        slot.current = null;
        if (job) this.finish(job, error);
        void this.replaceWorker(slot).then(() => this.dispatch());
    }

    private cancelRunning(slot: WorkerSlot<TRequest, TResponse>, job: PendingJob<TRequest, TResponse>, error: Error): void {
        if (slot.current !== job) return;
        slot.current = null;
        this.finish(job, error);
        void this.replaceWorker(slot).then(() => this.dispatch());
    }

    private async replaceWorker(slot: WorkerSlot<TRequest, TResponse>): Promise<void> {
        const old = slot.worker;
        old.removeAllListeners();
        await old.terminate();
        if (this.closed) return;
        const replacement = this.createSlot();
        const index = this.slots.indexOf(slot);
        if (index >= 0) this.slots[index] = replacement;
    }

    private dispatch(): void {
        if (this.closed) return;
        while (this.queue.length > 0) {
            const slot = this.slots.find(candidate => candidate.current === null);
            if (!slot) return;
            const job = this.queue.shift()!;
            if (job.abortListener && job.signal) {
                job.signal.removeEventListener("abort", job.abortListener);
                job.abortListener = null;
            }
            this.start(slot, job);
        }
    }

    private finish(job: PendingJob<TRequest, TResponse>, error: Error | null, value?: TResponse): void {
        if (job.timeout) clearTimeout(job.timeout);
        if (job.abortListener && job.signal) job.signal.removeEventListener("abort", job.abortListener);
        job.timeout = null;
        job.abortListener = null;
        if (error) job.reject(error);
        else job.resolve(value as TResponse);
    }
}
