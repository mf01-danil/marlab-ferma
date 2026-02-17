import { join } from "path";
import { shell } from "../adb";
import { jobStore } from "./job-store";
import { loadManifest, getBundleFilePath } from "./manifest";
import { createTransport, DeviceTransport } from "./transport";

const DEVICE_TIMEOUT_MS = 600_000; // 10 min per device

async function prepareDevice(jobId: string, serial: string): Promise<void> {
  const manifest = loadManifest();
  const transport = createTransport(serial);
  const fileNames = manifest.files.map((f) => f.name);

  jobStore.startDevice(jobId, serial, fileNames);
  const log = (msg: string, level: "info" | "success" | "warn" | "error" = "info") =>
    jobStore.deviceLog(jobId, serial, msg, level);

  // --- Connectivity check ---
  log("Checking device connectivity...");
  const online = await transport.checkOnline();
  if (!online) {
    jobStore.deviceFailed(jobId, serial, "Device is offline or unreachable");
    return;
  }
  log("Device is online", "success");

  // --- Create target directory ---
  try {
    await transport.ensureDir(manifest.targetDir);
  } catch (err) {
    jobStore.deviceFailed(jobId, serial, `Failed to create directory: ${(err as Error).message}`);
    return;
  }

  // ═══ Phase 1: Push files ═══
  log(`Copying ${manifest.files.length} files to device...`);
  let pushCount = 0;
  let skipCount = 0;

  for (const file of manifest.files) {
    const localPath = getBundleFilePath(file.localPath);
    const remotePath = join(manifest.targetDir, file.name).replace(/\\/g, "/");

    // Check if file already exists on device — skip if so
    const exists = await transport.checkFileExists(remotePath);
    if (exists) {
      skipCount++;
      jobStore.fileLoaded(jobId, serial, file.name);
      log(`${file.name} — already on device, skipped`);
      continue;
    }

    jobStore.fileUploading(jobId, serial, file.name);

    try {
      await transport.pushFile(localPath, remotePath);
      pushCount++;
      jobStore.fileLoaded(jobId, serial, file.name);
    } catch (err) {
      jobStore.fileFailed(jobId, serial, file.name, (err as Error).message);
      jobStore.deviceFailed(jobId, serial, `Failed to copy ${file.name}: ${(err as Error).message}`);
      return;
    }
  }

  if (skipCount > 0) {
    log(`Files ready: ${pushCount} copied, ${skipCount} already on device`, "success");
  } else {
    log(`All ${manifest.files.length} files copied`, "success");
  }

  // ═══ Phase 2: Install APKs ═══
  const apks = manifest.files.filter((f) => f.action === "install");
  if (apks.length > 0) {
    log(`Installing ${apks.length} APKs...`);
    for (const file of apks) {
      const localPath = getBundleFilePath(file.localPath);

      jobStore.fileInstalling(jobId, serial, file.name);

      try {
        await transport.installApk(localPath);
        jobStore.fileInstalled(jobId, serial, file.name);
        log(`${file.name} — installed`, "success");
      } catch (err) {
        jobStore.fileFailed(jobId, serial, file.name, `Install failed: ${(err as Error).message}`);
        jobStore.deviceFailed(jobId, serial, `Failed to install ${file.name}: ${(err as Error).message}`);
        return;
      }
    }
    log(`All ${apks.length} APKs installed`, "success");
  }

  // ═══ Phase 3: Magisk Setup ═══
  const magiskSetup = manifest.magiskSetup;
  if (magiskSetup?.enabled) {
    log("Starting Magisk setup...");
    const setupOk = await runMagiskSetup(jobId, serial, manifest);
    if (!setupOk) return;
    log("Magisk setup complete!", "success");
  }

  jobStore.devicePrepared(jobId, serial);
}

const KITSUNE_PACKAGE = "com.topjohnwu.magisk";

