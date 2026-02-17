import { push, shell, install } from "../adb";

export interface DeviceTransport {
  ensureDir(remotePath: string): Promise<void>;
  pushFile(localPath: string, remotePath: string): Promise<void>;
  installApk(localPath: string): Promise<void>;
  checkOnline(): Promise<boolean>;
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
