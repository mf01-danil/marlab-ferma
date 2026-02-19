'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// MarLab Ferma — Backend
// Manages Android devices via ADB + streams H.264 via scrcpy-server over WS
// ─────────────────────────────────────────────────────────────────────────────

const express   = require('express');
const http      = require('http');
const { WebSocketServer } = require('ws');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const netSocket = require('net');
const path      = require('path');
const fs        = require('fs');

const execFileAsync = promisify(execFile);

// ── Config ──────────────────────────────────────────────────────────────────
const PORT          = Number(process.env.PORT)     || 3001;
const ADB_BIN       = process.env.ADB_PATH         || 'adb';
// When running inside Docker, point to the host's ADB server
const ADB_HOST      = process.env.ADB_HOST         || null;
const ADB_PORT_NUM  = process.env.ADB_PORT         || '5037';
const SCRCPY_JAR    = path.join(__dirname, 'scrcpy-server.jar');
const SCRCPY_VER    = '2.7';
// Port pool for adb forward (one port per active stream)
let   nextFwdPort   = 27200;

// ── ADB helpers ─────────────────────────────────────────────────────────────

/** Prepend -H/-P flags when connecting to a remote ADB server (Docker). */
function adbArgs(...args) {
  return ADB_HOST
    ? ['-H', ADB_HOST, '-P', ADB_PORT_NUM, ...args]
    : args;
}

async function adb(...args) {
  const { stdout } = await execFileAsync(ADB_BIN, adbArgs(...args), { timeout: 15_000 });
  return stdout.trim();
}

async function adbShell(serial, cmd) {
  return adb('-s', serial, 'shell', cmd);
}

function adbSpawn(...args) {
  return spawn(ADB_BIN, adbArgs(...args), { stdio: ['ignore', 'pipe', 'pipe'] });
}

// ── Device listing ───────────────────────────────────────────────────────────

async function listRawDevices() {
  const out = await adb('devices', '-l');
  return out.split('\n').slice(1).reduce((acc, line) => {
    const m = line.match(/^(\S+)\s+(device|offline|unauthorized)\s*(.*)/);
    if (!m) return acc;
    const [, serial, state, extra] = m;
    const model = extra.match(/model:(\S+)/)?.[1]?.replace(/_/g, ' ') || null;
    acc.push({ serial, state, model });
    return acc;
  }, []);
}

async function enrichDevice({ serial, state, model }) {
  if (state !== 'device') {
    return {
      serial,
      status: state === 'unauthorized' ? 'unauthorized' : 'offline',
      model,
    };
  }

  const [batteryR, versionR, ipR, modelR] = await Promise.allSettled([
    adbShell(serial, "dumpsys battery | grep -m1 level | tr -dc '0-9'"),
    adbShell(serial, 'getprop ro.build.version.release'),
    adbShell(serial, "ip -f inet addr show wlan0 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1"),
    model ? Promise.resolve(model) : adbShell(serial, 'getprop ro.product.model'),
  ]);

  return {
    serial,
    status: 'device',   // matches ADB status string expected by frontend
    model:          modelR.status === 'fulfilled'   ? modelR.value  || 'Unknown' : 'Unknown',
    battery:        batteryR.status === 'fulfilled' ? parseInt(batteryR.value) || null : null,
    androidVersion: versionR.status === 'fulfilled' ? versionR.value || null : null,
    ipAddress:      ipR.status === 'fulfilled'      ? ipR.value || null : null,
  };
}

// ── scrcpy streaming ─────────────────────────────────────────────────────────
//
// Protocol (scrcpy-server v2.7, raw_stream=false):
//   ┌ Header (once, at connection start):
//   │  64 bytes  device name (UTF-8, null-padded)
//   │   4 bytes  codec id    (big-endian uint32; 0x68323634 = "h264")
//   │   4 bytes  width       (big-endian uint32)
//   │   4 bytes  height      (big-endian uint32)
//   └ Frames (repeated):
//      8 bytes  PTS          (big-endian int64, microseconds)
//      4 bytes  frame size   (big-endian uint32)
//      N bytes  H.264 NAL data
//
const META_SIZE  = 64 + 4 + 4 + 4; // 76 bytes
const FRAME_HDR  = 8 + 4;           // 12 bytes

