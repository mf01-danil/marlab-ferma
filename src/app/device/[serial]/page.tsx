"use client";

import { use } from "react";
import Link from "next/link";
import DeviceScreen from "../../components/DeviceScreen";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001";

export default function DevicePage({
  params,
}: {
  params: Promise<{ serial: string }>;
}) {
  const { serial } = use(params);
  const decodedSerial = decodeURIComponent(serial);

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

      <DeviceScreen serial={decodedSerial} wsUrl={WS_URL} />
    </main>
  );
}
