import { push, shell, install, shellSu, rebootDevice, waitForBoot, shellSpawn } from "../adb";

// ── uiautomator XML helpers ──

interface UIPos { x: number; y: number }

function extractNodeTags(xml: string): string[] {
  const nodes: string[] = [];
  const re = /<node\s[^>]+>/g;
  let m;
  while ((m = re.exec(xml)) !== null) nodes.push(m[0]);
  return nodes;
}

function getAttr(node: string, attr: string): string | null {
  const re = new RegExp(`\\b${attr}="([^"]*)"`, "i");
  const m = node.match(re);
  return m ? m[1] : null;
}

function getBounds(node: string): UIPos | null {
  const b = getAttr(node, "bounds");
  if (!b) return null;
  const m = b.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!m) return null;
  return { x: Math.round((+m[1] + +m[3]) / 2), y: Math.round((+m[2] + +m[4]) / 2) };
}

function findNodeByText(xml: string, text: string): UIPos | null {
  for (const node of extractNodeTags(xml)) {
    if (getAttr(node, "text") === text) return getBounds(node);
  }
  return null;
}

function findNodeByAttr(xml: string, attr: string, value: string): UIPos | null {
  for (const node of extractNodeTags(xml)) {
    if (getAttr(node, attr) === value) return getBounds(node);
  }
  return null;
}

function findConnectButton(xml: string): UIPos | null {
  // Try common "Connect" button labels (multiple languages)
  for (const label of ["Connect", "Подключиться", "Подключить", "연결", "Conectar", "Verbinden"]) {
    const pos = findNodeByText(xml, label);
    if (pos) return pos;
  }
  // Try Android positive button resource-id
  const pos = findNodeByAttr(xml, "resource-id", "android:id/button1");
  if (pos) return pos;
  return null;
}

// Resource IDs in Kitsune Mask use the actual package name (io.github.huskydg.magisk),
// NOT com.topjohnwu.magisk. All methods use `packageName` parameter for resource-id lookups.

export interface MagiskInfo {
  versionCode: number;
  versionName: string;
}

export interface DeviceTransport {
  ensureDir(remotePath: string): Promise<void>;
  pushFile(localPath: string, remotePath: string): Promise<void>;
  installApk(localPath: string): Promise<void>;
  checkOnline(): Promise<boolean>;
  checkRoot(): Promise<boolean>;
  checkFileExists(remotePath: string): Promise<boolean>;
  getConnectedWifiSsid(): Promise<string | null>;
  getAppVersionCode(packageName: string): Promise<number | null>;
  isZygiskEnabled(): Promise<boolean>;
  getMagiskVersion(): Promise<MagiskInfo | null>;
  getMagiskVersionNoRoot(): Promise<MagiskInfo | null>;
  launchApp(packageName: string): Promise<void>;
  connectWifi(ssid: string, password: string, security?: string): Promise<void>;
  waitForInternet(timeoutMs?: number): Promise<boolean>;
  grantInstallPermission(packageName: string): Promise<void>;
  configureSuperuser(): Promise<boolean>;
  configureSuperuserViaUI(packageName: string): Promise<boolean>;
  enableZygisk(): Promise<void>;
  enableZygiskViaUI(packageName: string): Promise<boolean>;
  installMagiskModule(remotePath: string): Promise<string>;
  installModuleViaUI(packageName: string, remotePath: string, log?: (msg: string, level?: "info" | "success" | "warn" | "error") => void): Promise<boolean>;
  tapButtonByText(label: string, delayBeforeMs?: number): Promise<boolean>;
  installMagiskViaUI(packageName: string): Promise<boolean>;
  enableShellSuperuser(packageName: string): Promise<boolean>;
  reboot(): Promise<void>;
  waitForBoot(timeoutMs?: number): Promise<boolean>;
  dismissDialogs(maxRounds?: number): Promise<number>;
  detectKitsunePackage(): Promise<string | null>;
  startDialogWatcher(log?: (msg: string) => void): () => void;
  pauseWatcher(): void;
  resumeWatcher(): void;
  navigateToKitsuneHome(packageName: string): Promise<boolean>;
  ensureAppForeground(packageName: string, maxAttempts?: number): Promise<boolean>;
  updateKitsuneApp(packageName: string): Promise<boolean>;
  setLog(log: (msg: string, level?: "info" | "success" | "warn" | "error") => void): void;
}

export class AdbTransport implements DeviceTransport {
  constructor(private serial: string) {}

  private _watcherPauseCount = 0;
  private _log?: (msg: string, level?: "info" | "success" | "warn" | "error") => void;

  /** Set a log callback so all internal methods can report progress. */
  setLog(log: (msg: string, level?: "info" | "success" | "warn" | "error") => void): void {
    this._log = log;
  }

  private log(msg: string, level?: "info" | "success" | "warn" | "error"): void {
    this._log?.(msg, level);
  }

  pauseWatcher(): void {
    this._watcherPauseCount++;
  }

  resumeWatcher(): void {
    this._watcherPauseCount = Math.max(0, this._watcherPauseCount - 1);
  }

  async ensureDir(remotePath: string): Promise<void> {
    await shell(this.serial, `mkdir -p "${remotePath}"`);
  }

  async pushFile(localPath: string, remotePath: string): Promise<void> {
    await push(this.serial, localPath, remotePath);
  }

  async installApk(localPath: string): Promise<void> {
    await install(this.serial, localPath);
  }

  async checkOnline(): Promise<boolean> {
    try {
      const result = await shell(this.serial, "echo ok");
      return result.trim() === "ok";
    } catch {
      return false;
    }
  }

  /**
   * Navigate to the Home tab in Kitsune Mask's bottom navigation.
   * After app restart/reopen, it may land on Logs or another tab.
   * ViewPager keeps all fragments in memory, so home elements appear in
   * uiautomator dump even when not visible — must explicitly switch to Home.
   */
  async navigateToKitsuneHome(packageName: string): Promise<boolean> {
    const DUMP = "/sdcard/ui_dump.xml";
    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    try {
      const xml = await this.dumpUI(DUMP);

      // Look for bottom navigation Home tab (homeFragment)
      const homeTab = findNodeByAttr(xml, "resource-id", `${packageName}:id/homeFragment`);
      if (homeTab) {
        // Check if already selected
        for (const node of extractNodeTags(xml)) {
          if (getAttr(node, "resource-id") === `${packageName}:id/homeFragment`) {
            if (getAttr(node, "selected") === "true") {
              this.log("Already on Home tab");
              return true;
            }
            break;
          }
        }
        this.log("Navigating to Home tab...");
        await shell(this.serial, `input tap ${homeTab.x} ${homeTab.y}`, 5000);
        await delay(1500);
        return true;
      }

      // Fallback: look for bottom nav items and tap the first (leftmost) one
      const navItems: Array<{ x: number; y: number; rid: string }> = [];
      for (const node of extractNodeTags(xml)) {
        const rid = getAttr(node, "resource-id") || "";
        if (rid.endsWith("Fragment") && rid.includes(packageName)) {
          const pos = getBounds(node);
          if (pos) navItems.push({ x: pos.x, y: pos.y, rid });
        }
      }
      if (navItems.length > 0) {
        // Sort by X coordinate — Home is the leftmost tab
        navItems.sort((a, b) => a.x - b.x);
        this.log(`Tapping leftmost nav tab (${navItems[0].rid.split("/")[1]}) at ${navItems[0].x},${navItems[0].y}...`);
        await shell(this.serial, `input tap ${navItems[0].x} ${navItems[0].y}`, 5000);
        await delay(1500);
        return true;
      }

      this.log("Bottom navigation not found — may already be on Home", "warn");
      return true;
    } catch {
      this.log("Failed to navigate to Home tab", "warn");
      return false;
    }
  }

  async ensureAppForeground(packageName: string, maxAttempts = 5): Promise<boolean> {
    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    const isProcessRunning = async (): Promise<boolean> => {
      try {
        const pid = await shell(this.serial, `pidof ${packageName}`, 5000);
        return pid.trim().length > 0;
      } catch { return false; }
    };

    for (let i = 0; i < maxAttempts; i++) {
      // Check if process is running
      const running = await isProcessRunning();
      if (running && i > 0) {
        // Process is running and we already tried to launch — assume it's in foreground
        this.log("App process is running — assuming foreground");
        return true;
      }

      if (i < 2) {
        this.log(`Launching app (attempt ${i + 1}/${maxAttempts})...`);
        try {
          const out = await shell(this.serial,
            `am start -n ${packageName}/com.topjohnwu.magisk.ui.MainActivity`, 10000);
          this.log(`  ${out.trim().slice(0, 120)}`);
        } catch {
          try {
            await shell(this.serial, `monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`, 10000);
            this.log("  launched via monkey");
          } catch { this.log("  launch failed", "warn"); }
        }
      } else {
        this.log(`Force relaunch (attempt ${i + 1}/${maxAttempts})...`);
        try { await shell(this.serial, `am force-stop ${packageName}`, 5000); } catch { /* ignore */ }
        await delay(2000);
        try {
          const out = await shell(this.serial,
            `am start -n ${packageName}/com.topjohnwu.magisk.ui.MainActivity`, 10000);
          this.log(`  ${out.trim().slice(0, 120)}`);
        } catch {
          try {
            await shell(this.serial, `monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`, 10000);
            this.log("  launched via monkey");
          } catch { this.log("  launch failed", "warn"); }
        }
      }

      this.log("Waiting 5s for app to start...");
      await delay(5000);

      // Verify process started
      if (await isProcessRunning()) {
        this.log("App is running", "success");
        return true;
      }
    }

    this.log("Failed to start app after all attempts", "error");
    return false;
  }

