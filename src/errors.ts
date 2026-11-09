/** Expected client failure with an explicit HTTP status and stable API error code. */
export class SurveyorRequestError extends Error {
    public constructor(
        public readonly statusCode: number,
        public readonly code: string,
        message: string) {
        super(message);
        this.name = "SurveyorRequestError";
    }
}

/** Admission rejected because neither an idle worker nor queue space is available. */
export class WorkerPoolOverloadedError extends Error {
    public constructor() {
        super("Surveyor analysis capacity is currently full.");
        this.name = "WorkerPoolOverloadedError";
    }
}

/** A running analysis exceeded its deadline and its worker must be replaced. */
export class WorkerJobTimeoutError extends Error {
    public constructor() {
        super("Surveyor analysis exceeded its configured timeout.");
        this.name = "WorkerJobTimeoutError";
    }
}

/** The request was aborted or shutdown prevented completion. */
export class WorkerJobCancelledError extends Error {
    public constructor() {
        super("Surveyor analysis was cancelled.");
        this.name = "WorkerJobCancelledError";
    }
}
