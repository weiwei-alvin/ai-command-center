/**
 * CAO Adapter Layer
 * 
 * All CAO-specific integration goes through this adapter.
 * UI components consume internal application types, never raw CAO response schemas.
 * 
 * Based on CAO contract verification (Ticket 01):
 * - CAO version: 2.3.0
 * - Base URL: http://localhost:9889 (default)
 * - Event stream requires CAO_MCP_APPS_ENABLED=1 and CAO_AGUI_ENABLED=1
 * - WebSocket PTY: ws://localhost:9889/terminals/{id}/ws
 */

import type {
  ConnectionState,
  AgentStatus,
  SessionSummary,
  LaunchFormData,
  Team,
  TimelineEvent,
  CAOConfig,
  CAOHealth,
  CAOComponentHealth,
} from '../../types';

// Raw CAO response types (internal to adapter)
interface CAOSessionResponse {
  name: string;
  agent_profile: string;
  provider?: string;
  session_name?: string;
  working_directory?: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface CAOTerminalResponse {
  id: string;
  session_name: string;
  agent_profile: string;
  provider: string;
  status: string;
  created_at: string;
}

interface CAOEventResponse {
  id: string;
  kind: string;
  timestamp: string;
  detail: Record<string, unknown>;
  session_name?: string;
  terminal_id?: string;
}

interface CAOHealthResponse {
  status: string;
  service: string;
  terminal_backend: string;
  version?: string;
  components?: Record<string, string>;
}

interface CAOAgentProfile {
  name: string;
  description: string;
  provider: string;
}

interface CAOProvider {
  name: string;
  installed: boolean;
}

const DEFAULT_CAO_CONFIG: CAOConfig = {
  baseUrl: 'http://localhost:9889',
  wsUrl: 'ws://localhost:9889',
};

class CAOAdapter {
  private config: CAOConfig;
  private eventSource: EventSource | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 2000;

  constructor(config: Partial<CAOConfig> = {}) {
    this.config = { ...DEFAULT_CAO_CONFIG, ...config };
  }

  /**
   * Check CAO server health and return a normalized CAOHealth snapshot.
   */
  async checkHealth(): Promise<CAOHealth> {
    const startedAt = Date.now();
    try {
      const response = await fetch(`${this.config.baseUrl}/health`);
      const latencyMs = Date.now() - startedAt;
      if (!response.ok) {
        return this.unhealthySnapshot();
      }
      const data = await response.json() as CAOHealthResponse;
      const healthy = data.status === 'ok';
      return {
        healthy,
        status: healthy ? 'connected' : 'failed',
        version: data.version ?? null,
        service: data.service ?? null,
        terminalBackend: data.terminal_backend ?? null,
        components: this.mapComponents(data.components ?? {}),
        latencyMs,
        checkedAt: new Date().toISOString(),
      };
    } catch {
      return this.unhealthySnapshot();
    }
  }

  private unhealthySnapshot(): CAOHealth {
    return {
      healthy: false,
      status: 'disconnected',
      version: null,
      service: null,
      terminalBackend: null,
      components: [],
      latencyMs: null,
      checkedAt: new Date().toISOString(),
    };
  }

  private mapComponents(components: Record<string, string>): CAOComponentHealth[] {
    return Object.entries(components).map(([name, status]) => ({
      name,
      status: this.mapCAOStatus(status),
      raw: status,
    }));
  }

  /**
   * List all sessions
   */
  async listSessions(): Promise<SessionSummary[]> {
    try {
      const response = await fetch(`${this.config.baseUrl}/sessions`);
      if (!response.ok) {
        throw new Error(`Failed to list sessions: ${response.status}`);
      }
      const sessions = await response.json() as CAOSessionResponse[];
      
      // For each session, fetch terminals to get agent info
      const sessionSummaries = await Promise.all(
        sessions.map(async (session) => {
          const terminals = await this.getSessionTerminals(session.name);
          return this.mapSessionToSummary(session, terminals);
        })
      );
      
      return sessionSummaries;
    } catch (error) {
      console.error('Failed to list sessions:', error);
      return [];
    }
  }

