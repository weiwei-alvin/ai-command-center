import { useState, useEffect, useCallback, useRef } from 'react';
import { SessionView } from './components/SessionView';
import { Dashboard } from './components/Dashboard';
import { SettingsPage } from './components/SettingsPage';
import { ConnectionIndicator } from './components/ConnectionIndicator';
import { getCAOAdapter, resetCAOAdapter } from './lib/cao/adapter';
import { loadSettings } from './lib/settings';
import type { SessionSummary, Team, ConnectionState, Settings } from './types';
import './App.css';

function App() {
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSession, setActiveSession] = useState<SessionSummary | null>(null);
  const [view, setView] = useState<'dashboard' | 'session' | 'settings'>('dashboard');
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(() => loadSettings());

  // Adapter is created lazily; re-created only when CAO config changes.
  const adapter = getCAOAdapter(settings.caoConfig);
  const configKey = `${settings.caoConfig.baseUrl}|${settings.caoConfig.wsUrl}`;
  const lastConfigKey = useRef(configKey);

  // Reconnect adapter when CAO connection config changes.
  useEffect(() => {
    if (lastConfigKey.current !== configKey) {
      lastConfigKey.current = configKey;
      resetCAOAdapter();
    }
  }, [configKey]);

  // Check CAO connection on mount and periodically (interval from preferences).
  useEffect(() => {
    const checkConnection = async () => {
      const { healthy } = await adapter.checkHealth();
      setConnectionState(healthy ? 'connected' : 'disconnected');
      if (healthy && settings.preferences.autoRefreshSessions) {
        loadSessions();
      }
    };

    checkConnection();
    const interval = setInterval(checkConnection, settings.preferences.pollIntervalMs);
    return () => clearInterval(interval);
  }, [adapter, settings.preferences.pollIntervalMs, settings.preferences.autoRefreshSessions]);

  const loadSessions = useCallback(async () => {
    const sessionList = await adapter.listSessions();
    setSessions(sessionList);
  }, [adapter]);

  const selectedTeam: Team =
    settings.teams[0] ?? {
      id: 'default',
      name: 'Default Team',
      description: 'Supervisor + Builder + Reviewer',
      supervisorProfile: 'code_supervisor',
      workerProfiles: ['developer', 'reviewer'],
    };

  const handleLaunch = async (formData: { projectFolder: string; team: string; task: string }) => {
    setLaunching(true);
    setLaunchError(null);

    const teamByName = settings.teams.find((t) => t.name === formData.team);
    const team = teamByName ?? selectedTeam;

    const result = await adapter.createSession(formData, team);

    if (result.success && result.sessionName) {
      // Wait a bit for session to be created, then load it
      setTimeout(async () => {
        const session = await adapter.getSession(result.sessionName!);
        if (session) {
          session.team = team.name;
          session.task = formData.task;
          if (settings.preferences.openSessionAfterLaunch) {
            setActiveSession(session);
            setView('session');
          }
        }
        loadSessions();
        setLaunching(false);
      }, 2000);
    } else {
      setLaunchError(result.error || 'Failed to launch session');
      setLaunching(false);
    }
  };

  const handleSessionSelect = (session: SessionSummary) => {
    setActiveSession(session);
    setView('session');
  };

  const handleBackToDashboard = () => {
    setActiveSession(null);
    setView('dashboard');
  };

  const handleStopSession = async (sessionName: string) => {
    const success = await adapter.stopSession(sessionName);
    if (success) {
      loadSessions();
      if (activeSession?.id === sessionName) {
        setActiveSession(null);
        setView('dashboard');
      }
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      resetCAOAdapter();
    };
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-left">
          <h1>AI Command Center</h1>
          {view !== 'dashboard' && (
            <button className="back-btn" onClick={handleBackToDashboard}>
              ← Dashboard
            </button>
          )}
        </div>
        <div className="app-header-right">
          <button
            className="btn btn-secondary header-nav-btn"
            onClick={() => setView(view === 'settings' ? 'dashboard' : 'settings')}
          >
            ⚙ Settings
          </button>
          <ConnectionIndicator state={connectionState} />
        </div>
      </header>

      <main className="app-main">
        {view === 'dashboard' ? (
          <Dashboard
            sessions={sessions}
            onSessionSelect={handleSessionSelect}
            launchFormProps={{
              onLaunch: handleLaunch,
              launching,
              error: launchError,
            }}
          />
        ) : view === 'settings' ? (
          <SettingsPage
            settings={settings}
            onChange={(next) => setSettings(next)}
          />
        ) : (
          <SessionView
            session={activeSession!}
            onBack={handleBackToDashboard}
            onStop={() => activeSession && handleStopSession(activeSession.id)}
            adapter={adapter}
          />
        )}
      </main>
    </div>
  );
}

export default App;