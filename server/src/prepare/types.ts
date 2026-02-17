import { z } from "zod";

// --- Job statuses ---
export type JobStatus = "queued" | "running" | "completed" | "failed";
export type DeviceJobStatus = "pending" | "preparing" | "prepared" | "failed";
export type FileStatus = "pending" | "uploading" | "loaded" | "failed";

// --- File progress ---
export interface FileProgress {
  name: string;
  status: FileStatus;
  error?: string;
}

// --- Per-device progress ---
export interface DeviceProgress {
  serial: string;
  status: DeviceJobStatus;
  files: FileProgress[];
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

// --- Full job ---
export interface PrepareJob {
  id: string;
  status: JobStatus;
  serials: string[];
  devices: Map<string, DeviceProgress>;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

// --- SSE event types ---
export type PrepareEvent =
  | { type: "job:started"; jobId: string }
  | { type: "device:started"; jobId: string; serial: string }
  | { type: "file:uploading"; jobId: string; serial: string; fileName: string }
  | { type: "file:loaded"; jobId: string; serial: string; fileName: string }
  | { type: "file:failed"; jobId: string; serial: string; fileName: string; error: string }
  | { type: "device:prepared"; jobId: string; serial: string }
  | { type: "device:failed"; jobId: string; serial: string; error: string }
  | { type: "job:completed"; jobId: string }
  | { type: "job:failed"; jobId: string; error: string };

// --- API request validation ---
export const PrepareRequestSchema = z.object({
  serials: z.array(z.string().min(1)).min(1, "At least one serial required"),
});

export type PrepareRequest = z.infer<typeof PrepareRequestSchema>;

// --- Bundle manifest ---
export interface BundleFile {
  name: string;
  localPath: string;
  description?: string;
}

export interface BundleManifest {
  version: string;
  targetDir: string;
  files: BundleFile[];
}
