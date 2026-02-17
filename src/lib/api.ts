import { Device } from "@/types/device";

export function getApiUrl(): string {
  if (typeof window !== "undefined") {
    const saved = localStorage.getItem("marlab_api_url");
    if (saved) return saved;
    return `${window.location.protocol}//${window.location.hostname}:3001`;
  }
  return "http://localhost:3001";
}

export function getWsUrl(): string {
  return getApiUrl().replace(/^http/, "ws");
}

export async function fetchDevices(): Promise<Device[]> {
  const res = await fetch(`${getApiUrl()}/api/devices`);
  if (!res.ok) throw new Error("Failed to fetch devices");
  return res.json();
}
