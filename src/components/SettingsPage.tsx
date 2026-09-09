import { useEffect, useState } from 'react';
import type { AppPreferences, CAOConfig, Settings, Team } from '../types';
import {
  DEFAULT_SETTINGS,
  makeTeamId,
  resetSettings,
  saveSettings,
} from '../lib/settings';

type HealthStatus = 'unknown' | 'checking' | 'ok' | 'fail';

interface SettingsPageProps {
  settings: Settings;
  onChange: (settings: Settings) => void;
}

interface ConnectionSectionProps {
  config: CAOConfig;
  onConfigChange: (config: CAOConfig) => void;
}

interface TeamsSectionProps {
  teams: Team[];
  onChange: (teams: Team[]) => void;
}

interface PreferencesSectionProps {
  preferences: AppPreferences;
  onChange: (preferences: AppPreferences) => void;
}

function ConnectionSection({ config, onConfigChange }: ConnectionSectionProps) {
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [wsUrl, setWsUrl] = useState(config.wsUrl);
  const [status, setStatus] = useState<HealthStatus>('unknown');
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    setBaseUrl(config.baseUrl);
    setWsUrl(config.wsUrl);
  }, [config.baseUrl, config.wsUrl]);

  const validBaseUrl = /^https?:\/\/.+/i.test(baseUrl.trim());
  const validWsUrl = /^wss?:\/\/.+/i.test(wsUrl.trim());
  const dirty = baseUrl !== config.baseUrl || wsUrl !== config.wsUrl;
  const canApply = validBaseUrl && validWsUrl;

  const handleApply = () => {
    onConfigChange({
      baseUrl: baseUrl.trim().replace(/\/+$/, ''),
      wsUrl: wsUrl.trim().replace(/\/+$/, ''),
    });
  };

  const handleTest = async () => {
    setStatus('checking');
    setStatusMessage('');
    const target = baseUrl.trim().replace(/\/+$/, '');
    try {
      const response = await fetch(`${target}/health`);
      if (!response.ok) {
        setStatus('fail');
        setStatusMessage(`Server responded with HTTP ${response.status}`);
        return;
      }
      const data = (await response.json()) as { status?: string };
      if (data.status === 'ok') {
        setStatus('ok');
        setStatusMessage('CAO server is healthy.');
      } else {
        setStatus('fail');
        setStatusMessage(`Health endpoint returned status "${data.status ?? 'unknown'}".`);
      }
    } catch (error) {
      setStatus('fail');
      setStatusMessage(
        error instanceof Error ? `Connection failed: ${error.message}` : 'Connection failed.'
      );
    }
  };

  return (
    <section className="settings-section">
      <h2>CAO Connection</h2>
      <p className="settings-hint">
        Base URL of the CAO server (HTTP API) and its WebSocket endpoint. Changes take effect after apply.
      </p>

      <div className="form-group">
        <label htmlFor="cao-base-url">HTTP Base URL</label>
        <input
          id="cao-base-url"
          type="text"
          value={baseUrl}
          placeholder="http://localhost:9889"
          onChange={(e) => setBaseUrl(e.target.value)}
          aria-invalid={!validBaseUrl}
        />
        {!validBaseUrl && <span className="field-error">Must start with http:// or https://</span>}
      </div>

      <div className="form-group">
        <label htmlFor="cao-ws-url">WebSocket URL</label>
        <input
          id="cao-ws-url"
          type="text"
          value={wsUrl}
          placeholder="ws://localhost:9889"
          onChange={(e) => setWsUrl(e.target.value)}
          aria-invalid={!validWsUrl}
        />
        {!validWsUrl && <span className="field-error">Must start with ws:// or wss://</span>}
      </div>

      <div className="settings-actions">
        <button
          className="btn btn-primary"
          onClick={handleApply}
          disabled={!canApply || !dirty}
        >
          Apply
        </button>
        <button
          className="btn btn-secondary"
          onClick={handleTest}
          disabled={!canApply || status === 'checking'}
        >
          {status === 'checking' ? 'Testing…' : 'Test Connection'}
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => {
            setBaseUrl(DEFAULT_SETTINGS.caoConfig.baseUrl);
            setWsUrl(DEFAULT_SETTINGS.caoConfig.wsUrl);
          }}
        >
          Restore Defaults
        </button>
      </div>

      {status === 'ok' && <div className="settings-status ok">✓ {statusMessage}</div>}
      {status === 'fail' && <div className="settings-status fail">✗ {statusMessage}</div>}
      {!dirty && status === 'unknown' && (
        <div className="settings-status muted">
          Current configuration is applied. Use “Test Connection” to verify reachability.
        </div>
      )}
    </section>
  );
}

