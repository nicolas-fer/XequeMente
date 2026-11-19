//! Perfil do jogador: histórico de partidas, memória do treinador e análises.
//! O formato é definido pelo front (JSON livre); aqui só lemos e gravamos com segurança.

use serde_json::Value;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn profile_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Pasta de dados indisponível: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("profile.json"))
}

#[tauri::command]
pub fn profile_get(app: AppHandle) -> Result<Value, String> {
    let path = profile_file(&app)?;
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("profile.json corrompido: {e}")),
        Err(_) => Ok(Value::Object(Default::default())),
    }
}

/// Grava o perfil inteiro de forma atômica (arquivo temporário + rename),
/// mantendo uma cópia do anterior em profile.bak.json.
#[tauri::command]
pub fn profile_put(app: AppHandle, data: Value) -> Result<(), String> {
    let path = profile_file(&app)?;
    let tmp = path.with_extension("tmp");
    let text = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, text).map_err(|e| format!("Falha ao salvar o perfil: {e}"))?;
    if path.exists() {
        let _ = std::fs::copy(&path, path.with_extension("bak.json"));
    }
    std::fs::rename(&tmp, &path).map_err(|e| format!("Falha ao salvar o perfil: {e}"))
}
