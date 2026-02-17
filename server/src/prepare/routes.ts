import { Router, Request, Response } from "express";
import { PrepareRequestSchema } from "./types";
import { jobStore } from "./job-store";
import { runPrepareJob } from "./worker";
import type { PrepareEvent } from "./types";

const router = Router();

// POST /api/prepare — create and start a prepare job
router.post("/", (req: Request, res: Response) => {
  const parsed = PrepareRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    const job = jobStore.createJob(parsed.data.serials);
    console.log(`[prepare] Created job ${job.id} for ${job.serials.length} devices`);

    // Start processing in background (don't await)
    runPrepareJob(job.id).catch((err) => {
      console.error(`[prepare] Job ${job.id} unhandled error:`, err);
    });

    res.json({ jobId: job.id, status: job.status });
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});

// GET /api/prepare/events?jobId=xxx — SSE stream for job progress
router.get("/events", (req: Request, res: Response) => {
  const jobId = req.query.jobId as string;
  if (!jobId) {
    res.status(400).json({ error: "Missing jobId parameter" });
    return;
  }

  const job = jobStore.getJob(jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  // Set up SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send current state as initial snapshot
  const snapshot = jobStore.serializeJob(job);
  res.write(`data: ${JSON.stringify({ type: "snapshot", ...snapshot })}\n\n`);

  // Listen for events
  const onEvent = (event: PrepareEvent) => {
    if (event.jobId === jobId) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);

      // Close SSE when job is done
      if (event.type === "job:completed" || event.type === "job:failed") {
        setTimeout(() => res.end(), 100);
      }
    }
  };

  jobStore.on("event", onEvent);

  // If job is already finished, close after snapshot
  if (job.status === "completed" || job.status === "failed") {
    setTimeout(() => res.end(), 100);
  }

  // Cleanup on client disconnect
  req.on("close", () => {
    jobStore.off("event", onEvent);
  });
});

// GET /api/prepare/:jobId — get job status
router.get("/:jobId", (req: Request, res: Response) => {
  const job = jobStore.getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(jobStore.serializeJob(job));
});

// GET /api/prepare/device/:serial/locked — check if device is locked
router.get("/device/:serial/locked", (req: Request, res: Response) => {
  res.json({ locked: jobStore.isDeviceLocked(req.params.serial) });
});

export { router as prepareRouter };
