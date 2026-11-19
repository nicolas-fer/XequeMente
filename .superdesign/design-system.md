# Xadrez Tutor — Design System

## Product context
Desktop chess training app for Windows (Tauri, fixed window 1440×900, min 1100×700). The player analyzes their own games with the Stockfish engine and talks to an AI coach (LLM) that explains mistakes in Brazilian Portuguese. All UI copy is **pt-BR**.

Key screens:
1. **Análise** (main, 90% of time): eval bar + board, game navigation, eval graph; engine lines; move list with move-quality badges; game review (accuracy, mistake counts, per-move feedback); AI coach chat.
2. **Editor de posição**: board + piece palette, side to move, castling, FEN, validation.
3. **Importar**: PGN, FEN, screenshot → AI converts to FEN.
4. **Configurações**: AI provider/keys/model, Stockfish engine settings.

JTBD: "After a game, show me where I went wrong and teach me why, like a friendly coach."

## Visual direction
Feels like a **polished online chess game** (inspired by chess.com's game/analysis screens), not a web admin page:
- Warm charcoal surfaces, board as the hero, chunky game-like buttons, colored move-quality badges, a coach character with speech bubble.
- Dense but calm. No gradients-everywhere, no glassmorphism, no neon, no purple.

## Color tokens
| Token | Value | Use |
|---|---|---|
| --bg | #302e2b | app background (warm charcoal) |
| --bg-deep | #262522 | side panels, sidebars |
| --surface | #21201d | cards inside panels, inputs, chat bubbles bg |
| --surface-2 | #3c3a37 | secondary buttons, hover rows |
| --line | #403e3b | hairline borders |
| --text | #ffffff | primary text |
| --text-2 | #c3c2c1 | secondary text |
| --muted | #8b8987 | labels, hints |
| --green | #81b64c | primary actions, brand |
| --green-dark | #45753c | primary button bottom edge (3D) |
| --green-hover | #a3d160 | primary hover |
| --gold | #f7c631 | highlights, accuracy stars |
| Board dark | #739552 | dark squares |
| Board light | #ebecd0 | light squares |
| Last move | rgba(255,255,51,.5) | from/to highlight |

Move quality badges (round 22px badge, white glyph):
- Brilhante #26c2a3 "!!" · Melhor #81b64c "★" · Excelente #96bc4b "👍"-like check · Bom #95b776 "✓" · Imprecisão #f7c045 "?!" · Erro #e58f2a "?" · Erro grave #ca3431 "??"

## Typography
- UI: "Nunito Sans" (fallback Segoe UI), weights 600/700/800. Headings and buttons **800**, slightly tight letter-spacing.
- Numbers/eval: tabular figures, weight 800.
- Mono only for FEN/PGN: "Cascadia Mono", Consolas.
- Scale: 12 / 13 / 14 (base) / 16 / 20 / 28.

## Shape, depth, spacing
- Radius: 6px buttons/inputs, 8px cards, 10px panels, 50% badges/avatars.
- Primary button: solid --green, white 800 text, 16px, padding 12px 20px, **bottom border 4px --green-dark** (raised game button), translateY(1px) on press.
- Secondary button: --surface-2 with bottom 3px #2b2a27.
- Panels: --bg-deep, no visible border, subtle shadow 0 2px 0 rgba(0,0,0,.25).
- Board: no border radius on squares; outer shadow 0 8px 30px rgba(0,0,0,.45); coordinates inside squares.
- Spacing scale: 4 / 8 / 12 / 16 / 24 / 32.

## Signature components
- **Top bar / left rail**: dark (--bg-deep) with app logo mark (knight emblem) + bold wordmark "Xadrez Tutor"; navigation items with icon + label; active item highlighted with --surface-2 and green left marker.
- **Player bars** above and below the board: avatar square, name, rating-like tag, captured pieces.
- **Eval bar**: 28px wide, white/black, eval number in bold at the winning side.
- **Coach panel**: coach avatar (round, 56px) + speech bubble (white bg #ffffff, dark text #312e2b, 12px radius, tail pointing at avatar), used for the AI tutor messages and move feedback ("Este lance foi um erro grave…"). User messages: right-aligned --surface-2 bubbles.
- **Move list**: two columns per row, alternating row shade, move-quality badge before the SAN, active move with --surface-2 + bold.
- **Engine lines**: eval pill (white pill for white advantage, black pill for black) + SAN line.
- **Review summary card**: big accuracy numbers for each side (white card / dark card), counts per badge with the badge icons.
- **Eval graph**: white area over dark, colored dots at mistakes.

## Motion
- 150ms ease-out on hover/press; eval bar height animates 300ms; new chat bubble slides up 8px + fade 180ms. No looping animations.

## Requirements
- Everything must fit 1440×900 without page scroll on the Análise screen (internal panels scroll).
- Keyboard: ← → Home End F still work; visible focus ring (2px --green).
