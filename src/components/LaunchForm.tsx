import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { LaunchFormData, Team } from '../types';

interface LaunchFormProps {
  onLaunch: (data: LaunchFormData) => void;
  launching: boolean;
  error: string | null;
  teams: Team[];
}

export function LaunchForm({ onLaunch, launching, error, teams }: LaunchFormProps) {
  const [projectFolder, setProjectFolder] = useState('');
  const [task, setTask] = useState('');
  const [selectedTeam, setSelectedTeam] = useState<string>('');
  const effectiveTeamId = teams.some((t) => t.id === selectedTeam)
    ? selectedTeam
    : (teams[0]?.id ?? 'default');
  const effectiveTeamName =
    teams.find((t) => t.id === effectiveTeamId)?.name ?? 'default';

  const handleFolderPick = useCallback(async () => {
    try {
      const selected = await invoke<string>('dialog_open', {
        options: {
          title: 'Select Project Folder',
          directory: true,
          multiple: false,
        },
      });
      if (selected) {
        setProjectFolder(selected);
      }
    } catch (err) {
      console.error('Folder pick failed:', err);
    }
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!projectFolder.trim() || !task.trim()) return;

    onLaunch({
      projectFolder: projectFolder.trim(),
      team: effectiveTeamName,
      task: task.trim(),
    });
  }, [projectFolder, task, effectiveTeamName, onLaunch]);

  return (
    <form className="launch-form" onSubmit={handleSubmit}>
      <div className="form-group">
        <label htmlFor="projectFolder">Project Folder</label>
        <div className="folder-picker">
          <input
            id="projectFolder"
            type="text"
            value={projectFolder}
            onChange={(e) => setProjectFolder(e.target.value)}
            placeholder="Select or enter project folder path"
            disabled={launching}
            readOnly
          />
          <button
            type="button"
            onClick={handleFolderPick}
            disabled={launching}
            aria-label="Browse for folder"
          >
            Browse…
          </button>
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="team">Team</label>
        <select
          id="team"
          value={effectiveTeamId}
          onChange={(e) => setSelectedTeam(e.target.value)}
          disabled={launching}
        >
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
              {team.description ? ` (${team.description})` : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label htmlFor="task">Task</label>
        <textarea
          id="task"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="Describe the task for the Supervisor…"
          disabled={launching}
          rows={4}
        />
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="launch-actions">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={launching || !projectFolder.trim() || !task.trim()}
        >
          {launching ? 'Launching…' : 'Launch'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setProjectFolder('');
            setTask('');
          }}
          disabled={launching}
        >
          Clear
        </button>
      </div>
    </form>
  );
}
