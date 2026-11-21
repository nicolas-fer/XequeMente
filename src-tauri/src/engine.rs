//! Integração com Stockfish via protocolo UCI.
//!
//! Cada busca recebe um `id` vindo do front. Toda busca `go` produz exatamente
//! um `bestmove`; quando uma busca é substituída por outra, enviamos `stop` e
//! contamos um `bestmove` pendente a descartar. Assim nenhuma linha `info` de
//! uma busca antiga é atribuída à busca nova.

use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{Mutex, oneshot};

use crate::settings::{Settings, SettingsState};

#[derive(Clone, Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PvLine {
    pub multipv: u32,
    pub depth: u32,
    pub seldepth: u32,
    /// Centipeões do ponto de vista das brancas.
    pub cp: Option<i32>,
    /// Mate em N do ponto de vista das brancas (positivo = brancas dão mate).
    pub mate: Option<i32>,
    pub pv: Vec<String>,
    pub nodes: u64,
    pub nps: u64,
    /// Vitória/empate/derrota em permilagem, do ponto de vista das brancas.
    pub wdl: Option<[u32; 3]>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InfoEvent {
    pub id: u64,
    pub fen: String,
    pub lines: Vec<PvLine>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub id: u64,
    pub fen: String,
    pub best_move: Option<String>,
    pub lines: Vec<PvLine>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    pub name: String,
    pub path: String,
    pub options: Vec<UciOption>,
}

/// Opção anunciada pelo motor na resposta ao `uci`.
#[derive(Clone, Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct UciOption {
    pub name: String,
    /// check, spin, combo, string ou button
    pub kind: String,
    pub default: Option<String>,
    pub min: Option<i64>,
    pub max: Option<i64>,
    pub vars: Vec<String>,
}

/// Opções que o app controla por conta própria (não entram no formulário genérico).
pub const MANAGED_OPTIONS: [&str; 4] = ["Threads", "Hash", "MultiPV", "UCI_ShowWDL"];

fn parse_option(line: &str) -> Option<UciOption> {
    let rest = line.strip_prefix("option name ")?;
    let type_pos = rest.find(" type ")?;
    let name = rest[..type_pos].trim().to_string();
    let tokens: Vec<&str> = rest[type_pos + 6..].split_whitespace().collect();
    let mut opt = UciOption {
        name,
        kind: tokens.first()?.to_string(),
        ..Default::default()
    };
    let keywords = ["default", "min", "max", "var"];
    let mut i = 1;
    while i < tokens.len() {
        let key = tokens[i];
        let mut j = i + 1;
        while j < tokens.len() && !keywords.contains(&tokens[j]) {
            j += 1;
        }
        let value = tokens[i + 1..j].join(" ");
        match key {
            "default" => opt.default = Some(if value == "<empty>" { String::new() } else { value }),
            "min" => opt.min = value.parse().ok(),
            "max" => opt.max = value.parse().ok(),
            "var" => opt.vars.push(value),
            _ => {}
        }
        i = j;
    }
    Some(opt)
}

struct Search {
    id: u64,
    fen: String,
    white_to_move: bool,
    lines: BTreeMap<u32, PvLine>,
    waiter: Option<oneshot::Sender<SearchResult>>,
    emit: bool,
    last_emit: Instant,
}

impl Search {
    fn snapshot(&self) -> Vec<PvLine> {
        self.lines.values().cloned().collect()
    }
}

#[derive(Default)]
struct Shared {
    current: Option<Search>,
    pending_stops: u32,
    /// Motor substituído de propósito: não avisa o front quando o processo terminar.
    retired: bool,
}

struct Engine {
    child: Child,
    stdin: ChildStdin,
    shared: Arc<StdMutex<Shared>>,
    info: EngineInfo,
    multipv: u32,
}

