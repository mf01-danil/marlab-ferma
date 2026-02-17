"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import DeviceScreen from "../../components/DeviceScreen";

export default function DevicePage({
  params,
}: {
  params: Promise<{ serial: string }>;
}) {
  const { serial } = use(params);
  const decodedSerial = decodeURIComponent(serial);

  const [wsUrl, setWsUrl] = useState("");

  useEffect(() => {
    // Same host as frontend, port 3001, ws/wss matches http/https
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    setWsUrl(`${protocol}//${window.location.hostname}:3001`);
  }, []);

  if (!wsUrl) return null;

  return (
    <main style={{ fontFamily: "system-ui", padding: 32, maxWidth: 720 }}>
      <Link
        href="/"
        style={{
          color: "#666",
          textDecoration: "none",
          fontSize: 14,
          marginBottom: 16,
          display: "inline-block",
        }}
      >
        &larr; Back to devices
      </Link>

      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Device: {decodedSerial}</h1>
      <p style={{ color: "#888", fontSize: 13, marginBottom: 16 }}>
        Click on the screen to interact with the device
      </p>

      <DeviceScreen serial={decodedSerial} wsUrl={wsUrl} />
    </main>
  );
}
