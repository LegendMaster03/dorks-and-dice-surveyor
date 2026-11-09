/** Correlates each worker-thread message with the pool's current job. */
export type WorkerRequestEnvelope<T> = {
    jobId: string;
    payload: T;
};

/** Both success and failure echo the job ID to discard stale messages safely. */
export type WorkerResponseEnvelope<T> =
    | { jobId: string; ok: true; result: T }
    | { jobId: string; ok: false; error: string };