  async checkRoot(): Promise<boolean> {
    this.pauseWatcher();
    try {
      // Run su in background while watching for superuser permission dialog
      const DUMP = "/sdcard/ui_dump.xml";
      const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

      return await new Promise<boolean>(async (resolve) => {
        let settled = false;
        const done = (result: boolean) => {
          if (!settled) { settled = true; resolve(result); }
        };

        // Start su command in background (non-blocking)
        const proc = shellSpawn(this.serial, "su -c id");
        let stdout = "";
        proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
        proc.on("close", () => {
          done(stdout.includes("uid=0"));
        });

        // Timeout
        const timer = setTimeout(() => {
          try { proc.kill(); } catch { /* ignore */ }
          done(false);
        }, 15000);

        // Meanwhile, watch for superuser dialog and tap РАЗРЕШИТЬ
        for (let i = 0; i < 5 && !settled; i++) {
          await delay(1500);
          if (settled) break;
          try {
            const xml = await this.dumpUI(DUMP);
            const grantBtn = findNodeByText(xml, "РАЗРЕШИТЬ")
              || findNodeByText(xml, "Разрешить")
              || findNodeByText(xml, "ALLOW")
              || findNodeByText(xml, "Allow")
              || findNodeByText(xml, "Grant");
            if (grantBtn) {
              await shell(this.serial, `input tap ${grantBtn.x} ${grantBtn.y}`, 5000);
              await delay(2000);
            }
          } catch { /* UI dump may fail if no dialog visible */ }
        }

        await delay(3000);
        clearTimeout(timer);
        if (!settled) done(false);
      });
    } finally {
      this.resumeWatcher();
    }
  }

  async checkFileExists(remotePath: string): Promise<boolean> {
    try {
      const result = await shell(this.serial, `ls "${remotePath}" 2>/dev/null`, 5000);
      return result.trim().length > 0;
    } catch {
      return false;
    }
  }

  async getConnectedWifiSsid(): Promise<string | null> {
    // First check if WiFi is even enabled
    try {
      const wifiOn = await shell(this.serial, "settings get global wifi_on", 5000);
      if (wifiOn.trim() !== "1") return null;
    } catch { /* continue — maybe command not available */ }

    // Check connection state + extract SSID from dumpsys wifi
    try {
      const dump = await shell(this.serial, "dumpsys wifi", 10000);
      // Check mNetworkInfo for CONNECTED state
      const netLine = dump.split("\n").find(l => l.includes("mNetworkInfo"));
      if (netLine && !netLine.toLowerCase().includes("connected")) return null;
      // Extract SSID from mWifiInfo
      const wifiLine = dump.split("\n").find(l => l.includes("mWifiInfo"));
      if (wifiLine) {
        const match = wifiLine.match(/SSID:\s*"?([^",\s]+)"?/);
        if (match && match[1] && match[1] !== "<unknown" && match[1] !== "0x") {
          return match[1];
        }
      }
    } catch { /* continue to fallback */ }

