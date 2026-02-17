import { Device, DeviceStatus } from "@/types/device";

const MODELS = [
  "SM-F721B", "SM-F721B", "SM-F721B", "SM-F721B",
  "SM-F721B", "SM-F721B", "SM-F721B", "SM-F721B",
  "Pixel 7", "Pixel 6a", "Galaxy S23", "Galaxy A54",
];
const GROUPS = ["Production", "Testing", "Development", "Staging", "QA"];
const STATUSES: DeviceStatus[] = [
  "device", "device", "device", "device", "device",
  "offline", "busy", "preparing", "error",
];

function randomHex(len: number): string {
  return Array.from({ length: len }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join("").toUpperCase();
}

export function generateMockDevices(count = 185): Device[] {
  return Array.from({ length: count }, (_, i) => {
    const status = STATUSES[Math.floor(Math.random() * STATUSES.length)];
    return {
      serial: `R5CT${randomHex(4)}${randomHex(4)}`,
      status,
      model: MODELS[i % MODELS.length],
      product: "f2q",
      group: GROUPS[Math.floor(Math.random() * GROUPS.length)],
      battery: Math.floor(Math.random() * 80) + 20,
      androidVersion: ["12", "13", "14"][Math.floor(Math.random() * 3)],
      ipAddress: `192.168.45.${100 + (i % 155)}`,
      lastSeen: new Date(Date.now() - Math.random() * 86400000).toISOString(),
    };
  });
}
