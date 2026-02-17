import { push, shell, install, shellSu, rebootDevice, waitForBoot } from "../adb";

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
  isZygiskEnabled(): Promise<boolean>;
  getMagiskVersion(): Promise<MagiskInfo | null>;
  getMagiskVersionNoRoot(): Promise<MagiskInfo | null>;
  launchApp(packageName: string): Promise<void>;
  connectWifi(ssid: string, password: string, security?: string): Promise<void>;
  waitForInternet(timeoutMs?: number): Promise<boolean>;
  enableZygisk(): Promise<void>;
  enableZygiskViaUI(packageName: string): Promise<boolean>;
  installMagiskModule(remotePath: string): Promise<string>;
  tapButtonByText(label: string, delayBeforeMs?: number): Promise<boolean>;
  installMagiskViaUI(packageName: string): Promise<boolean>;
  enableShellSuperuser(packageName: string): Promise<boolean>;
  reboot(): Promise<void>;
  waitForBoot(timeoutMs?: number): Promise<boolean>;
}

export class AdbTransport implements DeviceTransport {
  constructor(private serial: string) {}

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

  async checkRoot(): Promise<boolean> {
    try {
      const result = await shellSu(this.serial, "id", 10000);
      return result.includes("uid=0");
    } catch {
      return false;
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
    try {
      const result = await shell(this.serial, "dumpsys wifi | grep mWifiInfo", 10000);
      const match = result.match(/SSID:\s*"([^"]+)"/);
      return match ? match[1] : null;
    } catch {
      return null;
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
    const DUMP = "/sdcard/ui_dump.xml";
    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    // Open WiFi settings
    await shell(this.serial, "am start -a android.settings.WIFI_SETTINGS", 10000);
    await delay(3000);

    // Dump UI and find the SSID
    let xml = await this.dumpUI(DUMP);
    let ssidPos = findNodeByText(xml, ssid);

    if (!ssidPos) {
      // Scroll down to find the network
      await shell(this.serial, "input swipe 360 1000 360 400 500", 5000);
      await delay(1500);
      xml = await this.dumpUI(DUMP);
      ssidPos = findNodeByText(xml, ssid);
    }

    if (!ssidPos) {
      throw new Error(`WiFi network "${ssid}" not found on screen`);
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
  }

  private async dumpUI(path: string): Promise<string> {
    await shell(this.serial, `uiautomator dump ${path}`, 15000);
    return shell(this.serial, `cat ${path}`, 15000);
  }

  async tapButtonByText(label: string, delayBeforeMs = 3000): Promise<boolean> {
    const DUMP = "/sdcard/ui_dump.xml";
    await new Promise<void>((r) => setTimeout(r, delayBeforeMs));
    const xml = await this.dumpUI(DUMP);
    const pos = findNodeByText(xml, label);
    if (!pos) return false;
    await shell(this.serial, `input tap ${pos.x} ${pos.y}`, 5000);
    try { await shell(this.serial, `rm ${DUMP}`, 5000); } catch { /* ignore */ }
    return true;
  }

  /**
   * Full Magisk installation via UI automation:
   * 1. Launch app → tap "Установка" on Magisk card
   * 2. Select "Автоматическая установка" radio → tap "УСТАНОВИТЬ"
   * 3. Wait for "All done!" → tap "Перезагрузка"
   */
  async installMagiskViaUI(packageName: string): Promise<boolean> {
    const DUMP = "/sdcard/ui_dump.xml";
    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    // Launch the app
    await shell(this.serial, `monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`, 10000);
    await delay(4000);

    // Handle any "ОК" dialog (Magisk update prompt)
    let xml: string;
    try {
      xml = await this.dumpUI(DUMP);
    } catch {
      return false; // UI dump failed — device not ready
    }

    const okBtn = findNodeByText(xml, "ОК");
    if (okBtn) {
      await shell(this.serial, `input tap ${okBtn.x} ${okBtn.y}`, 5000);
      await delay(2000);
      try {
        xml = await this.dumpUI(DUMP);
      } catch {
        return false;
      }
    }

    // Tap "Установка" button on Magisk card (resource-id: home_magisk_button)
    const installBtn = findNodeByAttr(xml, "resource-id", "com.topjohnwu.magisk:id/home_magisk_button")
      || findNodeByText(xml, "Установка");
    if (!installBtn) return false;
    await shell(this.serial, `input tap ${installBtn.x} ${installBtn.y}`, 5000);
    await delay(3000);

    // Select "Автоматическая установка" radio button (method_direct)
    try {
      xml = await this.dumpUI(DUMP);
    } catch {
      return false;
    }
    const directRadio = findNodeByAttr(xml, "resource-id", "com.topjohnwu.magisk:id/method_direct");
    if (!directRadio) return false;
    await shell(this.serial, `input tap ${directRadio.x} ${directRadio.y}`, 5000);
    await delay(1000);

    // Tap "УСТАНОВИТЬ" button
    const installAction = findNodeByText(xml, "УСТАНОВИТЬ");
    if (!installAction) return false;
    await shell(this.serial, `input tap ${installAction.x} ${installAction.y}`, 5000);

    // Poll for completion — device may auto-reboot during install
    const installStart = Date.now();
    let consecutiveFailures = 0;
    while (Date.now() - installStart < 120000) {
      await delay(5000);
      try {
        xml = await this.dumpUI(DUMP);
        consecutiveFailures = 0;
      } catch {
        consecutiveFailures++;
        if (consecutiveFailures >= 3) {
          // 3 consecutive UI dump failures — device is rebooting
          return true;
        }
        continue;
      }
      const rebootBtn = findNodeByAttr(xml, "resource-id", "com.topjohnwu.magisk:id/restart_btn");
      if (rebootBtn) {
        await shell(this.serial, `input tap ${rebootBtn.x} ${rebootBtn.y}`, 5000);
        return true;
      }
    }
    return false;
  }

  /**
   * Enable Shell superuser access + set auto-response to Allow:
   * 1. Open Superuser tab → toggle Shell switch ON
   * 2. Open Settings → set "Автоматический ответ" to "Разрешить"
   */
  async enableShellSuperuser(packageName: string): Promise<boolean> {
    const DUMP = "/sdcard/ui_dump.xml";
    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    // Launch app
    await shell(this.serial, `monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`, 10000);
    await delay(3000);

    // Tap Superuser tab
    let xml = await this.dumpUI(DUMP);
    const suTab = findNodeByAttr(xml, "resource-id", "com.topjohnwu.magisk:id/superuserFragment");
    if (!suTab) return false;
    await shell(this.serial, `input tap ${suTab.x} ${suTab.y}`, 5000);
    await delay(2000);

    // Find Shell policy switch (policy_indicator) and enable it if unchecked
    xml = await this.dumpUI(DUMP);
    const policySwitch = findNodeByAttr(xml, "resource-id", "com.topjohnwu.magisk:id/policy_indicator");
    if (policySwitch) {
      // Check if it's already on by looking at the checked attribute
      for (const node of extractNodeTags(xml)) {
        if (getAttr(node, "resource-id") === "com.topjohnwu.magisk:id/policy_indicator") {
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
    const settingsBtn = findNodeByAttr(xml, "resource-id", "com.topjohnwu.magisk:id/action_settings");
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
    const DUMP = "/sdcard/ui_dump.xml";
    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    // Launch app
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
    const settingsBtn = findNodeByAttr(xml, "resource-id", "com.topjohnwu.magisk:id/action_settings");
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
  }

  async installMagiskModule(remotePath: string): Promise<string> {
    return shellSu(this.serial, `magisk --install-module ${remotePath}`, 120000);
  }

  async reboot(): Promise<void> {
    await rebootDevice(this.serial);
  }

  async waitForBoot(timeoutMs = 180000): Promise<boolean> {
    return waitForBoot(this.serial, timeoutMs);
  }
}

export class MockTransport implements DeviceTransport {
  constructor(
    private serial: string,
    private delayMs = 500,
    private failRate = 0
  ) {}

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

  async reboot(): Promise<void> {
    await this.delay();
  }

  async waitForBoot(): Promise<boolean> {
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