    // Fallback: cmd wifi status (Android 12+)
    try {
      const result = await shell(this.serial, "cmd wifi status 2>/dev/null", 10000);
      const match = result.match(/Wifi is connected to\s+"?([^"\n]+)"?/i);
      if (match && match[1] && match[1] !== "<unknown ssid>") {
        return match[1].trim();
      }
    } catch { /* ignore */ }

    return null;
  }

  async getAppVersionCode(packageName: string): Promise<number | null> {
    try {
      const result = await shell(this.serial, `dumpsys package ${packageName}`, 10000);
      const match = result.match(/versionCode=(\d+)/);
      return match ? parseInt(match[1], 10) : null;
    } catch {
      return null;
    }
  }

  async grantInstallPermission(packageName: string): Promise<void> {
    // Try appops first (works on most Android 8+)
    try {
      await shell(this.serial, `appops set ${packageName} REQUEST_INSTALL_PACKAGES allow`, 10000);
      return;
    } catch { /* Samsung may block — fall back to UI */ }

    // UI fallback: open unknown sources settings and toggle
    this.pauseWatcher();
    try {
    const DUMP = "/sdcard/ui_dump.xml";
    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    await shell(this.serial, `am start -a android.settings.MANAGE_UNKNOWN_APP_SOURCES -d "package:${packageName}"`, 10000);
    await delay(3000);

    const xml = await this.dumpUI(DUMP);
    for (const node of extractNodeTags(xml)) {
      const cls = getAttr(node, "class") || "";
      if (cls.includes("Switch") && getAttr(node, "checked") === "false") {
        const pos = getBounds(node);
        if (pos) {
          await shell(this.serial, `input tap ${pos.x} ${pos.y}`, 5000);
          break;
        }
      }
    }

    await delay(1000);
    await shell(this.serial, "input keyevent 4", 3000);
    try { await shell(this.serial, `rm ${DUMP}`, 5000); } catch { /* ignore */ }
    } finally {
      this.resumeWatcher();
    }
  }

  async configureSuperuser(): Promise<boolean> {
    // Set via Magisk sqlite: access mode = Apps and ADB (2), auto-response = Allow (1)
    try {
      await shellSu(this.serial, `magisk --sqlite "REPLACE INTO settings (key,value) VALUES('su_access',2)"`, 10000);
      await shellSu(this.serial, `magisk --sqlite "REPLACE INTO settings (key,value) VALUES('su_auto_response',1)"`, 10000);
      return true;
    } catch {
      return false;
    }
  }

  async configureSuperuserViaUI(packageName: string): Promise<boolean> {
    this.pauseWatcher();
    try {
    const DUMP = "/sdcard/ui_dump.xml";
    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    // Launch app → Settings
    await shell(this.serial, `monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`, 10000);
    await delay(3000);

    let xml: string;
    try { xml = await this.dumpUI(DUMP); } catch { return false; }
    const okBtn = findNodeByText(xml, "ОК");
    if (okBtn) {
      await shell(this.serial, `input tap ${okBtn.x} ${okBtn.y}`, 5000);
      await delay(2000);
    }

    try { xml = await this.dumpUI(DUMP); } catch { return false; }
    const settingsBtn = findNodeByAttr(xml, "resource-id", `${packageName}:id/action_settings`);
    if (!settingsBtn) return false;
    await shell(this.serial, `input tap ${settingsBtn.x} ${settingsBtn.y}`, 5000);
    await delay(2000);

    // Scroll to find Superuser section settings
    for (let i = 0; i < 5; i++) {
      xml = await this.dumpUI(DUMP);

      // Set "Уровень доступа" → "Приложения и ADB"
      const accessLvl = findNodeByText(xml, "Уровень доступа");
      if (accessLvl) {
        await shell(this.serial, `input tap ${accessLvl.x} ${accessLvl.y}`, 5000);
        await delay(2000);
        xml = await this.dumpUI(DUMP);
        const appsAdb = findNodeByText(xml, "Приложения и ADB");
        if (appsAdb) {
          await shell(this.serial, `input tap ${appsAdb.x} ${appsAdb.y}`, 5000);
          await delay(1000);
        }

        // Set "Автоматический ответ" → "Разрешить"
        xml = await this.dumpUI(DUMP);
        const autoResp = findNodeByText(xml, "Автоматический ответ");
        if (autoResp && !findNodeByText(xml, "Разрешить")) {
          await shell(this.serial, `input tap ${autoResp.x} ${autoResp.y}`, 5000);
          await delay(2000);
          xml = await this.dumpUI(DUMP);
          const allow = findNodeByText(xml, "Разрешить");
          if (allow) {
            await shell(this.serial, `input tap ${allow.x} ${allow.y}`, 5000);
            await delay(1000);
          }
        }

        await shell(this.serial, "input keyevent 4", 3000);
        await delay(500);
        await shell(this.serial, "input keyevent 4", 3000);
        try { await shell(this.serial, `rm ${DUMP}`, 5000); } catch { /* ignore */ }
        return true;
      }

      await shell(this.serial, "input swipe 540 1500 540 500 500", 5000);
      await delay(1000);
    }

    await shell(this.serial, "input keyevent 4", 3000);
    await delay(500);
    await shell(this.serial, "input keyevent 4", 3000);
    try { await shell(this.serial, `rm ${DUMP}`, 5000); } catch { /* ignore */ }
    return false;
    } finally {
      this.resumeWatcher();
    }
  }

  async isZygiskEnabled(): Promise<boolean> {
    try {
      const result = await shellSu(
        this.serial,
        `magisk --sqlite "SELECT value FROM settings WHERE key='zygisk'"`,
        10000
      );
      return result.includes("1");
    } catch {
      return false;
    }
  }

  async getMagiskVersion(): Promise<MagiskInfo | null> {
    try {
      const vCode = await shellSu(this.serial, "magisk -V", 10000);
      const vName = await shellSu(this.serial, "magisk -v", 10000);
      const code = parseInt(vCode.trim(), 10);
      if (isNaN(code)) return null;
      return { versionCode: code, versionName: vName.trim() };
    } catch {
      return null;
    }
  }

  async getMagiskVersionNoRoot(): Promise<MagiskInfo | null> {
    try {
      const vCode = await shell(this.serial, "magisk -V", 10000);
      const vName = await shell(this.serial, "magisk -v", 10000);
      const code = parseInt(vCode.trim(), 10);
      if (isNaN(code)) return null;
      return { versionCode: code, versionName: vName.trim() };
    } catch {
      return null;
    }
  }

  async launchApp(packageName: string): Promise<void> {
    await shell(this.serial, `monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`, 10000);
  }

  async connectWifi(ssid: string, password: string, security = "wpa2"): Promise<void> {
    // Enable WiFi first
    await shell(this.serial, "svc wifi enable", 10000);
    await new Promise((r) => setTimeout(r, 2000));

    // Try cmd wifi connect-network (works on AOSP Android 11+, may fail on Samsung)
    try {
      await shell(this.serial, `cmd wifi connect-network "${ssid}" ${security} "${password}"`, 15000);
      await new Promise((r) => setTimeout(r, 3000));
      return;
    } catch {
      // Samsung blocks cmd wifi connect-network for shell uid
    }

    // Samsung fallback: UI automation via uiautomator
    await this.connectWifiViaUI(ssid, password);
  }

  private async connectWifiViaUI(ssid: string, password: string): Promise<void> {
    this.pauseWatcher();
    try {
    const DUMP = "/sdcard/ui_dump.xml";
    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    // Open WiFi settings
    await shell(this.serial, "am start -a android.settings.WIFI_SETTINGS", 10000);
    await delay(4000);

    // Poll for SSID to appear (WiFi scan may take time)
    let xml: string;
    let ssidPos: ReturnType<typeof findNodeByText> = null;
    const scanStart = Date.now();
    while (Date.now() - scanStart < 180000) {
      xml = await this.dumpUI(DUMP);
      ssidPos = findNodeByText(xml, ssid);
      if (ssidPos) break;

      // Scroll down to find the network
      await shell(this.serial, "input swipe 360 1000 360 400 500", 5000);
      await delay(2000);
      xml = await this.dumpUI(DUMP);
      ssidPos = findNodeByText(xml, ssid);
      if (ssidPos) break;

      // Scroll back up and wait for scan refresh
      await shell(this.serial, "input swipe 360 400 360 1000 500", 5000);
      await delay(5000);
    }

    if (!ssidPos) {
      throw new Error(`WiFi network "${ssid}" not found after 3 min`);
    }

    // Tap on the network
    await shell(this.serial, `input tap ${ssidPos.x} ${ssidPos.y}`, 5000);
    await delay(2000);

    // Dump UI again — check if password dialog appeared
    xml = await this.dumpUI(DUMP);

    // Look for password EditText (has password="true" attribute)
    let pwField = findNodeByAttr(xml, "password", "true");
    if (!pwField) {
      // Try finding any EditText in the dialog
      pwField = findNodeByAttr(xml, "class", "android.widget.EditText");
    }

    if (pwField) {
      // Tap password field to focus
      await shell(this.serial, `input tap ${pwField.x} ${pwField.y}`, 5000);
      await delay(500);

      // Type password
      await shell(this.serial, `input text "${password}"`, 5000);
      await delay(500);

      // Hide keyboard so Connect button is visible
      await shell(this.serial, "input keyevent 4", 3000); // KEYCODE_BACK
      await delay(1000);

      // Dump UI and find Connect button
      xml = await this.dumpUI(DUMP);
      const connectBtn = findConnectButton(xml);
      if (connectBtn) {
        await shell(this.serial, `input tap ${connectBtn.x} ${connectBtn.y}`, 5000);
      } else {
        // Last resort: press Enter to submit
        await shell(this.serial, "input keyevent 66", 3000);
      }
    }
    // else: network is open or password was saved — tap connected it directly

    await delay(3000);

    // Clean up dump file
    try { await shell(this.serial, `rm ${DUMP}`, 5000); } catch { /* ignore */ }
    } finally {
      this.resumeWatcher();
    }
  }

  private async dumpUI(path: string): Promise<string> {
    await shell(this.serial, `uiautomator dump ${path}`, 15000);
    return shell(this.serial, `cat ${path}`, 15000);
  }

  async tapButtonByText(label: string, delayBeforeMs = 3000): Promise<boolean> {
    this.pauseWatcher();
    try {
      const DUMP = "/sdcard/ui_dump.xml";
      await new Promise<void>((r) => setTimeout(r, delayBeforeMs));
      const xml = await this.dumpUI(DUMP);
      const pos = findNodeByText(xml, label);
      if (!pos) return false;
      await shell(this.serial, `input tap ${pos.x} ${pos.y}`, 5000);
      try { await shell(this.serial, `rm ${DUMP}`, 5000); } catch { /* ignore */ }
      return true;
    } finally {
      this.resumeWatcher();
    }
  }

  /**
   * Dismiss any blocking dialog (superuser, permissions) that might overlay the UI.
   * Returns the new XML if a dialog was dismissed, or null if nothing was found.
   */
  private async dismissBlockingDialog(xml: string, dumpPath: string): Promise<string | null> {
    const blockers = [
      "РАЗРЕШИТЬ", "Разрешить", "ALLOW", "Allow", "Grant",
      "При использовании приложения", "While using the app",
      "Только в этот раз", "Only this time",
    ];
    for (const text of blockers) {
      const btn = findNodeByText(xml, text);
      if (btn) {
        this.log(`Blocking dialog found — tapping "${text}"`);
        await shell(this.serial, `input tap ${btn.x} ${btn.y}`, 5000);
        await new Promise<void>((r) => setTimeout(r, 2000));
        try { return await this.dumpUI(dumpPath); } catch { return null; }
      }
    }
    return null;
  }

  /**
   * Update the Kitsune Mask manager app itself.
   * Flow:
   * 1. Open Kitsune → dismiss "update Magisk" dialog (ОК/Да)
   * 2. Find "Приложение" card → tap "Установка" (home_manager_button)
   * 3. Handle unknown sources permission if prompted
   * 4. Android package installer → tap "УСТАНОВКА"
   * 5. Wait for install to finish → tap "Открыть" or "Готово"
   * Returns true if update completed or was not needed.
   */
  async updateKitsuneApp(packageName: string): Promise<boolean> {
    this.pauseWatcher();
    try {
      const DUMP = "/sdcard/ui_dump.xml";
      const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

      // 1. Launch Kitsune
      this.log("Launching Kitsune Mask...");
      try { await shell(this.serial, `am force-stop ${packageName}`, 5000); } catch { /* ignore */ }
      await delay(1000);
      await shell(this.serial, `monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`, 10000);
      this.log("Waiting 4s for app to open...");
      await delay(4000);

      let xml = "";
      for (let dumpAttempt = 0; dumpAttempt < 3; dumpAttempt++) {
        this.log(`UI dump attempt ${dumpAttempt + 1}/3...`);
        try { xml = await this.dumpUI(DUMP); break; } catch {
          this.log("UI dump failed, retrying in 3s...", "warn");
          await delay(3000);
        }
      }
      if (!xml) {
        this.log("All UI dump attempts failed", "error");
        return false;
      }

      // 1b. Dismiss any blocking dialog (superuser, permissions)
      const afterBlock = await this.dismissBlockingDialog(xml, DUMP);
      if (afterBlock) xml = afterBlock;

      // 2. Dismiss "update Magisk" dialog (ОК or Да)
      const okBtn = findNodeByText(xml, "ОК") || findNodeByText(xml, "Да") || findNodeByText(xml, "OK");
      if (okBtn) {
        this.log("Found update dialog — tapping OK...");
        await shell(this.serial, `input tap ${okBtn.x} ${okBtn.y}`, 5000);
        this.log("Waiting 8s for app to process...");
        await delay(8000);
        // App may close after agreeing — check and reopen
        if (!(await this.ensureAppForeground(packageName))) return false;
        // Navigate to Home tab (app may reopen on Logs or other tab)
        await this.navigateToKitsuneHome(packageName);
        // Dismiss any blocking dialog that appears after reopen (superuser etc.)
        try {
          xml = await this.dumpUI(DUMP);
          const afterReopen = await this.dismissBlockingDialog(xml, DUMP);
          if (afterReopen) xml = afterReopen;
        } catch {
          this.log("UI dump after reopen failed, retrying...", "warn");
          await delay(3000);
          try { xml = await this.dumpUI(DUMP); } catch { return false; }
        }
      } else {
        this.log("No update dialog found — continuing");
      }

      // 3. Navigate to Home tab
      await this.navigateToKitsuneHome(packageName);

      // 4. Tap "Скрыть" (Hide) to collapse the Magisk card — this makes "Приложение" card visible
      this.log("Looking for Скрыть (Hide) button to collapse Magisk card...");
      try { xml = await this.dumpUI(DUMP); } catch {
        this.log("UI dump failed", "error");
        return false;
      }
      const hideBtn = findNodeByText(xml, "Скрыть") || findNodeByText(xml, "Hide");
      if (hideBtn) {
        this.log(`Tapping Скрыть at ${hideBtn.x},${hideBtn.y}...`);
        await shell(this.serial, `input tap ${hideBtn.x} ${hideBtn.y}`, 5000);
        await delay(2000);
        // Re-dump after collapse
        try { xml = await this.dumpUI(DUMP); } catch {
          this.log("UI dump after Скрыть failed", "error");
          return false;
        }
      } else {
        this.log("Скрыть not found — Magisk card may already be collapsed, scrolling down...");
        await shell(this.serial, "input swipe 540 1500 540 600 400", 5000);
        await delay(1500);
        try { xml = await this.dumpUI(DUMP); } catch {
          this.log("UI dump after scroll failed", "error");
          return false;
        }
      }

      // Dismiss any blocking dialog
      const afterCollapse = await this.dismissBlockingDialog(xml, DUMP);
      if (afterCollapse) xml = afterCollapse;

      // 5. Find "Установка" on the "Приложение" card (now visible after collapse/scroll)
      this.log("Looking for Установка near Приложение...");
      const nodes3 = extractNodeTags(xml);

      let appLabelPos: UIPos | null = null;
      const installButtons: Array<UIPos & { cls: string }> = [];

      for (const node of nodes3) {
        const text = getAttr(node, "text") || "";
        const rid = getAttr(node, "resource-id") || "";
        const cls = getAttr(node, "class") || "";
        const pos = getBounds(node);
        if (!pos) continue;

        if (text === "Приложение" || rid.endsWith("/home_manager_title")) {
          appLabelPos = pos;
          this.log(`  "Приложение" at ${pos.x},${pos.y}`);
        }
        if (text === "Установка" || text === "Обновить" || text === "Update" || text === "Install") {
          installButtons.push({ ...pos, cls });
          this.log(`  "${text}" at ${pos.x},${pos.y} class=${cls}`);
        }
      }

      if (installButtons.length === 0) {
        this.log("No Установка buttons found — app may already be up to date", "success");
        return true;
      }

      // Pick "Установка" closest to "Приложение" by Y
      let target: UIPos | null = null;
      if (!appLabelPos) {
        this.log("Приложение label not found — using last Установка button", "warn");
        target = installButtons[installButtons.length - 1];
      } else if (installButtons.length === 1) {
        target = installButtons[0];
      } else {
        const sorted = [...installButtons].sort(
          (a, b) => Math.abs(a.y - appLabelPos!.y) - Math.abs(b.y - appLabelPos!.y)
        );
        const sameRow = sorted.filter(b => Math.abs(b.y - appLabelPos!.y) < 80);
        target = sameRow[0] || sorted[0];
      }

      this.log(`Tapping Установка at ${target.x},${target.y}...`);
      await shell(this.serial, `input tap ${target.x} ${target.y}`, 5000);
      await delay(3000);

      // Flexible post-tap loop: handle whatever screen appears
      // Flow: changelog dialog (УСТАНОВКА) → unknown sources (toggle) → Android installer (Установить) → done (Готово/Открыть)
      this.log("Handling app update screens...");
      let handledUnknownSources = false;
      for (let step = 0; step < 30; step++) {
        await delay(2000);
        try { xml = await this.dumpUI(DUMP); } catch {
          this.log(`UI dump failed (step ${step + 1})`, "warn");
          continue;
        }

        const nodes = extractNodeTags(xml);
        const texts = nodes.map(n => getAttr(n, "text")).filter(Boolean);
        const allText = texts.join(" ");

        // Log screen content every 5 steps
        if (step % 5 === 0) {
          this.log(`  Screen (step ${step + 1}): ${texts.slice(0, 12).join(" | ").slice(0, 250)}`);
        }

        // Done: "Открыть" / "Open" → tap and finish
        const openBtn = findNodeByText(xml, "Открыть") || findNodeByText(xml, "Open");
        if (openBtn) {
          this.log("Install complete — tapping Открыть", "success");
          await shell(this.serial, `input tap ${openBtn.x} ${openBtn.y}`, 5000);
          await delay(3000);
          return true;
        }

        // Done: "Готово" / "Done"
        const doneBtn = findNodeByText(xml, "Готово") || findNodeByText(xml, "Done");
        if (doneBtn) {
          this.log("Install complete — tapping Готово", "success");
          await shell(this.serial, `input tap ${doneBtn.x} ${doneBtn.y}`, 5000);
          await delay(2000);
          return true;
        }

        // Back on home screen (install auto-completed)
        if (findNodeByText(xml, "Приложение") && findNodeByText(xml, "Magisk")) {
          this.log("Back on home screen — update may have auto-completed", "success");
          return true;
        }

        // Changelog dialog: "УСТАНОВКА" with "ОТМЕНА" nearby → tap УСТАНОВКА
        const cancelBtn = findNodeByText(xml, "ОТМЕНА") || findNodeByText(xml, "Cancel");
        const installDlgBtn = findNodeByText(xml, "УСТАНОВКА") || findNodeByText(xml, "INSTALL");
        if (cancelBtn && installDlgBtn) {
          this.log("Changelog dialog — tapping УСТАНОВКА...");
          await shell(this.serial, `input tap ${installDlgBtn.x} ${installDlgBtn.y}`, 5000);
          await delay(3000);
          continue;
        }

        // Unknown sources permission: look for Switch (unchecked) → toggle → go back
        if (!handledUnknownSources) {
          let foundSwitch = false;
          for (const node of nodes) {
            const cls = getAttr(node, "class") || "";
            if (cls.includes("Switch") && getAttr(node, "checked") === "false") {
              const pos = getBounds(node);
              if (pos) {
                this.log("Unknown sources toggle — enabling...");
                await shell(this.serial, `input tap ${pos.x} ${pos.y}`, 5000);
                await delay(2000);
                this.log("Going back...");
                await shell(this.serial, "input keyevent 4", 3000);
                await delay(2000);
                handledUnknownSources = true;
                foundSwitch = true;
                break;
              }
            }
          }
          if (foundSwitch) continue;
        }

        // Android package installer: "Установить" / "Install" button (NOT in changelog dialog)
        const androidInstallBtn = findNodeByText(xml, "Установить")
          || findNodeByText(xml, "Install");
        if (androidInstallBtn) {
          this.log(`Tapping installer button: ${androidInstallBtn.x},${androidInstallBtn.y}...`);
          await shell(this.serial, `input tap ${androidInstallBtn.x} ${androidInstallBtn.y}`, 5000);
          await delay(5000);
          continue;
        }

        // "УСТАНОВКА" without "ОТМЕНА" = Android installer variant
        if (installDlgBtn && !cancelBtn) {
          this.log(`Tapping УСТАНОВКА in installer: ${installDlgBtn.x},${installDlgBtn.y}...`);
          await shell(this.serial, `input tap ${installDlgBtn.x} ${installDlgBtn.y}`, 5000);
          await delay(5000);
          continue;
        }

        // Permission dialogs (РАЗРЕШИТЬ / Allow)
        const allowBtn = findNodeByText(xml, "РАЗРЕШИТЬ")
          || findNodeByText(xml, "Разрешить")
          || findNodeByText(xml, "Allow");
        if (allowBtn) {
          this.log("Permission dialog — tapping Allow...");
          await shell(this.serial, `input tap ${allowBtn.x} ${allowBtn.y}`, 5000);
          await delay(2000);
          continue;
        }

        // Ended up on Logs tab → go back
        if (allText.includes("beginning of") || allText.includes("---------")) {
          this.log("On Logs tab — pressing Back...", "warn");
          await shell(this.serial, "input keyevent 4", 3000);
          await delay(2000);
          continue;
        }

        this.log(`Waiting... (step ${step + 1}/30)`);
      }

      this.log("Install wait timed out — assuming app is up to date", "warn");
      return true;
    } finally {
      this.resumeWatcher();
    }
  }

  /**
   * Magisk Direct Install via Kitsune Mask UI:
   * 1. Ensure Kitsune is open → tap "Установка" on Magisk card
   * 2. Handle superuser permission dialog → grant
   * 3. Find "Автоматическая установка" → tap → "Установить" → "Перезагрузка"
   * Returns true if Direct Install triggered (device will reboot).
   */
  async installMagiskViaUI(packageName: string): Promise<boolean> {
    this.pauseWatcher();
    try {
      const DUMP = "/sdcard/ui_dump.xml";
      const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

      // Ensure app is open and on Home tab
      this.log("Ensuring Kitsune is in foreground...");
      if (!(await this.ensureAppForeground(packageName))) return false;
      await this.navigateToKitsuneHome(packageName);
      await delay(2000);

      let xml: string;
      this.log("Dumping UI...");
      try { xml = await this.dumpUI(DUMP); } catch { this.log("UI dump failed", "error"); return false; }

      // Dismiss any blocking dialog (superuser, permissions)
      const afterBlock = await this.dismissBlockingDialog(xml, DUMP);
      if (afterBlock) xml = afterBlock;

      // Dismiss any startup dialog
      const okBtn = findNodeByText(xml, "ОК") || findNodeByText(xml, "Да") || findNodeByText(xml, "OK");
      if (okBtn) {
        this.log("Startup dialog found — tapping OK...");
        await shell(this.serial, `input tap ${okBtn.x} ${okBtn.y}`, 5000);
        await delay(3000);
        if (!(await this.ensureAppForeground(packageName))) return false;
        await this.navigateToKitsuneHome(packageName);
        try { xml = await this.dumpUI(DUMP); } catch { return false; }
      }

      // Tap "Установка" on Magisk card
      // Find "Установка" text near "Magisk" label (NOT the FrameLayout — it may not be clickable)
      this.log("Looking for Magisk install button...");
      const magiskNodes = extractNodeTags(xml);
      let magiskLabelY = 0;
      const magiskInstallBtns: UIPos[] = [];

      for (const node of magiskNodes) {
        const text = getAttr(node, "text") || "";
        const rid = getAttr(node, "resource-id") || "";
        const pos = getBounds(node);
        if (!pos) continue;
        if (text === "Magisk" || rid.endsWith("/home_magisk_title")) {
          magiskLabelY = pos.y;
          this.log(`  "Magisk" label at ${pos.x},${pos.y}`);
        }
        if (text === "Установка" || text === "Install") {
          magiskInstallBtns.push(pos);
          this.log(`  "${text}" at ${pos.x},${pos.y}`);
        }
      }

      // Pick "Установка" closest to Magisk label
      let magiskBtn: UIPos | null = null;
      if (magiskLabelY && magiskInstallBtns.length > 0) {
        magiskInstallBtns.sort((a, b) => Math.abs(a.y - magiskLabelY) - Math.abs(b.y - magiskLabelY));
        magiskBtn = magiskInstallBtns[0];
      }
      // Fallback: try resource-id (FrameLayout) if text search failed
      if (!magiskBtn) {
        const frameBtn = findNodeByAttr(xml, "resource-id", `${packageName}:id/home_magisk_button`);
        if (frameBtn) {
          this.log("Using home_magisk_button FrameLayout as fallback...", "warn");
          magiskBtn = frameBtn;
        }
      }
      if (!magiskBtn) {
        this.log("Magisk install button not found!", "error");
        return false;
      }
      this.log(`Tapping Magisk Установка at ${magiskBtn.x},${magiskBtn.y}...`);
      await shell(this.serial, `input tap ${magiskBtn.x} ${magiskBtn.y}`, 5000);
      await delay(3000);

      // Poll loop: handle superuser dialog, find Автоматическая установка
      this.log("Polling for Direct Install screen...");
      let foundAutoInstall = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        try { xml = await this.dumpUI(DUMP); } catch {
          this.log("UI dump failed — trying to reopen app...", "warn");
          await delay(2000);
          if (!(await this.ensureAppForeground(packageName))) continue;
          await this.navigateToKitsuneHome(packageName);
          await delay(2000);
          try { xml = await this.dumpUI(DUMP); } catch { continue; }
        }

        // Check for superuser permission dialog
        const grantBtn = findNodeByText(xml, "РАЗРЕШИТЬ")
          || findNodeByText(xml, "Разрешить")
          || findNodeByText(xml, "ALLOW")
          || findNodeByText(xml, "Allow");
        if (grantBtn) {
          this.log("Superuser dialog — tapping РАЗРЕШИТЬ...");
          await shell(this.serial, `input tap ${grantBtn.x} ${grantBtn.y}`, 5000);
          await delay(3000);
          this.log("Reopening app after superuser grant...");
          if (!(await this.ensureAppForeground(packageName))) continue;
          await this.navigateToKitsuneHome(packageName);
          await delay(2000);
          try { xml = await this.dumpUI(DUMP); } catch { continue; }
          const reOk = findNodeByText(xml, "ОК") || findNodeByText(xml, "Да");
          if (reOk) {
            this.log("Post-grant dialog — tapping OK...");
            await shell(this.serial, `input tap ${reOk.x} ${reOk.y}`, 5000);
            await delay(2000);
            if (!(await this.ensureAppForeground(packageName))) continue;
            await this.navigateToKitsuneHome(packageName);
            try { xml = await this.dumpUI(DUMP); } catch { continue; }
          }
          // Re-tap Magisk install: find "Установка" near "Magisk" text
          const retryNodes = extractNodeTags(xml);
          let retryMagiskY = 0;
          let retryBtn: UIPos | null = null;
          for (const node of retryNodes) {
            const text = getAttr(node, "text") || "";
            const rid = getAttr(node, "resource-id") || "";
            const pos = getBounds(node);
            if (!pos) continue;
            if (text === "Magisk" || rid.endsWith("/home_magisk_title")) retryMagiskY = pos.y;
          }
          if (retryMagiskY) {
            for (const node of retryNodes) {
              const text = getAttr(node, "text") || "";
              const pos = getBounds(node);
              if (!pos) continue;
              if ((text === "Установка" || text === "Install") && Math.abs(pos.y - retryMagiskY) < 80) {
                retryBtn = pos;
                break;
              }
            }
          }
          if (!retryBtn) {
            retryBtn = findNodeByAttr(xml, "resource-id", `${packageName}:id/home_magisk_button`);
          }
          if (retryBtn) {
            this.log(`Re-tapping Magisk install at ${retryBtn.x},${retryBtn.y}...`);
            await shell(this.serial, `input tap ${retryBtn.x} ${retryBtn.y}`, 5000);
            await delay(3000);
          }
          continue;
        }

        // Check for "Автоматическая установка" (Direct Install method)
        const autoInstall = findNodeByAttr(xml, "resource-id", `${packageName}:id/method_direct`)
          || findNodeByText(xml, "Автоматическая установка");
        if (autoInstall) {
          this.log("Found 'Автоматическая установка' — selecting Direct Install!", "success");
          await shell(this.serial, `input tap ${autoInstall.x} ${autoInstall.y}`, 5000);
          await delay(1000);
          foundAutoInstall = true;
          break;
        }

        // Check for ОК/Да dialog and dismiss
        const dismissBtn = findNodeByText(xml, "ОК") || findNodeByText(xml, "Да") || findNodeByText(xml, "OK");
        if (dismissBtn) {
          this.log("Dialog found — tapping OK...");
          await shell(this.serial, `input tap ${dismissBtn.x} ${dismissBtn.y}`, 5000);
          await delay(2000);
        }

        // Log screen content every 5 attempts for diagnostics
        if (attempt % 5 === 0) {
          const pollTexts = extractNodeTags(xml).map(n => getAttr(n, "text")).filter(Boolean);
          this.log(`  Screen: ${pollTexts.slice(0, 15).join(" | ").slice(0, 250)}`);
        }
        this.log(`Polling for Direct Install (attempt ${attempt + 1}/20)...`);
        await delay(2000);
      }

      if (!foundAutoInstall) {
        this.log("Direct Install screen not found after 20 attempts!", "error");
        return false;
      }

      // Tap "УСТАНОВИТЬ" / "Установить"
      this.log("Looking for Install button...");
      try { xml = await this.dumpUI(DUMP); } catch { return false; }
      const installAction = findNodeByText(xml, "УСТАНОВИТЬ")
        || findNodeByText(xml, "Установить")
        || findNodeByText(xml, "ДАЛЕЕ");
      if (installAction) {
        this.log("Tapping УСТАНОВИТЬ...");
        await shell(this.serial, `input tap ${installAction.x} ${installAction.y}`, 5000);
      }

      // Wait for install to complete — poll for "Перезагрузка" / "Reboot" button
      this.log("Waiting for Magisk install to complete (up to 3 min)...");
      const installStart = Date.now();
      let consecutiveFailures = 0;
      while (Date.now() - installStart < 180000) {
        await delay(5000);
        try {
          xml = await this.dumpUI(DUMP);
          consecutiveFailures = 0;
        } catch {
          consecutiveFailures++;
          this.log(`UI dump failed (${consecutiveFailures}/3) — device may be rebooting...`, "warn");
          if (consecutiveFailures >= 3) {
            this.log("Device is rebooting (3 consecutive dump failures)", "success");
            return true;
          }
          continue;
        }

        const rebootBtn = findNodeByText(xml, "Перезагрузка")
          || findNodeByText(xml, "Reboot")
          || findNodeByAttr(xml, "resource-id", `${packageName}:id/restart_btn`);
        if (rebootBtn) {
          this.log("Tapping Reboot button...", "success");
          await shell(this.serial, `input tap ${rebootBtn.x} ${rebootBtn.y}`, 5000);
          return true;
        }

        const elapsed = Math.round((Date.now() - installStart) / 1000);
        this.log(`Installing Magisk... (${elapsed}s elapsed)`);
      }

      this.log("Magisk install timed out after 3 min!", "error");
      return false;
    } finally {
      this.resumeWatcher();
    }
  }

  /**
   * Enable Shell superuser access + set auto-response to Allow:
   * 1. Open Superuser tab → toggle Shell switch ON
   * 2. Open Settings → set "Автоматический ответ" to "Разрешить"
   */
  async enableShellSuperuser(packageName: string): Promise<boolean> {
    this.pauseWatcher();
    try {
    const DUMP = "/sdcard/ui_dump.xml";
    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    // Launch app
    await shell(this.serial, `monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`, 10000);
    await delay(3000);

    // Tap Superuser tab
    let xml = await this.dumpUI(DUMP);
    const suTab = findNodeByAttr(xml, "resource-id", `${packageName}:id/superuserFragment`);
    if (!suTab) return false;
    await shell(this.serial, `input tap ${suTab.x} ${suTab.y}`, 5000);
    await delay(2000);

    // Find Shell policy switch (policy_indicator) and enable it if unchecked
    xml = await this.dumpUI(DUMP);
    const policySwitch = findNodeByAttr(xml, "resource-id", `${packageName}:id/policy_indicator`);
    if (policySwitch) {
      // Check if it's already on by looking at the checked attribute
      for (const node of extractNodeTags(xml)) {
        if (getAttr(node, "resource-id") === `${packageName}:id/policy_indicator`) {
          if (getAttr(node, "checked") === "false") {
            await shell(this.serial, `input tap ${policySwitch.x} ${policySwitch.y}`, 5000);
            await delay(1000);
          }
          break;
        }
      }
    }

    // Go to Settings → change "Автоматический ответ" to "Разрешить"
    // Navigate to Settings via gear icon
    xml = await this.dumpUI(DUMP);
    const settingsBtn = findNodeByAttr(xml, "resource-id", `${packageName}:id/action_settings`);
    if (settingsBtn) {
      await shell(this.serial, `input tap ${settingsBtn.x} ${settingsBtn.y}`, 5000);
      await delay(2000);

      // Scroll down to find Superuser section
      for (let i = 0; i < 3; i++) {
        xml = await this.dumpUI(DUMP);
        const autoResponse = findNodeByText(xml, "Автоматический ответ");
        if (autoResponse) {
          // Check if already set to "Разрешить"
          const currentValue = findNodeByText(xml, "Разрешить");
          if (!currentValue) {
            await shell(this.serial, `input tap ${autoResponse.x} ${autoResponse.y}`, 5000);
            await delay(2000);
            // Tap "Разрешить" in the dialog
            xml = await this.dumpUI(DUMP);
            const allowOption = findNodeByText(xml, "Разрешить");
            if (allowOption) {
              await shell(this.serial, `input tap ${allowOption.x} ${allowOption.y}`, 5000);
              await delay(1000);
            }
          }
          break;
        }
        await shell(this.serial, "input swipe 540 1500 540 500 500", 5000);
        await delay(1000);
      }
    }

    // Go back to home
    await shell(this.serial, "input keyevent 4", 3000);
    await delay(500);
    await shell(this.serial, "input keyevent 4", 3000);

    try { await shell(this.serial, `rm ${DUMP}`, 5000); } catch { /* ignore */ }
    return true;
    } finally {
      this.resumeWatcher();
    }
  }

  async waitForInternet(timeoutMs = 30000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const result = await shell(this.serial, "ping -c 1 -W 5 8.8.8.8", 10000);
        if (result.includes("1 received") || result.includes("1 packets received")) return true;
      } catch {
        // not connected yet
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    return false;
  }

  async enableZygisk(): Promise<void> {
    // Magisk stores settings in sqlite db
    await shellSu(
      this.serial,
      `magisk --sqlite "REPLACE INTO settings (key,value) VALUES('zygisk',1)"`,
      10000
    );
  }

  /**
   * Enable Zygisk via UI: open Kitsune Mask → Settings → toggle Zygisk switch ON
   */
  async enableZygiskViaUI(packageName: string): Promise<boolean> {
    this.pauseWatcher();
    try {
    const DUMP = "/sdcard/ui_dump.xml";
    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    // Force-stop and relaunch to ensure clean state
    try { await shell(this.serial, `am force-stop ${packageName}`, 5000); } catch { /* ignore */ }
    await delay(1000);
    await shell(this.serial, `monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`, 10000);
    await delay(3000);

    // Handle any "ОК" dialog
    let xml: string;
    try {
      xml = await this.dumpUI(DUMP);
    } catch {
      return false;
    }
    const okBtn = findNodeByText(xml, "ОК");
    if (okBtn) {
      await shell(this.serial, `input tap ${okBtn.x} ${okBtn.y}`, 5000);
      await delay(2000);
    }

    // Tap Settings gear icon
    try {
      xml = await this.dumpUI(DUMP);
    } catch {
      return false;
    }
    const settingsBtn = findNodeByAttr(xml, "resource-id", `${packageName}:id/action_settings`);
    if (!settingsBtn) return false;
    await shell(this.serial, `input tap ${settingsBtn.x} ${settingsBtn.y}`, 5000);
    await delay(2000);

    // Find Zygisk toggle — scroll if needed
    for (let i = 0; i < 3; i++) {
      xml = await this.dumpUI(DUMP);
      const zygiskLabel = findNodeByText(xml, "Zygisk");
      if (zygiskLabel) {
        // Find the switch near Zygisk — look for a Switch/CheckBox widget nearby
        const nodes = extractNodeTags(xml);
        for (const node of nodes) {
          const cls = getAttr(node, "class") || "";
          const rid = getAttr(node, "resource-id") || "";
          if (
            (cls.includes("Switch") || cls.includes("CheckBox") || rid.includes("zygisk")) &&
            getAttr(node, "checked") === "false"
          ) {
            const pos = getBounds(node);
            if (pos) {
              await shell(this.serial, `input tap ${pos.x} ${pos.y}`, 5000);
              await delay(1000);
              // Confirm dialog if it appears
              try {
                xml = await this.dumpUI(DUMP);
                const yesBtn = findNodeByText(xml, "ОК") || findNodeByText(xml, "Да") || findNodeByText(xml, "Yes");
                if (yesBtn) {
                  await shell(this.serial, `input tap ${yesBtn.x} ${yesBtn.y}`, 5000);
                }
              } catch { /* ignore */ }
              // Go back
              await shell(this.serial, "input keyevent 4", 3000);
              try { await shell(this.serial, `rm ${DUMP}`, 5000); } catch { /* ignore */ }
              return true;
            }
          }
          // If already checked
          if (
            (cls.includes("Switch") || cls.includes("CheckBox") || rid.includes("zygisk")) &&
            getAttr(node, "checked") === "true"
          ) {
            // Already enabled
            await shell(this.serial, "input keyevent 4", 3000);
            try { await shell(this.serial, `rm ${DUMP}`, 5000); } catch { /* ignore */ }
            return true;
          }
        }
        // If we found "Zygisk" text but no switch — try tapping on Zygisk label itself
        await shell(this.serial, `input tap ${zygiskLabel.x} ${zygiskLabel.y}`, 5000);
        await delay(1000);
        await shell(this.serial, "input keyevent 4", 3000);
        try { await shell(this.serial, `rm ${DUMP}`, 5000); } catch { /* ignore */ }
        return true;
      }
      await shell(this.serial, "input swipe 540 1500 540 500 500", 5000);
      await delay(1000);
    }

    await shell(this.serial, "input keyevent 4", 3000);
    try { await shell(this.serial, `rm ${DUMP}`, 5000); } catch { /* ignore */ }
    return false;
    } finally {
      this.resumeWatcher();
    }
  }

  async installMagiskModule(remotePath: string): Promise<string> {
    return shellSu(this.serial, `magisk --install-module ${remotePath}`, 120000);
  }

  /**
   * Install a Magisk module via Kitsune Mask UI:
   * Modules tab → FAB → SAF file picker → navigate to file → install
   */
  async installModuleViaUI(
    packageName: string,
    remotePath: string,
    log: (msg: string, level?: "info" | "success" | "warn" | "error") => void = () => {}
  ): Promise<boolean> {
    this.pauseWatcher();
    try {
    const DUMP = "/sdcard/ui_dump.xml";
    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const fileName = remotePath.split("/").pop()!;

    // Force-stop first to ensure fresh launch (not resuming on Settings page)
    log(`Opening Kitsune Mask (force restart)...`);
    try { await shell(this.serial, `am force-stop ${packageName}`, 5000); } catch { /* ignore */ }
    await delay(1000);
    await shell(this.serial, `monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`, 10000);
    await delay(4000);

    let xml: string;
    try {
      xml = await this.dumpUI(DUMP);
    } catch (err) {
      log(`UI dump failed after launch: ${(err as Error).message}`, "error");
      return false;
    }

    // Dismiss any dialog (e.g. "ОК" button)
    const okBtn = findNodeByText(xml, "ОК");
    if (okBtn) {
      log(`Dismissing dialog...`);
      await shell(this.serial, `input tap ${okBtn.x} ${okBtn.y}`, 5000);
      await delay(2000);
      try { xml = await this.dumpUI(DUMP); } catch (err) {
        log(`UI dump failed after dialog: ${(err as Error).message}`, "error");
        return false;
      }
    }

    // Navigate to Modules tab
    const modulesTab = findNodeByAttr(xml, "resource-id", `${packageName}:id/modulesFragment`);
    if (!modulesTab) {
      const nodes = extractNodeTags(xml);
      const ids = nodes.map(n => getAttr(n, "resource-id")).filter(Boolean);
      log(`Modules tab not found! Available IDs: ${ids.join(", ")}`, "error");
      return false;
    }
    log(`Navigating to Modules tab...`);
    await shell(this.serial, `input tap ${modulesTab.x} ${modulesTab.y}`, 5000);
    await delay(2000);

    // Tap FAB (install from storage)
    xml = await this.dumpUI(DUMP);
    let fab: UIPos | null = null;
    for (const node of extractNodeTags(xml)) {
      const cls = getAttr(node, "class") || "";
      if (cls.includes("FloatingActionButton")) {
        fab = getBounds(node);
        break;
      }
    }
    if (!fab) {
      const nodes = extractNodeTags(xml);
      const classes = [...new Set(nodes.map(n => getAttr(n, "class")).filter(Boolean))];
      log(`Install button (FAB) not found! Classes: ${classes.join(", ")}`, "error");
      return false;
    }
    log(`Tapping "Install from storage"...`);
    await shell(this.serial, `input tap ${fab.x} ${fab.y}`, 5000);
    await delay(3000);

    // === SAF file picker navigation ===
    xml = await this.dumpUI(DUMP);

    let fileBtn = findNodeByText(xml, fileName);
    if (fileBtn) {
      log(`File "${fileName}" found in recent files`);
    } else {
      // Open navigation drawer (hamburger menu)
      const hamburger = findNodeByAttr(xml, "content-desc", "Show roots")
        || findNodeByAttr(xml, "content-desc", "Показать корневые каталоги");
      if (hamburger) {
        log(`Opening file picker sidebar...`);
        await shell(this.serial, `input tap ${hamburger.x} ${hamburger.y}`, 5000);
        await delay(2000);
        xml = await this.dumpUI(DUMP);
      } else {
        log(`No sidebar button found`, "warn");
      }

      // Select storage root
      const storage = findNodeByText(xml, "Внутреннее хранилище")
        || findNodeByText(xml, "Internal storage")
        || findNodeByText(xml, "Phone")
        || findNodeByText(xml, "Телефон");
      if (storage) {
        log(`Selecting internal storage...`);
        await shell(this.serial, `input tap ${storage.x} ${storage.y}`, 5000);
        await delay(2000);
        xml = await this.dumpUI(DUMP);
      } else {
        const nodes = extractNodeTags(xml);
        const texts = nodes.map(n => getAttr(n, "text")).filter(Boolean);
        log(`Storage root not found! Visible: ${texts.join(" | ")}`, "warn");
      }

      // Navigate: Download folder
      const dlFolder = findNodeByText(xml, "Download") || findNodeByText(xml, "Downloads");
      if (dlFolder) {
        log(`Opening Download folder...`);
        await shell(this.serial, `input tap ${dlFolder.x} ${dlFolder.y}`, 5000);
        await delay(2000);
        xml = await this.dumpUI(DUMP);
      } else {
        const nodes = extractNodeTags(xml);
        const texts = nodes.map(n => getAttr(n, "text")).filter(Boolean);
        log(`Download folder not found! Visible: ${texts.join(" | ")}`, "warn");
      }

      // Navigate: prepare folder
      const prepFolder = findNodeByText(xml, "prepare");
      if (prepFolder) {
        log(`Opening prepare folder...`);
        await shell(this.serial, `input tap ${prepFolder.x} ${prepFolder.y}`, 5000);
        await delay(2000);
        xml = await this.dumpUI(DUMP);
      } else {
        const nodes = extractNodeTags(xml);
        const texts = nodes.map(n => getAttr(n, "text")).filter(Boolean);
        log(`prepare folder not found! Visible: ${texts.join(" | ")}`, "warn");
      }

      // Scroll to find the file if needed
      for (let attempt = 0; attempt < 5; attempt++) {
        fileBtn = findNodeByText(xml, fileName);
        if (fileBtn) {
          log(`File "${fileName}" found`);
          break;
        }
        log(`File not visible, scrolling... (${attempt + 1}/5)`);
        await shell(this.serial, "input swipe 540 1500 540 500 500", 5000);
        await delay(1500);
        xml = await this.dumpUI(DUMP);
      }
    }

    if (!fileBtn) {
      const nodes = extractNodeTags(xml);
      const texts = nodes.map(n => getAttr(n, "text")).filter(Boolean);
      log(`File "${fileName}" NOT FOUND! Visible: ${texts.join(" | ")}`, "error");
      return false;
    }

    log(`Selecting file "${fileName}"...`);
    await shell(this.serial, `input tap ${fileBtn.x} ${fileBtn.y}`, 5000);
    await delay(5000);

    // === Wait for module install to complete ===
    log(`Waiting for module install to finish...`);
    const installStart = Date.now();
    let pollCount = 0;
    while (Date.now() - installStart < 120000) {
      pollCount++;
      try { xml = await this.dumpUI(DUMP); } catch (err) {
        log(`UI dump failed during install (assuming done): ${(err as Error).message}`, "warn");
        return true;
      }

      // Look for "Reboot" / "Перезагрузка" / "Обновить" / "Update" button (install done)
      const rebootBtn = findNodeByText(xml, "Перезагрузка")
        || findNodeByText(xml, "Reboot")
        || findNodeByText(xml, "Обновить")
        || findNodeByText(xml, "Update");
      if (rebootBtn) {
        log(`Module installed — "${findNodeByText(xml, "Перезагрузка") ? "Перезагрузка" : findNodeByText(xml, "Обновить") ? "Обновить" : "Reboot"}" button detected`, "success");
        await shell(this.serial, "input keyevent 4", 3000);
        return true;
      }

      // Look for "Close" button (install done, no reboot needed)
      const closeBtn = findNodeByText(xml, "Закрыть") || findNodeByText(xml, "Close");
      if (closeBtn) {
        log(`Module installed — "Close" button detected`, "success");
        await shell(this.serial, `input tap ${closeBtn.x} ${closeBtn.y}`, 5000);
        return true;
      }

      // Show progress every few polls
      if (pollCount <= 3 || pollCount % 5 === 0) {
        const nodes = extractNodeTags(xml);
        const texts = nodes.map(n => getAttr(n, "text")).filter(Boolean);
        log(`Install in progress... (${Math.round((Date.now() - installStart) / 1000)}s) [${texts.join(" | ")}]`);
      }

      await delay(3000);
    }
    log(`Install timed out after 120s!`, "error");

    return false;
    } finally {
      this.resumeWatcher();
    }
  }

  async reboot(): Promise<void> {
    await rebootDevice(this.serial);
  }

  async waitForBoot(timeoutMs = 180000): Promise<boolean> {
    return waitForBoot(this.serial, timeoutMs);
  }

  async dismissDialogs(maxRounds = 3): Promise<number> {
    this.pauseWatcher();
    try {
    const DUMP = "/sdcard/ui_dump.xml";
    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const buttonTexts = [
      "Разрешить", "Allow", "РАЗРЕШИТЬ", "ALLOW",
      "Принять", "Accept", "ПРИНЯТЬ", "ACCEPT",
      "ОК", "OK", "Ок",
      "Да", "Yes", "ДА", "YES",
      "Продолжить", "Continue", "ПРОДОЛЖИТЬ", "CONTINUE",
      "Понятно", "Got it", "ПОНЯТНО",
      "При использовании приложения", "While using the app",
      "Только в этот раз", "Only this time",
    ];
    let dismissed = 0;

    for (let round = 0; round < maxRounds; round++) {
      let xml: string;
      try {
        xml = await this.dumpUI(DUMP);
      } catch {
        break;
      }

      let found = false;
      for (const text of buttonTexts) {
        const btn = findNodeByText(xml, text);
        if (btn) {
          await shell(this.serial, `input tap ${btn.x} ${btn.y}`, 5000);
          dismissed++;
          found = true;
          await delay(1500);
          break; // re-dump after each tap
        }
      }

      if (!found) break;
    }

    return dismissed;
    } finally {
      this.resumeWatcher();
    }
  }

  async detectKitsunePackage(): Promise<string | null> {
    try {
      // List all packages and search for ones with magisk-related names
      const pkgList = await shell(this.serial, "pm list packages", 10000);
      const packages = pkgList
        .split("\n")
        .map((l) => l.replace("package:", "").trim())
        .filter(Boolean);

      // Collect magisk-related packages
      const candidates: string[] = [];
      for (const pkg of packages) {
        if (pkg.includes("magisk") || pkg.includes("kitsune")) {
          candidates.push(pkg);
        }
      }

      // Check each candidate's version name for "kitsune"
      for (const pkg of candidates) {
        try {
          const info = await shell(
            this.serial,
            `dumpsys package ${pkg} | grep -E "versionName|versionCode"`,
            10000
          );
          if (info.toLowerCase().includes("kitsune")) {
            return pkg;
          }
        } catch { /* ignore */ }
      }

      // If no "kitsune" in version name, try by version code matching the binary
      // Also check any package that has versionCode 27002+
      for (const pkg of candidates) {
        if (pkg !== "com.topjohnwu.magisk") {
          // Any magisk-related package that's NOT the original Magisk is likely Kitsune
          return pkg;
        }
      }

      // Fallback: search ALL packages for kitsune in version name (stub package may have random name)
      try {
        const dumpAll = await shell(
          this.serial,
          "dumpsys package | grep -B5 -i kitsune | grep 'Package \\[' | head -1",
          15000
        );
        const match = dumpAll.match(/Package \[([^\]]+)\]/);
        if (match) return match[1];
      } catch { /* ignore */ }

      return null;
    } catch {
      return null;
    }
  }

  startDialogWatcher(log?: (msg: string) => void): () => void {
    const DUMP = "/sdcard/ui_watcher.xml";
    let running = true;
    // All agreement buttons — safe because UI automation methods call pauseWatcher()/resumeWatcher()
    const buttonTexts = [
      "Разрешить", "Allow", "РАЗРЕШИТЬ", "ALLOW", "Grant",
      "Принять", "Accept", "ПРИНЯТЬ", "ACCEPT",
      "ОК", "OK", "Ок",
      "Да", "Yes", "ДА", "YES",
      "Продолжить", "Continue", "ПРОДОЛЖИТЬ", "CONTINUE",
      "Понятно", "Got it", "ПОНЯТНО",
      "При использовании приложения", "While using the app",
      "Только в этот раз", "Only this time",
    ];

    const poll = async () => {
      while (running) {
        try {
          await new Promise((r) => setTimeout(r, 2000));
          if (!running) break;
          if (this._watcherPauseCount > 0) continue;

          const xml = await this.dumpUI(DUMP);

          for (const text of buttonTexts) {
            const btn = findNodeByText(xml, text);
            if (btn) {
              await shell(this.serial, `input tap ${btn.x} ${btn.y}`, 5000);
              if (log) log(`Auto-dismissed dialog: tapped "${text}"`);
              await new Promise((r) => setTimeout(r, 1000));
              break;
            }
          }
        } catch {
          // UI dump may fail if device is rebooting — ignore
        }
      }
    };

    poll();
    return () => { running = false; };
  }
}

