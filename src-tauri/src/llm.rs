//! Chamadas aos LLMs (Claude e Gemini) por HTTP.
//! As chaves ficam só no processo Rust; o front nunca faz a requisição.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

use crate::settings::{Settings, SettingsState};

const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2026-10-21";
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";
const GEMINI_BASE: &str = "https://generativelanguage.googleapis.com/v1beta/models";

#[derive(Default)]
pub struct TutorState {
    cancelled: Mutex<HashSet<String>>,
}

#[derive(Deserialize, Debug)]
pub struct ChatMessage {
    /// "user" ou "assistant"
    pub role: String,
    pub content: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DeltaEvent {
    request_id: String,
    text: String,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BoardRead {
    pub board_found: bool,
    pub orientation: String,
    pub rows: Vec<String>,
    pub side_to_move: String,
    pub notes: String,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())
}

fn level_text(level: &str) -> &'static str {
    match level {
        "iniciante" => "iniciante (conhece as regras, ainda perde peças por descuido; use linguagem simples e evite jargão sem explicar)",
        "avancado" => "avançado (rating acima de ~1800; pode usar termos técnicos e discutir nuances posicionais)",
        _ => "intermediário (rating entre ~1000 e ~1800; conhece táticas básicas, quer entender planos e evitar erros)",
    }
}

fn tutor_system_prompt(level: &str) -> String {
    format!(
        "Você é um treinador de xadrez experiente, paciente e direto. Seu aluno é {nivel}. \
O objetivo dele é melhorar de verdade, não só receber o lance certo.\n\n\
Junto de cada pergunta você recebe um bloco [CONTEXTO] com a posição (FEN), os lances da partida, \
o último lance e a análise do Stockfish (avaliação e melhores linhas em SAN). Use esses dados assim:\n\
- O Stockfish é a fonte da verdade para avaliações e variantes concretas. Não invente variantes longas; \
se mencionar um lance que não está nas linhas fornecidas, deixe claro que é uma ideia a verificar.\n\
- Traduza os números em ideias humanas: ameaças, peças soltas ou sobrecarregadas, segurança do rei, \
estrutura de peões, casas fracas, atividade das peças, planos típicos e padrões táticos com nome.\n\
- Quando o aluno errou, explique o que ele provavelmente deixou de ver e dê uma regra prática para \
não repetir o erro.\n\
- Se ele pedir uma dica, não entregue o lance: aponte onde olhar ou faça uma pergunta que leve à resposta.\n\
- Escreva lances em SAN como aparecem no contexto (K, Q, R, B, N), mas fale das peças em português.\n\
- Seja conciso: em geral de 80 a 250 palavras, com listas curtas quando ajudar. Aprofunde só se pedirem.\n\
- Responda sempre em português do Brasil.",
        nivel = level_text(level)
    )
}

const BOARD_PROMPT: &str = "Esta imagem deve conter um tabuleiro de xadrez (diagrama, print de site/app ou foto). \
Transcreva a posição com precisão.\n\n\
Regras da transcrição:\n\
1. `rows`: exatamente 8 strings, uma por fileira de casas, na ordem em que aparecem na imagem de CIMA para BAIXO. \
Cada string tem exatamente 8 caracteres, da ESQUERDA para a DIREITA da imagem.\n\
2. Caracteres: K Q R B N P para peças brancas, k q r b n p para peças pretas, '.' para casa vazia.\n\
3. `orientation`: 'white_bottom' se as brancas jogam de baixo para cima (coordenada '1' embaixo ou 'a' à esquerda embaixo); \
'black_bottom' se o tabuleiro estiver invertido. Use as coordenadas impressas na borda quando existirem; \
sem coordenadas, deduza pela posição dos reis/peões; na dúvida use 'white_bottom'.\n\
4. `side_to_move`: 'w' ou 'b' se a imagem indicar de quem é a vez (destaque do último lance, relógio ativo, texto); senão 'unknown'.\n\
5. Antes de responder, confira casa por casa e conte as peças de cada lado (no máximo 8 peões e 1 rei por cor).\n\
6. `notes`: em português, cite as casas em que você ficou em dúvida (ou deixe vazio).\n\
7. Se não houver tabuleiro na imagem, `board_found` = false e `rows` com 8 strings '........'.";

