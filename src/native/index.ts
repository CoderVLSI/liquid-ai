import { requireOptionalNativeModule } from 'expo';

export interface DeviceInfo {
  filesDir: string;
  nativeLibraryDir: string;
  serverBinaryPresent: boolean;
  serverBinarySize: number;
  abis: string[];
  sdk: number;
  device: string;
  totalRamBytes: number;
  availRamBytes: number;
  freeDiskBytes: number;
  cores: number;
}

export interface ExitReason {
  reason: string;
  status: number;
  description: string;
  process: string;
  timestamp: number;
  pssKb: number;
  rssKb: number;
}

export interface CrashReport {
  name: string;
  text: string;
}

export interface NativeEvents {
  serverLog: { stream: 'out' | 'err'; line: string };
  serverExit: { code: number; expected: boolean; signal: number; tail: string };
  micFrame: { data: string; rms: number };
  micError: { code: number; message: string };
  downloadProgress: { id: string; received: number; total: number };
}

interface Raw {
  getInfo(): DeviceInfo;
  getMemory(): { availRamBytes: number; lowMemory: boolean };
  startServer(args: string[]): Promise<number>;
  stopServer(): Promise<void>;
  isServerRunning(): boolean;
  getServerTail(): string;
  startMic(sampleRate: number, voiceCommunication: boolean): Promise<{ sampleRate: number; aec: boolean; ns: boolean }>;
  stopMic(): Promise<void>;
  enterVoiceMode(callMode: boolean): Promise<{ mode: string; speaker: boolean; headset?: boolean }>;
  leaveVoiceMode(): Promise<void>;
  startPlayer(sampleRate: number, callMode: boolean): Promise<void>;
  playPcm(base64: string): void;
  flushPlayer(): void;
  playerPendingMs(): number;
  stopPlayer(): Promise<void>;
  setWakeLock(on: boolean): void;
  fileSize(path: string): number;
  partialSize(path: string): number;
  deleteFile(path: string): Promise<boolean>;
  readText(path: string): Promise<string | null>;
  writeText(path: string, text: string, append: boolean): void;
  downloadFile(id: string, url: string, dest: string): Promise<{ path: string; size: number }>;
  cancelDownload(id: string): void;
  isDownloading(id: string): boolean;
  getCrashReports(): CrashReport[];
  clearCrashReports(): void;
  writeCrash(kind: string, text: string): void;
  getExitReasons(): ExitReason[];
  readLogcat(maxLines: number): Promise<string>;
  addListener(event: string, cb: (payload: any) => void): { remove(): void };
}

const mod = requireOptionalNativeModule<any>('LiquidNative') as Raw | null;

export const nativeAvailable = mod != null;

function need(): Raw {
  if (!mod) {
    throw new Error(
      'Native module "LiquidNative" is missing. This build was not made with `expo prebuild` (Expo Go cannot run this app) — install the APK built by the GitHub workflow.',
    );
  }
  return mod;
}

export const native = {
  info: () => need().getInfo(),
  memory: () => need().getMemory(),
  startServer: (args: string[]) => need().startServer(args),
  stopServer: () => need().stopServer(),
  isServerRunning: () => (mod ? mod.isServerRunning() : false),
  serverTail: () => (mod ? mod.getServerTail() : ''),
  startMic: (rate: number, voiceComm: boolean) => need().startMic(rate, voiceComm),
  stopMic: () => (mod ? mod.stopMic() : Promise.resolve()),
  enterVoiceMode: (callMode: boolean) => need().enterVoiceMode(callMode),
  leaveVoiceMode: () => (mod ? mod.leaveVoiceMode() : Promise.resolve()),
  startPlayer: (rate: number, callMode: boolean) => need().startPlayer(rate, callMode),
  playPcm: (b64: string) => need().playPcm(b64),
  flushPlayer: () => mod?.flushPlayer(),
  playerPendingMs: () => (mod ? mod.playerPendingMs() : 0),
  stopPlayer: () => (mod ? mod.stopPlayer() : Promise.resolve()),
  setWakeLock: (on: boolean) => mod?.setWakeLock(on),
  fileSize: (p: string) => (mod ? mod.fileSize(p) : -1),
  partialSize: (p: string) => (mod ? mod.partialSize(p) : 0),
  deleteFile: (p: string) => need().deleteFile(p),
  readText: (p: string) => (mod ? mod.readText(p) : Promise.resolve(null)),
  writeText: (p: string, t: string, append = false) => mod?.writeText(p, t, append),
  downloadFile: (id: string, url: string, dest: string) => need().downloadFile(id, url, dest),
  cancelDownload: (id: string) => mod?.cancelDownload(id),
  isDownloading: (id: string) => (mod ? mod.isDownloading(id) : false),
  crashReports: () => (mod ? mod.getCrashReports() : []),
  clearCrashReports: () => mod?.clearCrashReports(),
  writeCrash: (kind: string, text: string) => mod?.writeCrash(kind, text),
  exitReasons: () => (mod ? mod.getExitReasons() : []),
  logcat: (n: number) => need().readLogcat(n),

  on<K extends keyof NativeEvents>(event: K, cb: (e: NativeEvents[K]) => void): () => void {
    if (!mod) return () => {};
    const sub = mod.addListener(event, cb);
    return () => sub.remove();
  },
};
