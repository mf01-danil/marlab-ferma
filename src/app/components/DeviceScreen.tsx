"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import JMuxer from "jmuxer";

interface Props {
  serial: string;
  wsUrl: string;
}

export default function DeviceScreen({ serial, wsUrl }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const muxerRef = useRef<JMuxer | null>(null);
  const [status, setStatus] = useState<string>("Connecting...");
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [debugLines, setDebugLines] = useState<string[]>([]);

  const addDebug = useCallback((line: string) => {
    console.log(`[DeviceScreen] ${line}`);
    setDebugLines((prev) => [...prev.slice(-19), line]);
  }, []);

  useEffect(() => {
    addDebug(`Connecting to ${wsUrl}?serial=${serial}`);
    const ws = new WebSocket(`${wsUrl}?serial=${encodeURIComponent(serial)}`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    let muxer: JMuxer | null = null;
    let frameCount = 0;
    let configured = false;

    ws.onopen = () => {
      addDebug("WebSocket connected");
      setStatus("Connected, waiting for video...");

      // Initialize jMuxer
      try {
        muxer = new JMuxer({
          node: videoRef.current!,
          mode: "video",
          fps: 30,
          flushingTime: 0,
          debug: false,
          onReady: () => {
            addDebug("jMuxer ready");
          },
          onError: (err: unknown) => {
            addDebug(`jMuxer error: ${err}`);
          },
        });
        muxerRef.current = muxer;
        addDebug("jMuxer initialized");
      } catch (err) {
        addDebug(`jMuxer init error: ${err instanceof Error ? err.message : err}`);
        setStatus(`Player error: ${err instanceof Error ? err.message : err}`);
      }
    };

    ws.onmessage = (event) => {
      // JSON messages (metadata, errors)
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "metadata") {
            setDimensions({ width: msg.width, height: msg.height });
            setStatus("Receiving video...");
            addDebug(`Metadata: ${msg.width}x${msg.height}`);
          } else if (msg.type === "error") {
            setStatus(`Error: ${msg.message}`);
            addDebug(`Server error: ${msg.message}`);
          }
        } catch {
          // ignore
        }
        return;
      }

      if (!muxer) return;

      // Binary messages (video frames)
      const data = new Uint8Array(event.data);
      if (data.length < 13) return;

      // Parse header: type (1) + pts (8) + size (4)
      const frameType = data[0]; // 0=data, 1=config, 2=keyframe
      const view = new DataView(event.data);
      const pts = view.getFloat64(1);
      const size = view.getUint32(9);

      const frameData = new Uint8Array(event.data, 13, size);
      frameCount++;

      if (frameCount <= 5) {
        addDebug(`Frame#${frameCount}: type=${frameType} size=${size} pts=${pts}`);
      }

      try {
        // Feed raw H264 Annex B data directly to jMuxer
        // jMuxer handles Annex B start codes natively
        const duration = frameType === 1 ? 0 : 1000 / 30;
        muxer.feed({
          video: frameData,
          duration,
        });

        if (!configured && frameType === 1) {
          configured = true;
          addDebug("Config frame fed to jMuxer");
        }

        if (configured && frameType === 2) {
          setStatus("Streaming");
        }
      } catch (err) {
        if (frameCount <= 10) {
          addDebug(`Feed error: ${err instanceof Error ? err.message : err}`);
        }
      }
    };

    ws.onclose = (e) => {
      addDebug(`WebSocket closed: code=${e.code} reason=${e.reason}`);
      setStatus("Disconnected");
    };

    ws.onerror = () => {
      addDebug("WebSocket error");
      setStatus("Connection failed");
    };

    return () => {
      ws.close();
      if (muxer) {
        muxer.destroy();
      }
    };
  }, [serial, wsUrl, addDebug]);

  // Input handlers
  const getDeviceCoords = (
    e: React.MouseEvent<HTMLVideoElement>
  ): { x: number; y: number } | null => {
    const video = videoRef.current;
    if (!video || !dimensions.width || !dimensions.height) return null;

    const rect = video.getBoundingClientRect();
    const scaleX = dimensions.width / rect.width;
    const scaleY = dimensions.height / rect.height;

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const sendTouch = (action: "down" | "up" | "move", e: React.MouseEvent<HTMLVideoElement>) => {
    const coords = getDeviceCoords(e);
    if (!coords || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(
      JSON.stringify({
        type: "touch",
        action,
        x: coords.x,
        y: coords.y,
      })
    );
  };

  const [isMouseDown, setIsMouseDown] = useState(false);

  return (
    <div>
      <div style={{ marginBottom: 8, fontSize: 13, color: "#666" }}>
        {status}
        {dimensions.width > 0 && ` — ${dimensions.width}x${dimensions.height}`}
      </div>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{
          maxWidth: "100%",
          height: "auto",
          border: "1px solid #ddd",
          borderRadius: 4,
          cursor: "crosshair",
          touchAction: "none",
          background: "#000",
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          setIsMouseDown(true);
          sendTouch("down", e);
        }}
        onMouseMove={(e) => {
          if (isMouseDown) {
            sendTouch("move", e);
          }
        }}
        onMouseUp={(e) => {
          setIsMouseDown(false);
          sendTouch("up", e);
        }}
        onMouseLeave={(e) => {
          if (isMouseDown) {
            setIsMouseDown(false);
            sendTouch("up", e);
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      {debugLines.length > 0 && (
        <details style={{ marginTop: 16 }} open>
          <summary style={{ fontSize: 12, color: "#999", cursor: "pointer" }}>
            Debug log ({debugLines.length})
          </summary>
          <pre
            style={{
              fontSize: 11,
              background: "#111",
              color: "#0f0",
              padding: 12,
              borderRadius: 4,
              maxHeight: 300,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {debugLines.join("\n")}
          </pre>
        </details>
      )}
    </div>
  );
}