export class MockTransport implements DeviceTransport {
  constructor(
    private serial: string,
    private delayMs = 500,
    private failRate = 0
  ) {}

  setLog(_log: (msg: string, level?: "info" | "success" | "warn" | "error") => void): void {}

  async ensureDir(_remotePath: string): Promise<void> {
    await this.delay();
  }

  async pushFile(_localPath: string, _remotePath: string): Promise<void> {
    await this.delay();
    if (Math.random() < this.failRate) {
      throw new Error(`Mock push failed for ${this.serial}`);
    }
  }

  async installApk(_localPath: string): Promise<void> {
    await this.delay();
  }

  async checkOnline(): Promise<boolean> {
    await this.delay();
    return true;
  }

  async checkRoot(): Promise<boolean> {
    await this.delay();
    return true;
  }

  async checkFileExists(_remotePath: string): Promise<boolean> {
    await this.delay();
    return false;
  }

  async getConnectedWifiSsid(): Promise<string | null> {
    await this.delay();
    return null;
  }

  async getAppVersionCode(_packageName: string): Promise<number | null> {
    await this.delay();
    return 27002;
  }

  async grantInstallPermission(_packageName: string): Promise<void> {
    await this.delay();
  }

  async configureSuperuser(): Promise<boolean> {
    await this.delay();
    return true;
  }

