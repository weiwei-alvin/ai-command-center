/**
 * Session metadata persistence layer.
 *
 * Wraps the Tauri backend commands (session_metadata_save/list/delete)
 * which store team / task / projectFolder metadata in the app data dir
 * so sessions survive an app restart. All calls degrade gracefully:
 * in a non-Tauri context (e.g. plain browser dev) or on failure they
 * return empty results / log errors instead of throwing, so the UI
 * keeps working when persistence is unavailable.
 */

import { invoke } from '@tauri-apps/api/core';
import type { StoredSessionMetadata } from '../types';

const isTauriAvailable = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

export async function saveSessionMetadata(meta: {
  sessionId: string;
  team: string;
  task: string;
  projectFolder: string;
}): Promise<boolean> {
  if (!isTauriAvailable()) {
    return false;
  }
  try {
    await invoke('session_metadata_save', {
      sessionId: meta.sessionId,
      team: meta.team,
      task: meta.task,
      projectFolder: meta.projectFolder,
    });
    return true;
  } catch (error) {
    console.error('Failed to save session metadata:', error);
    return false;
  }
}

export async function listSessionMetadata(): Promise<StoredSessionMetadata[]> {
  if (!isTauriAvailable()) {
    return [];
  }
  try {
    return await invoke<StoredSessionMetadata[]>('session_metadata_list');
  } catch (error) {
    console.error('Failed to load session metadata:', error);
    return [];
  }
}

export async function deleteSessionMetadata(sessionId: string): Promise<boolean> {
  if (!isTauriAvailable()) {
    return false;
  }
  try {
    await invoke('session_metadata_delete', { sessionId });
    return true;
  } catch (error) {
    console.error('Failed to delete session metadata:', error);
    return false;
  }
}