import { Device } from "@/types/device";

function isLocal() {
  return typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
}

export function getApiBase(): string {
  return isLocal() ? 'http://localhost:3001' : '';
}

export function getWsBase(): string {
  if (typeof window === 'undefined') return 'ws://localhost:3001';
  if (isLocal()) return 'ws://localhost:3001';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}`;
}

export async function fetchDevices(): Promise<Device[]> {
  const res = await fetch(`${getApiBase()}/api/devices`);
  if (!res.ok) throw new Error("Failed to fetch devices");
  return res.json();
}
