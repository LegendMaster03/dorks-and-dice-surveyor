export function log(level: "info" | "error", event: string, fields: Record<string, unknown> = {}): void {
    const record = {
        timestamp: new Date().toISOString(),
        level,
        event,
        ...fields
    };
    const text = JSON.stringify(record);
    if (level === "error") process.stderr.write(`${text}\n`);
    else process.stdout.write(`${text}\n`);
}
