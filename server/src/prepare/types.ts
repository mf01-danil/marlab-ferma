import { z } from "zod";

// --- Job statuses ---
export type JobStatus = "queued" | "running" | "completed" | "failed";
export type DeviceJobStatus = "pending" | "preparing" | "prepared" | "failed";
export type FileStatus = "pending" | "uploading" | "loaded" | "installing" | "installed" | "failed";

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
  | { type: "file:installing"; jobId: string; serial: string; fileName: string }
  | { type: "file:installed"; jobId: string; serial: string; fileName: string }
  | { type: "file:failed"; jobId: string; serial: string; fileName: string; error: string }
  | { type: "device:setup"; jobId: string; serial: string; step: SetupStep; message?: string }
  | { type: "device:log"; jobId: string; serial: string; message: string; level: "info" | "success" | "warn" | "error" }
  | { type: "device:prepared"; jobId: string; serial: string }
  | { type: "device:failed"; jobId: string; serial: string; error: string }
  | { type: "job:completed"; jobId: string }
  | { type: "job:failed"; jobId: string; error: string };

// --- API request validation ---
export const PrepareRequestSchema = z.object({
  serials: z.array(z.string().min(1)).min(1, "At least one serial required"),
});

export type PrepareRequest = z.infer<typeof PrepareRequestSchema>;

// --- Setup step events ---
export type SetupStep =
  | "checking-magisk"
  | "connecting-wifi"
  | "waiting-internet"
  | "checking-root"
  | "updating-kitsune-app"
  | "awaiting-magisk-update"
  | "enabling-zygisk"
  | "installing-modules"
  | "rebooting"
  | "waiting-boot";

// --- Bundle manifest ---
export type BundleFileAction = "push" | "install" | "magisk-module";

export interface BundleFile {
  name: string;
  localPath: string;
  action?: BundleFileAction;
  description?: string;
}

export interface WifiConfig {
  ssid: string;
  password: string;
  security?: string;
}

export interface MagiskSetupConfig {
  enabled: boolean;
  enableZygisk?: boolean;
  connectWifi?: boolean;
  rebootAfter?: boolean;
}

export interface BundleManifest {
  version: string;
  targetDir: string;
  wifi?: WifiConfig;
  magiskSetup?: MagiskSetupConfig;
  files: BundleFile[];
}
