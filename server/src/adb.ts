import { execFile } from "child_process";
import { Device } from "./types";

function adb(args: string[], timeoutMs = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("adb", args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        const detail = stderr?.trim() || stdout?.trim() || err.message;
        reject(new Error(`adb ${args.join(" ")} failed: ${detail}`));
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

  // Only return USB-connected devices (filter out WiFi ADB pairs like 192.168.x.x:5555)
  return devices.filter((d) => !d.serial.includes(":"));
}

export async function push(
  serial: string,
  localPath: string,
  remotePath: string
): Promise<void> {
  await adb(["-s", serial, "push", localPath, remotePath], 60000);
}

export async function install(
  serial: string,
  localPath: string
): Promise<string> {
  return adb(["-s", serial, "install", "-r", "-g", localPath], 120000);
}

export async function shell(serial: string, command: string, timeoutMs = 10000): Promise<string> {
  return adb(["-s", serial, "shell", command], timeoutMs);
}

export async function shellSu(serial: string, command: string, timeoutMs = 30000): Promise<string> {
  return adb(["-s", serial, "shell", `su -c '${command}'`], timeoutMs);
}

export async function rebootDevice(serial: string): Promise<void> {
  await adb(["-s", serial, "reboot"], 10000);
}

export async function waitForDevice(serial: string, timeoutMs = 120000): Promise<void> {
  await adb(["-s", serial, "wait-for-device"], timeoutMs);
}

export async function waitForBoot(serial: string, timeoutMs = 180000): Promise<boolean> {
  const start = Date.now();
  // First wait for USB reconnection
  await waitForDevice(serial, timeoutMs);

  // Then poll sys.boot_completed
  while (Date.now() - start < timeoutMs) {
    try {
      const result = await shell(serial, "getprop sys.boot_completed", 5000);
      if (result.trim() === "1") return true;
    } catch {
      // device not ready yet
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
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