fn board_schema_json() -> Value {
    json!({
        "type": "object",
        "properties": {
            "board_found": {"type": "boolean"},
            "orientation": {"type": "string", "enum": ["white_bottom", "black_bottom"]},
            "rows": {"type": "array", "items": {"type": "string"}},
            "side_to_move": {"type": "string", "enum": ["w", "b", "unknown"]},
            "notes": {"type": "string"}
        },
        "required": ["board_found", "orientation", "rows", "side_to_move", "notes"],
        "additionalProperties": false
    })
}

fn gemini_board_schema() -> Value {
    json!({
        "type": "OBJECT",
        "properties": {
            "board_found": {"type": "BOOLEAN"},
            "orientation": {"type": "STRING", "enum": ["white_bottom", "black_bottom"]},
            "rows": {"type": "ARRAY", "items": {"type": "STRING"}},
            "side_to_move": {"type": "STRING", "enum": ["w", "b", "unknown"]},
            "notes": {"type": "STRING"}
        },
        "required": ["board_found", "orientation", "rows", "side_to_move", "notes"]
    })
}

// ---------------------------------------------------------------- Claude

fn claude_supports_effort(model: &str) -> bool {
    ["claude-opus-5", "claude-sonnet-5", "claude-haiku-5", "claude-fable-5", "claude-mythos-5"]
        .iter()
        .any(|p| model.starts_with(p))
}

fn claude_supports_fallback(model: &str) -> bool {
    ["claude-opus-5", "claude-sonnet-5-5", "claude-fable-5"]
        .iter()
        .any(|p| model.starts_with(p))
}

fn claude_request(s: &Settings, body: &Value) -> Result<reqwest::RequestBuilder, String> {
    if s.claude_api_key.trim().is_empty() {
        return Err("Informe a chave da API da Anthropic em Configurações.".into());
    }
    let mut req = client()?
        .post(ANTHROPIC_URL)
        .header("x-api-key", s.claude_api_key.trim())
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("content-type", "application/json");
    if claude_supports_fallback(&s.claude_model) {
        req = req.header("anthropic-beta", FALLBACK_BETA);
    }
    Ok(req.json(body))
}

fn claude_base_body(s: &Settings, effort: &str) -> Value {
    let mut body = json!({ "model": s.claude_model, "max_tokens": 16000 });
    if claude_supports_effort(&s.claude_model) {
        body["output_config"] = json!({ "effort": effort });
    }
    if claude_supports_fallback(&s.claude_model) {
        body["fallbacks"] = json!("default");
    }
    body
}

fn http_error(provider: &str, status: reqwest::StatusCode, body: &str) -> String {
    let detail = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| {
            v.pointer("/error/message")
                .and_then(|m| m.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| body.chars().take(300).collect());
    let hint = match status.as_u16() {
        400 => "Requisição recusada (confira o nome do modelo).",
        401 | 403 => "Chave de API inválida ou sem permissão.",
        404 => "Modelo não encontrado.",
        429 => "Limite de uso atingido; aguarde um pouco.",
        500..=599 => "Serviço indisponível no momento; tente de novo.",
        _ => "Erro na API.",
    };
    format!("{provider} ({}): {hint} {detail}", status.as_u16())
}

async fn send_with_retry(
    build: impl Fn() -> Result<reqwest::RequestBuilder, String>,
    provider: &str,
) -> Result<reqwest::Response, String> {
    let mut attempt = 0;
    loop {
        attempt += 1;
        match build()?.send().await {
            Ok(resp) if resp.status().is_success() => return Ok(resp),
            Ok(resp) => {
                let status = resp.status();
                let retryable = status.as_u16() == 429 || status.as_u16() == 529 || status.is_server_error();
                if retryable && attempt < 3 {
                    tokio::time::sleep(Duration::from_secs(2 * attempt)).await;
                    continue;
                }
                let text = resp.text().await.unwrap_or_default();
                return Err(http_error(provider, status, &text));
            }
            Err(e) if attempt < 3 && (e.is_connect() || e.is_timeout()) => {
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
            Err(e) => return Err(format!("{provider}: falha de rede: {e}")),
        }
    }
}

/// Itera as linhas `data:` de uma resposta SSE.
async fn for_each_sse_data(
    resp: reqwest::Response,
    mut on_data: impl FnMut(&str) -> Result<bool, String>,
) -> Result<(), String> {
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Conexão interrompida: {e}"))?;
        buf.extend_from_slice(&chunk);
        while let Some(pos) = buf.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = buf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line);
            let line = line.trim_end_matches(['\r', '\n']);
            if let Some(data) = line.strip_prefix("data:") {
                if !on_data(data.trim_start())? {
                    return Ok(());
                }
            }
        }
    }
    Ok(())
}

