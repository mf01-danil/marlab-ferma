"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getApiUrl } from "@/lib/api";

export type FileStatus = "pending" | "uploading" | "loaded" | "failed";
export type DeviceJobStatus = "pending" | "preparing" | "prepared" | "failed";
export type JobStatus = "queued" | "running" | "completed" | "failed";

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
}

export interface PrepareJobState {
  jobId: string | null;
  jobStatus: JobStatus | null;
  devices: Map<string, DeviceProgress>;
  error: string | null;
}

export function usePrepareJob() {
  const [state, setState] = useState<PrepareJobState>({
    jobId: null,
    jobStatus: null,
    devices: new Map(),
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

        switch (data.type) {
          case "snapshot": {
            // Initial state from server
            const devEntries = Object.entries(data.devices) as [string, DeviceProgress][];
            for (const [serial, dp] of devEntries) {
              devices.set(serial, dp);
            }
            return { ...prev, jobStatus: data.status, devices };
          }

          case "job:started":
            return { ...prev, jobStatus: "running" };

          case "device:started": {
            const dp = devices.get(data.serial);
            if (dp) {
              devices.set(data.serial, { ...dp, status: "preparing" });
            }
            return { ...prev, devices };
          }

          case "file:uploading": {
            const dp = devices.get(data.serial);
            if (dp) {
              const files = dp.files.map((f) =>
                f.name === data.fileName ? { ...f, status: "uploading" as const } : f
              );
              devices.set(data.serial, { ...dp, files });
            }
            return { ...prev, devices };
          }

          case "file:loaded": {
            const dp = devices.get(data.serial);
            if (dp) {
              const files = dp.files.map((f) =>
                f.name === data.fileName ? { ...f, status: "loaded" as const } : f
              );
              devices.set(data.serial, { ...dp, files });
            }
            return { ...prev, devices };
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
            return { ...prev, devices };
          }

          case "device:prepared": {
            const dp = devices.get(data.serial);
            if (dp) {
              devices.set(data.serial, { ...dp, status: "prepared" });
            }
            return { ...prev, devices };
          }

          case "device:failed": {
            const dp = devices.get(data.serial);
            if (dp) {
              devices.set(data.serial, { ...dp, status: "failed", error: data.error });
            }
            return { ...prev, devices };
          }

          case "job:completed":
            return { ...prev, jobStatus: "completed" };

          case "job:failed":
            return { ...prev, jobStatus: "failed", error: data.error };

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

      setState({ jobId, jobStatus: "queued", devices, error: null });
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
