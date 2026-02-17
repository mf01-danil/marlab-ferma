export interface Device {
  serial: string;
  status: "device" | "offline" | "unauthorized" | "no permissions";
  model?: string;
  product?: string;
  transport?: string;
}

export interface ScrcpyOptions {
  maxSize: number;
  bitRate: number;
  maxFps: number;
}

export interface VideoMetadata {
  deviceName: string;
  codecId: number;
  width: number;
  height: number;
}

export interface VideoFrame {
  pts: bigint;
  isKeyframe: boolean;
  isConfig: boolean;
  data: Buffer;
}

export interface InputMessage {
  type: "touch";
  action: "down" | "up" | "move";
  x: number;
  y: number;
}