async fn claude_chat_stream(
    app: &AppHandle,
    tutor: &TutorState,
    s: &Settings,
    request_id: &str,
    messages: &[ChatMessage],
) -> Result<(), String> {
    let mut body = claude_base_body(s, "medium");
    body["max_tokens"] = json!(32000);
    body["stream"] = json!(true);
    body["system"] = json!(tutor_system_prompt(&s.tutor_level));
    // Cache automático do prefixo da conversa (reduz custo em conversas longas).
    body["cache_control"] = json!({"type": "ephemeral"});
    body["messages"] = Value::Array(
        messages
            .iter()
            .map(|m| json!({"role": if m.role == "assistant" {"assistant"} else {"user"}, "content": m.content}))
            .collect(),
    );

    let resp = send_with_retry(|| claude_request(s, &body), "Claude").await?;
    let mut stop_reason: Option<String> = None;
    for_each_sse_data(resp, |data| {
        if tutor.cancelled.lock().unwrap().contains(request_id) {
            return Ok(false);
        }
        let Ok(ev) = serde_json::from_str::<Value>(data) else { return Ok(true) };
        match ev["type"].as_str() {
            Some("content_block_delta") => {
                if ev["delta"]["type"] == "text_delta" {
                    if let Some(t) = ev["delta"]["text"].as_str() {
                        let _ = app.emit("tutor-delta", DeltaEvent { request_id: request_id.into(), text: t.into() });
                    }
                }
            }
            Some("message_delta") => {
                if let Some(r) = ev["delta"]["stop_reason"].as_str() {
                    stop_reason = Some(r.to_string());
                }
            }
            Some("error") => {
                let msg = ev["error"]["message"].as_str().unwrap_or("erro desconhecido");
                return Err(format!("Claude: {msg}"));
            }
            Some("message_stop") => return Ok(false),
            _ => {}
        }
        Ok(true)
    })
    .await?;

    match stop_reason.as_deref() {
        Some("refusal") => Err("O modelo recusou responder a esta mensagem. Tente reformular.".into()),
        Some("max_tokens") => {
            let _ = app.emit("tutor-delta", DeltaEvent { request_id: request_id.into(), text: "\n\n_(resposta cortada pelo limite de tamanho)_".into() });
            Ok(())
        }
        _ => Ok(()),
    }
}

