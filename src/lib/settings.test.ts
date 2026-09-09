/**
 * Tests for the settings persistence layer.
 * parseSettings / normalizeUrl behavior is covered via the public API;
 * load/save/reset are thin localStorage wrappers around it.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  makeTeamId,
  parseSettings,
  resetSettings,
  saveSettings,
  loadSettings,
} from './settings';

const VALID_TEAM = {
  id: 'team-1',
  name: 'Team One',
  description: 'desc',
  supervisorProfile: 'code_supervisor',
  workerProfiles: ['developer'],
};

const ANOTHER_TEAM = {
  id: 'team-2',
  name: 'Team Two',
  description: '',
  supervisorProfile: 'sup',
  workerProfiles: ['worker-a', 'worker-b'],
};

afterEach(() => {
  localStorage.clear();
});

describe('parseSettings', () => {
  it('returns defaults for null/undefined/non-object input', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('garbage')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(42)).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults for corrupt JSON-shaped objects', () => {
    expect(parseSettings({ random: true })).toEqual(DEFAULT_SETTINGS);
  });

  it('parses a fully valid settings object', () => {
    const raw = {
      caoConfig: { baseUrl: 'http://localhost:1234', wsUrl: 'ws://localhost:1234' },
      teams: [VALID_TEAM, ANOTHER_TEAM],
      preferences: {
        pollIntervalMs: 5000,
        autoRefreshSessions: false,
        openSessionAfterLaunch: false,
        theme: 'light',
      },
    };
    const parsed = parseSettings(raw);
    expect(parsed.caoConfig).toEqual(raw.caoConfig);
    expect(parsed.teams).toHaveLength(2);
    expect(parsed.preferences).toEqual(raw.preferences);
  });

  it('normalizes URLs: strips trailing slashes, keeps valid schemes', () => {
    const parsed = parseSettings({
      caoConfig: { baseUrl: 'http://localhost:9889///', wsUrl: 'wss://example.com/' },
    });
    expect(parsed.caoConfig.baseUrl).toBe('http://localhost:9889');
    expect(parsed.caoConfig.wsUrl).toBe('wss://example.com');
  });

  it('falls back to default URLs for invalid schemes or non-strings', () => {
    const parsed = parseSettings({
      caoConfig: { baseUrl: 'ftp://bad', wsUrl: '', wsUrlMaybe: 'ws://ok' },
    });
    expect(parsed.caoConfig.baseUrl).toBe(DEFAULT_SETTINGS.caoConfig.baseUrl);
    expect(parsed.caoConfig.wsUrl).toBe(DEFAULT_SETTINGS.caoConfig.wsUrl);
  });

  it('drops invalid teams and keeps valid ones', () => {
    const invalidTeam = { id: '', name: 'No id' };
    const parsed = parseSettings({ teams: [VALID_TEAM, invalidTeam, 'not-a-team'] });
    expect(parsed.teams).toEqual([VALID_TEAM]);
  });

  it('falls back to the default team list when no valid teams exist', () => {
    const parsed = parseSettings({ teams: [{ bad: 'shape' }] });
    expect(parsed.teams).toEqual(DEFAULT_SETTINGS.teams);
  });

  it('deduplicates teams by id, keeping the first occurrence', () => {
    const duplicate = { ...ANOTHER_TEAM, name: 'Different name, same id' };
    const parsed = parseSettings({ teams: [VALID_TEAM, ANOTHER_TEAM, duplicate] });
    expect(parsed.teams).toHaveLength(2);
    expect(parsed.teams.map((t) => t.id)).toEqual(['team-1', 'team-2']);
  });

  it('normalizes preferences: rejects out-of-range poll intervals', () => {
    // parseSettings is strict: values outside [1000, 600000] fall back to the
    // default (the UI clamps before saving, so stored values are always valid).
    const tooFast = parseSettings({ preferences: { pollIntervalMs: 10 } });
    expect(tooFast.preferences.pollIntervalMs).toBe(DEFAULT_SETTINGS.preferences.pollIntervalMs);

    const tooSlow = parseSettings({ preferences: { pollIntervalMs: 99999999 } });
    expect(tooSlow.preferences.pollIntervalMs).toBe(DEFAULT_SETTINGS.preferences.pollIntervalMs);

    const valid = parseSettings({ preferences: { pollIntervalMs: 2000 } });
    expect(valid.preferences.pollIntervalMs).toBe(2000);

    const notANumber = parseSettings({ preferences: { pollIntervalMs: NaN } });
    expect(notANumber.preferences.pollIntervalMs).toBe(DEFAULT_SETTINGS.preferences.pollIntervalMs);
  });

  it('normalizes preferences: keeps only valid theme values', () => {
    expect(parseSettings({ preferences: { theme: 'light' } }).preferences.theme).toBe('light');
    expect(parseSettings({ preferences: { theme: 'dark' } }).preferences.theme).toBe('dark');
    expect(parseSettings({ preferences: { theme: 'solarized' } }).preferences.theme).toBe('dark');
  });

  it('normalizes preferences: keeps only boolean flags', () => {
    const prefs = parseSettings({
      preferences: { autoRefreshSessions: 'yes', openSessionAfterLaunch: 0 },
    }).preferences;
    expect(prefs.autoRefreshSessions).toBe(DEFAULT_SETTINGS.preferences.autoRefreshSessions);
    expect(prefs.openSessionAfterLaunch).toBe(DEFAULT_SETTINGS.preferences.openSessionAfterLaunch);
  });
});

describe('makeTeamId', () => {
  it('derives a slug from the team name with a unique suffix', () => {
    const id1 = makeTeamId('Full Stack Team!');
    const id2 = makeTeamId('Full Stack Team!');
    expect(id1).toMatch(/^full-stack-team-/);
    expect(id1).not.toBe(id2);
  });

  it('falls back to a "team" prefix for names with no slug-able characters', () => {
    expect(makeTeamId('!!!')).toMatch(/^team-/);
    expect(makeTeamId('')).toMatch(/^team-/);
  });
});

describe('localStorage round-trip', () => {
  it('saveSettings then loadSettings returns the same data', () => {
    const settings = parseSettings({
      caoConfig: { baseUrl: 'http://localhost:7777', wsUrl: 'ws://localhost:7777' },
      teams: [VALID_TEAM],
      preferences: { theme: 'light', pollIntervalMs: 15000 },
    });
    expect(saveSettings(settings)).toBe(true);
    expect(loadSettings()).toEqual(settings);
  });

  it('loadSettings returns defaults when nothing is stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('resetSettings clears storage and returns defaults', () => {
    saveSettings(parseSettings({ caoConfig: { baseUrl: 'http://x' } }));
    expect(resetSettings()).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});