const sessions        = new Map(); // serial → { port, proc, socket }
const sessionPending  = new Map(); // serial → Promise  (in-flight createSession)

async function killDeviceScrcpy(serial) {
  // Try multiple patterns — process may appear as scrcpy-server or app_process
  try {
    await adbShell(serial,
      'pkill -9 scrcpy-server 2>/dev/null; ' +
      'pkill -9 -f com.genymobile.scrcpy 2>/dev/null; ' +
      'true');
  } catch {}
  await sleep(700); // give socket time to be released
}

async function pushJar(serial) {
  if (!fs.existsSync(SCRCPY_JAR)) {
    throw new Error(`scrcpy-server.jar not found at ${SCRCPY_JAR}. See README.`);
  }
  // Check if already on device with the right version marker
  try {
    const ok = await adbShell(serial,
      'ls /data/local/tmp/scrcpy-server.jar 2>&1');
    if (ok.includes('scrcpy-server.jar')) return; // already there
  } catch {}
  await execFileAsync(ADB_BIN,
    adbArgs('-s', serial, 'push', SCRCPY_JAR, '/data/local/tmp/scrcpy-server.jar'),
    { timeout: 30_000 });
}

async function createSession(serial) {
  const port = nextFwdPort++;

  await killDeviceScrcpy(serial);
  await pushJar(serial);

  // Query touchscreen absolute axis max values via getevent -p.
  // More reliable than wm size: reads hardware-level ABS_MT_POSITION_X/Y (0035/0036)
  // which are unaffected by software display overrides (Samsung DeX, etc.).
  let touchMaxX = null, touchMaxY = null;

  // Method 1: getevent -p (ABS axes 0035 = X, 0036 = Y)
  try {
    const gevOut = await adbShell(serial, 'timeout 5 getevent -p 2>/dev/null; true');
    const all35 = [...gevOut.matchAll(/0035\s*:.*?max\s+(\d+)/g)];
    const all36 = [...gevOut.matchAll(/0036\s*:.*?max\s+(\d+)/g)];
    if (all35.length && all36.length) {
      touchMaxX = parseInt(all35[all35.length - 1][1]);
      touchMaxY = parseInt(all36[all36.length - 1][1]);
    }
    console.log(`[session:${serial}] getevent -p: ${gevOut.length} chars, axes 0035/0036 max=${touchMaxX}/${touchMaxY}`);
  } catch (e) {
    console.log(`[session:${serial}] getevent -p failed: ${e.message}`);
  }

  // Method 2: wm size Physical size (fallback)
  if (touchMaxX == null) {
    try {
      const wmOut = await adbShell(serial, 'wm size');
      const m = wmOut.match(/Physical size:\s*(\d+)x(\d+)/i);
      if (m) { touchMaxX = parseInt(m[1]) - 1; touchMaxY = parseInt(m[2]) - 1; }
      console.log(`[session:${serial}] wm size fallback: ${JSON.stringify(wmOut)} → ${touchMaxX}/${touchMaxY}`);
    } catch {}
  }

  console.log(`[session:${serial}] touch max: ${touchMaxX}x${touchMaxY}`);

  // Start scrcpy-server on device (stays running until killed)
  const proc = adbSpawn(
    '-s', serial, 'shell',
    `CLASSPATH=/data/local/tmp/scrcpy-server.jar`,
    `app_process`, `/`,
    `com.genymobile.scrcpy.Server`,
    SCRCPY_VER,
    `log_level=warn`,
    `max_size=720`,
    `video_bit_rate=2000000`,
    `max_fps=30`,
    `lock_video_orientation=0`,
    `tunnel_forward=true`,
    `audio=false`,
    `control=false`,    // input via adb shell (simpler + lower latency for farm use)
    `display_id=0`,
    `stay_awake=true`,
    `send_dummy_byte=false`,
    `send_device_meta=true`,
    `send_codec_meta=true`,
    `video_codec=h264`,
  );

  proc.stderr.on('data', d =>
    process.stdout.write(`[scrcpy:${serial}] ${d}`));

  proc.on('exit', code =>
    console.log(`[scrcpy:${serial}] exited (${code})`));

  // Wait for server to bind socket on device
  await sleep(600);

  // ADB forward: tcp:PORT → localabstract:scrcpy (video socket)
  await execFileAsync(ADB_BIN,
    adbArgs('-s', serial, 'forward', `tcp:${port}`, 'localabstract:scrcpy'),
    { timeout: 10_000 });

  // Connect to the forwarded port
  const socket = await tcpConnect('127.0.0.1', port);

  return { port, proc, socket, touchMaxX, touchMaxY };
}

