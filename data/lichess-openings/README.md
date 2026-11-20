# Catálogo de aberturas do Lichess

Arquivos `a.tsv` a `e.tsv` copiados de https://github.com/lichess-org/chess-openings
(domínio público / CC0). Colunas: `eco`, `name`, `pgn`.

Para atualizar: substitua os `.tsv` pelos do repositório e rode

```
node scripts/build-openings.mjs
```

que regenera `src/data/openings.json` (índice posição → abertura usado pelo app).

## Tradução para pt-BR

Os nomes têm a forma `Família: Variante, Subvariante`, e cada parte é traduzida uma vez só:

- `families.pt-BR.tsv`: as 149 famílias, traduzidas à mão (nomes consagrados no xadrez brasileiro);
- `segments.pt-BR.tsv`: os trechos depois de `:` (cerca de 2.100), traduzidos pelo Gemini com glossário e
  regras (nomes de pessoas e lances em notação ficam como estão) e revisados.

Depois de atualizar os `.tsv` do catálogo, rode `python scripts/translate-openings.py` (precisa da variável
`GEMINI_API_KEY`): ele traduz só os trechos novos e mantém os já revisados. Trechos sem tradução ficam em inglês.
O nome original em inglês continua no índice (aparece ao passar o mouse e vai para o treinador).
