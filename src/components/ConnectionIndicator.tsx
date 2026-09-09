import type { ConnectionState } from '../types';

interface ConnectionIndicatorProps {
  state: ConnectionState;
  /** Optional CAO version to display next to the status (e.g. in the header). */
  version?: string | null;
  /** Optional latency in milliseconds to display next to the status. */
  latencyMs?: number | null;
  /**
   * Whether to render the version/latency detail fragments.
   * Defaults to true. Set to false for compact usages (e.g. panel headers)
   * that only want the dot and label.
   */
  showDetails?: boolean;
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

export function ConnectionIndicator({
  state,
  version = null,
  latencyMs = null,
  showDetails = true,
}: ConnectionIndicatorProps) {
  const details: string[] = [];
  if (showDetails && version) {
    details.push(`v${version.replace(/^v/, '')}`);
  }
  if (showDetails && latencyMs !== null && latencyMs >= 0) {
    details.push(`${latencyMs} ms`);
  }

  return (
    <div
      className="connection-indicator"
      role="status"
      aria-label={`Connection status: ${stateLabels[state]}`}
    >
      <span className={`connection-dot ${state}`}></span>
      <span>{stateLabels[state]}</span>
      {details.length > 0 && (
        <span className="connection-details">{details.join(' · ')}</span>
      )}
    </div>
  );
}