function destroySession(serial) {
  const s = sessions.get(serial);
  if (!s) return;
  s.socket.destroy();
  try { s.proc.kill('SIGKILL'); } catch {}
  execFile(ADB_BIN,
    adbArgs('-s', serial, 'forward', '--remove', `tcp:${s.port}`),
    () => {});
  sessions.delete(serial);
  console.log(`[session:${serial}] destroyed`);
}

function tcpConnect(host, port, retries = 10, delay = 200) {
  return new Promise((resolve, reject) => {
    const attempt = n => {
      const s = netSocket.createConnection(port, host);
      s.once('connect', () => resolve(s));
      s.once('error', err => {
        s.destroy();
        if (n > 0) setTimeout(() => attempt(n - 1), delay);
        else reject(err);
      });
    };
    attempt(retries);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Input handling ───────────────────────────────────────────────────────────

async function handleInput(serial, msg, touchMaxX, touchMaxY) {
  // Fall back to a common resolution if touch dimensions couldn't be queried
  const maxX = touchMaxX ?? 1079;
  const maxY = touchMaxY ?? 1919;
  try {
    switch (msg.type) {
      case 'tap': {
        const x = Math.round(msg.xP * maxX);
        const y = Math.round(msg.yP * maxY);
        await execFileAsync(ADB_BIN, adbArgs(
          '-s', serial, 'shell', 'input', 'tap',
          String(x), String(y)
        ), { timeout: 5_000 });
        break;
      }

      case 'swipe': {
        const x1 = Math.round(msg.x1P * maxX);
        const y1 = Math.round(msg.y1P * maxY);
        const x2 = Math.round(msg.x2P * maxX);
        const y2 = Math.round(msg.y2P * maxY);
        await execFileAsync(ADB_BIN, adbArgs(
          '-s', serial, 'shell', 'input', 'swipe',
          String(x1), String(y1), String(x2), String(y2),
          String(msg.duration || 200)
        ), { timeout: 5_000 });
        break;
      }

      case 'keyevent':
        await execFileAsync(ADB_BIN, adbArgs(
          '-s', serial, 'shell', 'input', 'keyevent', String(msg.keycode)
        ), { timeout: 5_000 });
        break;

      case 'text':
        await execFileAsync(ADB_BIN, adbArgs(
          '-s', serial, 'shell', 'input', 'text',
          String(msg.text).replace(/'/g, "\\'")
        ), { timeout: 5_000 });
        break;
    }
  } catch (err) {
    console.error(`[input:${serial}] ${err.message}`);
  }
}

// ── HTTP server ──────────────────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/api/devices', async (req, res) => {
  try {
    const raw      = await listRawDevices();
    const enriched = await Promise.all(raw.map(enrichDevice));
    res.json(enriched);
  } catch (err) {
    console.error('/api/devices:', err.message);
    res.json([]);
  }
});

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ── WebSocket server ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server, path: '/ws/stream' });