  /**
   * Get a single session by name
   */
  async getSession(sessionName: string): Promise<SessionSummary | null> {
    try {
      const response = await fetch(`${this.config.baseUrl}/sessions/${sessionName}`);
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`Failed to get session: ${response.status}`);
      }
      const session = await response.json() as CAOSessionResponse;
      const terminals = await this.getSessionTerminals(session.name);
      return this.mapSessionToSummary(session, terminals);
    } catch (error) {
      console.error('Failed to get session:', error);
      return null;
    }
  }

  /**
   * Get terminals for a session
   */
  async getSessionTerminals(sessionName: string): Promise<CAOTerminalResponse[]> {
    try {
      const response = await fetch(`${this.config.baseUrl}/sessions/${sessionName}/terminals`);
      if (!response.ok) {
        return [];
      }
      return await response.json() as CAOTerminalResponse[];
    } catch {
      return [];
    }
  }

  /**
   * Create a new session (launch task)
   */
  async createSession(data: LaunchFormData, team: Team): Promise<{ success: boolean; sessionName?: string; error?: string }> {
    try {
      const sessionName = data.task
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .substring(0, 50) + `-${Date.now().toString(36)}`;

      const params = new URLSearchParams({
        agent_profile: team.supervisorProfile,
        session_name: sessionName,
        working_directory: data.projectFolder,
      });

      const response = await fetch(`${this.config.baseUrl}/sessions?${params.toString()}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          env_vars: {
            TASK: data.task,
            TEAM: team.name,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Failed to create session: ${response.status}`);
      }

      const result = await response.json() as { name: string };
      return { success: true, sessionName: result.name };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Stop a session
   */
  async stopSession(sessionName: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/sessions/${sessionName}`, {
        method: 'DELETE',
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Send a message to an agent (via terminal inbox)
   */
  async sendMessage(receiverId: string, senderId: string, message: string): Promise<boolean> {
    try {
      const params = new URLSearchParams({
        sender_id: senderId,
        message,
      });
      const response = await fetch(
        `${this.config.baseUrl}/terminals/${receiverId}/inbox/messages?${params.toString()}`,
        { method: 'POST' }
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get agent profiles
   */
  async getAgentProfiles(): Promise<CAOAgentProfile[]> {
    try {
      const response = await fetch(`${this.config.baseUrl}/agents/profiles`);
      if (!response.ok) return [];
      return await response.json() as CAOAgentProfile[];
    } catch {
      return [];
    }
  }

  /**
   * Get providers
   */
  async getProviders(): Promise<CAOProvider[]> {
    try {
      const response = await fetch(`${this.config.baseUrl}/agents/providers`);
      if (!response.ok) return [];
      return await response.json() as CAOProvider[];
    } catch {
      return [];
    }
  }

  /**
   * Start listening to event stream (SSE)
   */
  startEventStream(onEvent: (event: TimelineEvent) => void, onError?: (error: Error) => void): void {
    if (this.eventSource) {
      this.eventSource.close();
    }

    // Use AG-UI stream as specified in contract
    this.eventSource = new EventSource(`${this.config.baseUrl}/agui/v1/stream`);

    this.eventSource.onopen = () => {
      this.reconnectAttempts = 0;
    };

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const timelineEvent = this.mapCAOEventToTimeline(data);
        if (timelineEvent) {
          onEvent(timelineEvent);
        }
      } catch (e) {
        console.warn('Failed to parse event:', e);
      }
    };

    this.eventSource.onerror = (error) => {
      console.error('Event stream error:', error);
      this.handleReconnect(onEvent, onError);
    };
  }

  /**
   * Stop event stream
   */
  stopEventStream(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  /**
   * Get WebSocket URL for terminal PTY
   */
  getTerminalWSUrl(terminalId: string): string {
    return `${this.config.wsUrl}/terminals/${terminalId}/ws`;
  }

  /**
   * Map CAO session + terminals to internal SessionSummary
   */
  private mapSessionToSummary(session: CAOSessionResponse, terminals: CAOTerminalResponse[]): SessionSummary {
    const agents: AgentStatus[] = terminals.map((term) => ({
      id: term.id,
      name: term.agent_profile,
      role: this.inferRole(term.agent_profile),
      provider: term.provider,
      status: this.mapCAOStatus(term.status),
      recentActivity: `Created at ${term.created_at}`,
    }));

    // If no terminals yet but session exists, supervisor is starting
    if (agents.length === 0) {
      agents.push({
        id: 'supervisor-pending',
        name: session.agent_profile,
        role: 'Supervisor',
        provider: session.provider || 'unknown',
        status: 'running',
        recentActivity: 'Supervisor starting...',
      });
    }

    return {
      id: session.name,
      name: session.session_name || session.name,
      projectFolder: session.working_directory || '',
      team: '', // Will be filled by UI
      task: '', // Will be filled by UI
      state: this.mapCAOStatus(session.status),
      agents,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
    };
  }

  /**
   * Map CAO event to internal TimelineEvent
   */
  private mapCAOEventToTimeline(caoEvent: CAOEventResponse): TimelineEvent | null {
    const kindMap: Record<string, TimelineEvent['type']> = {
      launch: 'session_start',
      handoff: 'handoff',
      a2a_delegation: 'assignment',
      completion: 'completion',
      error: 'error',
      file_mod: 'message_metadata',
      other: 'message_metadata',
    };

    const type = kindMap[caoEvent.kind];
    if (!type) return null;

    return {
      id: caoEvent.id,
      timestamp: caoEvent.timestamp,
      type,
      agentId: caoEvent.terminal_id,
      sessionName: caoEvent.session_name,
      metadata: caoEvent.detail,
    };
  }

  /**
   * Map CAO status to internal ConnectionState
   */
  private mapCAOStatus(status: string): ConnectionState {
    const statusMap: Record<string, ConnectionState> = {
      running: 'running',
      idle: 'idle',
      waiting: 'waiting',
      completed: 'completed',
      failed: 'failed',
      unknown: 'unknown',
      starting: 'running',
      stopped: 'completed',
    };
    return statusMap[status.toLowerCase()] || 'unknown';
  }

  /**
   * Infer role from agent profile name
   */
  private inferRole(profile: string): string {
    const lower = profile.toLowerCase();
    if (lower.includes('supervisor') || lower.includes('orchestrator')) return 'Supervisor';
    if (lower.includes('reviewer')) return 'Reviewer';
    if (lower.includes('builder') || lower.includes('developer')) return 'Builder';
    return 'Worker';
  }

  /**
   * Handle reconnection with exponential backoff
   */
  private handleReconnect(
    onEvent: (event: TimelineEvent) => void,
    onError?: (error: Error) => void
  ): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      onError?.(new Error('Max reconnection attempts reached'));
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    setTimeout(() => {
      this.startEventStream(onEvent, onError);
    }, delay);
  }
}

// Singleton instance
let adapterInstance: CAOAdapter | null = null;

export function getCAOAdapter(config?: Partial<CAOConfig>): CAOAdapter {
  if (!adapterInstance) {
    adapterInstance = new CAOAdapter(config);
  }
  return adapterInstance;
}

export function resetCAOAdapter(): void {
  if (adapterInstance) {
    adapterInstance.stopEventStream();
    adapterInstance = null;
  }
}

export { CAOAdapter };