function TeamsSection({ teams, onChange }: TeamsSectionProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Team | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startCreate = () => {
    setEditingId(null);
    setError(null);
    setDraft({
      id: '',
      name: '',
      description: '',
      supervisorProfile: 'code_supervisor',
      workerProfiles: ['developer'],
    });
  };

  const startEdit = (team: Team) => {
    setEditingId(team.id);
    setError(null);
    setDraft({ ...team, workerProfiles: [...team.workerProfiles] });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
    setError(null);
  };

  const validateDraft = (t: Team): string | null => {
    if (!t.name.trim()) return 'Team name is required.';
    if (!t.supervisorProfile.trim()) return 'Supervisor profile is required.';
    const profiles = t.workerProfiles.map((p) => p.trim()).filter(Boolean);
    if (profiles.length === 0) return 'At least one worker profile is required.';
    return null;
  };

  const saveDraft = () => {
    if (!draft) return;
    const validation = validateDraft(draft);
    if (validation) {
      setError(validation);
      return;
    }
    const cleaned: Team = {
      ...draft,
      name: draft.name.trim(),
      description: draft.description.trim(),
      supervisorProfile: draft.supervisorProfile.trim(),
      workerProfiles: draft.workerProfiles.map((p) => p.trim()).filter(Boolean),
    };
    if (editingId) {
      onChange(teams.map((t) => (t.id === editingId ? cleaned : t)));
    } else {
      const id = makeTeamId(cleaned.name);
      onChange([...teams, { ...cleaned, id }]);
    }
    cancelEdit();
  };

  const handleDelete = (team: Team) => {
    if (teams.length <= 1) {
      setError('At least one team must remain configured.');
      return;
    }
    onChange(teams.filter((t) => t.id !== team.id));
  };

  const duplicateName = (name: string) =>
    teams.some((t) => t.name.toLowerCase() === name.toLowerCase().trim() && t.id !== editingId);

  return (
    <section className="settings-section">
      <h2>Teams</h2>
      <p className="settings-hint">
        Define supervisor and worker agent profiles used when launching tasks.
      </p>

      <div className="team-list">
        {teams.map((team) => (
          <div key={team.id} className="team-card">
            <div className="team-card-header">
              <div className="team-card-info">
                <div className="team-name">{team.name}</div>
                <div className="team-description">{team.description || 'No description'}</div>
                <div className="team-profiles">
                  <span className="team-profile-chip supervisor">
                    Supervisor: {team.supervisorProfile}
                  </span>
                  {team.workerProfiles.map((profile) => (
                    <span key={profile} className="team-profile-chip">
                      {profile}
                    </span>
                  ))}
                </div>
              </div>
              <div className="team-card-actions">
                <button className="btn btn-secondary" onClick={() => startEdit(team)}>
                  Edit
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => handleDelete(team)}
                  disabled={teams.length <= 1}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {draft ? (
        <div className="team-editor">
          <h3>{editingId ? 'Edit Team' : 'New Team'}</h3>
          <div className="form-group">
            <label htmlFor="team-name">Name</label>
            <input
              id="team-name"
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="e.g. Full Stack Team"
            />
            {duplicateName(draft.name) && (
              <span className="field-error">A team with this name already exists.</span>
            )}
          </div>
          <div className="form-group">
            <label htmlFor="team-description">Description</label>
            <input
              id="team-description"
              type="text"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="What this team is for"
            />
          </div>
          <div className="form-group">
            <label htmlFor="team-supervisor">Supervisor Profile</label>
            <input
              id="team-supervisor"
              type="text"
              value={draft.supervisorProfile}
              onChange={(e) => setDraft({ ...draft, supervisorProfile: e.target.value })}
              placeholder="e.g. code_supervisor"
            />
          </div>
          <div className="form-group">
            <label htmlFor="team-workers">Worker Profiles (comma separated)</label>
            <input
              id="team-workers"
              type="text"
              value={draft.workerProfiles.join(', ')}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  workerProfiles: e.target.value.split(',').map((p) => p.trimStart()),
                })
              }
              placeholder="e.g. developer, reviewer"
            />
          </div>
          {error && <div className="error-message">{error}</div>}
          <div className="settings-actions">
            <button
              className="btn btn-primary"
              onClick={saveDraft}
              disabled={duplicateName(draft.name)}
            >
              Save Team
            </button>
            <button className="btn btn-secondary" onClick={cancelEdit}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="settings-actions">
          <button className="btn btn-primary" onClick={startCreate}>
            Add Team
          </button>
        </div>
      )}
    </section>
  );
}

