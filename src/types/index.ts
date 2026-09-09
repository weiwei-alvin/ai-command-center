/**
 * Internal application types for AI Command Center.
 * These types are consumed by React components.
 * They are decoupled from raw CAO response schemas.
 */

export type ConnectionState = 
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'idle'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'unknown';

export interface AgentStatus {
  id: string;
  name: string;
  role: string;
  provider: string;
  status: ConnectionState;
  recentActivity: string;
}

export interface SessionSummary {
  id: string;
  name: string;
  projectFolder: string;
  team: string;
  task: string;
  state: ConnectionState;
  agents: AgentStatus[];
  createdAt: string;
  updatedAt: string;
}

export interface LaunchFormData {
  projectFolder: string;
  team: string;
  task: string;
}

export interface Team {
  id: string;
  name: string;
  description: string;
  supervisorProfile: string;
  workerProfiles: string[];
}

export interface TimelineEvent {
  id: string;
  timestamp: string;
  type: 'session_start' | 'agent_start' | 'handoff' | 'assignment' | 'message_metadata' | 'completion' | 'error';
  agentId?: string;
  agentName?: string;
  role?: string;
  message?: string;
  sessionName?: string;
  metadata?: Record<string, unknown>;
}

export interface CAOConfig {
  baseUrl: string;
  wsUrl: string;
}

/**
 * Health of a single CAO backend component.
 */
export interface CAOComponentHealth {
  name: string;
  status: ConnectionState;
  raw?: string;
}

/**
 * Aggregated CAO server health snapshot.
 */
export interface CAOHealth {
  healthy: boolean;
  status: ConnectionState;
  version: string | null;
  service: string | null;
  terminalBackend: string | null;
  components: CAOComponentHealth[];
  latencyMs: number | null;
  checkedAt: string;
}

/**
 * CAO process lifecycle actions.
 */
export type CAOProcessAction = 'start' | 'stop';

export interface CAOProcessResult {
  success: boolean;
  action: CAOProcessAction;
  message: string;
}
