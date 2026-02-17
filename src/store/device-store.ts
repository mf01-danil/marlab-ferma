import { create } from "zustand";
import { Device, ViewMode, DeviceFilter } from "@/types/device";

interface DeviceStore {
  devices: Device[];
  selectedIds: Set<string>;
  viewMode: ViewMode;
  filter: DeviceFilter;
  setDevices: (devices: Device[]) => void;
  toggleSelect: (serial: string) => void;
  selectAll: (serials: string[]) => void;
  clearSelection: () => void;
  setViewMode: (mode: ViewMode) => void;
  setFilter: (filter: Partial<DeviceFilter>) => void;
}

export const useDeviceStore = create<DeviceStore>((set) => ({
  devices: [],
  selectedIds: new Set<string>(),
  viewMode: "grid",
  filter: { status: "all", group: "all", search: "" },
  setDevices: (devices) => set({ devices }),
  toggleSelect: (serial) =>
    set((s) => {
      const next = new Set(s.selectedIds);
      if (next.has(serial)) next.delete(serial);
      else next.add(serial);
      return { selectedIds: next };
    }),
  selectAll: (serials) => set({ selectedIds: new Set(serials) }),
  clearSelection: () => set({ selectedIds: new Set<string>() }),
  setViewMode: (viewMode) => set({ viewMode }),
  setFilter: (partial) =>
    set((s) => ({ filter: { ...s.filter, ...partial } })),
}));
