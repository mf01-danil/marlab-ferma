"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface Device {
  serial: string;
  status: string;
  model?: string;
  product?: string;
}

const DEFAULT_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

function getSavedApiUrl(): string {
  if (typeof window !== "undefined") {
    return localStorage.getItem("marlab_api_url") || DEFAULT_API_URL;
  }
  return DEFAULT_API_URL;
}

export default function Home() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInput, setSettingsInput] = useState("");

  // Load saved URL on mount
  useEffect(() => {
    const saved = getSavedApiUrl();
    setApiUrl(saved);
    setSettingsInput(saved);
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

  const saveSettings = () => {
    const url = settingsInput.replace(/\/+$/, ""); // trim trailing slashes
    localStorage.setItem("marlab_api_url", url);
    setApiUrl(url);
    setShowSettings(false);
  };

  return (
    <main style={{ fontFamily: "system-ui", padding: 32, maxWidth: 960 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <h1 style={{ margin: 0 }}>MarLab Ferma</h1>
        <button
          onClick={() => { setShowSettings(!showSettings); setSettingsInput(apiUrl); }}
          style={{
            padding: "4px 10px",
            fontSize: 12,
            border: "1px solid #ddd",
            borderRadius: 6,
            background: "#fff",
            cursor: "pointer",
            color: "#888",
          }}
        >
          Settings
        </button>
      </div>

      {showSettings && (
        <div
          style={{
            padding: 16,
            background: "#f9f9f9",
            border: "1px solid #ddd",
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Backend URL</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              value={settingsInput}
              onChange={(e) => setSettingsInput(e.target.value)}
              style={{
                flex: 1,
                padding: "6px 10px",
                border: "1px solid #ccc",
                borderRadius: 6,
                fontSize: 13,
              }}
              placeholder="https://your-tunnel.trycloudflare.com"
            />
            <button
              onClick={saveSettings}
              style={{
                padding: "6px 16px",
                fontSize: 13,
                border: "1px solid #2a2",
                borderRadius: 6,
                background: "#2a2",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Save
            </button>
          </div>
          <div style={{ fontSize: 11, color: "#999", marginTop: 6 }}>
            Current: {apiUrl}
          </div>
        </div>
      )}

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
