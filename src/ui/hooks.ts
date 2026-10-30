import { useEffect, useState, useSyncExternalStore } from 'react';
import { formFor, isMegaActive, stageFor } from '../buddies/evolution';
import type { Form, Stage } from '../buddies/evolution';
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

/** The selected buddy's evolution state; re-renders when Mega runs out. */
export function useBuddyForm(): { buddyId: string; xp: number; stage: Stage; form: Form; megaActive: boolean; megaUntil: number } {
  const buddyId = useApp((st) => st.settings.buddy);
  const xp = useApp((st) => st.settings.buddyXp[st.settings.buddy] ?? 0);
  const megaUntil = useApp((st) => st.settings.megaUntil);
  const [, force] = useState(0);
  useEffect(() => {
    const left = megaUntil - Date.now();
    if (left <= 0) return undefined;
    const t = setTimeout(() => force((n) => n + 1), left + 50);
    return () => clearTimeout(t);
  }, [megaUntil]);
  const megaActive = isMegaActive(megaUntil, Date.now());
  return { buddyId, xp, stage: stageFor(xp), form: formFor(xp, megaActive), megaActive, megaUntil };
}
