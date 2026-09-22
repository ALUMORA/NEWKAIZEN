"""Tono de titulares para ``/v2/news``: heurística transparente en español e inglés.

Contrato: ``{"label": "positivo" | "negativo" | "neutral", "score": -1..1, "method": "heuristic"}``.

**Qué es y qué no.** Es un conteo de palabras con pesos, escrito a mano aquí mismo, no un modelo ni
un léxico con licencia de terceros. Loughran-McDonald quedó descartado en el plan porque solo existe
en inglés y su licencia comercial no está clara. Por eso ``method`` dice ``heuristic`` y la UI lo
presenta como una pista, nunca como un análisis de sentimiento.

**Cómo funciona**, en cuatro reglas que se pueden explicar a un usuario:

1. Se compara **palabra completa**, nunca por subcadena. El clasificador del legado
   (``domain.news.classify_sentiment``) usa ``any(p in w ...)``, y por eso "recortar" le cuenta como
   positivo por "corta" y "riesgo" aparece dentro de otras palabras. Aquí no.
2. Una **negación** hasta tres palabras antes invierte el signo: "no supera las expectativas" es
   negativo, no positivo.
3. Los **intensificadores** ("se desploma", "cae fuerte") y los **atenuantes** ("sube levemente")
   escalan el peso de la palabra que sigue.
4. El puntaje es ``suma_con_signo / (suma_de_magnitudes + 1.5)``, así que siempre cae dentro de
   ``(-1, 1)`` y un solo indicio débil no alcanza para etiquetar: hacen falta dos, o uno fuerte.

Los números de ``/v2/news`` no dependen de esto: el tono es un campo aparte y opcional.
"""

from __future__ import annotations

import re
import unicodedata

METHOD = "heuristic"
THRESHOLD = 0.20
"""Debajo de esto en valor absoluto el titular se queda en ``neutral``."""
SMOOTHING = 1.5
"""Suavizado del denominador: un indicio suelto no alcanza para etiquetar."""
NEGATION_WINDOW = 3

STRONG, MEDIUM, MILD = 1.0, 0.6, 0.35

_POSITIVE_STRONG = (
    # español
    "récord récords máximo máximos dispara disparan repunta repunte"
    " gana ganancias utilidad utilidades supera superó superan"
    # inglés
    " record records surge surges surged soar soars soared rally rallies beat beats"
    " outperform outperforms jumps jump jumped tops topped"
).split()
_POSITIVE_MEDIUM = (
    "sube suben subió alza alzas avanza avanzó avance crece creció crecen crecimiento"
    " mejora mejoró mejoran mejoría impulso impulsa rebote repunte recuperación recupera"
    " aprueba aprobó aprobación acuerdo alianza expansión dividendo dividendos adquisición"
    " rentabilidad sólido sólida solidez optimismo"
    " gains gain gained rises rise rose climbs climb climbed growth grows grew profit profits"
    " upgrade upgraded boost boosts boosted approval approved dividend buyback rebound rebounds"
    " recovery expansion optimism wins win exceeds exceeded raises raised"
).split()
_POSITIVE_MILD = (
    "positivo positiva favorable estable respaldo apoyo"
    " positive higher upside stable support"
).split()

_NEGATIVE_STRONG = (
    "desploma desplome hunde hundió quiebra fraude recesión default impago colapso"
    " crash crashes plunge plunges plunged slump slumps collapse collapses bankruptcy"
    " fraud recession default probe lawsuit"
).split()
_NEGATIVE_MEDIUM = (
    "cae caen cayó caída caídas baja bajan bajó pierde pierden perdió pérdida pérdidas"
    " retrocede retroceso recorte recortes recorta rebaja rebajó despido despidos huelga"
    " multa sanción investigación crisis débil debilidad desaceleración incumple"
    " incumplimiento mínimo mínimos advertencia alerta preocupación preocupaciones temor temores"
    " falls fall fell drops drop dropped declines decline declined losses loss lost"
    " cuts cut downgrade downgraded underperform warns warned warning weak weaker"
    " layoffs layoff fine penalty recall slowdown sinks sink tumbles tumble selloff"
    " concerns concern misses miss missed halts halted strike"
).split()
_NEGATIVE_MILD = (
    "riesgo riesgos presión presiones incertidumbre cautela negativo negativa dudas"
    " risk risks pressure uncertainty caution negative doubts lower bearish"
).split()

