from datetime import datetime, timezone
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
from tempfile import TemporaryDirectory
from typing import List, NamedTuple
import xml.etree.ElementTree as ET

from simulator.parser import aplica_marcas_del_diagrama, parse_bpmn_elements
from simulator.generateScript import DEFAULT_START_DATE, generateScript
from simulator.validation import (validate_diagram_correspondence, validate_diagram_xml,
                                  validate_simulation)


DEFAULT_TIMEOUT_SECONDS = 300
# Largest seed that stays exact in JavaScript (Number.MAX_SAFE_INTEGER) and in an XES int.
MAX_SEED = 2**53 - 1


class SimulationResult(NamedTuple):
    simulation: str
    warnings: List[str]
    seed: int


class SimulationConfigurationError(RuntimeError):
    pass


class SimulationTimeoutError(RuntimeError):
    pass


class SimulationExecutionError(RuntimeError):
    """A valid input model cannot finish its simulated execution."""


class SimulationInternalError(RuntimeError):
    """Unexpected generator, child process or output error; details are logged."""


def get_simulation_timeout() -> int:
    value = os.environ.get("SIMULATION_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS))
    try:
        seconds = int(value)
    except (TypeError, ValueError) as error:
        raise SimulationConfigurationError(
            "SIMULATION_TIMEOUT_SECONDS debe ser un número entero positivo."
        ) from error
    if seconds <= 0:
        raise SimulationConfigurationError(
            "SIMULATION_TIMEOUT_SECONDS debe ser un número entero positivo."
        )
    return seconds


def get_simulation_start_date() -> str:
    """Date and time of simulated second 0 in the XES log (UTC if no offset is given)."""
    value = os.environ.get("SIMULATION_START_DATE", DEFAULT_START_DATE).strip()
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise SimulationConfigurationError(
            "SIMULATION_START_DATE debe ser una fecha ISO 8601, por ejemplo 2026-01-01T00:00:00+00:00."
        ) from error
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.isoformat()


def resolve_seed(value=None) -> int:
    """Seed for every random draw of a run: the given one or, if empty, a new one.

    Accepts a non-negative integer or its decimal text. Negative values are
    rejected because random.seed() ignores the sign, so -7 would repeat 7.
    """
    if value is None or (isinstance(value, str) and not value.strip()):
        # Short enough to read off the log and type back in.
        return secrets.randbelow(2**32)
    if isinstance(value, str) and value.strip().isascii() and value.strip().isdigit():
        value = int(value.strip())
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= MAX_SEED:
        raise ValueError(
            f"seed debe ser un entero entre 0 y {MAX_SEED}; si se deja vacío, el motor genera una semilla."
        )
    return value


# Keep diagnostic files inside the same temporary directory as the simulation.
CHILD_RUNNER = """
import json
from pathlib import Path
import runpy
import traceback

try:
    runpy.run_path('simulation.py', run_name='__main__')
except Exception as error:
    Path('failure.json').write_text(json.dumps({
        'type': type(error).__name__,
        'message': str(error),
    }, ensure_ascii=False), encoding='utf-8')
    traceback.print_exc()
    raise SystemExit(1)
"""


def processSimulation(rules: str, *, diagram_xml=None, timeout_seconds=None, seed=None) -> SimulationResult:
    """Validate and run BPMN rules; return the XES, any warnings and the seed used.

    The same rules, seed and start date always produce the same XES. Without a
    seed, one is generated; either way the log records it.
    """
    if not isinstance(rules, str) or not rules.strip():
        raise ValueError("Faltan las reglas de simulación en content.")
    if timeout_seconds is None:
        timeout_seconds = get_simulation_timeout()
    if isinstance(timeout_seconds, bool) or not isinstance(timeout_seconds, int) or timeout_seconds <= 0:
        raise SimulationConfigurationError("El límite de ejecución debe ser un entero positivo.")
    start_date = get_simulation_start_date()
    seed = resolve_seed(seed)
    warnings = []
    diagram_root = None
    if diagram_xml is not None:
        diagram_root = validate_diagram_xml(diagram_xml, warnings)
    elements, process, starts, message_starts = parse_bpmn_elements(rules, warnings)
    # La marca de multiinstancia sale del dibujo (3.1), antes de validar nada,
    # para que la validacion vea el modelo que se va a simular.
    if diagram_root is not None:
        aplica_marcas_del_diagrama(elements, diagram_root)
    validate_simulation(elements, process, starts, message_starts, warnings)
    # Con las dos cosas validadas por separado, que cuenten el mismo modelo.
    if diagram_root is not None:
        validate_diagram_correspondence(elements, diagram_root, process)
    script, _ = generateScript(elements, process, starts, message_starts,
                               start_date=start_date, seed=seed)

    with TemporaryDirectory(prefix="simbpmn-") as directory:
        workdir = Path(directory)
        script_path = workdir / "simulation.py"
        script_path.write_text(script, encoding="utf-8")
        try:
            subprocess.run(
                [sys.executable, "-c", CHILD_RUNNER],
                cwd=workdir,
                check=True,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout_seconds,
                # Fixed string hashing: set iteration order cannot vary between runs.
                env={**os.environ, "PYTHONHASHSEED": "0"},
            )
        except subprocess.TimeoutExpired as error:
            raise SimulationTimeoutError(
                f"La simulación ha superado el límite de {timeout_seconds} segundos y se ha detenido. "
                "Revisa los ciclos y las esperas por mensajes o datos."
            ) from error
        except subprocess.CalledProcessError as error:
            failure_path = workdir / "failure.json"
            if failure_path.is_file():
                try:
                    failure = json.loads(failure_path.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    failure = {}
                if failure.get("type") in {"SimulationError", "ValueError"}:
                    raise SimulationExecutionError(failure["message"]) from error
            raise SimulationInternalError(error.stderr or "El proceso de simulación falló.") from error

        result_path = workdir / "resultSimulation.xes"
        if not result_path.is_file():
            raise SimulationInternalError("La simulación terminó sin generar el registro XES.")
        result = result_path.read_text(encoding="utf-8")
        try:
            document = ET.fromstring(result)
        except ET.ParseError as error:
            raise SimulationInternalError("El simulador generó un registro XES no válido.") from error
        if document.tag != "{http://www.xes-standard.org/}log":
            raise SimulationInternalError("El resultado no es un registro XES.")
        return SimulationResult(result, warnings, seed)
