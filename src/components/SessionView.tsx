import { useState, useEffect, useRef } from 'react';
import type { SessionSummary, AgentStatus, TimelineEvent } from '../types';
import { CAOAdapter } from '../lib/cao/adapter';

interface SessionViewProps {
  session: SessionSummary;
  onBack: () => void;
  onStop: () => void;
  adapter: CAOAdapter;
}

const ROLE_COLORS: Record<string, string> = {
  Supervisor: '#0e639c',
  Builder: '#6a9955',
  Reviewer: '#dcdcaa',
  Worker: '#c586c0',
};

export function SessionView({ session, onBack, onStop, adapter }: SessionViewProps) {
  const [agents, setAgents] = useState<AgentStatus[]>(session.agents);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [showTerminal, setShowTerminal] = useState(false);
  const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(null);
  const [terminalOutput, setTerminalOutput] = useState<string>('');
  const [terminalInput, setTerminalInput] = useState('');
  const terminalRef = useRef<HTMLDivElement>(null);

  // Start event stream on mount
  useEffect(() => {
    const handleEvent = (event: TimelineEvent) => {
      setTimelineEvents((prev) => [event, ...prev].slice(0, 100));
      
      // Update agent status based on events
      if (event.agentId && event.type === 'agent_start') {
        setAgents((prev) => prev.map((a) => 
          a.id === event.agentId ? { ...a, status: 'running' as const, recentActivity: 'Started' } : a
        ));
      } else if (event.agentId && event.type === 'completion') {
        setAgents((prev) => prev.map((a) => 
          a.id === event.agentId ? { ...a, status: 'completed' as const, recentActivity: 'Completed' } : a
        ));
      } else if (event.agentId && event.type === 'error') {
        setAgents((prev) => prev.map((a) => 
          a.id === event.agentId ? { ...a, status: 'failed' as const, recentActivity: 'Error' } : a
        ));
      } else if (event.agentId && event.type === 'handoff') {
        setAgents((prev) => prev.map((a) => 
          a.id === event.agentId ? { ...a, recentActivity: 'Handoff received' } : a
        ));
      }
    };

    const handleError = (error: Error) => {
      console.error('Event stream error:', error);
    };

    adapter.startEventStream(handleEvent, handleError);

    return () => {
      adapter.stopEventStream();
    };
  }, [adapter]);

  // Poll session for updates
  useEffect(() => {
    const interval = setInterval(async () => {
      const updated = await adapter.getSession(session.id);
      if (updated) {
        setAgents(updated.agents);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [adapter, session.id]);

  const handleOpenTerminal = (agent: AgentStatus) => {
    setSelectedTerminalId(agent.id);
    setShowTerminal(true);
    setTerminalOutput(`[Terminal: ${agent.name} (${agent.role})]\nConnecting...\n`);
  };

  const handleCloseTerminal = () => {
    setShowTerminal(false);
    setSelectedTerminalId(null);
    setTerminalOutput('');
  };

  const handleSendTerminalInput = () => {
    if (!terminalInput.trim() || !selectedTerminalId) return;
    
    setTerminalOutput((prev) => prev + `\n$ ${terminalInput}\n`);
    setTerminalInput('');
  };

  const handleSendMessage = async (agent: AgentStatus) => {
    const message = prompt(`Send message to ${agent.name}:`);
    if (message) {
      const success = await adapter.sendMessage(agent.id, 'user', message);
      if (success) {
        setTimelineEvents((prev) => [{
          id: `msg-${Date.now()}`,
          timestamp: new Date().toISOString(),
          type: 'message_metadata',
          agentId: agent.id,
          agentName: agent.name,
          message,
        }, ...prev]);
      } else {
        alert('Failed to send message');
      }
    }
  };

  const formatTime = (timestamp: string): string => {
    try {
      return new Date(timestamp).toLocaleTimeString();
    } catch {
      return timestamp;
    }
  };

  const getEventLabel = (type: TimelineEvent['type']): string => {
    const labels: Record<TimelineEvent['type'], string> = {
      session_start: 'Session Start',
      agent_start: 'Agent Start',
      handoff: 'Handoff',
      assignment: 'Assignment',
      message_metadata: 'Message',
      completion: 'Completion',
      error: 'Error',
    };
    return labels[type];
  };

  return (
    <div className="session-view">
      <header className="session-header">
        <div className="session-header-left">
          <button className="back-btn" onClick={onBack}>
            ← Back
          </button>
          <div className="session-title">
            <h2>{session.name}</h2>
            <div className="session-meta">
              <span>{session.projectFolder}</span>
              <span>Team: {session.team}</span>
              <span>Task: {session.task}</span>
            </div>
          </div>
        </div>
        <div className="session-header-right">
          <span className={`connection-dot ${session.state}`}></span>
          <span style={{ fontSize: '0.875rem', color: '#cccccc' }}>
            {session.state}
          </span>
          <button className="btn btn-danger" onClick={onStop}>
            Stop Session
          </button>
        </div>
      </header>

      <div className="session-content">
        <section className="agent-workspace">
          <div className="agent-list">
            {agents.map((agent) => (
              <div key={agent.id} className="agent-card">
                <div
                  className={`agent-avatar ${agent.role.toLowerCase()}`}
                  style={{ backgroundColor: ROLE_COLORS[agent.role] || ROLE_COLORS.Worker }}
                >
                  {agent.role.charAt(0)}
                </div>
                <div className="agent-info">
                  <div className="agent-name-row">
                    <span className="agent-name">{agent.name}</span>
                    <span className="agent-role">{agent.role}</span>
                  </div>
                  <div className="agent-provider">Provider: {agent.provider}</div>
                  <div className="agent-status-row">
                    <div className="agent-status">
                      <span className={`connection-dot ${agent.status}`}></span>
                      <span>{agent.status}</span>
                    </div>
                    <span className="agent-activity">{agent.recentActivity}</span>
                  </div>
                </div>
                <div className="agent-actions">
                  <button
                    className="btn btn-secondary"
                    onClick={() => handleOpenTerminal(agent)}
                    disabled={showTerminal}
                  >
                    Terminal
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => handleSendMessage(agent)}
                  >
                    Message
                  </button>
                </div>
              </div>
            ))}
            {agents.length === 0 && (
              <div className="empty-state" style={{ padding: '40px' }}>
                <p>No agents yet. Supervisor is starting...</p>
              </div>
            )}
          </div>
        </section>

        <section className="activity-timeline">
          <h3>Activity Timeline</h3>
          <div className="timeline-events">
            {timelineEvents.length === 0 ? (
              <div className="empty-state" style={{ padding: '20px' }}>
                <p>No activity yet</p>
              </div>
            ) : (
              timelineEvents.map((event) => (
                <div key={event.id} className="timeline-event">
                  <span className="timeline-time">{formatTime(event.timestamp)}</span>
                  <span className="timeline-type">{getEventLabel(event.type)}</span>
                  <span className="timeline-message">
                    {event.agentName ? `${event.agentName}: ` : ''}
                    {event.message || JSON.stringify(event.metadata || {})}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        {showTerminal && selectedTerminalId && (
          <div className="terminal-drawer">
            <div className="terminal-header">
              <h3>Terminal: {agents.find(a => a.id === selectedTerminalId)?.name || 'Unknown'}</h3>
              <button className="btn btn-secondary" onClick={handleCloseTerminal}>
                Close
              </button>
            </div>
            <div className="terminal-content" ref={terminalRef}>
              {terminalOutput}
            </div>
            <div className="terminal-input">
              <input
                type="text"
                value={terminalInput}
                onChange={(e) => setTerminalInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendTerminalInput()}
                placeholder="Type command..."
              />
              <button onClick={handleSendTerminalInput}>Send</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
