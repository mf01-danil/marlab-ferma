'use client';

// ─────────────────────────────────────────────────────────────────────────────
// DeviceScreen — renders real-time H.264 stream from scrcpy-server via WS.
// Decodes with WebCodecs (VideoDecoder), requires Chrome 94+ / Edge 94+.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useCallback, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface DeviceScreenProps {
  serial: string;
  /** Base WebSocket URL, e.g. "ws://localhost:3001" or "wss://marlab-ferma.com" */
  wsBase: string;
}

interface StreamMeta {
  deviceName: string;
  width: number;
  height: number;
  nativeWidth: number;
  nativeHeight: number;
}

export default function DeviceScreen({ serial, wsBase }: DeviceScreenProps) {
  const canvasRef      = useRef<HTMLCanvasElement>(null);
  const ctxRef         = useRef<CanvasRenderingContext2D | null>(null);
  const wsRef          = useRef<WebSocket | null>(null);
  const decoderRef     = useRef<any>(null);
  const configuredRef  = useRef(false);
  const needsKeyRef    = useRef(true);  // must receive IDR before decoding delta frames
  const metaRef        = useRef<StreamMeta | null>(null);
  // Stores SPS/PPS bytes from scrcpy codec-config frame to prepend before IDR frames
  const spsFrameRef    = useRef<Uint8Array | null>(null);

  const [meta,     setMeta]     = useState<StreamMeta | null>(null);
  const [status,   setStatus]   = useState<'connecting' | 'streaming' | 'error'>('connecting');
  const [errorMsg, setErrorMsg] = useState('');

  const dragRef = useRef<{ xP: number; yP: number; t: number } | null>(null);

  // ── Create / recreate VideoDecoder ────────────────────────────────────────
  const createDecoder = useCallback(() => {
    try { decoderRef.current?.close(); } catch {}
    configuredRef.current = false;

    if (!('VideoDecoder' in window)) return;

    let frameOutCount = 0;
    const decoder = new (window as any).VideoDecoder({
      output: (frame: any) => {
        const ctx = ctxRef.current;
        const canvas = canvasRef.current;
        if (ctx && canvas) ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
        frame.close();
        frameOutCount++;
        if (frameOutCount === 1) console.log('[DeviceScreen] first frame rendered');
        setStatus('streaming');
      },
      error: (e: Error) => {
        console.log('[DeviceScreen] decoder error:', e.message, '— recreating');
        createDecoder();
      },
    });
    decoderRef.current = decoder;
    console.log('[DeviceScreen] VideoDecoder created');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cleanup ───────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    try { decoderRef.current?.close(); } catch {}
    decoderRef.current = null;
    configuredRef.current = false;
    needsKeyRef.current = true;
    spsFrameRef.current = null;
  }, []);

  // ── SPS helpers ───────────────────────────────────────────────────────────
  function findSPS(buf: Uint8Array): Uint8Array | null {
    for (let i = 0; i < buf.length - 5; i++) {
      if (buf[i] === 0 && buf[i+1] === 0 && buf[i+2] === 0 && buf[i+3] === 1) {
        if ((buf[i+4] & 0x1f) === 7) {
          for (let j = i + 5; j < buf.length - 3; j++) {
            if (buf[j] === 0 && buf[j+1] === 0 && buf[j+2] === 0 && buf[j+3] === 1) {
              return buf.slice(i + 4, j);
            }
          }
          return buf.slice(i + 4);
        }
      }
    }
    return null;
  }

  function codecFromSPS(sps: Uint8Array): string {
    if (sps.length < 4) return 'avc1.42E01E';
    const h = (n: number) => n.toString(16).padStart(2, '0');
    return `avc1.${h(sps[1])}${h(sps[2])}${h(sps[3])}`;
  }

  /** Returns true if the buffer contains an IDR slice (NAL type 5). */
  function hasIDR(buf: Uint8Array): boolean {
    for (let i = 0; i < buf.length - 4; i++) {
      if (buf[i] === 0 && buf[i+1] === 0 && buf[i+2] === 0 && buf[i+3] === 1) {
        if ((buf[i+4] & 0x1f) === 5) return true;
      }
    }
    return false;
  }

  // ── Configure decoder ─────────────────────────────────────────────────────
  function configureDecoder(sps: Uint8Array): boolean {
    const decoder = decoderRef.current;
    if (!decoder) return false;
    const m = metaRef.current ?? { width: 720, height: 1280, deviceName: '' };
    const codec = codecFromSPS(sps);
    console.log(`[DeviceScreen] configure: ${codec} ${m.width}x${m.height}`);
    try {
      decoder.configure({
        codec,
        codedWidth:         m.width,
        codedHeight:        m.height,
        optimizeForLatency: true,
      });
      configuredRef.current = true;
      needsKeyRef.current   = true; // must wait for IDR before sending delta frames
      console.log('[DeviceScreen] configured OK');
      return true;
    } catch (e: any) {
      console.log('[DeviceScreen] configure failed:', e?.message);
      return false;
    }
  }

  // ── Feed frame ────────────────────────────────────────────────────────────
  const feedFrame = useCallback((pts: bigint, data: ArrayBuffer) => {
    const decoder = decoderRef.current;
    if (!decoder) return;

    const u8 = new Uint8Array(data);

    if (!configuredRef.current) {
      const sps = findSPS(u8);

      if (sps) {
        if (!configureDecoder(sps)) return;
        // scrcpy sends SPS/PPS as a separate codec-config frame (no IDR).
        if (!hasIDR(u8)) {
          spsFrameRef.current = u8; // save for prepending to next IDR
          return;
        }
        // SPS + IDR combined — fall through and decode normally
      } else {
        // No SPS in this frame. Try to reconfigure using stored SPS.
        const stored = spsFrameRef.current;
        if (!stored) return;
        const storedSps = findSPS(stored);
        if (!storedSps) return;
        // Only proceed if this is an IDR — never send delta right after reconfigure
        if (!hasIDR(u8)) return;
        if (!configureDecoder(storedSps)) return;
        // Fall through — SPS will be prepended below
      }
    }

    // After configure we must see an IDR before any delta frames.
    const isIDR = hasIDR(u8);
    if (needsKeyRef.current && !isIDR) return; // skip deltas until first IDR
    if (isIDR) needsKeyRef.current = false;

    // For IDR frames without inline SPS/PPS, prepend the saved ones.
    let decodeData: ArrayBuffer = data;
    if (isIDR && spsFrameRef.current && !findSPS(u8)) {
      const prefix = spsFrameRef.current;
      const combined = new Uint8Array(prefix.length + u8.length);
      combined.set(prefix, 0);
      combined.set(u8, prefix.length);
      decodeData = combined.buffer;
    }

    // Clamp to a safe range: negative = codec-config marker, very large = precision loss
    const MAX_SAFE = 9007199254740991n;
    const ts = pts < 0n ? 0n : pts > MAX_SAFE ? MAX_SAFE : pts;

    try {
      decoder.decode(new (window as any).EncodedVideoChunk({
        type:      isIDR ? 'key' : 'delta',
        timestamp: Number(ts),
        data:      decodeData,
      }));
    } catch (e: any) {
      console.log(`[DeviceScreen] decode() threw (ts=${ts}):`, e?.message);
      configuredRef.current = false;
      needsKeyRef.current = true;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── WebSocket ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!wsBase || !serial) return;

    setStatus('connecting');
    setMeta(null);
    metaRef.current = null;
    configuredRef.current = false;
    needsKeyRef.current = true;

    if (!('VideoDecoder' in window)) {
      setErrorMsg('WebCodecs not supported — use Chrome 94+ or Edge 94+');
      setStatus('error');
      return;
    }

    // Init canvas context
    const canvas = canvasRef.current;
    ctxRef.current = canvas?.getContext('2d') ?? null;

    // Create decoder
    createDecoder();

    const url = `${wsBase}/ws/stream?serial=${encodeURIComponent(serial)}`;
    console.log('[DeviceScreen] connecting to', url);
    const ws  = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    // Guard: ignore events from a stale WebSocket (React StrictMode opens WS twice)
    const isActive = () => wsRef.current === ws;

    ws.onopen  = () => { if (!isActive()) return; console.log('[DeviceScreen] WebSocket open'); };
    ws.onerror = () => { if (!isActive()) return; setErrorMsg('Connection failed'); setStatus('error'); };
    ws.onclose = () => { if (!isActive()) return; setStatus('connecting'); };

    ws.onmessage = (event) => {
      if (!isActive()) return;
      if (typeof event.data === 'string') {
        try {
          const msg: any = JSON.parse(event.data);
          if (msg.type === 'meta') {
            const m: StreamMeta = {
              deviceName:   msg.deviceName,
              width:        msg.width,
              height:       msg.height,
              nativeWidth:  msg.nativeWidth  ?? msg.width,
              nativeHeight: msg.nativeHeight ?? msg.height,
            };
            metaRef.current = m;
            setMeta(m);
            if (canvas) { canvas.width = m.width; canvas.height = m.height; }
          }
        } catch {}
        return;
      }

      const buf = event.data as ArrayBuffer;
      if (buf.byteLength < 8) return;

      const view = new DataView(buf);
      // Read as signed int64 (scrcpy encodes PTS as int64 big-endian).
      const pts = (BigInt(view.getInt32(0, false)) << 32n) | BigInt(view.getUint32(4, false));
      feedFrame(pts, buf.slice(8));
    };

    return cleanup;
  }, [serial, wsBase, cleanup, feedFrame, createDecoder]);

  // ── Input ─────────────────────────────────────────────────────────────────
  function send(msg: object) {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  // Returns click position as fractions [0..1] of the canvas element size.
  // The backend converts to device coordinates using hardware touch axis max values.
  function scaleCoords(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    return {
      xP: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      yP: Math.max(0, Math.min(1, (e.clientY - rect.top)  / rect.height)),
    };
  }

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    dragRef.current = { ...scaleCoords(e), t: Date.now() };
  };

  const onMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    const { xP: x1P, yP: y1P, t } = dragRef.current;
    const { xP: x2P, yP: y2P }    = scaleCoords(e);
    dragRef.current = null;
    // Tap threshold: movement < 2% of either screen dimension
    const dist = Math.hypot(x2P - x1P, y2P - y1P);
    if (dist < 0.02) {
      send({ type: 'tap', xP: x1P, yP: y1P });
    } else {
      send({ type: 'swipe', x1P, y1P, x2P, y2P, duration: Date.now() - t });
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="relative w-full flex items-center justify-center bg-black rounded-lg overflow-hidden"
      style={{ aspectRatio: meta ? `${meta.width} / ${meta.height}` : '9 / 19.5' }}
    >
      {status === 'connecting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/60">
          <Loader2 className="size-6 animate-spin" />
          <span className="text-sm">Connecting…</span>
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center text-red-400 text-sm px-4 text-center">
          {errorMsg || 'Stream unavailable'}
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="w-full h-full object-contain cursor-pointer select-none"
        style={{ display: status === 'streaming' ? 'block' : 'none' }}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onContextMenu={e => e.preventDefault()}
      />
    </div>
  );
}
