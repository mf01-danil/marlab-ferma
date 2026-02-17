"use client";

import { useState, useEffect } from "react";

export function useWsUrl(): string {
  const [wsUrl, setWsUrl] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("marlab_api_url");
    let base: string;
    if (saved) {
      base = saved;
    } else {
      base = `${window.location.protocol}//${window.location.hostname}:3001`;
    }
    setWsUrl(base.replace(/^http/, "ws"));
  }, []);

  return wsUrl;
}
