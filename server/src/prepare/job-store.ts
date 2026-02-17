import type { PrepareJob, DeviceProgress, FileProgress, PrepareEvent } from "./types";
import { EventEmitter } from "events";

class JobStore extends EventEmitter {
  private jobs = new Map<string, PrepareJob>();
  private lockedDevices = new Set<string>();
  private jobCounter = 0;

  createJob(serials: string[]): PrepareJob {
    // Check device locks
    const locked = serials.filter((s) => this.lockedDevices.has(s));
    if (locked.length > 0) {
      throw new Error(`Devices already being prepared: ${locked.join(", ")}`);
    }

    const id = `job_${++this.jobCounter}_${Date.now()}`;
    const devices = new Map<string, DeviceProgress>();

    for (const serial of serials) {
      devices.set(serial, {
        serial,
        status: "pending",
        files: [],
      });
      this.lockedDevices.add(serial);
    }

    const job: PrepareJob = {
      id,
      status: "queued",
      serials,
      devices,
      createdAt: Date.now(),
    };

    this.jobs.set(id, job);
    return job;
  }

  getJob(id: string): PrepareJob | undefined {
    return this.jobs.get(id);
  }

  isDeviceLocked(serial: string): boolean {
    return this.lockedDevices.has(serial);
  }

  // --- State mutations + event emission ---

  startJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = "running";
    job.startedAt = Date.now();
    this.emitEvent({ type: "job:started", jobId });
  }

  startDevice(jobId: string, serial: string, fileNames: string[]): void {
    const dp = this.getDeviceProgress(jobId, serial);
    if (!dp) return;
    dp.status = "preparing";
    dp.startedAt = Date.now();
    dp.files = fileNames.map((name) => ({ name, status: "pending" }));
    this.emitEvent({ type: "device:started", jobId, serial });
  }

  fileUploading(jobId: string, serial: string, fileName: string): void {
    const fp = this.getFileProgress(jobId, serial, fileName);
    if (!fp) return;
    fp.status = "uploading";
    this.emitEvent({ type: "file:uploading", jobId, serial, fileName });
  }

  fileLoaded(jobId: string, serial: string, fileName: string): void {
    const fp = this.getFileProgress(jobId, serial, fileName);
    if (!fp) return;
    fp.status = "loaded";
    this.emitEvent({ type: "file:loaded", jobId, serial, fileName });
  }

  fileFailed(jobId: string, serial: string, fileName: string, error: string): void {
    const fp = this.getFileProgress(jobId, serial, fileName);
    if (!fp) return;
    fp.status = "failed";
    fp.error = error;
    this.emitEvent({ type: "file:failed", jobId, serial, fileName, error });
  }

  devicePrepared(jobId: string, serial: string): void {
    const dp = this.getDeviceProgress(jobId, serial);
    if (!dp) return;
    dp.status = "prepared";
    dp.finishedAt = Date.now();
    this.lockedDevices.delete(serial);
    this.emitEvent({ type: "device:prepared", jobId, serial });
  }

  deviceFailed(jobId: string, serial: string, error: string): void {
    const dp = this.getDeviceProgress(jobId, serial);
    if (!dp) return;
    dp.status = "failed";
    dp.error = error;
    dp.finishedAt = Date.now();
    this.lockedDevices.delete(serial);
    this.emitEvent({ type: "device:failed", jobId, serial, error });
  }

  completeJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    const hasFailures = Array.from(job.devices.values()).some((d) => d.status === "failed");
    job.status = hasFailures ? "failed" : "completed";
    job.finishedAt = Date.now();
    if (hasFailures) {
      this.emitEvent({ type: "job:failed", jobId, error: "Some devices failed" });
    } else {
      this.emitEvent({ type: "job:completed", jobId });
    }
  }

  // --- Serialization for API responses ---

  serializeJob(job: PrepareJob) {
    return {
      id: job.id,
      status: job.status,
      serials: job.serials,
      devices: Object.fromEntries(
        Array.from(job.devices.entries()).map(([k, v]) => [k, v])
      ),
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    };
  }

  // --- Helpers ---

  private getDeviceProgress(jobId: string, serial: string): DeviceProgress | undefined {
    return this.jobs.get(jobId)?.devices.get(serial);
  }

  private getFileProgress(jobId: string, serial: string, fileName: string): FileProgress | undefined {
    return this.getDeviceProgress(jobId, serial)?.files.find((f) => f.name === fileName);
  }

  private emitEvent(event: PrepareEvent): void {
    this.emit("event", event);
  }
}

export const jobStore = new JobStore();
