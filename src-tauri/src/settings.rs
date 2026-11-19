use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// "claude" ou "gemini"
    pub provider: String,
    pub claude_api_key: String,
    pub claude_model: String,
    pub gemini_api_key: String,
    pub gemini_model: String,
    pub engine_path: String,
    pub engine_threads: u32,
    pub engine_hash_mb: u32,
    pub review_depth: u32,
    /// "iniciante", "intermediario" ou "avancado"
    pub tutor_level: String,
    /// Quantidade de linhas (MultiPV) ao abrir a análise.
    pub default_multipv: u32,
    /// Limite da análise ao vivo: "infinite", "depth" ou "time".
    pub live_limit: String,
    pub live_depth: u32,
    pub live_seconds: u32,
    /// Revisão por "depth" (profundidade fixa) ou "time" (tempo por posição).
    pub review_mode: String,
    pub review_ms: u32,
    /// Pede ao motor as chances de vitória/empate/derrota (UCI_ShowWDL).
    pub show_wdl: bool,
    /// Valores de qualquer opção UCI anunciada pelo motor (nome -> valor).
    pub engine_options: BTreeMap<String, String>,
}

impl Default for Settings {
    fn default() -> Self {
        let cpus = std::thread::available_parallelism()
            .map(|n| n.get() as u32)
            .unwrap_or(2);
        Self {
            provider: "claude".into(),
            claude_api_key: String::new(),
            claude_model: "claude-opus-5-5".into(),
            gemini_api_key: String::new(),
            gemini_model: "gemini-flash-latest".into(),
            engine_path: String::new(),
            engine_threads: cpus.saturating_sub(1).max(1),
            engine_hash_mb: 256,
            review_depth: 16,
            tutor_level: "intermediario".into(),
            default_multipv: 3,
            live_limit: "infinite".into(),
            live_depth: 30,
            live_seconds: 10,
            review_mode: "depth".into(),
            review_ms: 500,
            show_wdl: true,
            engine_options: BTreeMap::new(),
        }
    }
}

pub struct SettingsState(pub Mutex<Settings>);

fn settings_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Pasta de configuração indisponível: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

/// O app se chamava "Xadrez Tutor" (identificador com.xadreztutor.app).
/// Na primeira execução com o nome novo, traz as configurações da pasta antiga.
fn migrate_from_old_name(app: &AppHandle) {
    let Ok(new_file) = settings_file(app) else { return };
    if new_file.exists() {
        return;
    }
    let Some(old_file) = new_file
        .parent()
        .and_then(|dir| dir.parent())
        .map(|base| base.join("com.xadreztutor.app").join("settings.json"))
    else {
        return;
    };
    if old_file.exists() {
        let _ = std::fs::copy(&old_file, &new_file);
    }
}

pub fn load(app: &AppHandle) -> Settings {
    migrate_from_old_name(app);
    settings_file(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn persist(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_file(app)?;
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| format!("Falha ao salvar configurações: {e}"))
}

#[tauri::command]
pub fn get_settings(state: State<'_, SettingsState>) -> Settings {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    state: State<'_, SettingsState>,
    settings: Settings,
) -> Result<(), String> {
    persist(&app, &settings)?;
    *state.0.lock().unwrap() = settings;
    Ok(())
}
