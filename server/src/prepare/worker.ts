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

  // Attach logger so all transport methods can report progress
  transport.setLog(log);

  // Start background dialog watcher for the entire preparation process
  const stopWatcher = transport.startDialogWatcher((msg) => log(msg));
  try {
    await _prepareDeviceInner(jobId, serial, manifest, transport, log);
  } finally {
    stopWatcher();
  }
}

async function _prepareDeviceInner(
  jobId: string,
  serial: string,
  manifest: ReturnType<typeof loadManifest>,
  transport: DeviceTransport,
  log: (msg: string, level?: "info" | "success" | "warn" | "error") => void
): Promise<void> {
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
    const setupOk = await runMagiskSetup(jobId, serial, manifest, transport);
    if (!setupOk) return;
    log("Magisk setup complete!", "success");
  }

  jobStore.devicePrepared(jobId, serial);
}

const KITSUNE_PACKAGE_FALLBACK = "com.topjohnwu.magisk";

async function runMagiskSetup(
  jobId: string,
  serial: string,
  manifest: ReturnType<typeof loadManifest>,
  transport: DeviceTransport
): Promise<boolean> {
  const log = (msg: string, level: "info" | "success" | "warn" | "error" = "info") =>
    jobStore.deviceLog(jobId, serial, msg, level);

  // Detect Kitsune Mask package
  log("Detecting Kitsune Mask package...");
  const detectedPackage = await transport.detectKitsunePackage();
  const KITSUNE_PACKAGE = detectedPackage || KITSUNE_PACKAGE_FALLBACK;
  log(`Package: ${KITSUNE_PACKAGE}`, detectedPackage ? "success" : "warn");

  // Log current version info (informational, non-blocking)
  const magisk = await transport.getMagiskVersionNoRoot();
  if (magisk) {
    log(`Current binary: ${magisk.versionName} (${magisk.versionCode})`);
  } else {
    log("Magisk binary not found on device — will be installed by Kitsune", "warn");
  }

  // ── [1/8] WiFi ──
  if (manifest.magiskSetup?.connectWifi !== false && manifest.wifi) {
    const currentSsid = await transport.getConnectedWifiSsid();
    if (currentSsid === manifest.wifi.ssid) {
      log(`[1/8] WiFi — already connected to "${manifest.wifi.ssid}", skipped`, "success");
    } else {
      const alreadyOnline = currentSsid
        ? false
        : await transport.waitForInternet(5000);

      if (alreadyOnline) {
        log(`[1/8] WiFi — internet available, skipped`, "success");
      } else {
        log(`[1/8] Connecting to WiFi "${manifest.wifi.ssid}"...`);
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
    }
  } else {
    log("[1/8] WiFi — skipped (disabled or no config)");
  }

  // ── [2/8] Grant install permission for Kitsune Mask ──
  log("[2/8] Granting install from unknown sources...");
  try {
    await transport.grantInstallPermission(KITSUNE_PACKAGE);
    log("[2/8] Install permission granted", "success");
  } catch (err) {
    log(`[2/8] Install permission failed: ${(err as Error).message}`, "warn");
  }

  // ── [3/8] Update Kitsune Manager App ──
  log("[3/8] Updating Kitsune Mask app...");
  jobStore.deviceSetup(jobId, serial, "updating-kitsune-app", "Updating Kitsune app...");
  await unlockScreen(serial);

  const appUpdated = await transport.updateKitsuneApp(KITSUNE_PACKAGE);
  if (!appUpdated) {
    log("[3/8] Kitsune app update failed", "error");
    jobStore.deviceFailed(jobId, serial, "Failed to update Kitsune Mask app via UI");
    return false;
  }
  log("[3/8] Kitsune app update complete", "success");

  // ── [4/8] Magisk Direct Install → reboot ──
  log("[4/8] Starting Magisk Direct Install...");
  jobStore.deviceSetup(jobId, serial, "awaiting-magisk-update", "Magisk Direct Install...");
  await unlockScreen(serial);

  const directInstallOk = await transport.installMagiskViaUI(KITSUNE_PACKAGE);
  if (!directInstallOk) {
    log("[4/8] Magisk Direct Install failed", "error");
    jobStore.deviceFailed(jobId, serial, "Magisk Direct Install UI automation failed — try manually");
    return false;
  }

  log("[4/8] Direct Install triggered — waiting for reboot...", "success");

  // Wait for offline → boot
  jobStore.deviceSetup(jobId, serial, "waiting-boot", "Rebooting after Direct Install...");
  const wentOffline = await waitForDeviceOffline(transport, 180000);
  if (!wentOffline) {
    log("Device didn't go offline — checking if already rebooted...", "warn");
  }

  let booted = await transport.waitForBoot(180000);
  if (!booted) {
    jobStore.deviceFailed(jobId, serial, "Device did not come back after Direct Install reboot (3 min timeout)");
    return false;
  }

  // Stability check — handle double reboot
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
  }

  log("[4/8] Device back online after Direct Install", "success");
  await new Promise((r) => setTimeout(r, 5000));
  await unlockScreen(serial);

  // ── [5/8] Configure Superuser ──
  log("[5/8] Configuring superuser access...");
  jobStore.deviceSetup(jobId, serial, "checking-root");

  // Try sqlite first
  let suConfigOk = await transport.configureSuperuser();
  if (suConfigOk) {
    log("[5/8] Superuser configured via sqlite (Apps+ADB, auto-Allow)", "success");
  } else {
    log("sqlite failed — trying UI...", "warn");
    await unlockScreen(serial);
    try {
      await transport.enableShellSuperuser(KITSUNE_PACKAGE);
      suConfigOk = true;
      log("[5/8] Superuser configured via UI", "success");
    } catch (err) {
      log(`[5/8] Superuser UI config failed: ${(err as Error).message}`, "warn");
    }
  }

  // Verify root
  await new Promise((r) => setTimeout(r, 2000));
  const hasRoot = await transport.checkRoot();
  if (hasRoot) {
    log("[5/8] Root access confirmed!", "success");
  } else {
    log("[5/8] Root not available after setup!", "error");
    jobStore.deviceFailed(jobId, serial, "Root not available after Kitsune Direct Install");
    return false;
  }

  // ── [6/8] Zygisk — enable + reboot ──
  if (manifest.magiskSetup?.enableZygisk !== false) {
    log("[6/8] Checking Zygisk status...");
    const zygiskOn = await transport.isZygiskEnabled();
    if (zygiskOn) {
      log("[6/8] Zygisk — already enabled", "success");
    } else {
      log("[6/8] Zygisk is OFF — enabling...");
      jobStore.deviceSetup(jobId, serial, "enabling-zygisk");

      let zygiskOk = false;
      try {
        await transport.enableZygisk();
        zygiskOk = true;
        log("[6/8] Zygisk enabled via sqlite", "success");
      } catch {
        log("[6/8] Zygisk sqlite failed — trying UI toggle...", "warn");
      }

      if (!zygiskOk) {
        await unlockScreen(serial);
        zygiskOk = await transport.enableZygiskViaUI(KITSUNE_PACKAGE);
        if (zygiskOk) {
          log("[6/8] Zygisk enabled via UI", "success");
        }
      }

      if (!zygiskOk) {
        log("[6/8] Failed to enable Zygisk!", "error");
        jobStore.deviceFailed(jobId, serial, "Failed to enable Zygisk");
        return false;
      }

      log("[6/8] Sending reboot command...");
      jobStore.deviceSetup(jobId, serial, "rebooting", "Reboot after Zygisk");

      try {
        await transport.reboot();
        log("[6/8] Reboot command sent", "success");
      } catch (err) {
        jobStore.deviceFailed(jobId, serial, `Reboot failed: ${(err as Error).message}`);
        return false;
      }

      log("[6/8] Waiting for device to go offline...");
      const zygOffline = await waitForDeviceOffline(transport, 60000);
      if (zygOffline) {
        log("[6/8] Device is offline — rebooting", "success");
      } else {
        log("[6/8] Device didn't go offline after 60s", "warn");
      }

      log("[6/8] Waiting for device to boot (max 3 min)...");
      jobStore.deviceSetup(jobId, serial, "waiting-boot", "Rebooting after Zygisk...");
      const zygBooted = await transport.waitForBoot(180000);
      if (!zygBooted) {
        jobStore.deviceFailed(jobId, serial, "Device did not come back after Zygisk reboot");
        return false;
      }
      log("[6/8] Device is back online — waiting 10s for stability...");

      await new Promise((r) => setTimeout(r, 10000));
      const rootAfterZygisk = await transport.checkRoot();
      if (rootAfterZygisk) {
        log("[6/8] Zygisk reboot complete, root OK", "success");
      } else {
        log("[6/8] Root lost after Zygisk reboot!", "error");
        jobStore.deviceFailed(jobId, serial, "Root lost after Zygisk reboot");
        return false;
      }
    }
  } else {
    log("[6/8] Zygisk — skipped (disabled in config)");
  }

  // ── [7/8] Install Magisk modules via Kitsune UI ──
  const modules = manifest.files.filter((f) => f.action === "magisk-module");
  if (modules.length > 0) {
    // Separate LSPosed (needs reboot) from other modules
    const lsposedMod = modules.find((m) => m.name.toLowerCase().includes("lsposed"));
    const otherModules = modules.filter((m) => m !== lsposedMod);

    const totalModules = modules.length;
    let installedCount = 0;

    log(`[7/8] Installing ${totalModules} Magisk modules via Kitsune UI...`);
    jobStore.deviceSetup(jobId, serial, "installing-modules", `0/${totalModules}`);

    // --- Install LSPosed first (requires reboot) ---
    if (lsposedMod) {
      const remotePath = join(manifest.targetDir, lsposedMod.name).replace(/\\/g, "/");
      log(`Module: ${lsposedMod.name} (install -> reboot -> verify)`);
      jobStore.fileInstalling(jobId, serial, lsposedMod.name);

      await unlockScreen(serial);
      const lsposedOk = await transport.installModuleViaUI(KITSUNE_PACKAGE, remotePath, log);
      if (!lsposedOk) {
        jobStore.fileFailed(jobId, serial, lsposedMod.name, "UI install failed");
        jobStore.deviceFailed(jobId, serial, `Failed to install ${lsposedMod.name} via UI`);
        return false;
      }
      jobStore.fileInstalled(jobId, serial, lsposedMod.name);
      installedCount++;
      log(`${lsposedMod.name} — installed`, "success");
      jobStore.deviceSetup(jobId, serial, "installing-modules", `${installedCount}/${totalModules}`);

      // Reboot after LSPosed
      log("Rebooting after LSPosed install...");
      jobStore.deviceSetup(jobId, serial, "rebooting", "Reboot after LSPosed");
      try {
        await transport.reboot();
      } catch (err) {
        jobStore.deviceFailed(jobId, serial, `Reboot failed: ${(err as Error).message}`);
        return false;
      }

      const lsOffline = await waitForDeviceOffline(transport, 60000);
      if (!lsOffline) {
        log("Device didn't go offline", "warn");
      }

      log("Waiting for device to come back (max 3 min)...");
      jobStore.deviceSetup(jobId, serial, "waiting-boot", "Rebooting after LSPosed...");
      const lsBooted = await transport.waitForBoot(180000);
      if (!lsBooted) {
        jobStore.deviceFailed(jobId, serial, "Device did not come back after LSPosed reboot");
        return false;
      }
      await new Promise((r) => setTimeout(r, 10000));
      log("Device back online after LSPosed reboot", "success");

      const rootOk = await transport.checkRoot();
      if (!rootOk) {
        log("Root lost after LSPosed reboot!", "error");
        jobStore.deviceFailed(jobId, serial, "Root lost after LSPosed reboot");
        return false;
      }

      // Verify LSPosed activation
      await unlockScreen(serial);
      log("Verifying LSPosed activation...");
      try {
        const lsposedCheck = await shell(serial,
          "pm list packages 2>/dev/null | grep -i lsposed || dumpsys notification | grep -i lsposed || echo NOT_FOUND",
          10000
        );
        if (lsposedCheck.trim() !== "NOT_FOUND" && lsposedCheck.trim().length > 0) {
          log("LSPosed is active!", "success");
        } else {
          log("LSPosed not detected yet — may still be OK", "warn");
        }
      } catch {
        log("LSPosed verification failed — continuing", "warn");
      }
    }

    // --- Install remaining modules (KnoxPatch, etc.) ---
    for (const mod of otherModules) {
      const remotePath = join(manifest.targetDir, mod.name).replace(/\\/g, "/");
      log(`Module: ${mod.name}`);
      jobStore.fileInstalling(jobId, serial, mod.name);

      await unlockScreen(serial);
      const modOk = await transport.installModuleViaUI(KITSUNE_PACKAGE, remotePath, log);
      if (!modOk) {
        jobStore.fileFailed(jobId, serial, mod.name, "UI install failed");
        jobStore.deviceFailed(jobId, serial, `Failed to install ${mod.name} via UI`);
        return false;
      }
      jobStore.fileInstalled(jobId, serial, mod.name);
      installedCount++;
      log(`${mod.name} — installed`, "success");
      jobStore.deviceSetup(jobId, serial, "installing-modules", `${installedCount}/${totalModules}`);
    }

    log(`[7/8] All ${totalModules} modules installed`, "success");
  } else {
    log("[7/8] No Magisk modules to install");
  }

  // ── [8/8] Final reboot + verify root ──
  if (manifest.magiskSetup?.rebootAfter !== false) {
    log("[8/8] Final reboot...");
    jobStore.deviceSetup(jobId, serial, "rebooting", "Final reboot");
    try {
      await transport.reboot();
      log("Reboot command sent", "success");
    } catch (err) {
      jobStore.deviceFailed(jobId, serial, `Reboot failed: ${(err as Error).message}`);
      return false;
    }

    const finalOffline = await waitForDeviceOffline(transport, 60000);
    if (!finalOffline) {
      log("Device didn't go offline", "warn");
    }

    log("Waiting for device to come back (max 3 min)...");
    jobStore.deviceSetup(jobId, serial, "waiting-boot");
    const finalBooted = await transport.waitForBoot(180000);
    if (!finalBooted) {
      jobStore.deviceFailed(jobId, serial, "Device did not come back after final reboot");
      return false;
    }
    log("Device back online", "success");

    await new Promise((r) => setTimeout(r, 10000));
    const rootAfterReboot = await transport.checkRoot();
    if (rootAfterReboot) {
      log("[8/8] Root verified after final reboot", "success");
    } else {
      log("[8/8] Root NOT available after final reboot!", "error");
      jobStore.deviceFailed(jobId, serial, "Root lost after final reboot");
      return false;
    }
  } else {
    log("[8/8] Final reboot — skipped (disabled in config)");
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
