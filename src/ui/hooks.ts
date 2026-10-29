import { useSyncExternalStore } from 'react';
import { appStore } from '../state/app';
import type { AppState } from '../state/app';
import { downloads } from '../models/downloads';
import { server } from '../server/ServerManager';
import type { ServerStatus } from '../server/ServerManager';
import { log } from '../lib/log';
import type { LogEntry } from '../lib/log';

export function useApp<S>(selector: (s: AppState) => S): S {
  return useSyncExternalStore(appStore.subscribe, () => selector(appStore.get()));
}

export function useDownloads() {
  return useSyncExternalStore(downloads.subscribe.bind(downloads), () => downloads.state);
}

export function useServer(): ServerStatus {
  return useSyncExternalStore(server.subscribe.bind(server), () => server.status);
}

export function useLogs(): LogEntry[] {
  return useSyncExternalStore(log.subscribe, () => log.entries());
}
