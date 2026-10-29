import { log, stringify } from './log';
import { native } from '../native';

/**
 * Makes sure JS crashes leave evidence behind:
 *  - fatal/non-fatal JS errors are written to disk synchronously (native), together with the last logs
 *  - unhandled promise rejections are logged
 *  - console.* is mirrored into the in-app log
 * The next launch shows them in Debug → Crashes.
 */
export function installCrashHandlers() {
  const g: any = globalThis;

  const ErrorUtils = g.ErrorUtils;
  const previous = ErrorUtils?.getGlobalHandler?.();
  ErrorUtils?.setGlobalHandler?.((error: any, isFatal?: boolean) => {
    try {
      const text = `${isFatal ? 'FATAL ' : ''}${stringify(error)}\n\n--- last log lines ---\n${log.dump(150)}`;
      log.error('crash', isFatal ? 'fatal JS error' : 'JS error', stringify(error));
      native.writeCrash(isFatal ? 'js-fatal' : 'js-error', text);
    } catch {
      // never throw from the crash handler
    }
    previous?.(error, isFatal);
  });

  try {
    g.HermesInternal?.enablePromiseRejectionTracker?.({
      allRejections: true,
      onUnhandled: (id: number, error: unknown) => {
        log.error('promise', `unhandled rejection #${id}`, stringify(error));
        try {
          native.writeCrash('js-unhandled-rejection', `${stringify(error)}\n\n--- last log lines ---\n${log.dump(100)}`);
        } catch {
          // ignore
        }
      },
    });
  } catch {
    // tracker is optional
  }

  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const orig = console[level]?.bind(console);
    console[level] = (...args: unknown[]) => {
      log[level === 'log' ? 'info' : level]('console', ...args);
      orig?.(...args);
    };
  }
}
