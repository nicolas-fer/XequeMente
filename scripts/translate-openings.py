"""
Traduz para pt-BR os trechos de variante do catálogo de aberturas do Lichess, com o Gemini.

Os nomes têm a forma "Família: Variante, Subvariante". As famílias (149) estão traduzidas
à mão em data/lichess-openings/families.pt-BR.tsv; aqui vão só os trechos depois de ":",
cada um traduzido uma única vez (consistência) e com um exemplo de nome completo para dar
contexto (gênero, sentido). O resultado vai para data/lichess-openings/segments.pt-BR.tsv,
que o scripts/build-openings.mjs usa. Trechos já traduzidos no arquivo são mantidos.

Uso: GEMINI_API_KEY=... python scripts/translate-openings.py [modelo]
"""
import concurrent.futures as cf
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "lichess-openings"
OUT = DATA / "segments.pt-BR.tsv"
MODEL = sys.argv[1] if len(sys.argv) > 1 else "gemini-pro-latest"
KEY = os.environ["GEMINI_API_KEY"]
BATCH = 100

families = dict(l.split("\t") for l in (DATA / "families.pt-BR.tsv").read_text("utf-8").splitlines() if l)

# trecho -> exemplo de nome completo
segments: dict[str, str] = {}
for f in "abcde":
    for row in (DATA / f"{f}.tsv").read_text("utf-8").splitlines()[1:]:
        if not row:
            continue
        name = row.split("\t")[1]
        if ":" not in name:
            continue
        rest = name.split(":", 1)[1].strip()
        for s in rest.split(", "):
            segments.setdefault(s.strip(), name)

done: dict[str, str] = {}
if OUT.exists():
    done = dict(l.split("\t") for l in OUT.read_text("utf-8").splitlines() if l)
todo = [s for s in segments if s not in done]
print(f"{len(segments)} trechos, {len(done)} já traduzidos, {len(todo)} a traduzir com {MODEL}")

GLOSSARY = "\n".join(f"{en} = {pt}" for en, pt in families.items())
RULES = f"""Você é um tradutor especialista em xadrez e traduz nomes de aberturas do inglês para o português do Brasil, usando a terminologia consagrada no xadrez brasileiro (livros, chess.com e lichess em português).

Regras:
1. Nomes de pessoas ficam como estão (Najdorf, Marshall, Steinitz, Morphy, Lasker, Rubinstein, Fischer, Kasparov…), com a mesma grafia e acentos. Nomes de lugar viram adjetivo ou forma portuguesa quando houver uma consagrada (Berlin Defense = Defesa Berlinense, Moscow Variation = Variante Moscou, Vienna = Vienense, Paris = Paris, Leningrad = Leningrado, Prague = Praga, Copenhagen = Copenhague, Swiss = Suíço), senão ficam como estão.
2. Termos: Variation = Variante; Attack = Ataque; Gambit = Gambito; Countergambit = Contragambito; Defense = Defesa; Opening = Abertura; Game = Jogo; System = Sistema; Line = Linha; Main Line = Linha Principal; Formation = Formação; Trap = Armadilha; Sacrifice = Sacrifício; Counterattack = Contra-ataque; Accepted = Aceito/Aceita; Declined = Recusado/Recusada; Deferred = Adiado/Adiada; Accelerated = Acelerado/Acelerada; Reversed = Invertido/Invertida; Delayed = Retardado/Retardada; Exchange Variation = Variante das Trocas; Closed = Fechado/Fechada; Open = Aberto/Aberta; Classical = Clássico/Clássica; Modern = Moderno/Moderna; Old = Antigo/Antiga; Fianchetto = Fianqueto; Center = Centro; Knight = Cavalo; Bishop = Bispo; Rook = Torre; Queen = Dama; King = Rei; Pawn = Peão; Poisoned Pawn = Peão Envenenado; Dragon = Dragão; Hedgehog = Ouriço; Stonewall = Stonewall; Wing Gambit = Gambito da Ala; Two Knights = Dois Cavalos; Three Knights = Três Cavalos; Four Knights = Quatro Cavalos; Fried Liver Attack = Ataque Fegatello.
3. A ordem é a do português (substantivo antes): "Najdorf Variation" = "Variante Najdorf", "English Attack" = "Ataque Inglês", "Poisoned Pawn Variation" = "Variante do Peão Envenenado", "Main Line" = "Linha Principal". Concordância de gênero com o substantivo: "Gambito … Aceito", "Defesa … Aceita", "Variante … Fechada".
4. Lances em notação (Bb5, e4, Nf3, O-O, Qxd4, Bb4+, 4.f4) ficam EXATAMENTE como estão: o app usa notação inglesa. "with" = "com"; "without" = "sem"; "Bb5 Line" = "Linha Bb5".
5. Apelidos e nomes de fantasia: traduza quando houver tradução natural (Hippopotamus = Hipopótamo, Dragon = Dragão, Hedgehog = Ouriço, Orangutan = Orangotango, Rat = Rato, Lion = Leão, Vulture = Abutre, Spike = Spike); nomes de marca, siglas e trocadilhos sem tradução natural ficam como estão (Bongcloud, Coca-Cola, Spike Lee).
6. Seja consistente: a mesma palavra inglesa vira sempre a mesma palavra portuguesa.

Glossário das famílias (já traduzidas, use como referência de estilo):
{GLOSSARY}

Para cada trecho você recebe um exemplo do nome completo em que ele aparece (só contexto: traduza APENAS o trecho). Devolva um item por trecho, com o texto em inglês exatamente igual ao recebido em "en"."""

SCHEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {"en": {"type": "STRING"}, "pt": {"type": "STRING"}},
        "required": ["en", "pt"],
    },
}


def call(batch: list[str]) -> dict[str, str]:
    items = "\n".join(json.dumps({"en": s, "exemplo": segments[s]}, ensure_ascii=False) for s in batch)
    body = {
        "systemInstruction": {"parts": [{"text": RULES}]},
        "contents": [{"role": "user", "parts": [{"text": f"Traduza estes {len(batch)} trechos:\n{items}"}]}],
        "generationConfig": {"responseMimeType": "application/json", "responseSchema": SCHEMA},
    }
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": KEY},
    )
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                data = json.load(r)
            text = "".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"])
            out = {o["en"]: o["pt"].strip() for o in json.loads(text)}
            missing = [s for s in batch if not out.get(s)]
            if missing:
                raise ValueError(f"{len(missing)} trechos sem tradução")
            return {s: out[s] for s in batch}
        except Exception as e:  # noqa: BLE001
            print(f"  tentativa {attempt + 1} falhou: {str(e)[:160]}")
            time.sleep(5 * (attempt + 1))
    raise RuntimeError("lote falhou 5 vezes")


batches = [todo[i : i + BATCH] for i in range(0, len(todo), BATCH)]
with cf.ThreadPoolExecutor(max_workers=4) as pool:
    for n, res in enumerate(pool.map(call, batches), 1):
        done.update(res)
        # grava a cada lote (dá para retomar se cair)
        OUT.write_text("".join(f"{k}\t{v}\n" for k, v in sorted(done.items())), "utf-8")
        print(f"lote {n}/{len(batches)} ok")
print(f"pronto: {len(done)} trechos em {OUT.relative_to(ROOT)}")
