import * as net from "net";
import * as path from "path";
import { EventEmitter } from "events";
import { push, forward, removeForward, shellSpawn } from "./adb";
import { VideoMetadata, VideoFrame, ScrcpyOptions } from "./types";

const SCRCPY_SERVER_PATH = path.join(__dirname, "..", "bin", "scrcpy-server");
const SCRCPY_SERVER_VERSION = "2.7";
const DEVICE_SERVER_PATH = "/data/local/tmp/scrcpy-server.jar";

const DEFAULT_OPTIONS: ScrcpyOptions = {
  maxSize: 1280,
  bitRate: 2_000_000,
  maxFps: 30,
};

export class ScrcpyClient extends EventEmitter {
  private serial: string;
  private options: ScrcpyOptions;
  private scid: number;
  private localPort: number;
  private videoSocket: net.Socket | null = null;
  private controlSocket: net.Socket | null = null;
  private serverProcess: ReturnType<typeof shellSpawn> | null = null;
  private destroyed = false;
  private videoBuffer = Buffer.alloc(0);
  private metadata: VideoMetadata | null = null;
  private headerParsed = false;
  private codecMetaParsed = false;

  // Track device screen dimensions for touch events
  screenWidth = 0;
  screenHeight = 0;

  constructor(serial: string, options?: Partial<ScrcpyOptions>) {
    super();
    this.serial = serial;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    // Keep scid small enough so hex representation fits in a Java int
    this.scid = Math.floor(Math.random() * 0xffff);
    this.localPort = 27183 + (this.scid % 1000);
  }

  async start(): Promise<void> {
    try {
      // Step 1: Push scrcpy-server to device
      console.log(`[scrcpy:${this.serial}] Pushing server...`);
      await push(this.serial, SCRCPY_SERVER_PATH, DEVICE_SERVER_PATH);
      if (this.destroyed) return;

      // Step 2: Start scrcpy-server on device
      const scidHex = this.scid.toString(16).padStart(8, "0");
      console.log(`[scrcpy:${this.serial}] Starting server (scid=${scidHex}, port=${this.localPort})...`);

      const cmd = [
        `CLASSPATH=${DEVICE_SERVER_PATH}`,
        "app_process / com.genymobile.scrcpy.Server",
        SCRCPY_SERVER_VERSION,
        `scid=${scidHex}`,
        "log_level=verbose",
        "tunnel_forward=true",
        "video=true",
        "audio=false",
        "control=true",
        `max_size=${this.options.maxSize}`,
        `video_bit_rate=${this.options.bitRate}`,
        `max_fps=${this.options.maxFps}`,
        "video_codec=h264",
        "send_device_meta=true",
        "send_frame_meta=true",
        "send_codec_meta=true",
      ].join(" ");

      this.serverProcess = shellSpawn(this.serial, cmd);

      this.serverProcess.stdout?.on("data", (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) console.log(`[scrcpy-server:stdout] ${msg}`);
      });

      this.serverProcess.stderr?.on("data", (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) console.log(`[scrcpy-server:stderr] ${msg}`);
      });

      this.serverProcess.on("exit", (code: number | null, signal: string | null) => {
        console.log(`[scrcpy:${this.serial}] Server process exited (code=${code}, signal=${signal})`);
        if (!this.destroyed) {
          this.emit("error", new Error(`scrcpy server exited: code=${code}`));
        }
      });

      // Step 3: Wait for server to start listening
      console.log(`[scrcpy:${this.serial}] Waiting for server to initialize...`);
      await this.sleep(2000);
      if (this.destroyed) return;

      // Step 4: Forward port
      const socketName = `localabstract:scrcpy_${scidHex}`;
      console.log(`[scrcpy:${this.serial}] Forwarding tcp:${this.localPort} -> ${socketName}`);
      await forward(this.serial, this.localPort, socketName);
      if (this.destroyed) return;

      // Step 5: Connect video socket with retry
      await this.sleep(500);
      if (this.destroyed) return;

      console.log(`[scrcpy:${this.serial}] Connecting video socket...`);
      this.videoSocket = await this.connectWithRetry(this.localPort, 3);
      console.log(`[scrcpy:${this.serial}] Video socket connected`);

      // Attach data handler BEFORE connecting control socket
      this.videoSocket.on("data", (data) => {
        this.onVideoData(data);
      });
      this.videoSocket.on("error", (err) => {
        console.error(`[scrcpy:${this.serial}] Video socket error:`, err.message);
        this.emit("error", err);
      });
      this.videoSocket.on("close", (hadError) => {
        console.log(`[scrcpy:${this.serial}] Video socket closed (hadError=${hadError})`);
        if (!this.destroyed) this.emit("error", new Error("Video socket closed"));
      });

      // Step 6: Connect control socket
      if (this.destroyed) return;
      this.controlSocket = await this.connectWithRetry(this.localPort, 3);
      console.log(`[scrcpy:${this.serial}] Control socket connected`);

