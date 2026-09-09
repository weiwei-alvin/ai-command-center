/**
 * Settings persistence layer.
 *
 * Persists CAO connection config, team definitions and app preferences to
 * localStorage so they survive app restarts. Includes validation and
 * migration-safe merging with defaults for unknown/partial payloads.
 */

import type { AppPreferences, CAOConfig, Settings, Team } from '../types';

const STORAGE_KEY = 'ai-command-center:settings:v1';

export const DEFAULT_CAO_CONFIG: CAOConfig = {
  baseUrl: 'http://localhost:9889',
  wsUrl: 'ws://localhost:9889',
};

export const DEFAULT_PREFERENCES: AppPreferences = {
  pollIntervalMs: 10000,
  autoRefreshSessions: true,
  openSessionAfterLaunch: true,
  theme: 'dark',
};

export const DEFAULT_TEAM: Team = {
  id: 'default',
  name: 'Default Team',
  description: 'Supervisor + Builder + Reviewer',
  supervisorProfile: 'code_supervisor',
  workerProfiles: ['developer', 'reviewer'],
};

export const DEFAULT_SETTINGS: Settings = {
  caoConfig: { ...DEFAULT_CAO_CONFIG },
  teams: [DEFAULT_TEAM],
  preferences: { ...DEFAULT_PREFERENCES },
};

/** Validate and normalize a URL-ish string (accepts http(s):// and ws(s)://). */
function normalizeUrl(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (!/^https?:\/\//.test(trimmed) && !/^wss?:\/\//.test(trimmed)) return fallback;
  return trimmed.replace(/\/+$/, '');
}

function isValidTeam(value: unknown): value is Team {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Partial<Team>;
  return (
    typeof t.id === 'string' && t.id.length > 0 &&
    typeof t.name === 'string' && t.name.length > 0 &&
    typeof t.supervisorProfile === 'string' &&
    Array.isArray(t.workerProfiles) &&
    t.workerProfiles.every((p) => typeof p === 'string')
  );
}

function normalizePreferences(value: unknown): AppPreferences {
  const prefs = { ...DEFAULT_PREFERENCES };
  if (typeof value !== 'object' || value === null) return prefs;
  const raw = value as Partial<AppPreferences>;
  if (
    typeof raw.pollIntervalMs === 'number' &&
    Number.isFinite(raw.pollIntervalMs) &&
    raw.pollIntervalMs >= 1000 &&
    raw.pollIntervalMs <= 600000
  ) {
    prefs.pollIntervalMs = raw.pollIntervalMs;
  }
  if (typeof raw.autoRefreshSessions === 'boolean') {
    prefs.autoRefreshSessions = raw.autoRefreshSessions;
  }
  if (typeof raw.openSessionAfterLaunch === 'boolean') {
    prefs.openSessionAfterLaunch = raw.openSessionAfterLaunch;
  }
  if (raw.theme === 'dark' || raw.theme === 'light') {
    prefs.theme = raw.theme;
  }
  return prefs;
}

/** Parse + validate a raw settings payload; falls back to defaults per field. */
export function parseSettings(raw: unknown): Settings {
  const settings: Settings = {
    caoConfig: { ...DEFAULT_CAO_CONFIG },
    teams: [DEFAULT_TEAM],
    preferences: { ...DEFAULT_PREFERENCES },
  };

  if (typeof raw !== 'object' || raw === null) return settings;
  const data = raw as Record<string, unknown>;

  if (typeof data.caoConfig === 'object' && data.caoConfig !== null) {
    const cfg = data.caoConfig as Record<string, unknown>;
    settings.caoConfig = {
      baseUrl: normalizeUrl(cfg.baseUrl, DEFAULT_CAO_CONFIG.baseUrl),
      wsUrl: normalizeUrl(cfg.wsUrl, DEFAULT_CAO_CONFIG.wsUrl),
    };
  }

  if (Array.isArray(data.teams)) {
    const teams = data.teams.filter(isValidTeam);
    if (teams.length > 0) {
      // Deduplicate by id, keeping first occurrence
      const seen = new Set<string>();
      settings.teams = teams.filter((t) => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });
    }
  }

  settings.preferences = normalizePreferences(data.preferences);
  return settings;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return parseSettings(JSON.parse(raw));
  } catch (error) {
    console.warn('Failed to load settings, using defaults:', error);
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch (error) {
    console.warn('Failed to save settings:', error);
    return false;
  }
}

export function resetSettings(): Settings {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore removal errors
  }
  return { ...DEFAULT_SETTINGS };
}

/** Generate a unique team id from a team name. */
export function makeTeamId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .substring(0, 40);
  const suffix = Date.now().toString(36);
  return `${base || 'team'}-${suffix}`;
}