impl Engine {
    async fn send(&mut self, cmd: &str) -> Result<(), String> {
        self.stdin
            .write_all(format!("{cmd}\n").as_bytes())
            .await
            .map_err(|e| format!("Falha ao falar com o motor: {e}"))?;
        self.stdin.flush().await.map_err(|e| e.to_string())
    }
}

#[derive(Default)]
pub struct EngineState {
    /// Motor de análise (força máxima).
    inner: Mutex<Option<Engine>>,
    /// Motor adversário do modo Jogar (processo separado, com Skill Level próprio).
    opponent: Mutex<Option<Engine>>,
}

/// Como iniciar um processo de motor.
struct StartConfig {
    path: String,
    threads: u32,
    hash_mb: u32,
    show_wdl: bool,
    options: BTreeMap<String, String>,
    exit_event: &'static str,
}

impl StartConfig {
    fn analysis(s: &Settings) -> Self {
        Self {
            path: s.engine_path.clone(),
            threads: s.engine_threads,
            hash_mb: s.engine_hash_mb,
            show_wdl: s.show_wdl,
            options: s.engine_options.clone(),
            exit_event: "engine-exited",
        }
    }
}

async fn read_until(
    lines: &mut Lines<BufReader<ChildStdout>>,
    token: &str,
    timeout: Duration,
    mut on_line: impl FnMut(&str),
) -> Result<(), String> {
    let fut = async {
        while let Some(line) = lines.next_line().await.map_err(|e| e.to_string())? {
            on_line(&line);
            if line.trim() == token {
                return Ok(());
            }
        }
        Err("O motor encerrou inesperadamente.".to_string())
    };
    tokio::time::timeout(timeout, fut)
        .await
        .map_err(|_| format!("O motor não respondeu '{token}' a tempo. O caminho aponta para o Stockfish?"))?
}

fn parse_info(line: &str, white_to_move: bool) -> Option<PvLine> {
    let tokens: Vec<&str> = line.split_whitespace().collect();
    if tokens.first() != Some(&"info") {
        return None;
    }
    let mut out = PvLine {
        multipv: 1,
        ..Default::default()
    };
    let mut has_score = false;
    let mut i = 1;
    while i < tokens.len() {
        match tokens[i] {
            "depth" => {
                out.depth = tokens.get(i + 1)?.parse().ok()?;
                i += 2;
            }
            "seldepth" => {
                out.seldepth = tokens.get(i + 1)?.parse().unwrap_or(0);
                i += 2;
            }
            "multipv" => {
                out.multipv = tokens.get(i + 1)?.parse().ok()?;
                i += 2;
            }
            "nodes" => {
                out.nodes = tokens.get(i + 1)?.parse().unwrap_or(0);
                i += 2;
            }
            "nps" => {
                out.nps = tokens.get(i + 1)?.parse().unwrap_or(0);
                i += 2;
            }
            "score" => {
                let kind = *tokens.get(i + 1)?;
                let value: i32 = tokens.get(i + 2)?.parse().ok()?;
                let value = if white_to_move { value } else { -value };
                match kind {
                    "cp" => out.cp = Some(value),
                    "mate" => out.mate = Some(value),
                    _ => return None,
                }
                has_score = true;
                i += 3;
                // Linhas com limite parcial (lowerbound/upperbound) causam oscilação: ignoramos.
                if matches!(tokens.get(i), Some(&"lowerbound") | Some(&"upperbound")) {
                    return None;
                }
            }
            "wdl" => {
                let w: u32 = tokens.get(i + 1)?.parse().ok()?;
                let d: u32 = tokens.get(i + 2)?.parse().ok()?;
                let l: u32 = tokens.get(i + 3)?.parse().ok()?;
                out.wdl = Some(if white_to_move { [w, d, l] } else { [l, d, w] });
                i += 4;
            }
            "pv" => {
                out.pv = tokens[i + 1..].iter().map(|s| s.to_string()).collect();
                break;
            }
            _ => i += 1,
        }
    }
    if has_score && !out.pv.is_empty() {
        Some(out)
    } else {
        None
    }
}

