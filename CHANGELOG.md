# Changelog

Todas as mudanças relevantes do XequeMente ficam registradas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa [versionamento semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

## [0.6.1] - 2026-11-20

### Alterado
- **Sons refeitos** com o modelo mais novo de efeitos sonoros do ElevenLabs (v3), com o prompt seguido à risca (influência 100%) e prompts enriquecidos com detalhes de sound design. Cada som foi escolhido de ouvido entre 6 a 8 versões; o som de vitória continua o anterior. A promoção deixou de ser um brilho "mágico" e virou um toque de madeira como o do lance, com um brilho suave no fim.

## [0.6.0] - 2026-11-20

### Adicionado
- **O treinador fala**: o relatório pós-jogo ganhou um resumo curto (2 ou 3 frases, até ~45 palavras) feito para ser ouvido, com o momento que decidiu a partida e a lição principal, e os lances ditos como se fala ("o bispo em b4", "no lance 19"). Ele é lido em voz alta assim que o relatório fica pronto, e o botão **Ouvir** no balão do relatório (Jogar, Partidas e Análise) toca ou para a fala a qualquer momento.
- A voz é do Gemini (TTS) e usa a chave do Gemini, mesmo com o Claude como provedor do tutor; sem essa chave, o app usa a voz do Windows. Cada áudio é gerado uma vez e fica guardado neste computador (os 40 mais recentes).
- Em Configurações → Tutor: ligar ou desligar a leitura automática, escolher entre 12 vozes e testar a voz escolhida.
- Relatórios antigos ganham o resumo falado na primeira vez que você clica em Ouvir; ele fica salvo na partida.

## [0.5.2] - 2026-11-20

### Alterado
- **Nomes das aberturas em português**, com a terminologia do xadrez brasileiro: "Defesa Siciliana: Variante Najdorf, Ataque Inglês", "Ruy López: Defesa Berlinense", "Gambito da Dama Recusado: Defesa Ortodoxa". As 149 famílias foram traduzidas à mão; os cerca de 2.100 nomes de variantes, com IA (glossário, regras de gênero e nomes próprios preservados) e revisados. O nome original em inglês aparece ao passar o mouse e também vai para o treinador.

## [0.5.1] - 2026-11-20

### Adicionado
- **O relatório do treinador acompanha a partida na Análise**: ao abrir uma partida salva (botão "Abrir na Análise" ou clicando num lance do relatório), a aba Treinador mostra o relatório completo (resumo, o que você fez bem e onde errou, com lances clicáveis) acima da conversa.
- Na aba Revisão, ao parar num lance que o treinador comentou no relatório, o balão mostra o comentário dele e a lição daquele lance.
- **Selo da classificação no tabuleiro**, como no chess.com: na Análise revisada, o último lance ganha o selo (melhor ★, excelente ✔, teórico, imprecisão ?!, erro ?, erro grave ??…) no canto da casa para onde a peça foi.

### Corrigido
- Partidas gravadas antes da v0.3.0 mostravam na aba Partidas e no Perfil a precisão antiga (média simples), diferente da Análise (algoritmo do Lichess). Ao abrir o app, a precisão das partidas com revisão salva é recalculada uma vez e gravada; partidas sem revisão são recalculadas quando forem revisadas na Análise.

## [0.5.0] - 2026-11-20

### Adicionado
- **Aberturas pelo catálogo do Lichess** (cerca de 3.900 linhas, embutido no app e funcionando offline):
  - nome e código ECO da abertura acima dos lances na Análise e no Jogar, atualizando a cada lance (segue também as variantes); o livro fica aceso enquanto a posição é teórica;
  - selo **Teórico** (livro) na revisão para os lances de teoria, como no chess.com, inclusive na contagem por categoria; a precisão continua no cálculo do Lichess;
  - o reconhecimento é pela posição, então aberturas alcançadas por outra ordem de lances (transposição) também aparecem;
  - aba **Partidas**: abertura em cada partida, filtro por abertura e o lance em que a partida saiu da teoria (clicável);
  - **Perfil**: seção "Suas aberturas" com partidas, vitórias, empates e derrotas, aproveitamento e precisão média por abertura e cor;
  - o treinador recebe a abertura e onde a partida saiu da teoria (relatório, chats e análise do perfil, que passa a considerar o desempenho por abertura).

## [0.4.1] - 2026-11-20

### Adicionado
- Sons ao navegar pelos lances na Análise (setas, Home/End, lista de lances, gráfico, linhas do motor), como no chess.com: lance, captura, xeque, roque e promoção. Carregar uma partida não faz barulho.

### Corrigido
- Ao segurar uma peça durante a vez do adversário e soltá-la depois que ele jogou, o lance virava um pré-lance preso (casas vermelhas) e não era jogado. Agora o lance é jogado normalmente.

## [0.4.0] - 2026-11-20

### Adicionado
- **A conversa com o treinador acompanha você até a Análise**: ao clicar num lance citado no chat (pós-jogo ou aba Partidas), a Análise abre naquela posição já na aba Treinador, com a mesma conversa. Dá para continuar perguntando: o treinador recebe a partida inteira e a posição do tabuleiro, e as mensagens ficam salvas na partida (aparecem também na aba Partidas).
- Partidas antigas, sem revisão salva, são revisadas automaticamente ao abrir na Análise, e a revisão fica guardada na partida.

### Corrigido
- Os chats da mesma partida (pós-jogo, aba Partidas e Análise) ficam sincronizados e não sobrescrevem as mensagens um do outro.

## [0.3.0] - 2026-11-20

### Corrigido
- No pós-jogo, as caixas "O que você fez bem" e "Onde errou e a lição" ficavam espremidas e escondiam o texto.

### Alterado
- **Tabuleiro responsivo**: nas abas Jogar e Análise, o tabuleiro mede a área livre e ocupa o máximo que cabe (antes era limitado a 800 px); o painel lateral também cresce em telas largas (até 560 px). Numa tela 2560×1440, o tabuleiro de jogo passou de 480 px para 1224 px.
- **Precisão da partida igual à do Lichess**: cada lance pesa pela volatilidade da posição e o resultado combina a média ponderada com a média harmônica (erros graves pesam mais), com o bônus de +1 por lance e mate valendo ±1000 centipeões. Validado contra 6 partidas analisadas pelo próprio Lichess: os 12 números bateram exatamente.
- **Classificação dos lances no estilo do chess.com**, pela perda de chance de vitória: Excelente (menos de 2 pontos), Bom (2–5), Imprecisão (5–10), Erro (10–20) e Erro grave (20 ou mais).

### Adicionado
- Aba **Partidas**: histórico com filtro (vitórias, derrotas, empates) e, para cada partida, a posição final, precisão, contagem por categoria, lances com selo (clique abre na Análise), relatório do treinador, erros apontados pelo Stockfish, **chat com o treinador salvo na partida** (dá para continuar a conversa depois) e exclusão. Partidas sem relatório ganham o botão "Gerar relatório".
- A revisão do Stockfish fica guardada em cada partida: "Abrir na Análise" mostra a revisão na hora, sem recalcular.
- **Chat com o treinador no pós-jogo**, logo depois do relatório, com atalhos ("Onde a partida virou?", "Como evitar esse erro?", "O que treinar?").
- **Lances citados pelo treinador são clicáveis** ("2... d5", "7. h6") no relatório, nas listas e nos chats: abrem a Análise naquela posição.
- Categorias **Ótimo** (o melhor lance numa posição em que a segunda opção era bem pior; recapturas óbvias não contam) e **Excelente**. A revisão passa a pedir as 2 melhores linhas ao Stockfish para identificar os lances críticos.

## [0.2.1] - 2026-11-20

### Corrigido
- Revisão da partida muito lenta com profundidade alta (ex.: profundidade 30 levava cerca de 1 hora numa partida de 35 lances). Agora:
  - a revisão por profundidade tem um **tempo máximo por posição** (padrão 1,5 s; o motor para no que vier primeiro), configurável em Configurações → Revisão;
  - no modo Jogar, as posições são **analisadas durante a própria partida**, então a revisão do final fica pronta em segundos;
  - a barra de progresso mostra o **tempo restante estimado**;
  - Configurações avisa quando a combinação escolhida pode ser lenta e mostra a duração estimada da revisão.

## [0.2.0] - 2026-11-19

### Adicionado
- Avatares ilustrados para os 8 adversários (Tico, Bia, Rafa, Dona Lúcia, Prof. Hélio, Mestre Otávio, GM Sombra e Stockfish), no cartão do adversário, no cabeçalho da partida e na barra do jogador.
- Fileira de retratos na tela de escolha do adversário: um clique seleciona o personagem e o nível correspondente.
- Versão do app no rodapé do menu lateral.
- Ao passar o mouse sobre uma linha do motor na Análise, o primeiro lance dela é destacado no tabuleiro (casas de origem e destino em azul e seta própria).
- **Setas e marcações com o botão direito**, como no chess.com, nos tabuleiros de Análise e de Jogo: arrastar desenha uma seta (em L para lances de cavalo), clicar marca a casa; Shift, Ctrl e Alt trocam a cor (verde, vermelho, azul); repetir apaga e o clique esquerdo limpa tudo.
- **Efeitos sonoros novos**, gravados com o ElevenLabs: madeira quente e ressonante para lance, captura, roque, xeque e pré-lance; sinos suaves para início, vitória, derrota e empate; promoção e tique do relógio com pouco tempo. Os lances feitos na Análise também têm som.
- Seção **Sons** em Configurações: liga/desliga, volume geral e botões para ouvir cada som.

### Alterado
- Bolinhas de lances legais maiores e mais visíveis, com anel nas casas de captura, e também durante o arraste da peça.
- As setas do motor também saem em L nos lances de cavalo.
- **Dicas e macetes do Perfil agora seguem o seu jogo**, logo depois da análise do treinador:
  - com a análise do treinador gerada, viram "Dicas para você": grupos de dicas ligados a cada ponto fraco ("Para corrigir") e forte ("Para aproveitar"), com a evidência tirada das suas partidas;
  - sem análise de IA, as dicas gerais são ordenadas pelos seus erros medidos e as mais importantes ganham destaque e o motivo (ex.: "5 vezes você deixou material atacado");
  - sem partidas, a seção fica recolhida com as dicas gerais disponíveis num clique.

## [0.1.0] - 2026-11-19

Primeira versão.

### Adicionado
- **Jogar contra o Stockfish**: níveis 0 a 20 (Skill Level) com personagens e Elo aproximado; modalidades bullet, blitz, rápida, clássica e sem relógio; escolha de cor; pré-lance; oferta de empate e desistência.
- **Adversário que joga como gente**: processo próprio do Stockfish com tempo de pensamento variável conforme relógio, fase e tipo de lance; desiste quando está perdido e só aceita empate quando não está melhor.
- **Pós-jogo**: revisão automática com o Stockfish, classificação dos erros (fase, apuro de tempo, tática perdida, material deixado, mate permitido…) e relatório do treinador de IA com o que foi bem, onde errou e a lição de cada erro.
- **Memória do treinador**: até 12 observações sobre o jogador, atualizadas a cada partida e usadas nos relatórios, na análise de perfil e no chat.
- **Perfil**: estatísticas, evolução da precisão, precisão por fase, erros mais frequentes, análise do treinador (pontos fortes e fracos, erros frequentes, plano de treino) e histórico de partidas.
- **Análise**: motor ao vivo com até 5 linhas, barra de avaliação, WDL, setas do melhor lance, variantes, revisão de partida com precisão e gráfico, e chat com o treinador.
- **Editor de posição** e **importação** de PGN (inclusive com várias partidas), FEN e print/foto do tabuleiro convertido em FEN pela IA.
- **Tutor de IA** com Claude (Anthropic) ou Gemini (Google); os modelos disponíveis são listados a partir da chave informada.
- **Configuração completa do Stockfish**: download do executável oficial, threads, hash, limites da análise ao vivo, critério da revisão e todas as opções UCI anunciadas pelo motor.
- Instaladores para Windows (NSIS e MSI).

[Não lançado]: https://github.com/nicolas-fer/XequeMente/compare/v0.6.1...HEAD
[0.6.1]: https://github.com/nicolas-fer/XequeMente/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/nicolas-fer/XequeMente/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/nicolas-fer/XequeMente/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/nicolas-fer/XequeMente/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/nicolas-fer/XequeMente/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/nicolas-fer/XequeMente/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/nicolas-fer/XequeMente/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/nicolas-fer/XequeMente/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/nicolas-fer/XequeMente/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/nicolas-fer/XequeMente/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/nicolas-fer/XequeMente/releases/tag/v0.1.0