      this.emit("ready");
    } catch (err) {
      console.error(`[scrcpy:${this.serial}] Start failed:`, err);
      this.emit("error", err);
      this.destroy();
    }
  }

  private connectWithRetry(port: number, retries: number): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const attempt = (n: number) => {
        const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
          socket.setTimeout(0); // clear timeout after connection
          resolve(socket);
        });
        socket.on("error", (err) => {
          if (n > 0 && !this.destroyed) {
            console.log(`[scrcpy:${this.serial}] Socket connect retry (${retries - n + 1}/${retries})...`);
            setTimeout(() => attempt(n - 1), 1000);
          } else {
            reject(err);
          }
        });
        socket.setTimeout(5000, () => {
          socket.destroy();
          if (n > 0 && !this.destroyed) {
            console.log(`[scrcpy:${this.serial}] Socket connect timeout, retrying...`);
            setTimeout(() => attempt(n - 1), 1000);
          } else {
            reject(new Error("Socket connection timeout after retries"));
          }
        });
      };
      attempt(retries);
    });
  }

  private onVideoData(data: Buffer): void {
    this.videoBuffer = Buffer.concat([this.videoBuffer, data]);

    // Parse header: dummy byte (1) + device name (64)
    if (!this.headerParsed) {
      if (this.videoBuffer.length < 65) return;

      const dummyByte = this.videoBuffer[0];
      const deviceNameBuf = this.videoBuffer.subarray(1, 65);
      const nullIdx = deviceNameBuf.indexOf(0);
      const deviceName = deviceNameBuf
        .subarray(0, nullIdx >= 0 ? nullIdx : 64)
        .toString("utf-8");

      this.videoBuffer = this.videoBuffer.subarray(65);
      this.headerParsed = true;

      console.log(`[scrcpy:${this.serial}] Device name: "${deviceName}" (dummy=0x${dummyByte.toString(16)})`);
    }

    // Parse codec metadata: codec_id (4) + width (4) + height (4)
    if (!this.codecMetaParsed) {
      if (this.videoBuffer.length < 12) return;

      const codecId = this.videoBuffer.readUInt32BE(0);
      const width = this.videoBuffer.readUInt32BE(4);
      const height = this.videoBuffer.readUInt32BE(8);

      this.videoBuffer = this.videoBuffer.subarray(12);
      this.codecMetaParsed = true;

      this.screenWidth = width;
      this.screenHeight = height;

      this.metadata = { deviceName: "", codecId, width, height };
      console.log(`[scrcpy:${this.serial}] Video: ${width}x${height}, codec=0x${codecId.toString(16)}`);

      this.emit("metadata", this.metadata);
    }

    // Parse video frames: PTS (8) + packet_size (4) + data
    while (this.videoBuffer.length >= 12) {
      const ptsRaw = this.videoBuffer.readBigUInt64BE(0);
      const packetSize = this.videoBuffer.readUInt32BE(8);

      if (this.videoBuffer.length < 12 + packetSize) break;

      const isConfig = Boolean(ptsRaw & (1n << 63n));
      const isKeyframe = Boolean(ptsRaw & (1n << 62n));
      const pts = ptsRaw & ((1n << 62n) - 1n);

      const frameData = this.videoBuffer.subarray(12, 12 + packetSize);
      this.videoBuffer = this.videoBuffer.subarray(12 + packetSize);

      const frame: VideoFrame = {
        pts,
        isKeyframe,
        isConfig,
        data: Buffer.from(frameData),
      };

      this.emit("frame", frame);
    }
  }

  sendTouchEvent(
    action: number,
    x: number,
    y: number,
    screenWidth: number,
    screenHeight: number
  ): void {
    if (!this.controlSocket || this.destroyed) return;

    const buf = Buffer.alloc(32);
    buf.writeUInt8(0x02, 0); // TYPE_INJECT_TOUCH_EVENT
    buf.writeUInt8(action, 1); // action: 0=DOWN, 1=UP, 2=MOVE
    buf.writeBigInt64BE(0x0000000000000001n, 2); // pointer_id
    buf.writeInt32BE(Math.round(x), 10); // position x
    buf.writeInt32BE(Math.round(y), 14); // position y
    buf.writeUInt16BE(screenWidth, 18); // screen width
    buf.writeUInt16BE(screenHeight, 20); // screen height
    buf.writeUInt16BE(action === 1 ? 0x0000 : 0xffff, 22); // pressure
    buf.writeUInt32BE(action === 1 ? 0 : 1, 24); // action_button
    buf.writeUInt32BE(action === 1 ? 0 : 1, 28); // buttons

    this.controlSocket.write(buf);
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;

    console.log(`[scrcpy:${this.serial}] Destroying client`);

    this.videoSocket?.destroy();
    this.controlSocket?.destroy();
    this.serverProcess?.kill();

    await removeForward(this.serial, this.localPort);
    this.removeAllListeners();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
