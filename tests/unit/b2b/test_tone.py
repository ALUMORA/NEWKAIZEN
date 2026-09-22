"""Tono heurístico de titulares: reglas, límites y titulares reales de los fixtures grabados.

Los titulares con nombre y apellido de aquí salieron de la capa ``2026-09-22-b2b`` (feeds de
Expansión y El Financiero) y del set base (``Ticker.news`` de Yahoo), no están inventados.
"""

from __future__ import annotations

import pytest

from kaizen_api.domain import news as news_domain
from kaizen_api.domain import tone as tone_mod
from tests.replay import load_module, replaying, reset_backend_state

from .conftest import B2B_SETS

TITULARES_REALES = [
    ("Fitch mejora a 1.4% el crecimiento de México para 2026 por el impulso de EU y la IA", "positivo"),
    ("Wall Street ‘sonríe’ y Nasdaq anota máximo histórico tras subir 2.26%", "positivo"),
    ("Le ganamos a ‘los grandes’: México creció al doble del G20 en el 2T26, dice la OCDE", "positivo"),
    ("Nasdaq hits intraday record high on Alphabet boost, Mideast negotiation hopes", "positivo"),
    ("Stock market today: Nasdaq surges 2% to record high, Dow and S&P 500 gain as chip stocks rally", "positivo"),
    ("El dólar se hunde tras decepcionante reporte de empleo en Estados Unidos", "negativo"),
    ("SpaceX se desploma en Wall Street tras la publicación de sus resultados", "negativo"),
    ("Stock Market Today: Dow Slips, Oil Stocks Fall On U.S.-Iran Hopes; Homebuilders, Retailers Shine", "negativo"),
    ("Gold Prices Fall as Stronger Dollar and Fed Rate Expectations Weigh on Bullion", "negativo"),
    ("WMMVY or WMT: Which Is the Better Value Stock Right Now?", "neutral"),
    ("Pantera Holdings inicia OPA por Traxión; la operación abre la puerta a posible desliste", "neutral"),
]


@pytest.mark.parametrize("titular,esperado", TITULARES_REALES, ids=[t[:38] for t, _ in TITULARES_REALES])
def test_titulares_reales(titular, esperado):
    resultado = tone_mod.tone(titular)
    assert resultado["label"] == esperado, tone_mod.explain(titular)["hits"]
    assert resultado["method"] == "heuristic"
    assert -1 <= resultado["score"] <= 1


def test_metodo_y_limites_del_puntaje():
    """El puntaje nunca se sale de -1 a 1, ni con un titular hecho de puras palabras fuertes."""
    exagerado = "récord récord récord gana gana supera supera rally surge soar beats jumps"
    catastrofe = "desplome quiebra fraude crisis colapso plunge crash bankruptcy recesión"
    assert 0.2 < tone_mod.tone(exagerado)["score"] <= 1
    assert -1 <= tone_mod.tone(catastrofe)["score"] < -0.2
    assert tone_mod.tone(exagerado)["label"] == "positivo"
    assert tone_mod.tone(catastrofe)["label"] == "negativo"


def test_sin_texto_no_hay_tono():
    assert tone_mod.tone("") is None
    assert tone_mod.tone("   ") is None
    assert tone_mod.tone(None) is None


def test_un_titular_sin_palabras_del_lexico_es_neutral():
    resultado = tone_mod.tone("Banxico publica el calendario de subastas del cuarto trimestre")
    assert resultado == {"label": "neutral", "score": 0.0, "method": "heuristic"}


def test_no_cuenta_subcadenas_como_el_clasificador_del_legado():
    """``trabajadores`` trae ``baja`` adentro: el legado lo cuenta negativo y aquí no."""
    titular = "Los trabajadores de la planta reciben su reparto de utilidades"
    assert news_domain.classify_sentiment(titular) == "negative"  # el legado, tal cual quedó
    resultado = tone_mod.explain(titular)
    assert [hit["word"] for hit in resultado["hits"]] == ["utilidades"]
    assert resultado["label"] == "positivo"


