export type DeviceStatus = "device" | "offline" | "unauthorized" | "no permissions" | "preparing" | "busy" | "error";

export interface Device {
  serial: string;
  status: DeviceStatus;
  model?: string;
  product?: string;
  transport?: string;
  group?: string;
  lastSeen?: string;
  battery?: number;
  androidVersion?: string;
  ipAddress?: string;
}

export type ViewMode = "grid" | "table";

export interface DeviceFilter {
  status: DeviceStatus | "all";
  group: string | "all";
  search: string;
}
