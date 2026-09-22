"""Sets de fixtures en capas: ``"base,capa"`` busca capa por capa y graba solo en la última.

Todo corre sin red: los proveedores son falsos (``yfinance.Ticker`` y ``requests.Session.request``
parchados) y los sets viven en ``tmp_path``. La prueba sobre el set real ``2026-09-22`` lo monta con
un enlace simbólico y comprueba byte por byte que grabar encima no lo toca.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import urllib.error
import urllib.request
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest
import requests

import kaizen_api
from kaizen_api.settings import configure
from tests.replay import (
    DEFAULT_SET,
    FIXTURES_ROOT,
    GOLDENS_DIR,
    FixtureSetError,
    FixtureStore,
    LayeredStore,
    ReplayMiss,
    active_session,
    check_record_spec,
    compare,
    format_sets,
    golden_name,
    install_replay,
    load_golden,
    open_sets,
    parse_sets,
    recording,
    replaying,
)

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
FRED_KEY = "http:GET https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10"


# ─── proveedores falsos ──────────────────────────────────────────────────────


class _Upstream:
    """Lo que "responde Yahoo": cuenta cada llamada real y marca la versión del dato."""

    calls: list[str] = []
    version = "v1"


class _FakeTicker:
    def __init__(self, ticker, session=None):
        self.ticker = ticker.upper()
        self.session = session

    @property
    def info(self):
        _Upstream.calls.append(f"{self.ticker}.info")
        if self.ticker == "BAD":
            raise KeyError("currentTradingPeriod")
        return {"symbol": self.ticker, "version": _Upstream.version}


def _fake_request(self, method, url, params=None, **kwargs):
    _Upstream.calls.append(f"http {url}")
    r = requests.Response()
    r.status_code = 200
    r.reason = "OK"
    r.url = url
    r.headers["Content-Type"] = "text/csv"
    r._content = f"v,{_Upstream.version}\n".encode()
    r.encoding = "utf-8"
    return r


@contextmanager
def _fake_upstream() -> Iterator[type[_Upstream]]:
    """Parcha yfinance.Ticker y requests con los falsos; al salir vuelven los reales."""
    import yfinance

    _Upstream.calls = []
    _Upstream.version = "v1"
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(yfinance, "Ticker", _FakeTicker)
        mp.setattr(requests.Session, "request", _fake_request)
        yield _Upstream
    FixtureStore.forget()


@pytest.fixture
def upstream():
    with _fake_upstream() as fake:
        yield fake


def _info(symbol: str) -> dict:
    import yfinance as yf

    return yf.Ticker(symbol).info


def _get(url: str) -> str:
    return requests.get(url, timeout=5).text


def _hashes(directory: Path) -> dict[str, str]:
    """Nombre y sha256 de cada archivo (sigue enlaces simbólicos)."""
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(directory.iterdir()) if p.is_file()}


def _index(root: Path, name: str) -> dict:
    return json.loads((root / name / "index.json").read_text(encoding="utf-8"))


def _load_script(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def base(tmp_path, upstream):
    """Set ``base`` con AAPL, un fallo grabado (BAD) y una llamada HTTP."""
    with recording("base", root=tmp_path, throttle=0):
        _info("AAPL")
        with pytest.raises(KeyError):
            _info("BAD")
        _get("https://x.test/a")
    upstream.calls.clear()
    return tmp_path


# ─── el formato del spec ─────────────────────────────────────────────────────


def test_spec_ignores_blanks_and_empty_entries():
    assert parse_sets(" base , top ,") == ["base", "top"]
    assert parse_sets("base,,top") == ["base", "top"]
    assert parse_sets(",base") == ["base"]
    assert parse_sets(["base", " top "]) == ["base", "top"]
    assert parse_sets(DEFAULT_SET) == [DEFAULT_SET]
    assert format_sets(" 2026-09-22 ,2026-09-22-b2a, ") == "2026-09-22,2026-09-22-b2a"


@pytest.mark.parametrize(
    "spec,message",
    [
        ("", "No se indicó ningún set"),
        (" , ,", "No se indicó ningún set"),
        ([], "No se indicó ningún set"),
        ("../2026-09-22", "Nombre de set inválido"),
        ("base,capa/b2a", "Nombre de set inválido"),
        (".oculto", "Nombre de set inválido"),
        ("base..b2a", "Nombre de set inválido"),
        ("base, top ,base", "aparece más de una vez"),
    ],
)
def test_bad_spec_gives_a_clear_spanish_error(spec, message):
    with pytest.raises(FixtureSetError, match=message):
        parse_sets(spec)
    with pytest.raises(FixtureSetError, match=message):
        replaying(spec).__enter__()
    assert active_session() is None


def test_blanks_in_the_spec_are_the_same_session(base):
    with replaying(" base , ", root=base) as rp:
        assert rp.set_name == "base" and rp.set_names == ["base"]
        assert _info("AAPL")["version"] == "v1"
    assert rp.misses == []


# ─── lectura capa por capa ───────────────────────────────────────────────────


def test_lookup_goes_layer_by_layer_and_the_first_hit_wins(base, upstream):
    root = base
    upstream.version = "v1-capa"
    with recording("base,top", root=root, throttle=0) as rec:
        assert _info("AAPL")["version"] == "v1"  # está en la base: sale de ahí, sin ir al proveedor
        assert _info("MSFT")["version"] == "v1-capa"  # nueva: va al proveedor y se graba en top
        assert _get("https://x.test/b") == "v,v1-capa\n"
    assert upstream.calls == ["MSFT.info", "http https://x.test/b"]
    assert rec.stats["base_hits"] == 1

    # Después alguien graba MSFT también en la base (con otro dato): ahora la base la sombrea.
    upstream.version = "v2-base"
    with recording("base", root=root, throttle=0):
        assert _info("MSFT")["version"] == "v2-base"
    upstream.calls.clear()

    with replaying("base,top", root=root) as rp:
        assert _info("AAPL")["version"] == "v1"
        assert _info("MSFT")["version"] == "v2-base"  # base primero: gana aunque top también la tenga
        assert _get("https://x.test/b") == "v,v1-capa\n"  # solo está en top
        layer, _ = rp.store.locate("yf:MSFT:info")
        assert layer.name == "base"
        assert rp.store.locate("http:GET https://x.test/b")[0].name == "top"
    assert rp.misses == []

    with replaying("top,base", root=root) as rp:  # el orden manda
        assert _info("MSFT")["version"] == "v1-capa"
        assert _info("AAPL")["version"] == "v1"  # no está en top: la busca en base
    assert rp.misses == []

    with replaying("top", root=root) as rp:  # una capa sola no ve lo de abajo
        with pytest.raises(ReplayMiss):
            _info("AAPL")
    assert rp.misses == ["yf:AAPL:info"]
    assert upstream.calls == []  # el replay nunca llamó al proveedor


def test_a_miss_is_a_miss_only_after_every_layer(base, upstream):
    with recording("base,top", root=base, throttle=0):
        _info("MSFT")
    upstream.calls.clear()
    with replaying("base,top", root=base) as rp:
        with pytest.raises(ReplayMiss) as miss:
            _info("NVDA")
        with pytest.raises(ReplayMiss):
            try:
                _get("https://x.test/nunca")
            except Exception:
                pytest.fail("ReplayMiss fue atrapado por except Exception")
    assert rp.misses == ["yf:NVDA:info", "http:GET https://x.test/nunca"]
    assert str(miss.value) == "Llamada no grabada en ninguno de los sets 'base', 'top': yf:NVDA:info"
    assert upstream.calls == []


# ─── grabación solo en la última capa ────────────────────────────────────────


def test_recording_writes_only_the_last_layer_and_never_the_base(base, upstream):
    root = base
    before = _hashes(root / "base")
    index_before = (root / "base" / "index.json").read_bytes()
    upstream.version = "v9"
    with recording("base,top", root=root, throttle=0, refresh=True) as rec:
        assert _info("AAPL")["version"] == "v1"  # ni con refresh se vuelve a pedir lo de la base
        with pytest.raises(KeyError):
            _info("BAD")  # el fallo grabado en la base se sirve tal cual, no se "arregla" en top
        assert _info("MSFT")["version"] == "v9"
        assert _get("https://x.test/c") == "v,v9\n"
    assert upstream.calls == ["MSFT.info", "http https://x.test/c"]
    assert rec.stats["base_hits"] == 2 and rec.stats["live"] == 2

    assert _hashes(root / "base") == before
    assert (root / "base" / "index.json").read_bytes() == index_before

    top = _index(root, "top")
    assert sorted(top["entries"]) == ["http:GET https://x.test/c", "yf:MSFT:info"]
    assert top["set"] == "top" and top["layered_on"] == ["base"]
    assert top["frozen_at"] == _index(root, "base")["frozen_at"]  # hereda el reloj de la base
    assert set(_hashes(root / "top")) == {"index.json", *(e["file"] for e in top["entries"].values())}

    # Una segunda corrida sobre la misma pila solo agrega a top.
    with recording("base,top", root=root, throttle=0):
        _info("GOOG")
    assert _hashes(root / "base") == before
    assert sorted(_index(root, "top")["entries"]) == ["http:GET https://x.test/c", "yf:GOOG:info", "yf:MSFT:info"]


def test_recording_over_the_real_committed_set_never_writes_it(tmp_path, upstream):
    real = FIXTURES_ROOT / DEFAULT_SET
    (tmp_path / DEFAULT_SET).symlink_to(real, target_is_directory=True)
    before = _hashes(real)
    fred_alone = None
    with replaying(DEFAULT_SET) as rp:
        fred_alone = _get("https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10")
    assert rp.misses == []

    spec = f"{DEFAULT_SET},{DEFAULT_SET}-prueba"
    with recording(spec, root=tmp_path, throttle=0) as rec:
        assert _info("AAPL")["symbol"] == "AAPL"  # grabada el 22 sep: sale del set real
        assert _get("https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10") == fred_alone
        assert _info("ZZZCAPA")["version"] == "v1"  # nueva: a la capa
    assert upstream.calls == ["ZZZCAPA.info"]
    assert rec.stats["base_hits"] == 2
    assert rec.store.locate(FRED_KEY)[0].name == DEFAULT_SET

    assert _hashes(real) == before  # ni un byte del set real cambió
    top = _index(tmp_path, f"{DEFAULT_SET}-prueba")
    assert list(top["entries"]) == ["yf:ZZZCAPA:info"]
    assert top["frozen_at"] == FixtureStore.open(DEFAULT_SET).frozen_at == "2026-09-22T14:51:31+00:00"

    with replaying(spec, root=tmp_path) as rp:
        assert _get("https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10") == fred_alone
        assert _info("ZZZCAPA")["version"] == "v1"
        assert rp.frozen_at.isoformat() == "2026-09-22T14:51:31+00:00"
    assert rp.misses == []


# ─── el set base no se toca por accidente ────────────────────────────────────


def test_a_comma_that_collapsed_into_one_layer_refuses_to_record(base, upstream):
    """``--set "base,$CAPA"`` con ``$CAPA`` sin definir escribiría en la base: mejor un error."""
    before = _hashes(base / "base")
    for spec in ("base,", " base , ", ",base"):
        with pytest.raises(FixtureSetError, match="trae coma pero se quedó en una sola capa"):
            recording(spec, root=base).__enter__()
    assert active_session() is None
    assert upstream.calls == [] and _hashes(base / "base") == before

    # parse_sets y format_sets siguen tolerantes (leer nunca escribe), y el replay también.
    assert parse_sets("base,") == ["base"] and format_sets(" base , ") == "base"
    with replaying("base,", root=base) as rp:
        assert _info("AAPL")["version"] == "v1"
    assert rp.misses == []
    # Sin coma no hay nada que reclamar, ni con lista.
    assert check_record_spec("base") == ["base"] and check_record_spec(["base"]) == ["base"]
    with recording("base,otra-capa", root=base, throttle=0) as rec:
        assert rec.store.top.name == "otra-capa"


def test_writing_into_the_shared_base_set_has_to_be_explicit(tmp_path, upstream):
    """La última capa es a donde se graba: si es el set base compartido, se pide a propósito."""
    with pytest.raises(FixtureSetError, match="Graba en tu propia capa"):
        recording(DEFAULT_SET, root=tmp_path).__enter__()
    with pytest.raises(FixtureSetError, match="Graba en tu propia capa"):
        recording(f"otra,{DEFAULT_SET}", root=tmp_path).__enter__()
    assert active_session() is None
    assert not (tmp_path / DEFAULT_SET).exists() and upstream.calls == []

    with recording(DEFAULT_SET, root=tmp_path, throttle=0, allow_base=True):
        _info("AAPL")
    assert list(_index(tmp_path, DEFAULT_SET)["entries"]) == ["yf:AAPL:info"]


def test_a_layer_that_records_nothing_is_not_created(base, upstream):
    """Hoy las rutas de fase 2 responden 501: la primera corrida de cada stream no graba nada."""
    with recording("base,vacia", root=base, throttle=0) as rec:
        assert _info("AAPL")["version"] == "v1"  # todo sale de la base
    assert rec.stats["base_hits"] == 1 and upstream.calls == []
    assert not (base / "vacia").exists()

    # Y el error de replay dice qué pasó, en vez de dejar a alguien buscando la carpeta.
    with pytest.raises(FileNotFoundError, match="no grabó ninguna llamada no se crea"):
        replaying("base,vacia", root=base).__enter__()
    assert active_session() is None

    # En cuanto graba algo, la capa se crea con su índice completo.
    with recording("base,vacia", root=base, throttle=0):
        _info("MSFT")
    assert list(_index(base, "vacia")["entries"]) == ["yf:MSFT:info"]
    assert _index(base, "vacia")["layered_on"] == ["base"]


# ─── sets que no existen o no cuadran ────────────────────────────────────────


def test_unknown_set_gives_a_clear_spanish_error(base, upstream):
    with pytest.raises(FileNotFoundError) as err:
        replaying("base,no-existe", root=base).__enter__()
    text = str(err.value)
    assert "No existe el set grabado 'no-existe'" in text and "Sets disponibles" in text and "base" in text
    with pytest.raises(FileNotFoundError, match="No existe el set grabado 'no-existe'"):
        replaying("no-existe", root=base).__enter__()
    with pytest.raises(FileNotFoundError, match="No existe el set grabado 'no-existe'"):
        install_replay("base,no-existe", root=base)
    assert active_session() is None
    # Al grabar, la base tiene que existir: un typo en la base no puede volver "nueva" cada llamada.
    with pytest.raises(FileNotFoundError, match="las capas base tienen que existir"):
        recording("no-existe,top", root=base).__enter__()
    assert not (base / "top").exists()
    assert [layer.name for layer in open_sets("base,no-existe", base).missing()] == ["no-existe"]


def test_layers_with_different_clocks_are_rejected(base):
    other = base / "otro"
    other.mkdir()
    (other / "index.json").write_text(
        json.dumps({"set": "otro", "frozen_at": "2020-01-02T00:00:00+00:00", "entries": {}}), encoding="utf-8"
    )
    with pytest.raises(FixtureSetError, match="no comparten reloj"):
        replaying("base,otro", root=base).__enter__()
    assert active_session() is None


def test_single_set_behaves_as_before(tmp_path, upstream):
    with recording("solo", root=tmp_path, throttle=0):
        _info("AAPL")
    index = _index(tmp_path, "solo")
    assert {"set", "frozen_at", "created_at", "yfinance_version"} <= set(index) and "layered_on" not in index
    assert isinstance(FixtureStore.open("solo", tmp_path), FixtureStore)
    assert isinstance(FixtureStore.open("solo,otra", tmp_path), LayeredStore)
    with replaying("solo", root=tmp_path) as rp:
        with pytest.raises(ReplayMiss) as miss:
            _info("MSFT")
    assert str(miss.value) == "Llamada no grabada en el set 'solo': yf:MSFT:info"
    assert rp.store.names == ["solo"] and rp.store.top.dir == tmp_path / "solo"


# ─── puntos de entrada: servidor de replay y grabador ────────────────────────


def test_replay_server_serves_a_layered_spec(tmp_path, monkeypatch, capsys):
    for var in ("KAIZEN_ENV", "AUTH_REQUIRED", "KAIZEN_LEGACY_ROUTES", "USERS", "SECRET_KEY"):
        monkeypatch.delenv(var, raising=False)
    runner = _load_script("run_replay_backend")
    (tmp_path / DEFAULT_SET).symlink_to(FIXTURES_ROOT / DEFAULT_SET, target_is_directory=True)
    spec = f"{DEFAULT_SET},{DEFAULT_SET}-srv"
    with _fake_upstream() as fake, recording(spec, root=tmp_path, throttle=0):
        _info("ZZZSRV")
    assert fake.calls == ["ZZZSRV.info"]
    # El servidor usa el yfinance real (la superficie de Ticker que el legado necesita), sin red.

    configure(None)
    session, module = runner.start(runner.DEFAULT_MODULE, f" {spec} ,", root=tmp_path)
    try:
        assert session.set_name == spec and session.store.names == [DEFAULT_SET, f"{DEFAULT_SET}-srv"]
        kaizen_api.reset_state()
        module.__dict__.pop("app", None)
        with runner.ServerThread(runner.asgi_app(module)) as url:
            with urllib.request.urlopen(url + "/stock/AAPL", timeout=30) as resp:
                body = json.loads(resp.read())
            golden = load_golden(GOLDENS_DIR / golden_name("get_stock", ["AAPL"], {}))
            assert compare(body, golden["output"], volatile=golden["volatile_paths"]) == []
            try:
                urllib.request.urlopen(url + "/stock/NOTRECORDED2", timeout=30)
            except urllib.error.HTTPError as err:
                miss = json.loads(err.read())
                assert err.code == 500 and miss["error"] == "ReplayMiss"
                assert f"ninguno de los sets '{DEFAULT_SET}', '{DEFAULT_SET}-srv'" in miss["detail"]
        session.misses.clear()
    finally:
        session.uninstall()
        module.__dict__.pop("app", None)
        configure(None)

    # La variable de entorno es el --set por omisión; un set desconocido sale con 2 y mensaje claro.
    monkeypatch.setenv("KAIZEN_REPLAY_SET", f"{DEFAULT_SET},no-existe-xyz")
    monkeypatch.setattr(sys, "argv", ["run_replay_backend.py", "--port", "0"])
    assert runner.main() == 2
    assert "No existe el set grabado 'no-existe-xyz'" in capsys.readouterr().err
    assert active_session() is None


def test_record_fixtures_layers_entry_point(tmp_path, monkeypatch, capsys):
    recorder = _load_script("record_fixtures")
    (tmp_path / DEFAULT_SET).symlink_to(FIXTURES_ROOT / DEFAULT_SET, target_is_directory=True)
    before = _hashes(FIXTURES_ROOT / DEFAULT_SET)
    goldens_before = _hashes(GOLDENS_DIR)
    for var in recorder.SECRET_ENV_VARS:
        monkeypatch.delenv(var, raising=False)

    def run(*argv: str) -> int:
        monkeypatch.setattr(sys, "argv", ["record_fixtures.py", *argv])
        return recorder.main()

    # --get graba en la última capa y verifica el replay de toda la pila.
    spec = f"{DEFAULT_SET},{DEFAULT_SET}-rec"
    assert (
        run("--root", str(tmp_path), "--set", spec, "--throttle", "0", "--get", "/stock/AAPL", "--get", "health") == 0
    )
    out = capsys.readouterr().out
    assert f"graba en={DEFAULT_SET}-rec" in out and "todas las rutas se reproducen completas" in out
    # Todo salió de la base (y la guarda de red del conftest falla si algo hubiera salido a la red),
    # así que la capa no grabó nada y NO se creó: nadie commitea una carpeta con un index vacío.
    assert not (tmp_path / f"{DEFAULT_SET}-rec").exists()
    assert "no grabó ninguna llamada, la capa no se creó" in out

    # Con algo grabado sí se crea, con su propio index.json y el reloj de la base.
    with _fake_upstream(), recording(spec, root=tmp_path, throttle=0):
        _info("ZZZREC")
    top = _index(tmp_path, f"{DEFAULT_SET}-rec")
    assert list(top["entries"]) == ["yf:ZZZREC:info"] and top["layered_on"] == [DEFAULT_SET]
    assert top["frozen_at"] == "2026-09-22T14:51:31+00:00"
    # Sin red: solo verificar.
    assert run("--root", str(tmp_path), "--set", spec, "--get", "/stock/AAPL", "--goldens-only") == 0
    capsys.readouterr()

    # Con varias capas y sin --get no se regeneran los goldens del legado en su carpeta.
    assert run("--root", str(tmp_path), "--set", spec, "--goldens-only") == 2
    assert "los de tests/goldens_legacy quedan fijos en el set base" in capsys.readouterr().out
    assert run("--set", " , ") == 2
    assert "No se indicó ningún set" in capsys.readouterr().out
    # Una coma que se quedó en una sola capa (--set "2026-09-22,$CAPA" con $CAPA vacía) no graba.
    assert run("--root", str(tmp_path), "--set", f"{DEFAULT_SET},", "--get", "/health") == 2
    assert "trae coma pero se quedó en una sola capa" in capsys.readouterr().out
    # Y grabar en el set base se pide a propósito.
    assert run("--root", str(tmp_path), "--set", DEFAULT_SET, "--throttle", "0", "--get", "/health") == 2
    assert "Graba en tu propia capa" in capsys.readouterr().out
    assert run("--root", str(tmp_path), "--set", f"{DEFAULT_SET},falta,{DEFAULT_SET}-rec", "--get", "/health") == 2
    assert "No existe el set grabado 'falta'" in capsys.readouterr().out

    assert _hashes(FIXTURES_ROOT / DEFAULT_SET) == before
    assert _hashes(GOLDENS_DIR) == goldens_before
    assert active_session() is None


def test_leaked_tokens_are_reported(tmp_path, monkeypatch):
    recorder = _load_script("record_fixtures")
    layer = tmp_path / "capa"
    layer.mkdir()
    (layer / "http-banxico.json").write_text('{"url": "https://x.test/?token=abcdef123456"}', encoding="utf-8")
    (layer / "limpio.json").write_text('{"url": "https://x.test/"}', encoding="utf-8")
    for var in recorder.SECRET_ENV_VARS:
        monkeypatch.delenv(var, raising=False)
    assert recorder.leaked_secrets(layer) == []
    monkeypatch.setenv("BANXICO_TOKEN", "abcdef123456")
    assert recorder.leaked_secrets(layer) == ["http-banxico.json: contiene el valor de BANXICO_TOKEN"]
