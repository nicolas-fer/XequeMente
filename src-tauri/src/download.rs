//! Baixa o Stockfish oficial (GitHub releases) para a pasta de dados do app.

use serde_json::Value;
use std::io::{Cursor, Read};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::settings::{self, SettingsState};

const RELEASES_URL: &str = "https://api.github.com/repos/official-stockfish/Stockfish/releases/latest";

fn preferred_assets() -> Vec<&'static str> {
    // A partir do Stockfish 19 há um build "universal" que escolhe as instruções da CPU sozinho.
    let mut names = vec!["stockfish-windows-x86-64-universal.zip"];
    #[cfg(target_arch = "x86_64")]
    {
        if std::arch::is_x86_feature_detected!("avx2") && std::arch::is_x86_feature_detected!("bmi2") {
            names.push("stockfish-windows-x86-64-avx2.zip");
        }
        if std::arch::is_x86_feature_detected!("sse4.1") && std::arch::is_x86_feature_detected!("popcnt") {
            names.push("stockfish-windows-x86-64-sse41-popcnt.zip");
        }
    }
    names.push("stockfish-windows-x86-64.zip");
    names
}

#[tauri::command]
pub async fn engine_download(app: AppHandle, settings: State<'_, SettingsState>) -> Result<String, String> {
    let http = reqwest::Client::builder()
        .user_agent("xequemente")
        .build()
        .map_err(|e| e.to_string())?;

    let _ = app.emit("download-progress", "Consultando a última versão do Stockfish…");
    let release: Value = http
        .get(RELEASES_URL)
        .send()
        .await
        .map_err(|e| format!("Falha ao consultar o GitHub: {e}"))?
        .error_for_status()
        .map_err(|e| format!("GitHub respondeu com erro: {e}"))?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let assets = release["assets"].as_array().cloned().unwrap_or_default();
    let tag = release["tag_name"].as_str().unwrap_or("?").to_string();

    let (asset_name, url) = preferred_assets()
        .into_iter()
        .find_map(|wanted| {
            assets.iter().find(|a| a["name"] == wanted).and_then(|a| {
                a["browser_download_url"]
                    .as_str()
                    .map(|u| (wanted.to_string(), u.to_string()))
            })
        })
        .or_else(|| {
            // Nome desconhecido: qualquer zip Windows x86-64.
            assets.iter().find_map(|a| {
                let name = a["name"].as_str()?;
                (name.contains("windows-x86-64") && name.ends_with(".zip"))
                    .then(|| Some((name.to_string(), a["browser_download_url"].as_str()?.to_string())))
                    .flatten()
            })
        })
        .ok_or("Não encontrei um executável do Stockfish para Windows na última versão.")?;

    let _ = app.emit("download-progress", format!("Baixando {asset_name} ({tag})…"));
    let bytes = http
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Falha no download: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Falha no download: {e}"))?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    let _ = app.emit("download-progress", "Extraindo…");
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| format!("Arquivo inválido: {e}"))?;
    let mut exe_bytes: Option<Vec<u8>> = None;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().to_lowercase();
        let base = name.rsplit('/').next().unwrap_or(&name).to_string();
        if base.starts_with("stockfish") && base.ends_with(".exe") {
            let mut buf = Vec::new();
            file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            exe_bytes = Some(buf);
            break;
        }
    }
    let exe_bytes = exe_bytes.ok_or("O pacote baixado não contém o executável.")?;

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("stockfish");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let target = dir.join("stockfish.exe");
    std::fs::write(&target, exe_bytes).map_err(|e| format!("Não consegui gravar o motor: {e}"))?;
    let path = target.to_string_lossy().to_string();

    let updated = {
        let mut s = settings.0.lock().unwrap();
        s.engine_path = path.clone();
        s.clone()
    };
    settings::persist(&app, &updated)?;
    let _ = app.emit("download-progress", format!("Stockfish {tag} instalado."));
    Ok(path)
}
