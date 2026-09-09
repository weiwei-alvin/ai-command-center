import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectionIndicator } from './ConnectionIndicator';
import { controlCAOProcess, isTauri } from '../lib/tauri/process';
import { getCAOAdapter } from '../lib/cao/adapter';
import type { CAOHealth, CAOProcessAction } from '../types';

interface CAOHealthPanelProps {
  health: CAOHealth;
  onHealthChange: (health: CAOHealth) => void;
  refreshIntervalMs?: number;
}

const DEFAULT_REFRESH_INTERVAL_MS = 10000;

/**
 * Dashboard panel showing CAO connection status, version, component health,
 * and process start/stop controls.
 */
export function CAOHealthPanel({
  health,
  onHealthChange,
  refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS,
}: CAOHealthPanelProps) {
  const [busyAction, setBusyAction] = useState<CAOProcessAction | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshHealth = useCallback(async () => {
    const adapter = getCAOAdapter();
    const snapshot = await adapter.checkHealth();
    if (mountedRef.current) {
      onHealthChange(snapshot);
    }
  }, [onHealthChange]);

  // Periodic health refresh while the panel is visible.
  useEffect(() => {
    const interval = setInterval(refreshHealth, refreshIntervalMs);
    return () => clearInterval(interval);
  }, [refreshHealth, refreshIntervalMs]);

  const handleAction = async (action: CAOProcessAction) => {
    setBusyAction(action);
    setActionMessage(null);
    setActionError(null);

    const result = await controlCAOProcess(action);
    if (!mountedRef.current) return;

    if (result.success) {
      setActionMessage(result.message);
    } else {
      setActionError(result.message);
    }

    // Re-check health shortly after the lifecycle action.
    setTimeout(() => {
      refreshHealth();
    }, action === 'start' ? 1500 : 500);

    setBusyAction(null);
  };

  const running = health.healthy;

  return (
    <div className="dashboard-section cao-health-panel">
      <div className="cao-health-header">
        <h2>CAO Health</h2>
        <ConnectionIndicator state={health.status} showVersion={false} />
      </div>

      <div className="cao-health-grid">
        <div className="cao-health-field">
          <span className="cao-health-label">Status</span>
          <span className="cao-health-value">{running ? 'Healthy' : 'Unreachable'}</span>
        </div>
        <div className="cao-health-field">
          <span className="cao-health-label">Version</span>
          <span className="cao-health-value">{health.version ?? '—'}</span>
        </div>
        <div className="cao-health-field">
          <span className="cao-health-label">Service</span>
          <span className="cao-health-value">{health.service ?? '—'}</span>
        </div>
        <div className="cao-health-field">
          <span className="cao-health-label">Terminal backend</span>
          <span className="cao-health-value">{health.terminalBackend ?? '—'}</span>
        </div>
        <div className="cao-health-field">
          <span className="cao-health-label">Latency</span>
          <span className="cao-health-value">
            {health.latencyMs !== null ? `${health.latencyMs} ms` : '—'}
          </span>
        </div>
      </div>

      {health.components.length > 0 && (
        <div className="cao-health-components">
          <span className="cao-health-label">Components</span>
          <div className="cao-component-list">
            {health.components.map((component) => (
              <div key={component.name} className="cao-component-item">
                <span className={`connection-dot ${component.status}`}></span>
                <span className="cao-component-name">{component.name}</span>
                <span className="cao-component-status">{component.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!running && health.components.length === 0 && (
        <p className="cao-health-hint">
          CAO is not reachable at the configured URL. Use the controls below to start it.
        </p>
      )}

      <div className="cao-health-actions">
        <button
          className="btn btn-primary"
          disabled={busyAction !== null || running}
          onClick={() => handleAction('start')}
        >
          {busyAction === 'start' ? 'Starting…' : 'Start CAO'}
        </button>
        <button
          className="btn btn-danger"
          disabled={busyAction !== null || !running}
          onClick={() => handleAction('stop')}
        >
          {busyAction === 'stop' ? 'Stopping…' : 'Stop CAO'}
        </button>
      </div>

      {actionMessage && <p className="cao-action-message">{actionMessage}</p>}
      {actionError && <p className="cao-action-error">{actionError}</p>}
      {!isTauri() && (
        <p className="cao-health-hint">
          Running in a browser preview — start/stop controls are only available in the desktop app.
        </p>
      )}
    </div>
  );
}