  async configureSuperuserViaUI(_packageName: string): Promise<boolean> {
    await this.delay();
    return true;
  }

  async isZygiskEnabled(): Promise<boolean> {
    await this.delay();
    return false;
  }

  async getMagiskVersion(): Promise<MagiskInfo | null> {
    await this.delay();
    return { versionCode: 27000, versionName: "27.0:KITSUNE" };
  }

  async getMagiskVersionNoRoot(): Promise<MagiskInfo | null> {
    return this.getMagiskVersion();
  }

  async launchApp(_packageName: string): Promise<void> {
    await this.delay();
  }

  async connectWifi(_ssid: string, _password: string): Promise<void> {
    await this.delay();
  }

  async tapButtonByText(_label: string): Promise<boolean> {
    await this.delay();
    return true;
  }

  async installMagiskViaUI(_packageName: string): Promise<boolean> {
    await this.delay();
    return true;
  }

  async enableShellSuperuser(_packageName: string): Promise<boolean> {
    await this.delay();
    return true;
  }

  async waitForInternet(): Promise<boolean> {
    await this.delay();
    return true;
  }

  async enableZygisk(): Promise<void> {
    await this.delay();
  }

  async enableZygiskViaUI(_packageName: string): Promise<boolean> {
    await this.delay();
    return true;
  }