fn spawn_reader(app: AppHandle, mut lines: Lines<BufReader<ChildStdout>>, shared: Arc<StdMutex<Shared>>, exit_event: &'static str) {
    tauri::async_runtime::spawn(async move {
        while let Ok(Some(line)) = lines.next_line().await {
            let line = line.trim();
            if line.starts_with("info") {
                let mut sh = shared.lock().unwrap();
                if sh.pending_stops > 0 {
                    continue;
                }
                let Some(search) = sh.current.as_mut() else { continue };
                let Some(pv) = parse_info(line, search.white_to_move) else { continue };
                search.lines.insert(pv.multipv, pv);
                if search.emit && search.last_emit.elapsed() >= Duration::from_millis(120) {
                    search.last_emit = Instant::now();
                    let ev = InfoEvent {
                        id: search.id,
                        fen: search.fen.clone(),
                        lines: search.snapshot(),
                    };
                    let _ = app.emit("engine-info", ev);
                }
            } else if let Some(rest) = line.strip_prefix("bestmove") {
                let mut sh = shared.lock().unwrap();
                if sh.pending_stops > 0 {
                    sh.pending_stops -= 1;
                    continue;
                }
                let Some(mut search) = sh.current.take() else { continue };
                let best = rest
                    .split_whitespace()
                    .next()
                    .filter(|m| *m != "(none)")
                    .map(|m| m.to_string());
                let result = SearchResult {
                    id: search.id,
                    fen: search.fen.clone(),
                    best_move: best,
                    lines: search.snapshot(),
                };
                if search.emit {
                    let _ = app.emit(
                        "engine-info",
                        InfoEvent {
                            id: result.id,
                            fen: result.fen.clone(),
                            lines: result.lines.clone(),
                        },
                    );
                    let _ = app.emit("engine-bestmove", result.clone());
                }
                if let Some(tx) = search.waiter.take() {
                    let _ = tx.send(result);
                }
            }
        }
        // Processo terminou: libera quem estiver esperando.
        let mut sh = shared.lock().unwrap();
        sh.current = None;
        if !sh.retired {
            let _ = app.emit(exit_event, ());
        }
    });
}

async fn start_engine(app: &AppHandle, cfg: &StartConfig) -> Result<Engine, String> {
    let path = cfg.path.as_str();
    if path.trim().is_empty() {
        return Err("Caminho do Stockfish não configurado.".into());
    }
    let mut cmd = Command::new(path);
    cmd.stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Não foi possível iniciar o motor em '{path}': {e}"))?;
    let mut stdin = child.stdin.take().ok_or("stdin indisponível")?;
    let stdout = child.stdout.take().ok_or("stdout indisponível")?;
    let mut lines = BufReader::new(stdout).lines();

    stdin.write_all(b"uci\n").await.map_err(|e| e.to_string())?;
    stdin.flush().await.map_err(|e| e.to_string())?;
    let mut name = String::from("Motor UCI");
    let mut options: Vec<UciOption> = Vec::new();
    read_until(&mut lines, "uciok", Duration::from_secs(10), |l| {
        if let Some(n) = l.strip_prefix("id name ") {
            name = n.trim().to_string();
        } else if let Some(o) = parse_option(l.trim()) {
            options.push(o);
        }
    })
    .await?;

    let has = |n: &str| options.iter().any(|o| o.name.eq_ignore_ascii_case(n));
    let mut setup = String::new();
    if has("Threads") {
        setup.push_str(&format!("setoption name Threads value {}\n", cfg.threads.max(1)));
    }
    if has("Hash") {
        setup.push_str(&format!("setoption name Hash value {}\n", cfg.hash_mb.max(1)));
    }
    if has("MultiPV") {
        setup.push_str("setoption name MultiPV value 1\n");
    }
    if has("UCI_ShowWDL") {
        setup.push_str(&format!("setoption name UCI_ShowWDL value {}\n", cfg.show_wdl));
    }
    for (key, value) in &cfg.options {
        let Some(opt) = options.iter().find(|o| &o.name == key) else { continue };
        if MANAGED_OPTIONS.contains(&opt.name.as_str()) || opt.kind == "button" {
            continue;
        }
        let value = value.replace(['\n', '\r'], " ");
        if value.is_empty() && opt.kind == "string" {
            setup.push_str(&format!("setoption name {} value <empty>\n", opt.name));
        } else {
            setup.push_str(&format!("setoption name {} value {}\n", opt.name, value));
        }
    }
    setup.push_str("isready\n");
    stdin.write_all(setup.as_bytes()).await.map_err(|e| e.to_string())?;
    stdin.flush().await.map_err(|e| e.to_string())?;
    read_until(&mut lines, "readyok", Duration::from_secs(30), |_| {}).await?;

    let shared = Arc::new(StdMutex::new(Shared::default()));
    spawn_reader(app.clone(), lines, shared.clone(), cfg.exit_event);

    Ok(Engine {
        child,
        stdin,
        shared,
        info: EngineInfo {
            name,
            path: path.to_string(),
            options,
        },
        multipv: 1,
    })
}

