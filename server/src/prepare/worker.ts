import { join } from "path";
import { jobStore } from "./job-store";
import { loadManifest, getBundleFilePath } from "./manifest";
import { createTransport } from "./transport";

const DEVICE_TIMEOUT_MS = 300_000; // 5 minutes per device (push + install takes time)

async function prepareDevice(jobId: string, serial: string): Promise<void> {
  const manifest = loadManifest();
  const transport = createTransport(serial);
  const fileNames = manifest.files.map((f) => f.name);

  jobStore.startDevice(jobId, serial, fileNames);

  // Check device is online
  const online = await transport.checkOnline();
  if (!online) {
    jobStore.deviceFailed(jobId, serial, "Device is offline or unreachable");
    return;
  }

  // Create target directory
  try {
    await transport.ensureDir(manifest.targetDir);
  } catch (err) {
    jobStore.deviceFailed(jobId, serial, `Failed to create directory: ${(err as Error).message}`);
    return;
  }

  // Phase 1: Push all files
  for (const file of manifest.files) {
    const localPath = getBundleFilePath(file.localPath);
    const remotePath = join(manifest.targetDir, file.name).replace(/\\/g, "/");

    jobStore.fileUploading(jobId, serial, file.name);

    try {
      await transport.pushFile(localPath, remotePath);
      jobStore.fileLoaded(jobId, serial, file.name);
    } catch (err) {
      jobStore.fileFailed(jobId, serial, file.name, (err as Error).message);
      jobStore.deviceFailed(jobId, serial, `Failed to push ${file.name}: ${(err as Error).message}`);
      return;
    }
  }

  // Phase 2: Install APKs
  const apks = manifest.files.filter((f) => f.action === "install");
  for (const file of apks) {
    const localPath = getBundleFilePath(file.localPath);

    jobStore.fileInstalling(jobId, serial, file.name);

    try {
      await transport.installApk(localPath);
      jobStore.fileInstalled(jobId, serial, file.name);
    } catch (err) {
      jobStore.fileFailed(jobId, serial, file.name, `Install failed: ${(err as Error).message}`);
      jobStore.deviceFailed(jobId, serial, `Failed to install ${file.name}: ${(err as Error).message}`);
      return;
    }
  }

  jobStore.devicePrepared(jobId, serial);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${label} exceeded ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

export async function runPrepareJob(jobId: string): Promise<void> {
  const job = jobStore.getJob(jobId);
  if (!job) return;

  jobStore.startJob(jobId);

  // Process devices concurrently (with timeout per device)
  const promises = job.serials.map((serial) =>
    withTimeout(prepareDevice(jobId, serial), DEVICE_TIMEOUT_MS, serial).catch((err) => {
      // Catch timeout or unexpected errors
      const dp = job.devices.get(serial);
      if (dp && dp.status !== "failed" && dp.status !== "prepared") {
        jobStore.deviceFailed(jobId, serial, (err as Error).message);
      }
    })
  );

  await Promise.allSettled(promises);
  jobStore.completeJob(jobId);
}
