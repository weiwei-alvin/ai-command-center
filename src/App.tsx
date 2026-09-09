import { useState, useEffect, useCallback, useRef } from 'react';
import { SessionView } from './components/SessionView';
import { Dashboard } from './components/Dashboard';
import { ConnectionIndicator } from './components/ConnectionIndicator';
import { getCAOAdapter, resetCAOAdapter } from './lib/cao/adapter';
import {
  listSessionMetadata,
  saveSessionMetadata,
  deleteSessionMetadata,
} from './lib/sessionStore';
import type { SessionSummary, Team, ConnectionState, StoredSessionMetadata } from './types';
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
  const [resuming, setResuming] = useState(false);
  // Metadata recovered from the persistent store (survives app restarts).
  const storedMetadata = useRef<Map<string, StoredSessionMetadata>>(new Map());
  // History entries not currently visible in the live session list.
  const [recoveredHistory, setRecoveredHistory] = useState<StoredSessionMetadata[]>([]);

  const adapter = getCAOAdapter();

  // Load persisted session metadata on mount so history is available
  // even before the CAO connection is established.
  useEffect(() => {
    listSessionMetadata().then((items) => {
      const map = new Map(items.map((m) => [m.sessionId, m]));
      storedMetadata.current = map;
      setRecoveredHistory(items);
      // Enrich any already-loaded sessions with persisted team/task info.
      setSessions((prev) =>
        prev.map((s) => {
          const meta = map.get(s.id);
          return meta ? { ...s, team: meta.team, task: meta.task } : s;
        })
      );
    });
  }, []);

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
    // Enrich live sessions with persisted metadata (team/task survive restarts).
    const enriched = sessionList.map((session) => {
      const meta = storedMetadata.current.get(session.id);
      if (meta) {
        return {
          ...session,
          team: session.team || meta.team,
          task: session.task || meta.task,
          projectFolder: session.projectFolder || meta.projectFolder,
        };
      }
      return session;
    });
    setSessions(enriched);
  }, []);

  const handleLaunch = async (formData: { projectFolder: string; team: string; task: string }) => {
    setLaunching(true);
    setLaunchError(null);

    const result = await adapter.createSession(formData, DEFAULT_TEAM);
    
    if (result.success && result.sessionName) {
      // Persist metadata so this session can be recovered after a restart.
      const saved = await saveSessionMetadata({
        sessionId: result.sessionName,
        team: DEFAULT_TEAM.name,
        task: formData.task,
        projectFolder: formData.projectFolder,
      });
      if (saved) {
        const meta: StoredSessionMetadata = {
          sessionId: result.sessionName,
          team: DEFAULT_TEAM.name,
          task: formData.task,
          projectFolder: formData.projectFolder,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        storedMetadata.current.set(result.sessionName, meta);
        setRecoveredHistory((prev) => [meta, ...prev.filter((m) => m.sessionId !== meta.sessionId)]);
      }
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
      // Remove persisted metadata for stopped sessions.
      await deleteSessionMetadata(sessionName);
      storedMetadata.current.delete(sessionName);
      setRecoveredHistory((prev) => prev.filter((m) => m.sessionId !== sessionName));
      loadSessions();
      if (activeSession?.id === sessionName) {
        setActiveSession(null);
        setView('dashboard');
      }
    }
  };

  /**
   * Resume a session from the persisted history: re-attach to the CAO
   * session if it still exists, otherwise fall back to the stored
   * metadata view so the user keeps the context (team/task/folder).
   */
  const handleResumeSession = async (sessionId: string) => {
    setResuming(true);
    try {
      const live = await adapter.getSession(sessionId);
      const meta = storedMetadata.current.get(sessionId);
      if (live) {
        const resumed: SessionSummary = {
          ...live,
          team: meta?.team || live.team,
          task: meta?.task || live.task,
          projectFolder: meta?.projectFolder || live.projectFolder,
        };
        setActiveSession(resumed);
        setView('session');
      } else if (meta) {
        // CAO no longer has the session (e.g. server restarted):
        // show a placeholder so the user sees the recovered context.
        const placeholder: SessionSummary = {
          id: meta.sessionId,
          name: meta.sessionId,
          projectFolder: meta.projectFolder,
          team: meta.team,
          task: meta.task,
          state: 'disconnected',
          agents: [],
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
        };
        setActiveSession(placeholder);
        setView('session');
      }
    } finally {
      setResuming(false);
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
            sessionHistory={recoveredHistory}
            onResumeSession={handleResumeSession}
            resuming={resuming}
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