fn fen_white_to_move(fen: &str) -> bool {
    fen.split_whitespace().nth(1) != Some("b")
}

/// Começa uma busca nova, interrompendo a anterior se houver.
async fn begin_search(
    engine: &mut Engine,
    id: u64,
    fen: &str,
    multipv: u32,
    go: &str,
    emit: bool,
    waiter: Option<oneshot::Sender<SearchResult>>,
    history: Option<(&str, &[String])>,
) -> Result<(), String> {
    let had_running = {
        let mut sh = engine.shared.lock().unwrap();
        let previous = sh.current.take();
        let had = previous.is_some();
        if let Some(mut prev) = previous {
            sh.pending_stops += 1;
            if let Some(tx) = prev.waiter.take() {
                let _ = tx.send(SearchResult {
                    id: prev.id,
                    fen: prev.fen.clone(),
                    best_move: prev.lines.get(&1).and_then(|l| l.pv.first().cloned()),
                    lines: prev.snapshot(),
                });
            }
        }
        sh.current = Some(Search {
            id,
            fen: fen.to_string(),
            white_to_move: fen_white_to_move(fen),
            lines: BTreeMap::new(),
            waiter,
            emit,
            last_emit: Instant::now() - Duration::from_secs(1),
        });
        had
    };
    let mut script = String::new();
    if had_running {
        script.push_str("stop\n");
    }
    let multipv = multipv.clamp(1, 8);
    if multipv != engine.multipv {
        script.push_str(&format!("setoption name MultiPV value {multipv}\n"));
        engine.multipv = multipv;
    }
    match history {
        Some((start, moves)) if !moves.is_empty() => {
            script.push_str(&format!("position fen {start} moves {}\n{go}", moves.join(" ")))
        }
        _ => script.push_str(&format!("position fen {fen}\n{go}")),
    }
    engine.send(&script).await
}

#[tauri::command]
pub async fn engine_start(
    app: AppHandle,
    state: State<'_, EngineState>,
    settings: State<'_, SettingsState>,
) -> Result<EngineInfo, String> {
    let snapshot = settings.0.lock().unwrap().clone();
    let mut guard = state.inner.lock().await;
    if let Some(mut old) = guard.take() {
        old.shared.lock().unwrap().retired = true;
        let _ = old.send("quit").await;
        let _ = old.child.kill().await;
    }
    let engine = start_engine(&app, &StartConfig::analysis(&snapshot)).await?;
    let info = engine.info.clone();
    *guard = Some(engine);
    Ok(info)
}

#[tauri::command]
pub async fn engine_status(state: State<'_, EngineState>) -> Result<Option<EngineInfo>, String> {
    let guard = state.inner.lock().await;
    Ok(guard.as_ref().map(|e| e.info.clone()))
}

