mod download;
mod engine;
mod llm;
mod profile;
mod settings;

use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(engine::EngineState::default())
        .manage(llm::TutorState::default())
        .setup(|app| {
            let loaded = settings::load(app.handle());
            app.manage(settings::SettingsState(Mutex::new(loaded)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            settings::get_settings,
            settings::save_settings,
            engine::engine_start,
            engine::engine_status,
            engine::engine_analyze,
            engine::engine_eval,
            engine::engine_stop,
            engine::engine_command,
            engine::system_info,
            engine::opponent_start,
            engine::opponent_move,
            engine::opponent_stop,
            profile::profile_get,
            profile::profile_put,
            download::engine_download,
            llm::tutor_chat,
            llm::tutor_cancel,
            llm::image_to_board,
            llm::llm_json,
            llm::tts_speak,
            llm::llm_models,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o XequeMente");
}
