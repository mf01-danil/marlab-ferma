import { execFile } from "child_process";
import { Device } from "./types";

function adb(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("adb", args, { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`adb ${args.join(" ")} failed: ${stderr || err.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}

export async function listDevices(): Promise<Device[]> {
  const output = await adb(["devices", "-l"]);
  const lines = output.trim().split("\n").slice(1); // skip header
  const devices: Device[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(/\s+/);
    const serial = parts[0];
    const status = parts[1] as Device["status"];

    let model: string | undefined;
    let product: string | undefined;
    let transport: string | undefined;

    for (const part of parts.slice(2)) {
      if (part.startsWith("model:")) model = part.slice(6);
      if (part.startsWith("product:")) product = part.slice(8);
      if (part.startsWith("transport_id:")) transport = part.slice(13);
    }

    devices.push({ serial, status, model, product, transport });
  }

  return devices;
}

export async function push(
  serial: string,
  localPath: string,
  remotePath: string
): Promise<void> {
  await adb(["-s", serial, "push", localPath, remotePath]);
}

export async function shell(serial: string, command: string): Promise<string> {
  return adb(["-s", serial, "shell", command]);
}

export async function forward(
  serial: string,
  localPort: number,
  remote: string
): Promise<void> {
  await adb(["-s", serial, "forward", `tcp:${localPort}`, remote]);
}

export async function removeForward(
  serial: string,
  localPort: number
): Promise<void> {
  try {
    await adb(["-s", serial, "forward", "--remove", `tcp:${localPort}`]);
  } catch {
    // ignore errors during cleanup
  }
}

export function shellSpawn(serial: string, command: string) {
  const { spawn } = require("child_process") as typeof import("child_process");
  return spawn("adb", ["-s", serial, "shell", command], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}