/// Análise contínua (go infinite). Resultados chegam pelo evento `engine-info`.
#[tauri::command]
pub async fn engine_analyze(
    state: State<'_, EngineState>,
    settings: State<'_, SettingsState>,
    id: u64,
    fen: String,
    multipv: u32,
) -> Result<(), String> {
    let go = {
        let s = settings.0.lock().unwrap();
        match s.live_limit.as_str() {
            "depth" => format!("go depth {}\n", s.live_depth.clamp(1, 99)),
            "time" => format!("go movetime {}\n", s.live_seconds.clamp(1, 3600) as u64 * 1000),
            _ => "go infinite\n".to_string(),
        }
    };
    let mut guard = state.inner.lock().await;
    let engine = guard.as_mut().ok_or("Motor não iniciado.")?;
    begin_search(engine, id, &fen, multipv, &go, true, None, None).await
}

/// Avalia uma posição até a profundidade pedida e devolve o resultado final.
#[tauri::command]
pub async fn engine_eval(
    state: State<'_, EngineState>,
    id: u64,
    fen: String,
    depth: Option<u32>,
    movetime: Option<u32>,
    multipv: u32,
) -> Result<SearchResult, String> {
    let (tx, rx) = oneshot::channel();
    {
        let mut guard = state.inner.lock().await;
        let engine = guard.as_mut().ok_or("Motor não iniciado.")?;
        // Profundidade e tempo juntos: o motor para no que vier primeiro.
        let go = match (depth, movetime) {
            (Some(d), Some(ms)) => format!("go depth {} movetime {}\n", d.clamp(1, 99), ms.clamp(10, 600_000)),
            (None, Some(ms)) => format!("go movetime {}\n", ms.clamp(10, 600_000)),
            (Some(d), None) => format!("go depth {}\n", d.clamp(1, 99)),
            (None, None) => "go depth 16\n".to_string(),
        };
        begin_search(engine, id, &fen, multipv, &go, false, Some(tx), None).await?;
    }
    tokio::time::timeout(Duration::from_secs(300), rx)
        .await
        .map_err(|_| "Tempo esgotado esperando o motor.".to_string())?
        .map_err(|_| "Busca interrompida.".to_string())
}

#[tauri::command]
pub async fn engine_stop(state: State<'_, EngineState>) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    if let Some(engine) = guard.as_mut() {
        let running = engine.shared.lock().unwrap().current.is_some();
        if running {
            engine.send("stop").await?;
        }
    }
    Ok(())
}

/// Envia um comando com o motor parado (ex.: `ucinewgame`, botão `Clear Hash`).
/// A análise ao vivo em andamento é interrompida; o front a reinicia depois.
#[tauri::command]
pub async fn engine_command(state: State<'_, EngineState>, command: String) -> Result<(), String> {
    let allowed = command == "ucinewgame" || command.starts_with("setoption name ");
    if !allowed || command.contains('\n') || command.contains('\r') {
        return Err("Comando não permitido.".into());
    }
    let mut guard = state.inner.lock().await;
    let engine = guard.as_mut().ok_or("Motor não iniciado.")?;
    let had_running = {
        let mut sh = engine.shared.lock().unwrap();
        match sh.current.take() {
            Some(mut prev) => {
                sh.pending_stops += 1;
                if let Some(tx) = prev.waiter.take() {
                    let _ = tx.send(SearchResult {
                        id: prev.id,
                        fen: prev.fen.clone(),
                        best_move: None,
                        lines: prev.snapshot(),
                    });
                }
                true
            }
            None => false,
        }
    };
    let script = if had_running { format!("stop\n{command}\nisready") } else { format!("{command}\nisready") };
    engine.send(&script).await
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub logical_cores: u32,
    pub physical_cores: Option<u32>,
    pub total_memory_mb: u64,
    pub cpu_name: String,
}

