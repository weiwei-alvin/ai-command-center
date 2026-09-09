import { LaunchForm } from './LaunchForm';
import type { SessionSummary, StoredSessionMetadata } from '../types';

interface DashboardProps {
  sessions: SessionSummary[];
  onSessionSelect: (session: SessionSummary) => void;
  sessionHistory: StoredSessionMetadata[];
  onResumeSession: (sessionId: string) => void;
  resuming: boolean;
  launchFormProps: {
    onLaunch: (data: { projectFolder: string; team: string; task: string }) => void;
    launching: boolean;
    error: string | null;
  };
}

function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleString();
  } catch {
    return dateString;
  }
}

function getStatusLabel(state: string): string {
  const labels: Record<string, string> = {
    connecting: 'Connecting…',
    connected: 'Connected',
    disconnected: 'Disconnected',
    idle: 'Idle',
    running: 'Running',
    waiting: 'Waiting',
    completed: 'Completed',
    failed: 'Failed',
    unknown: 'Unknown',
  };
  return labels[state] || state;
}

export function Dashboard({
  sessions,
  onSessionSelect,
  sessionHistory,
  onResumeSession,
  resuming,
  launchFormProps,
}: DashboardProps) {
  return (
    <div className="dashboard">
      <div className="dashboard-section">
        <h2>Launch Task</h2>
        <LaunchForm {...launchFormProps} />
      </div>

      <div className="dashboard-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2>Sessions</h2>
          <span style={{ fontSize: '0.875rem', color: '#808080' }}>
            {sessions.length} session{ sessions.length !== 1 ? 's' : '' }
          </span>
        </div>

        {sessions.length === 0 ? (
          <div className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            <p>No sessions yet. Launch a task to get started.</p>
          </div>
        ) : (
          <div className="session-list">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="session-item"
                onClick={() => onSessionSelect(session)}
              >
                <div className="session-info">
                  <div className="session-name">{session.name}</div>
                  <div className="session-meta">
                    <span>{session.projectFolder || 'No folder'}</span>
                    <span>{formatDate(session.createdAt)}</span>
                  </div>
                </div>
                <div className="session-status">
                  <span className={`connection-dot ${session.state}`}></span>
                  <span>{getStatusLabel(session.state)}</span>
                </div>
                <div className="session-actions">
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSessionSelect(session);
                    }}
                  >
                    Open
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {sessionHistory.length > 0 && (
          <div className="session-history" style={{ marginTop: '24px' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '8px' }}>Recovered Sessions</h3>
            <p style={{ fontSize: '0.8rem', color: '#808080', marginBottom: '8px' }}>
              Sessions restored from the local store. Resume to re-attach if the session is still running.
            </p>
            <div className="session-list">
              {sessionHistory.map((meta) => (
                <div key={meta.sessionId} className="session-item">
                  <div className="session-info">
                    <div className="session-name">{meta.task || meta.sessionId}</div>
                    <div className="session-meta">
                      <span>{meta.team || 'Unknown team'}</span>
                      <span>{meta.projectFolder || 'No folder'}</span>
                      <span>{formatDate(meta.updatedAt)}</span>
                    </div>
                  </div>
                  <div className="session-actions">
                    <button
                      className="btn btn-primary"
                      style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                      onClick={() => onResumeSession(meta.sessionId)}
                      disabled={resuming}
                    >
                      {resuming ? 'Resuming…' : 'Resume'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
