"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getApiUrl } from "@/lib/api";

export type FileStatus = "pending" | "uploading" | "loaded" | "installing" | "installed" | "failed";
export type DeviceJobStatus = "pending" | "preparing" | "prepared" | "failed";
export type JobStatus = "queued" | "running" | "completed" | "failed";
export type SetupStep =
  | "checking-magisk"
  | "connecting-wifi"
  | "waiting-internet"
  | "checking-root"
  | "awaiting-magisk-update"
  | "enabling-zygisk"
  | "installing-modules"
  | "rebooting"
  | "waiting-boot";

export interface FileProgress {
  name: string;
  status: FileStatus;
  error?: string;
}

export interface DeviceProgress {
  serial: string;
  status: DeviceJobStatus;
  files: FileProgress[];
  error?: string;
  setupStep?: SetupStep;
  setupMessage?: string;
}

export type LogLevel = "info" | "success" | "error" | "warn";

export interface LogEntry {
  time: number;
  serial?: string;
  message: string;
  level: LogLevel;
}

export interface PrepareJobState {
  jobId: string | null;
  jobStatus: JobStatus | null;
  devices: Map<string, DeviceProgress>;
  logs: LogEntry[];
  error: string | null;
}

export function usePrepareJob() {
  const [state, setState] = useState<PrepareJobState>({
    jobId: null,
    jobStatus: null,
    devices: new Map(),
    logs: [],
    error: null,
  });
  const eventSourceRef = useRef<EventSource | null>(null);

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  // Subscribe to SSE events for a job
  const subscribe = useCallback((jobId: string) => {
    cleanup();

    const url = `${getApiUrl()}/api/prepare/events?jobId=${jobId}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      const data = JSON.parse(event.data);

      setState((prev) => {
        const devices = new Map(prev.devices);
        const log = (message: string, level: LogLevel = "info", serial?: string): LogEntry => ({
          time: Date.now(), serial, message, level,
        });

        switch (data.type) {
          case "snapshot": {
            const devEntries = Object.entries(data.devices) as [string, DeviceProgress][];
            for (const [serial, dp] of devEntries) {
              devices.set(serial, dp);
            }
            return { ...prev, jobStatus: data.status, devices,
              logs: [...prev.logs, log(`Connected to job (status: ${data.status})`)] };
          }

          case "job:started":
            return { ...prev, jobStatus: "running",
              logs: [...prev.logs, log("Job started")] };

          case "device:started": {
            const dp = devices.get(data.serial);
            if (dp) devices.set(data.serial, { ...dp, status: "preparing" });
            return { ...prev, devices,
              logs: [...prev.logs, log("Starting preparation", "info", data.serial)] };
          }

          case "file:uploading": {
            const dp = devices.get(data.serial);
            if (dp) {
              const files = dp.files.map((f) =>
                f.name === data.fileName ? { ...f, status: "uploading" as const } : f
              );
              devices.set(data.serial, { ...dp, files });
            }
            return { ...prev, devices,
              logs: [...prev.logs, log(`Pushing ${data.fileName}`, "info", data.serial)] };
          }

          case "file:loaded": {
            const dp = devices.get(data.serial);
            if (dp) {
              const files = dp.files.map((f) =>
                f.name === data.fileName ? { ...f, status: "loaded" as const } : f
              );
              devices.set(data.serial, { ...dp, files });
            }
            return { ...prev, devices,
              logs: [...prev.logs, log(`Pushed ${data.fileName}`, "success", data.serial)] };
          }

          case "file:installing": {
            const dp = devices.get(data.serial);
            if (dp) {
              const files = dp.files.map((f) =>
                f.name === data.fileName ? { ...f, status: "installing" as const } : f
              );
              devices.set(data.serial, { ...dp, files });
            }
            return { ...prev, devices,
              logs: [...prev.logs, log(`Installing ${data.fileName}`, "info", data.serial)] };
          }

          case "file:installed": {
            const dp = devices.get(data.serial);
            if (dp) {
              const files = dp.files.map((f) =>
                f.name === data.fileName ? { ...f, status: "installed" as const } : f
              );
              devices.set(data.serial, { ...dp, files });
            }
            return { ...prev, devices,
              logs: [...prev.logs, log(`Installed ${data.fileName}`, "success", data.serial)] };
          }

          case "file:failed": {
            const dp = devices.get(data.serial);
            if (dp) {
              const files = dp.files.map((f) =>
                f.name === data.fileName
                  ? { ...f, status: "failed" as const, error: data.error }
                  : f
              );
              devices.set(data.serial, { ...dp, files });
            }
            return { ...prev, devices,
              logs: [...prev.logs, log(`Failed: ${data.fileName} — ${data.error}`, "error", data.serial)] };
          }

          case "device:setup": {
            const dp = devices.get(data.serial);
            if (dp) {
              devices.set(data.serial, {
                ...dp, setupStep: data.step, setupMessage: data.message,
              });
            }
            const stepMsg = data.message ? `${data.step}: ${data.message}` : data.step;
            return { ...prev, devices,
              logs: [...prev.logs, log(stepMsg, "info", data.serial)] };
          }

          case "device:log": {
            return { ...prev,
              logs: [...prev.logs, log(data.message, data.level || "info", data.serial)] };
          }

          case "device:prepared": {
            const dp = devices.get(data.serial);
            if (dp) {
              devices.set(data.serial, { ...dp, status: "prepared", setupStep: undefined, setupMessage: undefined });
            }
            return { ...prev, devices,
              logs: [...prev.logs, log("Device prepared", "success", data.serial)] };
          }

          case "device:failed": {
            const dp = devices.get(data.serial);
            if (dp) {
              devices.set(data.serial, { ...dp, status: "failed", error: data.error });
            }
            return { ...prev, devices,
              logs: [...prev.logs, log(`Failed: ${data.error}`, "error", data.serial)] };
          }

          case "job:completed":
            return { ...prev, jobStatus: "completed",
              logs: [...prev.logs, log("All devices prepared", "success")] };

          case "job:failed":
            return { ...prev, jobStatus: "failed", error: data.error,
              logs: [...prev.logs, log(`Job failed: ${data.error}`, "error")] };

          default:
            return prev;
        }
      });
    };

    es.onerror = () => {
      // EventSource will auto-reconnect, but if server closes it stays closed
      es.close();
      eventSourceRef.current = null;
    };
  }, [cleanup]);

  // Start a prepare job
  const startJob = useCallback(async (serials: string[]) => {
    cleanup();
    setState({
      jobId: null,
      jobStatus: null,
      devices: new Map(),
      logs: [],
      error: null,
    });

    try {
      const res = await fetch(`${getApiUrl()}/api/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serials }),
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to start prepare job");
      }

      const { jobId } = await res.json();

      // Initialize devices in local state
      const devices = new Map<string, DeviceProgress>();
      for (const serial of serials) {
        devices.set(serial, { serial, status: "pending", files: [] });
      }

      setState({ jobId, jobStatus: "queued", devices, logs: [], error: null });
      subscribe(jobId);
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: (err as Error).message,
        jobStatus: "failed",
      }));
    }
  }, [cleanup, subscribe]);

  // Reset state
  const reset = useCallback(() => {
    cleanup();
    setState({
      jobId: null,
      jobStatus: null,
      devices: new Map(),
      logs: [],
      error: null,
    });
  }, [cleanup]);

  // Cleanup on unmount
  useEffect(() => cleanup, [cleanup]);

  const isRunning = state.jobStatus === "queued" || state.jobStatus === "running";
  const isDone = state.jobStatus === "completed" || state.jobStatus === "failed";

  return {
    ...state,
    isRunning,
    isDone,
    startJob,
    reset,
  };
}
