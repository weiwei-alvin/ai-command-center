import { useState, useEffect, useCallback } from 'react';
import { SessionView } from './components/SessionView';
import { Dashboard } from './components/Dashboard';
import { ConnectionIndicator } from './components/ConnectionIndicator';
import { getCAOAdapter, resetCAOAdapter } from './lib/cao/adapter';
import type { SessionSummary, Team, ConnectionState, CAOHealth } from './types';
import './App.css';

const DEFAULT_TEAM: Team = {
  id: 'default',
  name: 'Default Team',
  description: 'Supervisor + Builder + Reviewer',
  supervisorProfile: 'code_supervisor',
  workerProfiles: ['developer', 'reviewer'],
};

const INITIAL_HEALTH: CAOHealth = {
  healthy: false,
  status: 'connecting',
  version: null,
  service: null,
  terminalBackend: null,
  components: [],
  latencyMs: null,
  checkedAt: new Date().toISOString(),
};

function App() {
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [caoHealth, setCAOHealth] = useState<CAOHealth>(INITIAL_HEALTH);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSession, setActiveSession] = useState<SessionSummary | null>(null);
  const [view, setView] = useState<'dashboard' | 'session'>('dashboard');
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const adapter = getCAOAdapter();

  // Check CAO connection on mount and periodically
  useEffect(() => {
    const checkConnection = async () => {
      const health = await adapter.checkHealth();
      setCAOHealth(health);
      setConnectionState(health.healthy ? 'connected' : 'disconnected');
      if (health.healthy) {
        loadSessions();
      }
    };

    checkConnection();
    const interval = setInterval(checkConnection, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleCAOHealthChange = useCallback((health: CAOHealth) => {
    setCAOHealth(health);
    setConnectionState(health.healthy ? 'connected' : 'disconnected');
  }, []);

  const loadSessions = useCallback(async () => {
    const sessionList = await adapter.listSessions();
    setSessions(sessionList);
  }, []);

  const handleLaunch = async (formData: { projectFolder: string; team: string; task: string }) => {
    setLaunching(true);
    setLaunchError(null);

    const result = await adapter.createSession(formData, DEFAULT_TEAM);
    
    if (result.success && result.sessionName) {
      // Wait a bit for session to be created, then load it
      setTimeout(async () => {
        const session = await adapter.getSession(result.sessionName!);
        if (session) {
          session.team = DEFAULT_TEAM.name;
          session.task = formData.task;
          setActiveSession(session);
          setView('session');
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
        <h1>AI Command Center</h1>
        <ConnectionIndicator
          state={connectionState}
          version={caoHealth.version}
          latencyMs={caoHealth.latencyMs}
        />
      </header>

      <main className="app-main">
        {view === 'dashboard' ? (
          <Dashboard
            sessions={sessions}
            onSessionSelect={handleSessionSelect}
            caoHealth={caoHealth}
            onCAOHealthChange={handleCAOHealthChange}
            launchFormProps={{
              onLaunch: handleLaunch,
              launching,
              error: launchError,
            }}
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