async fn claude_read_board(s: &Settings, image_b64: &str, media_type: &str) -> Result<BoardRead, String> {
    let mut body = claude_base_body(s, "high");
    body["output_config"]["format"] = json!({ "type": "json_schema", "schema": board_schema_json() });
    body["messages"] = json!([{
        "role": "user",
        "content": [
            {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_b64}},
            {"type": "text", "text": BOARD_PROMPT}
        ]
    }]);
    let resp = send_with_retry(|| claude_request(s, &body), "Claude").await?;
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    if v["stop_reason"] == "refusal" {
        return Err("O modelo recusou analisar a imagem.".into());
    }
    let text: String = v["content"]
        .as_array()
        .map(|blocks| {
            blocks
                .iter()
                .filter(|b| b["type"] == "text")
                .filter_map(|b| b["text"].as_str())
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();
    parse_board_json(&text)
}

// ---------------------------------------------------------------- Gemini

fn gemini_request(s: &Settings, method: &str, body: &Value) -> Result<reqwest::RequestBuilder, String> {
    if s.gemini_api_key.trim().is_empty() {
        return Err("Informe a chave da API do Gemini em Configurações.".into());
    }
    let model = s.gemini_model.trim().trim_start_matches("models/");
    let url = format!("{GEMINI_BASE}/{model}:{method}");
    Ok(client()?
        .post(url)
        .header("x-goog-api-key", s.gemini_api_key.trim())
        .json(body))
}

fn gemini_text(v: &Value) -> String {
    v.pointer("/candidates/0/content/parts")
        .and_then(|p| p.as_array())
        .map(|parts| {
            parts
                .iter()
                .filter(|p| p["thought"] != true)
                .filter_map(|p| p["text"].as_str())
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default()
}

async fn gemini_chat_stream(
    app: &AppHandle,
    tutor: &TutorState,
    s: &Settings,
    request_id: &str,
    messages: &[ChatMessage],
) -> Result<(), String> {
    let body = json!({
        "systemInstruction": {"parts": [{"text": tutor_system_prompt(&s.tutor_level)}]},
        "contents": messages.iter().map(|m| json!({
            "role": if m.role == "assistant" {"model"} else {"user"},
            "parts": [{"text": m.content}]
        })).collect::<Vec<_>>()
    });
    let resp = send_with_retry(|| gemini_request(s, "streamGenerateContent?alt=sse", &body), "Gemini").await?;
    let mut blocked: Option<String> = None;
    for_each_sse_data(resp, |data| {
        if tutor.cancelled.lock().unwrap().contains(request_id) {
            return Ok(false);
        }
        let Ok(v) = serde_json::from_str::<Value>(data) else { return Ok(true) };
        if let Some(msg) = v.pointer("/error/message").and_then(|m| m.as_str()) {
            return Err(format!("Gemini: {msg}"));
        }
        if let Some(r) = v.pointer("/promptFeedback/blockReason").and_then(|r| r.as_str()) {
            blocked = Some(r.to_string());
        }
        let t = gemini_text(&v);
        if !t.is_empty() {
            let _ = app.emit("tutor-delta", DeltaEvent { request_id: request_id.into(), text: t });
        }
        Ok(true)
    })
    .await?;
    if let Some(r) = blocked {
        return Err(format!("Gemini bloqueou a resposta ({r})."));
    }
    Ok(())
}

async fn gemini_read_board(s: &Settings, image_b64: &str, media_type: &str) -> Result<BoardRead, String> {
    let body = json!({
        "contents": [{
            "role": "user",
            "parts": [
                {"inline_data": {"mime_type": media_type, "data": image_b64}},
                {"text": BOARD_PROMPT}
            ]
        }],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": gemini_board_schema()
        }
    });
    let resp = send_with_retry(|| gemini_request(s, "generateContent", &body), "Gemini").await?;
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    parse_board_json(&gemini_text(&v))
}

fn parse_board_json(text: &str) -> Result<BoardRead, String> {
    let trimmed = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    let v: Value = serde_json::from_str(trimmed)
        .map_err(|_| format!("Resposta inesperada do modelo: {}", text.chars().take(200).collect::<String>()))?;
    Ok(BoardRead {
        board_found: v["board_found"].as_bool().unwrap_or(false),
        orientation: v["orientation"].as_str().unwrap_or("white_bottom").to_string(),
        rows: v["rows"]
            .as_array()
            .map(|a| a.iter().filter_map(|r| r.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default(),
        side_to_move: v["side_to_move"].as_str().unwrap_or("unknown").to_string(),
        notes: v["notes"].as_str().unwrap_or("").to_string(),
    })
}

// ---------------------------------------------------------------- Comandos

#[tauri::command]
pub async fn tutor_chat(
    app: AppHandle,
    settings: State<'_, SettingsState>,
    tutor: State<'_, TutorState>,
    request_id: String,
    messages: Vec<ChatMessage>,
) -> Result<(), String> {
    let s = settings.0.lock().unwrap().clone();
    let result = if s.provider == "gemini" {
        gemini_chat_stream(&app, &tutor, &s, &request_id, &messages).await
    } else {
        claude_chat_stream(&app, &tutor, &s, &request_id, &messages).await
    };
    tutor.cancelled.lock().unwrap().remove(&request_id);
    result
}

#[tauri::command]
pub fn tutor_cancel(tutor: State<'_, TutorState>, request_id: String) {
    tutor.cancelled.lock().unwrap().insert(request_id);
}

#[tauri::command]
pub async fn image_to_board(
    settings: State<'_, SettingsState>,
    image_base64: String,
    media_type: String,
) -> Result<BoardRead, String> {
    let s = settings.0.lock().unwrap().clone();
    if s.provider == "gemini" {
        gemini_read_board(&s, &image_base64, &media_type).await
    } else {
        claude_read_board(&s, &image_base64, &media_type).await
    }
}

// ---------------------------------------------------------------- JSON estruturado (relatórios e perfil)

/// Converte um JSON Schema simples para o subconjunto OpenAPI aceito pelo Gemini.
fn to_gemini_schema(v: &Value) -> Value {
    match v {
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (k, val) in map {
                match k.as_str() {
                    "additionalProperties" => {}
                    "type" => {
                        out.insert(k.clone(), Value::String(val.as_str().unwrap_or("string").to_uppercase()));
                    }
                    _ => {
                        out.insert(k.clone(), to_gemini_schema(val));
                    }
                }
            }
            Value::Object(out)
        }
        Value::Array(items) => Value::Array(items.iter().map(to_gemini_schema).collect()),
        other => other.clone(),
    }
}

fn parse_json_text(text: &str) -> Result<Value, String> {
    let trimmed = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    serde_json::from_str(trimmed)
        .map_err(|_| format!("Resposta inesperada do modelo: {}", text.chars().take(200).collect::<String>()))
}

/// Chamada única ao LLM que devolve um objeto JSON no formato de `schema`.
#[tauri::command]
pub async fn llm_json(
    settings: State<'_, SettingsState>,
    system: String,
    prompt: String,
    schema: Value,
) -> Result<Value, String> {
    let s = settings.0.lock().unwrap().clone();
    if s.provider == "gemini" {
        let body = json!({
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": to_gemini_schema(&schema)
            }
        });
        let resp = send_with_retry(|| gemini_request(&s, "generateContent", &body), "Gemini").await?;
        let v: Value = resp.json().await.map_err(|e| e.to_string())?;
        if let Some(r) = v.pointer("/promptFeedback/blockReason").and_then(|r| r.as_str()) {
            return Err(format!("Gemini bloqueou a resposta ({r})."));
        }
        parse_json_text(&gemini_text(&v))
    } else {
        let mut body = claude_base_body(&s, "medium");
        body["max_tokens"] = json!(16000);
        body["system"] = json!(system);
        body["output_config"]["format"] = json!({ "type": "json_schema", "schema": schema });
        body["messages"] = json!([{ "role": "user", "content": prompt }]);
        let resp = send_with_retry(|| claude_request(&s, &body), "Claude").await?;
        let v: Value = resp.json().await.map_err(|e| e.to_string())?;
        match v["stop_reason"].as_str() {
            Some("refusal") => return Err("O modelo recusou esta análise.".into()),
            Some("max_tokens") => return Err("A resposta ficou longa demais e foi cortada. Tente de novo.".into()),
            _ => {}
        }
        let text: String = v["content"]
            .as_array()
            .map(|blocks| {
                blocks
                    .iter()
                    .filter(|b| b["type"] == "text")
                    .filter_map(|b| b["text"].as_str())
                    .collect::<Vec<_>>()
                    .join("")
            })
            .unwrap_or_default();
        parse_json_text(&text)
    }
}

// ---------------------------------------------------------------- Voz do treinador (TTS do Gemini)

const TTS_MODEL: &str = "gemini-3.8-flash-tts";
const TTS_STYLE: &str = "Leia em voz alta, em português do Brasil, como um treinador de xadrez calmo, caloroso e encorajador, em ritmo natural de conversa:";
/// Quantos áudios ficam guardados no cache (os mais recentes).
const TTS_CACHE_KEEP: usize = 40;

/// Cabeçalho WAV para PCM 16 bits mono (o Gemini às vezes devolve só o PCM cru, "audio/L16").
fn wav_from_pcm(pcm: &[u8], rate: u32) -> Vec<u8> {
    let mut out = Vec::with_capacity(44 + pcm.len());
    let len = pcm.len() as u32;
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(pcm);
    out
}

fn decode_base64(s: &str) -> Result<Vec<u8>, String> {
    fn val(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a' + 26) as u32),
            b'0'..=b'9' => Some((c - b'0' + 52) as u32),
            b'+' | b'-' => Some(62),
            b'/' | b'_' => Some(63),
            _ => None,
        }
    }
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let (mut acc, mut bits) = (0u32, 0u32);
    for &c in s.as_bytes() {
        if c == b'=' || c.is_ascii_whitespace() {
            continue;
        }
        let v = val(c).ok_or("Áudio em formato inesperado.")?;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    Ok(out)
}

fn tts_cache_dir(app: &AppHandle) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    let dir = app.path().app_cache_dir().ok()?.join("tts");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// Mantém só os áudios mais recentes no cache.
fn prune_tts_cache(dir: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut files: Vec<_> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .collect();
    if files.len() <= TTS_CACHE_KEEP {
        return;
    }
    files.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, path) in files.into_iter().skip(TTS_CACHE_KEEP) {
        let _ = std::fs::remove_file(path);
    }
}

/// Lê `text` com a voz do Gemini e devolve o WAV (bytes crus para o front).
/// Usa a chave do Gemini mesmo quando o provedor do tutor é o Claude; sem ela, o front usa a voz do Windows.
#[tauri::command]
pub async fn tts_speak(
    app: AppHandle,
    settings: State<'_, SettingsState>,
    text: String,
    voice: Option<String>,
) -> Result<tauri::ipc::Response, String> {
    let s = settings.0.lock().unwrap().clone();
    if s.gemini_api_key.trim().is_empty() {
        return Err("Sem chave do Gemini para a voz do treinador.".into());
    }
    let voice = voice.filter(|v| !v.trim().is_empty()).unwrap_or_else(|| s.tts_voice.clone());
    let voice = if voice.trim().is_empty() { "Charon".to_string() } else { voice };

    let cache = tts_cache_dir(&app);
    let file = cache.as_ref().map(|dir| {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        (TTS_MODEL, TTS_STYLE, &voice, &text).hash(&mut h);
        dir.join(format!("{:016x}.wav", h.finish()))
    });
    if let Some(f) = &file {
        if let Ok(bytes) = std::fs::read(f) {
            return Ok(tauri::ipc::Response::new(bytes));
        }
    }

    let body = json!({
        "contents": [{"role": "user", "parts": [{"text": format!("{TTS_STYLE}\n\n{text}")}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}}
        }
    });
    let url = format!("{GEMINI_BASE}/{TTS_MODEL}:generateContent");
    let key = s.gemini_api_key.trim().to_string();
    let resp = send_with_retry(
        || Ok(client()?.post(&url).header("x-goog-api-key", &key).json(&body)),
        "Gemini (voz)",
    )
    .await?;
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    let part = v
        .pointer("/candidates/0/content/parts")
        .and_then(|p| p.as_array())
        .and_then(|parts| parts.iter().find(|p| p.get("inlineData").is_some()))
        .and_then(|p| p.get("inlineData"))
        .ok_or("O Gemini não devolveu áudio.")?;
    let data = decode_base64(part["data"].as_str().unwrap_or_default())?;
    let mime = part["mimeType"].as_str().unwrap_or_default().to_lowercase();
    let wav = if data.starts_with(b"RIFF") {
        data
    } else {
        // "audio/L16;codec=pcm;rate=24000"
        let rate = mime
            .split(';')
            .find_map(|p| p.trim().strip_prefix("rate=").and_then(|r| r.parse().ok()))
            .unwrap_or(24000);
        wav_from_pcm(&data, rate)
    };
    if let (Some(f), Some(dir)) = (&file, &cache) {
        if std::fs::write(f, &wav).is_ok() {
            prune_tts_cache(dir);
        }
    }
    Ok(tauri::ipc::Response::new(wav))
}

// ---------------------------------------------------------------- Lista de modelos

#[derive(Serialize, Clone)]
pub struct ModelOption {
    pub id: String,
    pub label: String,
}

/// Modelos do Gemini que não servem para conversa/visão (imagem, voz, embeddings…).
fn gemini_model_usable(id: &str) -> bool {
    let id = id.to_lowercase();
    id.starts_with("gemini")
        && ![
            "image", "banana", "tts", "transcribe", "embedding", "live", "audio", "computer-use", "robotics", "aqa",
            "learnlm", "customtools",
        ]
            .iter()
            .any(|bad| id.contains(bad))
}

/// Lista os modelos disponíveis para a chave informada (ainda não salva).
#[tauri::command]
pub async fn llm_models(provider: String, api_key: String) -> Result<Vec<ModelOption>, String> {
    let key = api_key.trim().to_string();
    if key.is_empty() {
        return Ok(vec![]);
    }
    let http = client()?;
    if provider == "gemini" {
        let mut out = Vec::new();
        let mut page: Option<String> = None;
        loop {
            let mut req = http
                .get(format!("{GEMINI_BASE}?pageSize=1000"))
                .header("x-goog-api-key", &key);
            if let Some(t) = &page {
                req = req.query(&[("pageToken", t)]);
            }
            let resp = req.send().await.map_err(|e| format!("Gemini: falha de rede: {e}"))?;
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            if !status.is_success() {
                return Err(http_error("Gemini", status, &text));
            }
            let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            for m in v["models"].as_array().cloned().unwrap_or_default() {
                let methods = m["supportedGenerationMethods"].as_array().cloned().unwrap_or_default();
                if !methods.iter().any(|x| x == "generateContent") {
                    continue;
                }
                let id = m["name"].as_str().unwrap_or("").trim_start_matches("models/").to_string();
                if !gemini_model_usable(&id) {
                    continue;
                }
                let name = m["displayName"].as_str().unwrap_or(&id).to_string();
                out.push(ModelOption { label: format!("{name} ({id})"), id });
            }
            page = v["nextPageToken"].as_str().filter(|t| !t.is_empty()).map(|t| t.to_string());
            if page.is_none() {
                break;
            }
        }
        // Atalhos "-latest" primeiro, depois do mais novo para o mais antigo.
        out.sort_by(|a, b| {
            let al = a.id.contains("latest");
            let bl = b.id.contains("latest");
            bl.cmp(&al).then_with(|| b.id.cmp(&a.id))
        });
        out.dedup_by(|a, b| a.id == b.id);
        Ok(out)
    } else {
        let resp = http
            .get(format!("{}?limit=1000", ANTHROPIC_URL.replace("/messages", "/models")))
            .header("x-api-key", &key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .send()
            .await
            .map_err(|e| format!("Claude: falha de rede: {e}"))?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(http_error("Claude", status, &text));
        }
        let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        Ok(v["data"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter_map(|m| {
                let id = m["id"].as_str()?.to_string();
                let name = m["display_name"].as_str().unwrap_or(&id).to_string();
                Some(ModelOption { label: format!("{name} ({id})"), id })
            })
            .collect())
    }
}