  async installMagiskModule(_remotePath: string): Promise<string> {
    await this.delay();
    return "Success";
  }

  async installModuleViaUI(_packageName: string, _remotePath: string, _log?: (msg: string, level?: "info" | "success" | "warn" | "error") => void): Promise<boolean> {
    await this.delay();
    return true;
  }

  async reboot(): Promise<void> {
    await this.delay();
  }

  async waitForBoot(): Promise<boolean> {
    await this.delay();
    return true;
  }

  async dismissDialogs(): Promise<number> {
    await this.delay();
    return 0;
  }

  async detectKitsunePackage(): Promise<string | null> {
    await this.delay();
    return "com.topjohnwu.magisk";
  }

  startDialogWatcher(): () => void {
    return () => {};
  }

  pauseWatcher(): void {}
  resumeWatcher(): void {}

  async navigateToKitsuneHome(_packageName: string): Promise<boolean> {
    await this.delay();
    return true;
  }

  async ensureAppForeground(_packageName: string): Promise<boolean> {
    await this.delay();
    return true;
  }

  async updateKitsuneApp(_packageName: string): Promise<boolean> {
    await this.delay();
    return true;
  }

  private delay(): Promise<void> {
    return new Promise((r) => setTimeout(r, this.delayMs));
  }
}

export function createTransport(serial: string): DeviceTransport {
  if (process.env.MOCK_TRANSPORT === "true") {
    return new MockTransport(serial, 800, 0.05);
  }
  return new AdbTransport(serial);
}
