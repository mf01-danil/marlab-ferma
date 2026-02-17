"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface Props {
  serial: string;
  wsUrl: string;
}

// Parse Annex B H264 stream into individual NAL units (strips start codes)
function parseAnnexBNALUs(data: Uint8Array): Uint8Array[] {
  const nalus: Uint8Array[] = [];
  let i = 0;

  while (i < data.length) {
    let startCodeLen = 0;
    if (
      i + 4 <= data.length &&
      data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1
    ) {
      startCodeLen = 4;
    } else if (
      i + 3 <= data.length &&
      data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1
    ) {
      startCodeLen = 3;
    }

    if (startCodeLen === 0) {
      i++;
      continue;
    }

    const naluStart = i + startCodeLen;
    let naluEnd = data.length;
    for (let j = naluStart; j < data.length - 2; j++) {
      if (
        data[j] === 0 && data[j + 1] === 0 &&
        (data[j + 2] === 1 || (data[j + 2] === 0 && j + 3 < data.length && data[j + 3] === 1))
      ) {
        naluEnd = j;
        break;
      }
    }

    if (naluStart < naluEnd) {
      nalus.push(data.slice(naluStart, naluEnd));
    }
    i = naluEnd;
  }
  return nalus;
}

// Convert Annex B SPS/PPS to avcC configuration record
function buildAvcC(configData: Uint8Array): Uint8Array {
  const nalus = parseAnnexBNALUs(configData);
  const spsList: Uint8Array[] = [];
  const ppsList: Uint8Array[] = [];

  for (const nalu of nalus) {
    const naluType = nalu[0] & 0x1f;
    if (naluType === 7) spsList.push(nalu);
    if (naluType === 8) ppsList.push(nalu);
  }

  if (spsList.length === 0 || ppsList.length === 0) {
    throw new Error(`No SPS/PPS found: ${nalus.length} NALUs, types=[${nalus.map(n => n[0] & 0x1f).join(",")}]`);
  }

  const sps = spsList[0];
  let totalSize = 6;
  for (const s of spsList) totalSize += 2 + s.length;
  totalSize += 1;
  for (const p of ppsList) totalSize += 2 + p.length;

  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);
  let offset = 0;

  buf[offset++] = 1;
  buf[offset++] = sps[1];
  buf[offset++] = sps[2];
  buf[offset++] = sps[3];
  buf[offset++] = 0xff;
  buf[offset++] = 0xe0 | spsList.length;

  for (const s of spsList) {
    view.setUint16(offset, s.length); offset += 2;
    buf.set(s, offset); offset += s.length;
  }
  buf[offset++] = ppsList.length;
  for (const p of ppsList) {
    view.setUint16(offset, p.length); offset += 2;
    buf.set(p, offset); offset += p.length;
  }
  return buf;
}

// Convert Annex B frame data to AVCC format
function annexBToAvcc(data: Uint8Array): Uint8Array {
  const nalus = parseAnnexBNALUs(data);
  if (nalus.length === 0) return data;

  let totalSize = 0;
  for (const nalu of nalus) totalSize += 4 + nalu.length;

  const result = new Uint8Array(totalSize);
  const view = new DataView(result.buffer);
  let offset = 0;

  for (const nalu of nalus) {
    view.setUint32(offset, nalu.length); offset += 4;
    result.set(nalu, offset); offset += nalu.length;
  }
  return result;
}

