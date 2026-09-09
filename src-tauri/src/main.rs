#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::sync::Mutex;

use serde::Serialize;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};
use tauri_plugin_shell::process::{Command as ShellCommand, CommandChild};

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
    child: Mutex<Option<CommandChild>>,
}

impl CAOProcess {
    fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }
}

fn cao_executable() -> Option<String> {
    // Allow overriding via CAO_BIN; otherwise rely on `cao` being on PATH.
    std::env::var("CAO_BIN")
        .ok()
        .or_else(|| Some("cao".to_string()))
}

#[tauri::command]
async fn cao_start(state: tauri::State<'_, CAOProcess>) -> Result<CAOProcessResult, String> {
    {
        let guard = state.child.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Ok(CAOProcessResult {
                success: true,
                action: "start".to_string(),
                message: "CAO is already running".to_string(),
            });
        }
    }

    let bin = cao_executable().ok_or_else(|| "CAO executable not configured".to_string())?;

    let child = ShellCommand::new(&bin)
        .args(["serve", "--port", "9889"])
        .spawn()
        .map_err(|e| format!("Failed to start CAO: {}", e))?;

    let mut guard = state.child.lock().map_err(|e| e.to_string())?;
    *guard = Some(child);

    Ok(CAOProcessResult {
        success: true,
        action: "start".to_string(),
        message: format!("CAO started ({})", bin),
    })
}

#[tauri::command]
async fn cao_status(state: tauri::State<'_, CAOProcess>) -> Result<CAOProcessStatus, String> {
    let guard = state.child.lock().map_err(|e| e.to_string())?;
    Ok(CAOProcessStatus {
        managed: guard.is_some(),
    })
}

#[tauri::command]
async fn cao_stop(state: tauri::State<'_, CAOProcess>) -> Result<CAOProcessResult, String> {
    let child = {
        let mut guard = state.child.lock().map_err(|e| e.to_string())?;
        guard.take()
    };

    match child {
        Some(child) => {
            let _ = child.kill();
            Ok(CAOProcessResult {
                success: true,
                action: "stop".to_string(),
                message: "CAO stopped".to_string(),
            })
        }
        None => Ok(CAOProcessResult {
            success: true,
            action: "stop".to_string(),
            message: "CAO was not started by this app".to_string(),
        }),
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(CAOProcess::new())
        .invoke_handler(tauri::generate_handler![greet, cao_start, cao_stop, cao_status])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
