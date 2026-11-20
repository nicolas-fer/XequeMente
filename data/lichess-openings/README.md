# Catálogo de aberturas do Lichess

Arquivos `a.tsv` a `e.tsv` copiados de https://github.com/lichess-org/chess-openings
(domínio público / CC0). Colunas: `eco`, `name`, `pgn`.

Para atualizar: substitua os `.tsv` pelos do repositório e rode

```
node scripts/build-openings.mjs
```

que regenera `src/data/openings.json` (índice posição → abertura usado pelo app).