function PreferencesSection({ preferences, onChange }: PreferencesSectionProps) {
  const update = (patch: Partial<AppPreferences>) => {
    onChange({ ...preferences, ...patch });
  };

  const clampPollInterval = (value: number) => {
    if (!Number.isFinite(value)) return DEFAULT_SETTINGS.preferences.pollIntervalMs;
    return Math.min(600000, Math.max(1000, Math.round(value)));
  };

  return (
    <section className="settings-section">
      <h2>Preferences</h2>
      <p className="settings-hint">Application behavior and appearance.</p>

      <div className="form-group">
        <label htmlFor="pref-theme">Theme</label>
        <select
          id="pref-theme"
          value={preferences.theme}
          onChange={(e) => update({ theme: e.target.value as AppPreferences['theme'] })}
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </div>

      <div className="form-group">
        <label htmlFor="pref-poll">Status Poll Interval (ms)</label>
        <input
          id="pref-poll"
          type="number"
          min={1000}
          max={600000}
          step={1000}
          value={preferences.pollIntervalMs}
          onChange={(e) => update({ pollIntervalMs: clampPollInterval(Number(e.target.value)) })}
        />
        <span className="field-hint">Between 1,000 and 600,000 ms.</span>
      </div>

      <div className="form-group checkbox-group">
        <label>
          <input
            type="checkbox"
            checked={preferences.autoRefreshSessions}
            onChange={(e) => update({ autoRefreshSessions: e.target.checked })}
          />
          Auto-refresh session list while connected
        </label>
        <label>
          <input
            type="checkbox"
            checked={preferences.openSessionAfterLaunch}
            onChange={(e) => update({ openSessionAfterLaunch: e.target.checked })}
          />
          Open session view immediately after launching a task
        </label>
      </div>
    </section>
  );
}

export function SettingsPage({ settings, onChange }: SettingsPageProps) {
  const [savedNotice, setSavedNotice] = useState(false);

  const persist = (next: Settings) => {
    onChange(next);
    if (saveSettings(next)) {
      setSavedNotice(true);
      window.setTimeout(() => setSavedNotice(false), 2000);
    }
  };

  const handleReset = () => {
    const next = resetSettings();
    onChange(next);
    saveSettings(next);
  };

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>Settings</h1>
        {savedNotice && <span className="settings-saved-notice">Saved ✓</span>}
        <button className="btn btn-danger settings-reset" onClick={handleReset}>
          Reset All Settings
        </button>
      </div>

      <ConnectionSection
        config={settings.caoConfig}
        onConfigChange={(caoConfig) => persist({ ...settings, caoConfig })}
      />
      <TeamsSection teams={settings.teams} onChange={(teams) => persist({ ...settings, teams })} />
      <PreferencesSection
        preferences={settings.preferences}
        onChange={(preferences) => persist({ ...settings, preferences })}
      />
    </div>
  );
}