def test_la_negacion_invierte_el_signo():
    positivo = tone_mod.tone("Grupo Bimbo supera las expectativas del trimestre")
    negado = tone_mod.tone("Grupo Bimbo no supera las expectativas del trimestre")
    assert positivo["label"] == "positivo"
    assert negado["label"] == "negativo"
    assert negado["score"] == pytest.approx(-positivo["score"])
    assert tone_mod.explain("no supera")["hits"][0]["negated"] is True


def test_la_negacion_solo_alcanza_tres_palabras():
    lejos = tone_mod.explain("no se sabe todavía si la empresa supera las expectativas")
    assert lejos["hits"][0]["negated"] is False


def test_intensificadores_y_atenuantes_pesan_mas_o_menos():
    suave = tone_mod.tone("El peso sube levemente frente al dólar")["score"]
    normal = tone_mod.tone("El peso sube frente al dólar")["score"]
    fuerte = tone_mod.tone("El peso sube fuerte frente al dólar")["score"]
    assert suave < normal < fuerte


def test_el_modificador_vale_antes_y_despues():
    """En español el adverbio va detrás del verbo y en inglés delante; las dos formas cuentan."""
    assert tone_mod.explain("cae fuerte")["hits"][0]["scale"] == pytest.approx(1.25)
    assert tone_mod.explain("sharply fell")["hits"][0]["scale"] == pytest.approx(1.3)


def test_acentos_y_mayusculas_dan_lo_mismo():
    assert tone_mod.tone("RÉCORD de utilidades") == tone_mod.tone("record de Utilidades")


def test_label_for_respeta_el_umbral():
    assert tone_mod.label_for(tone_mod.THRESHOLD) == "positivo"
    assert tone_mod.label_for(tone_mod.THRESHOLD - 0.0001) == "neutral"
    assert tone_mod.label_for(-tone_mod.THRESHOLD) == "negativo"
    assert tone_mod.label_for(0.0) == "neutral"


def test_un_solo_indicio_debil_no_alcanza_para_etiquetar():
    """El suavizado está para que "hay riesgo" no salga marcado como noticia negativa."""
    assert tone_mod.tone("Analistas ven riesgo en el sector")["label"] == "neutral"
    assert tone_mod.tone("Analistas ven riesgo e incertidumbre en el sector")["label"] == "negativo"


def test_el_lexico_es_propio_y_no_se_pisa_a_si_mismo():
    """Nada de Loughran-McDonald: es una lista escrita a mano, sin palabras repetidas de signo opuesto."""
    assert tone_mod.METHOD == "heuristic"
    assert len(tone_mod.LEXICON) > 150
    modificadores = set(tone_mod.INTENSIFIERS) | set(tone_mod.DOWNTONERS)
    assert not (modificadores & set(tone_mod.LEXICON)), "una palabra no puede ser polar y modificador a la vez"
    assert not (set(tone_mod.NEGATORS) & set(tone_mod.LEXICON))


def test_todos_los_titulares_grabados_reciben_un_tono_valido():
    """Pasada sobre los 80 y tantos titulares reales de los fixtures: ninguno rompe el contrato."""
    package = load_module("kaizen_api")
    with replaying(B2B_SETS):
        reset_backend_state(package)
        crudos, _notas, _proveedores = news_domain.collect(None, "all")
        items = news_domain.build_items(crudos, "all", 500)
    reset_backend_state(package)
    assert len(items) >= 40, "los fixtures tendrían que traer decenas de titulares"
    etiquetas = {"positivo": 0, "negativo": 0, "neutral": 0}
    for item in items:
        tono = item["tone"]
        assert tono["method"] == "heuristic"
        assert tono["label"] in etiquetas
        assert -1 <= tono["score"] <= 1
        assert tono["label"] == tone_mod.label_for(tono["score"])
        etiquetas[tono["label"]] += 1
    # Una heurística que etiqueta todo igual no sirve de nada: tiene que repartir.
    assert etiquetas["positivo"] > 0 and etiquetas["negativo"] > 0 and etiquetas["neutral"] > 0
