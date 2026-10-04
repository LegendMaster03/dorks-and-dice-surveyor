export class SurveyorRequestError extends Error {
    public constructor(
        public readonly statusCode: number,
        public readonly code: string,
        message: string) {
        super(message);
        this.name = "SurveyorRequestError";
    }
}

export class WorkerPoolOverloadedError extends Error {
    public constructor() {
        super("Surveyor analysis capacity is currently full.");
        this.name = "WorkerPoolOverloadedError";
    }
}

export class WorkerJobTimeoutError extends Error {
    public constructor() {
        super("Surveyor analysis exceeded its configured timeout.");
        this.name = "WorkerJobTimeoutError";
    }
}

export class WorkerJobCancelledError extends Error {
    public constructor() {
        super("Surveyor analysis was cancelled.");
        this.name = "WorkerJobCancelledError";
    }
}