LEXICON: dict[str, float] = {}
for _words, _weight in (
    (_POSITIVE_STRONG, STRONG),
    (_POSITIVE_MEDIUM, MEDIUM),
    (_POSITIVE_MILD, MILD),
    (_NEGATIVE_STRONG, -STRONG),
    (_NEGATIVE_MEDIUM, -MEDIUM),
    (_NEGATIVE_MILD, -MILD),
):
    for _word in _words:
        LEXICON.setdefault(_word, _weight)
"""Palabra (sin acentos, en minúsculas) a peso con signo. Escrito a mano, no es un léxico de terceros."""

INTENSIFIERS: dict[str, float] = {
    "fuerte": 1.25,
    "fuertes": 1.25,
    "fuertemente": 1.3,
    "muy": 1.2,
    "enorme": 1.3,
    "histórico": 1.2,
    "histórica": 1.2,
    "sharp": 1.2,
    "sharply": 1.3,
    "steep": 1.25,
    "deeply": 1.25,
    "strongly": 1.25,
}
DOWNTONERS: dict[str, float] = {
    "leve": 0.65,
    "levemente": 0.65,
    "ligero": 0.65,
    "ligera": 0.65,
    "ligeramente": 0.65,
    "marginal": 0.6,
    "slight": 0.65,
    "slightly": 0.65,
    "modest": 0.7,
    "modestly": 0.7,
    "marginally": 0.6,
}
NEGATORS = frozenset(
    "no sin ni nunca tampoco apenas not without never barely fails fail failed nor".split()
)

_WORD_RE = re.compile(r"[0-9a-záéíóúüñ]+", re.IGNORECASE)


def _fold(text: str) -> str:
    """Minúsculas sin acentos: "Récord" y "record" son la misma palabra para la heurística."""
    norm = unicodedata.normalize("NFD", str(text or "").lower())
    return "".join(ch for ch in norm if unicodedata.category(ch) != "Mn")


_FOLDED_LEXICON = {_fold(k): v for k, v in LEXICON.items()}
_FOLDED_INTENSIFIERS = {_fold(k): v for k, v in INTENSIFIERS.items()}
_FOLDED_DOWNTONERS = {_fold(k): v for k, v in DOWNTONERS.items()}
_FOLDED_NEGATORS = frozenset(_fold(w) for w in NEGATORS)


def tokenize(text: str) -> list[str]:
    """Palabras del titular, en minúsculas y sin acentos."""
    return _WORD_RE.findall(_fold(text))


def explain(text: str) -> dict:
    """Puntaje con el detalle de qué palabra aportó qué, para las pruebas y para poder explicarlo.

    Devuelve ``{"score", "label", "hits": [{"word", "weight", "negated", "scale"}], "tokens"}``.
    """
    tokens = tokenize(text)
    hits: list[dict] = []
    signed = 0.0
    magnitude = 0.0
    for i, token in enumerate(tokens):
        base = _FOLDED_LEXICON.get(token)
        if base is None:
            continue
        scale = 1.0
        if i > 0:
            previous = tokens[i - 1]
            scale = _FOLDED_INTENSIFIERS.get(previous) or _FOLDED_DOWNTONERS.get(previous) or 1.0
        window = tokens[max(0, i - NEGATION_WINDOW) : i]
        negated = any(word in _FOLDED_NEGATORS for word in window)
        weight = base * scale * (-1.0 if negated else 1.0)
        signed += weight
        magnitude += abs(weight)
        hits.append({"word": token, "weight": round(weight, 4), "negated": negated, "scale": scale})
    score = 0.0 if magnitude == 0 else signed / (magnitude + SMOOTHING)
    score = round(max(-1.0, min(1.0, score)), 4)
    return {"score": score, "label": label_for(score), "hits": hits, "tokens": tokens}


def label_for(score: float) -> str:
    """Etiqueta del contrato para un puntaje."""
    if score >= THRESHOLD:
        return "positivo"
    if score <= -THRESHOLD:
        return "negativo"
    return "neutral"


def tone(text: str) -> dict | None:
    """``{"label", "score", "method": "heuristic"}`` del titular, o ``None`` si no hay texto."""
    if not str(text or "").strip():
        return None
    result = explain(text)
    return {"label": result["label"], "score": result["score"], "method": METHOD}
