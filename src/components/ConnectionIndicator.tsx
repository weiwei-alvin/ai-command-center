import type { ConnectionState } from '../types';

interface ConnectionIndicatorProps {
  state: ConnectionState;
}

const stateLabels: Record<ConnectionState, string> = {
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

export function ConnectionIndicator({ state }: ConnectionIndicatorProps) {
  return (
    <div className="connection-indicator">
      <span className={`connection-dot ${state}`}></span>
      <span>{stateLabels[state]}</span>
    </div>
  );
}
