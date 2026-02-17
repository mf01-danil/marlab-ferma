"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface Device {
  serial: string;
  status: string;
  model?: string;
  product?: string;
}

function getApiUrl(): string {
  if (typeof window !== "undefined") {
    // Same host as frontend, port 3001
    return `${window.location.protocol}//${window.location.hostname}:3001`;
  }
  return "http://localhost:3001";
}

export default function Home() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [apiUrl, setApiUrl] = useState("http://localhost:3001");

  useEffect(() => {
    setApiUrl(getApiUrl());
  }, []);

  const fetchDevices = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/devices`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setDevices(data);
      setError(null);
    } catch {
      setError("Cannot connect to backend server");
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    setLoading(true);
    fetchDevices();
    const interval = setInterval(fetchDevices, 5000);
    return () => clearInterval(interval);
  }, [fetchDevices]);

  return (
    <main style={{ fontFamily: "system-ui", padding: 32, maxWidth: 960 }}>
      <h1 style={{ marginBottom: 8 }}>MarLab Ferma</h1>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
        <p style={{ color: "#666", margin: 0 }}>
          Phone Farm Management — {devices.filter((d) => d.status === "device").length} online / {devices.length} total
        </p>
        <button
          onClick={() => setShowAll(!showAll)}
          style={{
            padding: "4px 12px",
            fontSize: 12,
            border: "1px solid #ddd",
            borderRadius: 6,
            background: showAll ? "#f5f5f5" : "#fff",
            cursor: "pointer",
          }}
        >
          {showAll ? "Show online only" : "Show all"}
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: 16,
            background: "#fee",
            border: "1px solid #fcc",
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          {error}. Make sure backend is running on {apiUrl}
        </div>
      )}

      {loading && <p>Loading devices...</p>}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        {devices
          .filter((d) => showAll || d.status === "device")
          .map((device, i) => (
          <Link
            key={device.serial}
            href={`/device/${encodeURIComponent(device.serial)}`}
            style={{ textDecoration: "none", color: "inherit" }}
          >
            <div
              style={{
                border: "1px solid #ddd",
                borderRadius: 8,
                padding: 16,
                cursor: device.status === "device" ? "pointer" : "not-allowed",
                opacity: device.status === "device" ? 1 : 0.5,
                transition: "box-shadow 0.2s",
              }}
              onMouseEnter={(e) => {
                if (device.status === "device")
                  (e.currentTarget as HTMLDivElement).style.boxShadow =
                    "0 2px 8px rgba(0,0,0,0.1)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  marginBottom: 4,
                }}
              >
                #{i + 1} {device.model || "Unknown"}
              </div>
              <div style={{ fontSize: 12, color: "#888", wordBreak: "break-all" }}>
                {device.serial}
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 11,
                  color: device.status === "device" ? "#2a2" : "#c33",
                  fontWeight: 500,
                }}
              >
                {device.status === "device" ? "Online" : device.status}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
