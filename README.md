# XequeMente

App de xadrez para Windows para treinar e melhorar: jogue contra o **Stockfish** em 21 níveis, revise suas partidas e receba explicações de um **treinador de IA (Claude ou Gemini)** que lembra dos seus padrões de erro.

Feito com Tauri v2, React/TypeScript e Rust.

## Instalar

Baixe o instalador na página de [Releases](../../releases/latest):

- `XequeMente_x.y.z_x64-setup.exe` (recomendado), ou
- `XequeMente_x.y.z_x64_en-US.msi`

Requer Windows 10 ou 11 (64 bits) com o WebView2, que já vem no Windows 11.

O que mudou em cada versão está no [CHANGELOG](CHANGELOG.md).

Na primeira execução, vá em **Configurações**:

1. **Motor:** clique em *Baixar Stockfish oficial* (baixa a última versão do GitHub do Stockfish) ou aponte para um `stockfish.exe` seu.
2. **Tutor (opcional):** escolha Claude ou Gemini e cole a sua chave de API; o menu de modelos aparece com os modelos disponíveis para a chave. Sem chave, tudo funciona menos o treinador de IA.

## Desenvolvimento

```powershell
npm install
npm run tauri dev      # desenvolvimento
npm run tauri build    # instaladores em src-tauri/target/release/bundle
```

Requisitos: Node.js 20+, Rust (stable) e as ferramentas de build do Visual Studio (C++).

## Funcionalidades

- **Análise:** tabuleiro com arrastar ou clicar, setas do melhor lance, barra de avaliação, MultiPV de 1 a 5 linhas em SAN (clique numa linha para jogar o lance), variantes, atalhos ← → Home End e F (girar o tabuleiro).
- **Revisão da partida:** avalia todas as posições numa profundidade configurável, classifica cada lance (melhor, imprecisão ?!, erro ?, erro grave ??) pela perda de chance de vitória (fórmula do Lichess), mostra a precisão de cada lado e um gráfico clicável, e tem o botão *Ver melhor lance*.
- **Aberturas:** nome e código ECO da abertura acima dos lances (Análise, Jogar e Partidas), selo *Teórico* nos lances de livro, marcação de onde a partida saiu da teoria e desempenho por abertura no Perfil. Usa o catálogo de aberturas do Lichess, embutido no app (funciona offline) e indexado por posição, então transposições também são reconhecidas. Os nomes aparecem em português ("Defesa Siciliana: Variante Najdorf, Ataque Inglês"), com o original em inglês ao passar o mouse.
- **Tutor:** chat em streaming. Cada pergunta leva junto FEN, lances, último lance com a classificação e as linhas do Stockfish. Tem atalhos (explicar a posição, dica sem entregar o lance, ameaças) e pode gerar um resumo da partida com padrões de erro e o que treinar.
- **Editor de posição:** paleta de peças, arrastar, botão direito para apagar, vez de jogar, roques, validação (reis, peões na 1ª/8ª fileira, lado que não joga em xeque).
- **Importar:** PGN (texto ou arquivo, inclusive com várias partidas), FEN, e **print ou foto** (Ctrl+V, arrastar ou arquivo). O LLM transcreve o tabuleiro, o app monta o FEN e abre no editor para você revisar.

## Jogar contra o Stockfish

- **Adversários:** níveis 0 a 20 (Skill Level do Stockfish), cada faixa com um personagem e Elo aproximado pela fórmula do próprio Stockfish (Elo ≈ 1346,6 + 143,4 · nível^0,806).
- **Modalidades:** bullet (1+0, 2+1), blitz (3+0, 3+2, 5+0), rápida (10+0, 15+10), clássica (30+0) e sem relógio. Cor: brancas, pretas ou aleatória.
- **Jogador simulado:** o oponente roda num processo separado do Stockfish (1 thread). O tempo de pensamento varia com o relógio, a fase da partida e o tipo de lance (rápido na abertura, em recapturas e lances únicos; demora no meio-jogo; joga no reflexo com pouco tempo). Desiste quando está perdido e aceita empate só quando a posição dele não é melhor.
- **Pré-lance:** mova suas peças durante o tempo do adversário; o lance sai na hora se for legal. Botão direito cancela.
- **Pós-jogo:** revisão automática com o motor de análise, classificação dos seus erros (fase, apuro de tempo, tática perdida, material deixado, mate permitido…) e relatório do treinador (IA) com o que foi bem, onde errou e a lição de cada erro.

## Perfil e memória do treinador

- O histórico fica em `%APPDATA%\com.xequemente.app\profile.json`.
- Depois de cada partida o treinador atualiza uma **memória** de até 12 observações sobre você (padrões, fraquezas, progresso). Ela entra nos relatórios seguintes, na análise de perfil e no chat da aba Análise. Dá para apagar itens no Perfil.
- A aba **Perfil** mostra precisão ao longo do tempo, precisão por fase, onde você mais erra, a análise do treinador (pontos fortes, fracos, erros frequentes, plano de treino, dicas personalizadas) e dicas gerais de como pensar rápido e calcular.

## Configuração do motor

Em **Configurações → Motor**:

- **Desempenho:** threads (com atalhos 1 / metade / todos menos 1 / todos, mostrando os núcleos físicos e lógicos da sua CPU) e hash (com a RAM disponível como referência).
- **Análise ao vivo:** número padrão de linhas, limite (sem limite, profundidade ou tempo por posição) e a barra de chances de vitória/empate/derrota (WDL).
- **Revisão da partida:** por profundidade ou por milissegundos por posição.
- **Opções avançadas:** todas as opções UCI que o motor anuncia (Skill Level, Syzygy, NNUE, Chess960, Move Overhead etc.), geradas a partir da resposta ao comando `uci`, então funciona com qualquer motor UCI. Botões como `Clear Hash` executam na hora; as demais opções são aplicadas ao salvar, com o motor reiniciado.

## Estrutura

```
src-tauri/src/
  engine.rs     UCI: motor de análise e motor adversário, análise contínua, eval, opções UCI, info do sistema
  llm.rs        Claude e Gemini: chat em streaming, leitura de imagem, respostas JSON, lista de modelos
  profile.rs    perfil do jogador (histórico, memória do treinador)
  download.rs   download do Stockfish oficial
  settings.rs   configurações em %APPDATA%\com.xequemente.app\settings.json
src/
  lib/          chess-utils, useGame, useEngine, review (revisão e tipos de erro), bots (níveis e tempo humano),
                profile (estatísticas e prompts do treinador), sound
  components/   PlayView, PlayBoard, AnalysisView, BoardView, EditorView, ImportView, ProfileView,
                SettingsView, TutorChat, EvalBar, EvalGraph, MoveList
```

## Privacidade

As chaves de API ficam salvas em texto puro no `settings.json` da sua pasta de usuário (`%APPDATA%\com.xequemente.app`), nunca no repositório. As requisições às APIs saem do processo Rust, nunca do WebView. O app envia ao provedor de IA só o que o treinador precisa: posição, lances, análise do Stockfish e a memória sobre você.

## Créditos

- [Stockfish](https://stockfishchess.org/) (GPL-3.0), baixado à parte pelo próprio app, não distribuído junto.
- [Catálogo de aberturas do Lichess](https://github.com/lichess-org/chess-openings) (domínio público / CC0), em `data/lichess-openings`; `node scripts/build-openings.mjs` regenera o índice `src/data/openings.json`.
- [chess.js](https://github.com/jhlywa/chess.js) e [react-chessboard](https://github.com/Clariity/react-chessboard).
