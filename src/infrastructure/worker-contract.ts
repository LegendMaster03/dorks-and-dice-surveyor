export type WorkerRequestEnvelope<T> = {
    jobId: string;
    payload: T;
};

export type WorkerResponseEnvelope<T> =
    | { jobId: string; ok: true; result: T }
    | { jobId: string; ok: false; error: string };
