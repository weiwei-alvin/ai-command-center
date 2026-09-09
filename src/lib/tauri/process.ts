/**
 * Tauri bridge for CAO process lifecycle control.
 *
 * Wraps `invoke` calls with a graceful browser fallback so the UI can be
 * developed and previewed outside the Tauri shell.
 */

import type { CAOProcessAction, CAOProcessResult } from '../../types';

interface TauriInvoke {
  (cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}

/**
 * Whether the app's Tauri backend spawned and is tracking the CAO process.
 */
export interface CAOProcessStatus {
  managed: boolean;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: { invoke: TauriInvoke };
    __TAURI__?: { core?: { invoke: TauriInvoke } };
  }
}

function getInvoke(): TauriInvoke | null {
  if (typeof window === 'undefined') return null;
  if (window.__TAURI_INTERNALS__?.invoke) return window.__TAURI_INTERNALS__.invoke;
  if (window.__TAURI__?.core?.invoke) return window.__TAURI__.core.invoke;
  return null;
}

/**
 * Whether we are running inside the Tauri desktop shell.
 */
export function isTauri(): boolean {
  return getInvoke() !== null;
}

/**
 * Start or stop the CAO server process via Tauri backend commands.
 * Returns a failure result when not running under Tauri.
 */
export async function controlCAOProcess(action: CAOProcessAction): Promise<CAOProcessResult> {
  const invoke = getInvoke();
  if (!invoke) {
    return {
      success: false,
      action,
      message: 'Process control requires the desktop app (Tauri runtime).',
    };
  }

  try {
    const command = action === 'start' ? 'cao_start' : 'cao_stop';
    return await invoke(command) as CAOProcessResult;
  } catch (error) {
    return {
      success: false,
      action,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Ask the Tauri backend whether it spawned and is tracking the CAO process.
 * Returns `null` when not running under Tauri (status unknown).
 */
export async function getCAOProcessStatus(): Promise<CAOProcessStatus | null> {
  const invoke = getInvoke();
  if (!invoke) {
    return null;
  }

  try {
    return await invoke('cao_status') as CAOProcessStatus;
  } catch {
    return null;
  }
}