import { useQuery } from "@tanstack/react-query";
import { useDeviceStore } from "@/store/device-store";

export function useDevices() {
  const mockDevices = useDeviceStore((s) => s.devices);

  return useQuery({
    queryKey: ["devices"],
    queryFn: async () => mockDevices,
    refetchInterval: 5000,
  });
}