async function runMagiskSetup(
  jobId: string,
  serial: string,
  manifest: ReturnType<typeof loadManifest>
): Promise<boolean> {
  const transport = createTransport(serial);
  const log = (msg: string, level: "info" | "success" | "warn" | "error" = "info") =>
    jobStore.deviceLog(jobId, serial, msg, level);

  // ── [1/7] Check Magisk binary ──
  log("[1/7] Checking Magisk binary...");
  jobStore.deviceSetup(jobId, serial, "checking-magisk");
  const magisk = await transport.getMagiskVersionNoRoot();
  if (!magisk) {
    jobStore.deviceFailed(jobId, serial, "Kitsune Mask not found — magisk binary is missing on device");
    return false;
  }
  log(`[1/7] Magisk found: ${magisk.versionName} (${magisk.versionCode})`, "success");
  jobStore.deviceSetup(jobId, serial, "checking-magisk", magisk.versionName);

  // ── [2/7] WiFi ──
  if (manifest.magiskSetup?.connectWifi !== false && manifest.wifi) {
    const currentSsid = await transport.getConnectedWifiSsid();
    if (currentSsid === manifest.wifi.ssid) {
      log(`[2/7] WiFi — already connected to "${manifest.wifi.ssid}", skipped`, "success");
    } else {
      log(`[2/7] Connecting to WiFi "${manifest.wifi.ssid}"...`);
      jobStore.deviceSetup(jobId, serial, "connecting-wifi", manifest.wifi.ssid);
      try {
        await transport.connectWifi(
          manifest.wifi.ssid,
          manifest.wifi.password,
          manifest.wifi.security
        );
        log("WiFi connect command sent", "success");
      } catch (err) {
        log(`WiFi connect failed: ${(err as Error).message}`, "error");
        jobStore.deviceFailed(jobId, serial, `WiFi connection failed: ${(err as Error).message}`);
        return false;
      }

      log("Waiting for internet (max 30s)...");
      jobStore.deviceSetup(jobId, serial, "waiting-internet", "Checking connectivity...");
      const hasInternet = await transport.waitForInternet(30000);
      if (!hasInternet) {
        log("No internet after 30s — continuing anyway", "warn");
      } else {
        log("Internet connected", "success");
      }
    }
  } else {
    log("[2/7] WiFi — skipped (disabled or no config)");
  }

  // ── [3/7] Root access ──
  log("[3/7] Checking root access...");
  jobStore.deviceSetup(jobId, serial, "checking-root");
  let hasRoot = await transport.checkRoot();

  if (!hasRoot) {
    // Maybe Magisk was installed on a previous run but superuser wasn't configured
    // Try configuring superuser first before doing a full install
    log("[3/7] Root not available — trying to configure superuser (previous install?)...", "warn");
    await unlockScreen(serial);

    try {
      await transport.enableShellSuperuser(KITSUNE_PACKAGE);
      await new Promise((r) => setTimeout(r, 2000));
      hasRoot = await transport.checkRoot();
    } catch {
      // App not accessible or not installed — need full install
    }

    if (hasRoot) {
      log("[3/7] Root configured from previous install!", "success");
    }
  }

  if (!hasRoot) {
    log("[3/7] Full Magisk install needed — starting Direct Install...", "warn");
    jobStore.deviceSetup(jobId, serial, "awaiting-magisk-update", "Installing Magisk...");

    await unlockScreen(serial);

    // Step 3a: Install Magisk via UI (Direct Install)
    log("Running Direct Install in Kitsune Mask...");
    const installed = await transport.installMagiskViaUI(KITSUNE_PACKAGE);
    if (!installed) {
      log("Magisk UI install failed — could not find required UI elements", "error");
      jobStore.deviceFailed(jobId, serial, "Magisk UI automation failed — try installing manually");
      return false;
    }

    log("Magisk install triggered — waiting for reboot...", "success");

    // Wait for device to actually go offline (reboot may be delayed)
    jobStore.deviceSetup(jobId, serial, "waiting-boot", "Waiting for reboot to start...");
    const wentOffline = await waitForDeviceOffline(transport, 180000);
    if (!wentOffline) {
      log("Device didn't reboot — maybe Magisk was already installed", "warn");
    }

    // Wait for boot
    log("Waiting for device to come back (max 3 min)...");
    jobStore.deviceSetup(jobId, serial, "waiting-boot", "Rebooting after Magisk install...");
    let booted = await transport.waitForBoot(180000);
    if (!booted) {
      jobStore.deviceFailed(jobId, serial, "Device did not come back after reboot (3 min timeout)");
      return false;
    }

    // Stability check — handle double reboot (common with Magisk)
    await new Promise((r) => setTimeout(r, 10000));
    let stillOnline = await transport.checkOnline();
    if (!stillOnline) {
      log("Device went offline again — waiting for second reboot...");
      booted = await transport.waitForBoot(180000);
      if (!booted) {
        jobStore.deviceFailed(jobId, serial, "Device did not come back after second reboot");
        return false;
      }
      await new Promise((r) => setTimeout(r, 10000));
      stillOnline = await transport.checkOnline();
      if (!stillOnline) {
        jobStore.deviceFailed(jobId, serial, "Device keeps going offline after Magisk install");
        return false;
      }
    }

    log("Device back online", "success");
    await new Promise((r) => setTimeout(r, 5000));
    await unlockScreen(serial);

    // Step 3b: Enable Shell superuser + set auto-response to Allow
    log("Configuring superuser access in Kitsune Mask...");
    jobStore.deviceSetup(jobId, serial, "awaiting-magisk-update", "Enabling root for Shell...");
    try {
      await transport.enableShellSuperuser(KITSUNE_PACKAGE);
      log("Superuser configured", "success");
    } catch (err) {
      log(`Superuser config error: ${(err as Error).message}`, "warn");
    }

    // Verify root
    await new Promise((r) => setTimeout(r, 2000));
    hasRoot = await transport.checkRoot();
    if (hasRoot) {
      log("[3/7] Root access confirmed!", "success");
    } else {
      jobStore.deviceFailed(jobId, serial, "Root still not available after Magisk install — try manually");
      return false;
    }
  } else {
    log("[3/7] Root access available", "success");
  }

  // ── [4/7] Magisk version (root) ──
  log("[4/7] Getting Magisk version (root)...");
  const magiskRoot = await transport.getMagiskVersion();
  if (magiskRoot) {
    log(`[4/7] Magisk: ${magiskRoot.versionName} (${magiskRoot.versionCode})`, "success");
  } else {
    log("[4/7] Could not get Magisk version with root", "warn");
  }

  // ── [5/7] Zygisk ──
  if (manifest.magiskSetup?.enableZygisk !== false) {
    const zygiskOn = await transport.isZygiskEnabled();
    if (zygiskOn) {
      log("[5/7] Zygisk — already enabled, skipped", "success");
    } else {
      log("[5/7] Enabling Zygisk...");
      jobStore.deviceSetup(jobId, serial, "enabling-zygisk");

      // Try sqlite first, fall back to UI toggle
      let zygiskOk = false;
      try {
        await transport.enableZygisk();
        zygiskOk = true;
      } catch {
        log("Zygisk sqlite failed — trying UI toggle...", "warn");
      }

      if (!zygiskOk) {
        await unlockScreen(serial);
        zygiskOk = await transport.enableZygiskViaUI(KITSUNE_PACKAGE);
      }

      if (zygiskOk) {
        log("[5/7] Zygisk enabled", "success");
      } else {
        jobStore.deviceFailed(jobId, serial, "Failed to enable Zygisk");
        return false;
      }
    }
  } else {
    log("[5/7] Zygisk — skipped (disabled in config)");
  }

  // ── [6/7] Magisk modules ──
  const modules = manifest.files.filter((f) => f.action === "magisk-module");
  if (modules.length > 0) {
    log(`[6/7] Installing ${modules.length} Magisk modules...`);
    jobStore.deviceSetup(jobId, serial, "installing-modules", `0/${modules.length}`);

    for (let i = 0; i < modules.length; i++) {
      const mod = modules[i];
      const remotePath = join(manifest.targetDir, mod.name).replace(/\\/g, "/");

      log(`Module ${i + 1}/${modules.length}: ${mod.name}`);
      jobStore.fileInstalling(jobId, serial, mod.name);

      try {
        await transport.installMagiskModule(remotePath);
        jobStore.fileInstalled(jobId, serial, mod.name);
        log(`${mod.name} — installed`, "success");
      } catch (err) {
        jobStore.fileFailed(jobId, serial, mod.name, `Install failed: ${(err as Error).message}`);
        jobStore.deviceFailed(jobId, serial, `Failed to install module ${mod.name}: ${(err as Error).message}`);
        return false;
      }

      jobStore.deviceSetup(jobId, serial, "installing-modules", `${i + 1}/${modules.length}`);
    }
    log(`[6/7] All ${modules.length} modules installed`, "success");
  } else {
    log("[6/7] No Magisk modules to install");
  }

  // ── [7/7] Reboot ──
  if (manifest.magiskSetup?.rebootAfter !== false) {
    log("[7/7] Rebooting device...");
    jobStore.deviceSetup(jobId, serial, "rebooting");
    try {
      await transport.reboot();
      log("Reboot command sent", "success");
    } catch (err) {
      jobStore.deviceFailed(jobId, serial, `Reboot failed: ${(err as Error).message}`);
      return false;
    }

    log("Waiting for device to come back (max 3 min)...");
    jobStore.deviceSetup(jobId, serial, "waiting-boot");
    const booted = await transport.waitForBoot(180000);
    if (!booted) {
      jobStore.deviceFailed(jobId, serial, "Device did not come back after reboot (3 min timeout)");
      return false;
    }
    log("[7/7] Device back online", "success");
  } else {
    log("[7/7] Reboot — skipped (disabled in config)");
  }

  return true;
}

async function waitForDeviceOffline(transport: DeviceTransport, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const online = await transport.checkOnline();
    if (!online) return true;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

async function unlockScreen(serial: string): Promise<void> {
  try {
    await shell(serial, "input keyevent KEYCODE_WAKEUP", 3000);
    await new Promise((r) => setTimeout(r, 1000));
    await shell(serial, "input keyevent 82", 3000); // KEYCODE_MENU dismisses lock screen
    await new Promise((r) => setTimeout(r, 2000));
  } catch { /* ignore */ }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${label} exceeded ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

export async function runPrepareJob(jobId: string): Promise<void> {
  const job = jobStore.getJob(jobId);
  if (!job) return;

  jobStore.startJob(jobId);

  // Process devices concurrently (with timeout per device)
  const promises = job.serials.map((serial) =>
    withTimeout(prepareDevice(jobId, serial), DEVICE_TIMEOUT_MS, serial).catch((err) => {
      // Catch timeout or unexpected errors
      const dp = job.devices.get(serial);
      if (dp && dp.status !== "failed" && dp.status !== "prepared") {
        jobStore.deviceFailed(jobId, serial, (err as Error).message);
      }
    })
  );

  await Promise.allSettled(promises);
  jobStore.completeJob(jobId);
}