export default function DeviceScreen({ serial, wsUrl }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const decoderRef = useRef<VideoDecoder | null>(null);
  const [status, setStatus] = useState<string>("Connecting...");
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [debugLines, setDebugLines] = useState<string[]>([]);

  const addDebug = useCallback((line: string) => {
    console.log(`[DeviceScreen] ${line}`);
    setDebugLines((prev) => [...prev.slice(-19), line]);
  }, []);

  const initDecoder = useCallback(() => {
    if (decoderRef.current?.state !== "closed") {
      decoderRef.current?.close();
    }

    const decoder = new VideoDecoder({
      output: (frame) => {
        const canvas = canvasRef.current;
        if (!canvas) { frame.close(); return; }
        canvas.width = frame.displayWidth;
        canvas.height = frame.displayHeight;
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.drawImage(frame, 0, 0);
        frame.close();
      },
      error: (err) => {
        console.error("[decoder] Error:", err);
        setStatus(`Decoder error: ${err.message}`);
      },
    });

    decoderRef.current = decoder;
    return decoder;
  }, []);

  useEffect(() => {
    addDebug(`Connecting to ${wsUrl}?serial=${serial}`);
    const ws = new WebSocket(`${wsUrl}?serial=${encodeURIComponent(serial)}`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    let decoder: VideoDecoder | null = null;
    let configured = false;
    let frameCount = 0;

    ws.onopen = () => {
      addDebug("WebSocket connected");
      setStatus("Connected, waiting for video...");
    };

    ws.onmessage = (event) => {
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
        } catch { /* ignore */ }
        return;
      }

      const data = new Uint8Array(event.data);
      if (data.length < 13) return;

      const frameType = data[0];
      const view = new DataView(event.data);
      const pts = view.getFloat64(1);
      const size = view.getUint32(9);
      const frameData = data.slice(13, 13 + size);
      frameCount++;

      if (frameCount <= 5) {
        addDebug(`Frame#${frameCount}: type=${frameType} size=${size} pts=${pts}`);
      }

      if (frameType === 1) {
        try {
          if (!decoder || decoder.state === "closed") {
            decoder = initDecoder();
          }

          const nalus = parseAnnexBNALUs(frameData);
          addDebug(`NALUs: ${nalus.length} [${nalus.map(n => `type=${n[0] & 0x1f},len=${n.length}`).join(" ")}]`);

          const avcC = buildAvcC(frameData);
          const sps = nalus.find((n) => (n[0] & 0x1f) === 7);
          const codecStr = sps
            ? `avc1.${[sps[1], sps[2], sps[3]].map((b) => b.toString(16).padStart(2, "0")).join("")}`
            : "avc1.640028";

          addDebug(`Codec: ${codecStr}, avcC: ${avcC.length} bytes`);

          decoder.configure({
            codec: codecStr,
            description: avcC,
            optimizeForLatency: true,
          });

          configured = true;
          addDebug(`Decoder configured! state=${decoder.state}`);
          setStatus("Streaming");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          addDebug(`CONFIG ERROR: ${msg}`);
          setStatus(`Config error: ${msg}`);
        }
        return;
      }

      if (!configured || !decoder || decoder.state !== "configured") return;

      try {
        const avccData = annexBToAvcc(frameData);
        const chunk = new EncodedVideoChunk({
          type: frameType === 2 ? "key" : "delta",
          timestamp: pts,
          data: avccData,
        });
        decoder.decode(chunk);
      } catch (err) {
        if (frameCount <= 10) {
          addDebug(`Decode error: ${err instanceof Error ? err.message : err}`);
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
      if (decoder && decoder.state !== "closed") decoder.close();
    };
  }, [serial, wsUrl, initDecoder, addDebug]);

  const getDeviceCoords = (
    e: React.MouseEvent<HTMLCanvasElement>
  ): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas || !dimensions.width || !dimensions.height) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (dimensions.width / rect.width),
      y: (e.clientY - rect.top) * (dimensions.height / rect.height),
    };
  };

  const sendTouch = (action: "down" | "up" | "move", e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getDeviceCoords(e);
    if (!coords || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "touch", action, x: coords.x, y: coords.y }));
  };

  const [isMouseDown, setIsMouseDown] = useState(false);

  return (
    <div>
      <div style={{ marginBottom: 8, fontSize: 13, color: "#666" }}>
        {status}
        {dimensions.width > 0 && ` — ${dimensions.width}x${dimensions.height}`}
      </div>
      <canvas
        ref={canvasRef}
        style={{
          maxWidth: "100%",
          height: "auto",
          border: "1px solid #ddd",
          borderRadius: 4,
          cursor: "crosshair",
          touchAction: "none",
        }}
        onMouseDown={(e) => { e.preventDefault(); setIsMouseDown(true); sendTouch("down", e); }}
        onMouseMove={(e) => { if (isMouseDown) sendTouch("move", e); }}
        onMouseUp={(e) => { setIsMouseDown(false); sendTouch("up", e); }}
        onMouseLeave={(e) => { if (isMouseDown) { setIsMouseDown(false); sendTouch("up", e); } }}
        onContextMenu={(e) => e.preventDefault()}
      />
      {debugLines.length > 0 && (
        <details style={{ marginTop: 16 }} open>
          <summary style={{ fontSize: 12, color: "#999", cursor: "pointer" }}>
            Debug log ({debugLines.length})
          </summary>
          <pre style={{
            fontSize: 11, background: "#111", color: "#0f0", padding: 12,
            borderRadius: 4, maxHeight: 300, overflow: "auto",
            whiteSpace: "pre-wrap", wordBreak: "break-all",
          }}>
            {debugLines.join("\n")}
          </pre>
        </details>
      )}
    </div>
  );
}
