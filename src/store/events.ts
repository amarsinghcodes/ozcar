import { promises as fs } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { IsoTimestampSchema, RunIdSchema } from "../contracts/run";

export type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const RunEventSchema = z.object({
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  type: z.string().min(1),
  at: IsoTimestampSchema,
  details: z.record(z.string(), JsonValueSchema).optional(),
});

export type RunEventRecord = z.infer<typeof RunEventSchema>;

export class RunEventIdentityError extends Error {
  readonly actualRunId: string;
  readonly expectedRunId: string;
  readonly lineNumber: number;
  readonly eventsFile: string;

  constructor(eventsFile: string, lineNumber: number, expectedRunId: string, actualRunId: string) {
    super(
      `Event log at ${eventsFile} line ${lineNumber} expected runId ${expectedRunId} but found ${actualRunId}.`,
    );

    this.name = "RunEventIdentityError";
    this.actualRunId = actualRunId;
    this.expectedRunId = expectedRunId;
    this.lineNumber = lineNumber;
    this.eventsFile = eventsFile;
  }
}

export async function ensureEventLog(eventsFile: string): Promise<void> {
  await fs.mkdir(path.dirname(eventsFile), { recursive: true });

  try {
    await fs.access(eventsFile);
  } catch {
    await fs.writeFile(eventsFile, "", "utf8");
  }
}

export async function appendEventRecord(eventsFile: string, event: RunEventRecord): Promise<void> {
  await ensureEventLog(eventsFile);
  await fs.appendFile(eventsFile, `${JSON.stringify(RunEventSchema.parse(event))}\n`, "utf8");
}

export async function readEventRecords(eventsFile: string, expectedRunId?: string): Promise<RunEventRecord[]> {
  const content = await fs.readFile(eventsFile, "utf8");
  const lines = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.map((line, index) => {
    let parsed: unknown;

    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSON in ${eventsFile} at line ${index + 1}: ${String(error)}`);
    }

    const event = RunEventSchema.parse(parsed);

    if (expectedRunId !== undefined && event.runId !== expectedRunId) {
      throw new RunEventIdentityError(eventsFile, index + 1, expectedRunId, event.runId);
    }

    return event;
  });
}
