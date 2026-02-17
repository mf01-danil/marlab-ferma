import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { URL } from "url";
import { listDevices } from "./adb";
import { ScrcpyClient } from "./scrcpy-client";
import { InputMessage, VideoFrame, VideoMetadata } from "./types";
import { prepareRouter } from "./prepare/routes";

const PORT = Number(process.env.PORT) || 3001;

const app = express();
app.use(cors());
app.use(express.json());

// Prepare routes
app.use("/api/prepare", prepareRouter);

// REST: List devices
app.get("/api/devices", async (_req, res) => {
  try {
    const devices = await listDevices();
    res.json(devices);
  } catch (err) {
    console.error("Failed to list devices:", err);
    res.status(500).json({ error: "Failed to list devices" });
  }
});

const server = http.createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server });

// Track active scrcpy clients per device
const activeClients = new Map<string, { scrcpy: ScrcpyClient; viewers: Set<WebSocket>; cleanupTimer?: ReturnType<typeof setTimeout> }>();

wss.on("connection", (ws, req) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const serial = url.searchParams.get("serial");

  if (!serial) {
    ws.close(4000, "Missing serial parameter");
    return;
  }

  console.log(`[ws] Client connected for device: ${serial}`);

  // Check if scrcpy is already running for this device
  let entry = activeClients.get(serial);

  if (entry) {
    // Cancel pending cleanup if reconnecting (React StrictMode)
    if (entry.cleanupTimer) {
      clearTimeout(entry.cleanupTimer);
      entry.cleanupTimer = undefined;
      console.log(`[ws] Cancelled pending cleanup for ${serial}`);
    }

    // Add viewer to existing stream
    entry.viewers.add(ws);
    console.log(`[ws] Added viewer to existing stream (${entry.viewers.size} viewers)`);

    // Send metadata if already available
    if (entry.scrcpy.screenWidth > 0) {
      ws.send(
        JSON.stringify({
          type: "metadata",
          width: entry.scrcpy.screenWidth,
          height: entry.scrcpy.screenHeight,
        })
      );
    }
  } else {
    // Start new scrcpy client
    const scrcpy = new ScrcpyClient(serial);
    const viewers = new Set<WebSocket>([ws]);
    entry = { scrcpy, viewers };
    activeClients.set(serial, entry);

    scrcpy.on("metadata", (meta: VideoMetadata) => {
      const msg = JSON.stringify({
        type: "metadata",
        width: meta.width,
        height: meta.height,
      });
      for (const viewer of viewers) {
        if (viewer.readyState === WebSocket.OPEN) {
          viewer.send(msg);
        }
      }
    });

    let frameCount = 0;
    scrcpy.on("frame", (frame: VideoFrame) => {
      frameCount++;
      if (frameCount <= 5) {
        console.log(`[frame#${frameCount}] config=${frame.isConfig} key=${frame.isKeyframe} size=${frame.data.length} pts=${frame.pts}`);
      }
      const header = Buffer.alloc(13);
      header.writeUInt8(frame.isConfig ? 1 : frame.isKeyframe ? 2 : 0, 0);
      header.writeDoubleBE(Number(frame.pts), 1);
      header.writeUInt32BE(frame.data.length, 9);

      const packet = Buffer.concat([header, frame.data]);

      for (const viewer of viewers) {
        if (viewer.readyState === WebSocket.OPEN) {
          viewer.send(packet);
        }
      }
    });

    scrcpy.on("error", (err: Error) => {
      console.error(`[scrcpy] Error for ${serial}:`, err.message);
      const msg = JSON.stringify({ type: "error", message: err.message });
      for (const viewer of viewers) {
        if (viewer.readyState === WebSocket.OPEN) {
          viewer.send(msg);
        }
      }
    });

    scrcpy.start().catch((err) => {
      console.error(`[scrcpy] Failed to start for ${serial}:`, err);
    });
  }

  // Handle input messages from client
  ws.on("message", (data) => {
    try {
      const msg: InputMessage = JSON.parse(data.toString());
      if (msg.type === "touch" && entry) {
        const actionMap: Record<string, number> = {
          down: 0,
          up: 1,
          move: 2,
        };
        const action = actionMap[msg.action];
        if (action !== undefined) {
          entry.scrcpy.sendTouchEvent(
            action,
            msg.x,
            msg.y,
            entry.scrcpy.screenWidth,
            entry.scrcpy.screenHeight
          );
        }
      }
    } catch {
      // ignore invalid messages
    }
  });

  ws.on("close", () => {
    console.log(`[ws] Client disconnected for device: ${serial}`);
    if (entry) {
      entry.viewers.delete(ws);

      // If no more viewers, delay cleanup (React StrictMode sends disconnect+reconnect)
      if (entry.viewers.size === 0) {
        console.log(`[ws] No viewers for ${serial}, scheduling cleanup in 2s...`);
        entry.cleanupTimer = setTimeout(() => {
          const current = activeClients.get(serial);
          if (current && current.viewers.size === 0) {
            console.log(`[ws] Cleaning up scrcpy for ${serial}`);
            current.scrcpy.destroy();
            activeClients.delete(serial);
          }
        }, 2000);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`[server] MarLab Ferma backend running on http://localhost:${PORT}`);
  console.log(`[server] REST API: http://localhost:${PORT}/api/devices`);
  console.log(`[server] WebSocket: ws://localhost:${PORT}?serial=<device_serial>`);
});