#[tauri::command]
pub fn system_info() -> SystemInfo {
    let logical_cores = std::thread::available_parallelism().map(|n| n.get() as u32).unwrap_or(1);
    let physical_cores = sysinfo::System::physical_core_count().ok().map(|n| n as u32);
    match sysinfo::System::new() {
        Ok(mut sys) => {
            sys.refresh_memory();
            sys.refresh_cpu_all();
            SystemInfo {
                logical_cores,
                physical_cores,
                total_memory_mb: sys.total_memory() / (1024 * 1024),
                cpu_name: sys.cpus().first().map(|c| c.brand().trim().to_string()).unwrap_or_default(),
            }
        }
        Err(_) => SystemInfo { logical_cores, physical_cores, total_memory_mb: 0, cpu_name: String::new() },
    }
}

// ------------------------------------------------------------------ Adversário (modo Jogar)

/// Inicia o motor adversário com o nível pedido (Skill Level 0–20).
#[tauri::command]
pub async fn opponent_start(
    app: AppHandle,
    state: State<'_, EngineState>,
    settings: State<'_, SettingsState>,
    skill: u32,
) -> Result<EngineInfo, String> {
    let s = settings.0.lock().unwrap().clone();
    let mut options = s.engine_options.clone();
    // Força controlada só pelo Skill Level; nada de limitar por Elo nem de pensar no tempo do jogador.
    options.insert("Skill Level".into(), skill.min(20).to_string());
    options.insert("UCI_LimitStrength".into(), "false".into());
    options.insert("Ponder".into(), "false".into());
    options.remove("Debug Log File");
    let cfg = StartConfig {
        path: s.engine_path.clone(),
        threads: 1,
        hash_mb: 64,
        show_wdl: false,
        options,
        exit_event: "opponent-exited",
    };
    let mut guard = state.opponent.lock().await;
    if let Some(mut old) = guard.take() {
        old.shared.lock().unwrap().retired = true;
        let _ = old.send("quit").await;
        let _ = old.child.kill().await;
    }
    let mut engine = start_engine(&app, &cfg).await?;
    engine.send("ucinewgame\nisready").await?;
    let info = engine.info.clone();
    *guard = Some(engine);
    Ok(info)
}

/// Pede o lance do adversário. `moves` é o histórico desde `start_fen` (para o motor ver repetições).
#[tauri::command]
pub async fn opponent_move(
    state: State<'_, EngineState>,
    id: u64,
    start_fen: String,
    moves: Vec<String>,
    fen: String,
    movetime: u32,
    multipv: Option<u32>,
) -> Result<SearchResult, String> {
    if moves.iter().any(|m| !m.chars().all(|c| c.is_ascii_alphanumeric()))
        || start_fen.contains(['\n', '\r'])
        || fen.contains(['\n', '\r'])
    {
        return Err("Lance ou posição inválida.".into());
    }
    let (tx, rx) = oneshot::channel();
    {
        let mut guard = state.opponent.lock().await;
        let engine = guard.as_mut().ok_or("O adversário não foi iniciado.")?;
        let go = format!("go movetime {}\n", movetime.clamp(20, 120_000));
        // Com MultiPV > 1, o front recebe os melhores candidatos e escolhe um lance mais fraco (níveis negativos).
        begin_search(engine, id, &fen, multipv.unwrap_or(1), &go, false, Some(tx), Some((&start_fen, &moves))).await?;
    }
    tokio::time::timeout(Duration::from_secs(180), rx)
        .await
        .map_err(|_| "O adversário demorou demais.".to_string())?
        .map_err(|_| "Busca interrompida.".to_string())
}

#[tauri::command]
pub async fn opponent_stop(state: State<'_, EngineState>) -> Result<(), String> {
    let mut guard = state.opponent.lock().await;
    if let Some(mut old) = guard.take() {
        old.shared.lock().unwrap().retired = true;
        let _ = old.send("quit").await;
        let _ = old.child.kill().await;
    }
    Ok(())
}
