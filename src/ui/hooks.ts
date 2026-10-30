import { useSyncExternalStore } from 'react';
import { appStore } from '../state/app';
import type { AppState } from '../state/app';
import { downloads } from '../models/downloads';
import { server } from '../server/ServerManager';
import type { ServerStatus } from '../server/ServerManager';
import { agentStore } from '../agents/store';
import type { AgentState } from '../agents/store';
import { connStore } from '../connections/store';
import type { ConnState } from '../connections/store';
import { mcpStore } from '../mcp/manager';
import { log } from '../lib/log';
import type { LogEntry } from '../lib/log';

export function useApp<S>(selector: (s: AppState) => S): S {
  return useSyncExternalStore(appStore.subscribe, () => selector(appStore.get()));
}

export function useAgents<S>(selector: (s: AgentState) => S): S {
  return useSyncExternalStore(agentStore.subscribe, () => selector(agentStore.get()));
}

export function useConnections<S>(selector: (s: ConnState) => S): S {
  return useSyncExternalStore(connStore.subscribe, () => selector(connStore.get()));
}

export function useMcp() {
  return useSyncExternalStore(mcpStore.subscribe, () => mcpStore.get().status);
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
