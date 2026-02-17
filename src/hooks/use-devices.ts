import { useQuery } from "@tanstack/react-query";
import { fetchDevices } from "@/lib/api";
import { useDeviceStore } from "@/store/device-store";
import { useEffect } from "react";

export function useDevices() {
  const setDevices = useDeviceStore((s) => s.setDevices);

  const query = useQuery({
    queryKey: ["devices"],
    queryFn: fetchDevices,
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (query.data) {
      setDevices(query.data);
    }
  }, [query.data, setDevices]);

  return query;
}