wss.on('connection', async (ws, req) => {
  const params = new URL(req.url, 'http://x').searchParams;
  const serial  = params.get('serial');

  if (!serial) { ws.close(1008, 'Missing serial'); return; }

  console.log(`[ws:${serial}] client connected`);

  // ── Serialize session creation per device (prevents race on React StrictMode) ─
  // If another connection is already creating a session, wait for it first.
  if (sessionPending.has(serial)) {
    console.log(`[ws:${serial}] waiting for pending session...`);
    try { await sessionPending.get(serial); } catch {}
  }

  // Kill any previous session for this device
  destroySession(serial);

  // ── Start streaming session ───────────────────────────────────────────────
  let session;
  const creationPromise = createSession(serial);
  sessionPending.set(serial, creationPromise);
  try {
    session = await creationPromise;
    sessions.set(serial, session);
  } catch (err) {
    console.error(`[ws:${serial}] session failed:`, err.message);
    ws.close(1011, err.message);
    return;
  } finally {
    sessionPending.delete(serial);
  }

  const { socket, touchMaxX, touchMaxY } = session;

  // ── Stream parsing state ──────────────────────────────────────────────────
  let headerBuf  = Buffer.alloc(0);
  let headerDone = false;
  let frameBuf   = Buffer.alloc(0);

  socket.on('data', chunk => {
    if (ws.readyState !== ws.OPEN) return;

    // ── Phase 1: collect 76-byte meta header ─────────────────────────────
    if (!headerDone) {
      headerBuf = Buffer.concat([headerBuf, chunk]);
      if (headerBuf.length < META_SIZE) return;

      const deviceName = headerBuf.slice(0, 64).toString('utf8').replace(/\0/g, '');
      const codecId    = headerBuf.readUInt32BE(64);
      const width      = headerBuf.readUInt32BE(68);
      const height     = headerBuf.readUInt32BE(72);
      headerDone = true;

      console.log(`[ws:${serial}] meta: ${deviceName} ${width}x${height} touchMax=${touchMaxX}x${touchMaxY} codec=0x${codecId.toString(16)}`);

      ws.send(JSON.stringify({
        type: 'meta', deviceName, width, height,
        nativeWidth:  touchMaxX != null ? touchMaxX + 1 : width,
        nativeHeight: touchMaxY != null ? touchMaxY + 1 : height,
      }));

      // Leftover bytes after header → start of frame data
      const rest = headerBuf.slice(META_SIZE);
      headerBuf = null;
      if (rest.length > 0) {
        frameBuf = Buffer.concat([frameBuf, rest]);
        drainFrames();
      }
      return;
    }

    // ── Phase 2: parse framed H.264 stream ───────────────────────────────
    frameBuf = Buffer.concat([frameBuf, chunk]);
    drainFrames();
  });

  let frameCount = 0;

  /** Parse as many complete frames as possible from frameBuf. */
  function drainFrames() {
    while (frameBuf.length >= FRAME_HDR) {
      const pts       = frameBuf.readBigInt64BE(0);            // int64 µs
      const frameSize = frameBuf.readUInt32BE(8);              // uint32

      if (frameBuf.length < FRAME_HDR + frameSize) break;     // incomplete

      const frameData = frameBuf.slice(FRAME_HDR, FRAME_HDR + frameSize);
      frameBuf        = frameBuf.slice(FRAME_HDR + frameSize);

      if (ws.readyState !== ws.OPEN) break;

      frameCount++;
      if (frameCount <= 5) {
        const hex = frameData.slice(0, Math.min(12, frameData.length)).toString('hex');
        console.log(`[ws:${serial}] frame #${frameCount} size=${frameSize} pts=${pts} first_bytes=${hex}`);
      } else if (frameCount % 150 === 0) {
        console.log(`[ws:${serial}] frame #${frameCount}`);
      }

      // Message layout: [8 bytes PTS big-endian int64] [H.264 NAL data]
      const msg = Buffer.allocUnsafe(8 + frameData.length);
      msg.writeBigInt64BE(pts, 0);
      frameData.copy(msg, 8);
      ws.send(msg);
    }
  }

  socket.on('error', err => {
    console.error(`[ws:${serial}] socket error:`, err.message);
    if (ws.readyState === ws.OPEN) ws.close();
  });

  socket.on('end', () => {
    console.log(`[ws:${serial}] socket ended`);
    if (ws.readyState === ws.OPEN) ws.close();
  });

  // ── Input from browser ────────────────────────────────────────────────────
  ws.on('message', data => {
    try {
      handleInput(serial, JSON.parse(data.toString()), touchMaxX, touchMaxY);
    } catch {}
  });

  ws.on('close', () => {
    console.log(`[ws:${serial}] client disconnected`);
    destroySession(serial);
  });
});

// ── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`MarLab backend  :${PORT}`);
  console.log(`  ADB server    : ${ADB_HOST ? `${ADB_HOST}:${ADB_PORT_NUM}` : 'localhost (native)'}`);
  console.log(`  scrcpy jar    : ${SCRCPY_JAR}`);
  if (!fs.existsSync(SCRCPY_JAR)) {
    console.warn(`  WARNING: scrcpy-server.jar missing! Download from:`);
    console.warn(`  https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_VER}/scrcpy-server-v${SCRCPY_VER}`);
    console.warn(`  and rename to scrcpy-server.jar in the server/ directory`);
  }
});
