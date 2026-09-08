import { useState, useEffect, useCallback } from 'react';
import { SessionView } from './components/SessionView';
import { Dashboard } from './components/Dashboard';
import { ConnectionIndicator } from './components/ConnectionIndicator';
import { getCAOAdapter, resetCAOAdapter } from './lib/cao/adapter';
import type { SessionSummary, Team, ConnectionState } from './types';
import './App.css';

const DEFAULT_TEAM: Team = {
  id: 'default',
  name: 'Default Team',
  description: 'Supervisor + Builder + Reviewer',
  supervisorProfile: 'code_supervisor',
  workerProfiles: ['developer', 'reviewer'],
};

function App() {
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSession, setActiveSession] = useState<SessionSummary | null>(null);
  const [view, setView] = useState<'dashboard' | 'session'>('dashboard');
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const adapter = getCAOAdapter();

  // Check CAO connection on mount and periodically
  useEffect(() => {
    const checkConnection = async () => {
      const { healthy } = await adapter.checkHealth();
      setConnectionState(healthy ? 'connected' : 'disconnected');
      if (healthy) {
        loadSessions();
      }
    };

    checkConnection();
    const interval = setInterval(checkConnection, 10000);
    return () => clearInterval(interval);
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
        <ConnectionIndicator state={connectionState} />
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
