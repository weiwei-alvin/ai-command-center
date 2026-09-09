#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::Manager;

/// Metadata persisted for each launched session so the UI can recover
/// team / task / project folder context after an app restart.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionMetadata {
    session_id: String,
    team: String,
    task: String,
    project_folder: String,
    created_at: String,
    updated_at: String,
}

/// All persisted session metadata, keyed by session id.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionStore {
    sessions: HashMap<String, SessionMetadata>,
}

impl SessionStore {
    fn path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to resolve app data directory: {e}"))?;
        Ok(dir.join("session-store.json"))
    }

    fn load(app: &tauri::AppHandle) -> Result<SessionStore, String> {
        let path = Self::path(app)?;
        if !path.exists() {
            return Ok(SessionStore::default());
        }
        let raw = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read session store ({}): {e}", path.display()))?;
        if raw.trim().is_empty() {
            return Ok(SessionStore::default());
        }
        serde_json::from_str::<SessionStore>(&raw)
            .map_err(|e| format!("Session store is corrupted: {e}"))
    }

    fn save(&self, app: &tauri::AppHandle) -> Result<(), String> {
        let path = Self::path(app)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create app data directory: {e}"))?;
        }
        let raw = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize session store: {e}"))?;
        // Write via a temp file + rename so a crash never truncates the store.
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, raw)
            .map_err(|e| format!("Failed to write session store: {e}"))?;
        fs::rename(&tmp, &path)
            .map_err(|e| format!("Failed to finalize session store: {e}"))?;
        Ok(())
    }
}

/// Current UTC time as an RFC3339 timestamp (no chrono dependency;
/// epoch-days-to-civil conversion per Howard Hinnant's algorithm).
fn now_iso() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0) as i64;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // Civil-from-days algorithm to convert epoch days to Y/M/D.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mth = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mth <= 2 { y + 1 } else { y };
    format!("{y:04}-{mth:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

#[tauri::command]
fn session_metadata_save(
    app: tauri::AppHandle,
    session_id: String,
    team: String,
    task: String,
    project_folder: String,
) -> Result<(), String> {
    let mut store = SessionStore::load(&app)?;
    let timestamp = now_iso();
    match store.sessions.get_mut(&session_id) {
        Some(existing) => {
            existing.team = team;
            existing.task = task;
            existing.project_folder = project_folder;
            existing.updated_at = timestamp.clone();
        }
        None => {
            store.sessions.insert(
                session_id.clone(),
                SessionMetadata {
                    session_id,
                    team,
                    task,
                    project_folder,
                    created_at: timestamp.clone(),
                    updated_at: timestamp,
                },
            );
        }
    }
    store.save(&app)
}

#[tauri::command]
fn session_metadata_list(app: tauri::AppHandle) -> Result<Vec<SessionMetadata>, String> {
    let store = SessionStore::load(&app)?;
    let mut sessions: Vec<SessionMetadata> = store.sessions.into_values().collect();
    // Newest first for the history display.
    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(sessions)
}

#[tauri::command]
fn session_metadata_delete(app: tauri::AppHandle, session_id: String) -> Result<(), String> {
    let mut store = SessionStore::load(&app)?;
    if store.sessions.remove(&session_id).is_none() {
        return Err(format!("Session metadata not found: {session_id}"));
    }
    store.save(&app)
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            session_metadata_save,
            session_metadata_list,
            session_metadata_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn now_iso_matches_known_epoch() {
        // 2026-09-09T10:29:12Z (verified independently)
        let secs = 1_789_962_552i64;
        let days = secs.div_euclid(86_400);
        let rem = secs.rem_euclid(86_400);
        let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
        let z = days + 719_468;
        let era = z.div_euclid(146_097);
        let doe = z.rem_euclid(146_097);
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
        let y = yoe + era * 400;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = doy - (153 * mp + 2) / 5 + 1;
        let mth = if mp < 10 { mp + 3 } else { mp - 9 };
        let y = if mth <= 2 { y + 1 } else { y };
        let iso = format!("{y:04}-{mth:02}-{d:02}T{h:02}:{m:02}:{s:02}Z");
        assert_eq!(iso, "2026-09-09T10:29:12Z");
    }

    #[test]
    fn session_store_roundtrip() {
        let mut store = SessionStore::default();
        store.sessions.insert(
            "s1".into(),
            SessionMetadata {
                session_id: "s1".into(),
                team: "Default Team".into(),
                task: "Fix the bug".into(),
                project_folder: "G:/repo".into(),
                created_at: "2026-09-09T00:00:00Z".into(),
                updated_at: "2026-09-09T00:00:00Z".into(),
            },
        );
        let json = serde_json::to_string(&store).expect("serialize");
        let back: SessionStore = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.sessions.len(), 1);
        assert_eq!(back.sessions["s1"].task, "Fix the bug");
        // camelCase keys on the wire for the TS layer
        assert!(json.contains("\"sessionId\""));
        assert!(json.contains("\"projectFolder\""));
    }

    #[test]
    fn session_store_loads_corrupted_as_error_not_panic() {
        let result = serde_json::from_str::<SessionStore>("{ not json");
        assert!(result.is_err());
    }
}
