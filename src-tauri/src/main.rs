#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{Manager, RunEvent};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Result payload for CAO process lifecycle commands.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CAOProcessResult {
    success: bool,
    action: String,
    message: String,
}

/// Status of the CAO process from the app's perspective.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CAOProcessStatus {
    /// Whether this app spawned and is tracking the CAO process.
    managed: bool,
}

/// Shared handle to the running CAO process, if any.
struct CAOProcess {
    child: Mutex<Option<Child>>,
}

impl CAOProcess {
    fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }

    /// Kill the managed child, if any. Returns a description of what happened.
    fn kill_managed(&self) -> Result<bool, String> {
        let child = self
            .child
            .lock()
            .map_err(|e| format!("Lock poisoned: {}", e))?
            .take();
        match child {
            Some(mut child) => {
                child
                    .kill()
                    .map_err(|e| format!("Failed to stop CAO process: {}", e))?;
                // Reap the child so we don't leave a zombie entry.
                let _ = child.wait();
                Ok(true)
            }
            None => Ok(false),
        }
    }
}

/// CAO server port. Keep in sync with DEFAULT_CAO_CONFIG in
/// src/lib/cao/adapter.ts (and its VITE_CAO_PORT override) — both use
/// the CAO_PORT env var with 9889 as the shared default, so the spawned
/// server and the frontend health probe stay synchronized.
fn cao_port() -> String {
    std::env::var("CAO_PORT")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "9889".to_string())
}

/// Resolve the CAO executable to spawn.
///
/// The binary is expected to be the CAO CLI on PATH, or an explicit path
/// provided via the `CAO_BIN` environment variable (e.g. `C:\bin\cao.exe`).
/// The path is passed directly to the OS process spawner — no shell is
/// involved, so shell metacharacters cannot be injected. Operators are
/// responsible for ensuring `CAO_BIN` points at a trusted build of CAO.
fn cao_executable() -> String {
    std::env::var("CAO_BIN")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "cao".to_string())
}

/// Background thread that watches the managed child. When the process exits
/// on its own (crash, external kill), the slot is cleared so the app can
/// start/manage CAO again instead of holding a stale handle forever.
///
/// Intentionally one-shot per spawn: each successful `cao_start` spawns a
/// fresh watcher thread tied to that child. The thread exits as soon as the
/// slot is cleared (either by the watcher itself, by `cao_stop`, or on app
/// exit), so there are never more watcher threads than live spawns.
fn watch_child(process: Arc<CAOProcess>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(1000));
        let Ok(mut guard) = process.child.lock() else {
            break;
        };
        match guard.as_mut() {
            None => break, // slot already empty; nothing to watch
            Some(child) => match child.try_wait() {
                Ok(Some(_)) => {
                    // Process exited; clear the stale handle.
                    *guard = None;
                    break;
                }
                Ok(None) => { /* still running */ }
                Err(_) => {
                    // Cannot query the process; treat it as gone.
                    *guard = None;
                    break;
                }
            },
        }
    });
}

#[tauri::command]
async fn cao_start(
    state: tauri::State<'_, Arc<CAOProcess>>,
) -> Result<CAOProcessResult, String> {
    {
        let guard = state.child.lock().map_err(|e| e.to_string())?;
        if let Some(child) = guard.as_mut() {
            // Verify the tracked child is still alive so a crashed process
            // does not masquerade as "already running".
            match child.try_wait() {
                Ok(None) => {
                    return Ok(CAOProcessResult {
                        success: true,
                        action: "start".to_string(),
                        message: "CAO is already running".to_string(),
                    });
                }
                _ => {
                    // Exited or unknown state: clear the stale handle.
                    *guard = None;
                }
            }
        }
    }

    let bin = cao_executable();

    let child = Command::new(&bin)
        .args(["serve", "--port", &cao_port()])
        .spawn()
        .map_err(|e| format!("Failed to start CAO `{}`: {}", bin, e))?;

    let mut guard = state.child.lock().map_err(|e| e.to_string())?;
    *guard = Some(child);
    drop(guard);

    // Watch for unexpected exit so the handle is reaped automatically.
    watch_child(state.inner().clone());

    Ok(CAOProcessResult {
        success: true,
        action: "start".to_string(),
        message: format!("CAO started ({})", bin),
    })
}

#[tauri::command]
async fn cao_stop(state: tauri::State<'_, Arc<CAOProcess>>) -> Result<CAOProcessResult, String> {
    match state.kill_managed()? {
        true => Ok(CAOProcessResult {
            success: true,
            action: "stop".to_string(),
            message: "CAO stopped".to_string(),
        }),
        false => Ok(CAOProcessResult {
            success: true,
            action: "stop".to_string(),
            message: "CAO was not started by this app".to_string(),
        }),
    }
}

#[tauri::command]
async fn cao_status(state: tauri::State<'_, Arc<CAOProcess>>) -> Result<CAOProcessStatus, String> {
    let guard = state.child.lock().map_err(|e| e.to_string())?;
    Ok(CAOProcessStatus {
        managed: guard.is_some(),
    })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(Arc::new(CAOProcess::new()))
        .invoke_handler(tauri::generate_handler![greet, cao_start, cao_stop, cao_status])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } = event {
                // Kill the CAO process we spawned so it is not orphaned when
                // the app closes. Externally-started CAO is left untouched.
                if let Some(process) = app.try_state::<Arc<CAOProcess>>() {
                    if let Err(e) = process.kill_managed() {
                        eprintln!("Failed to stop managed CAO on exit: {}", e);
                    }
                }
            }
        });
}