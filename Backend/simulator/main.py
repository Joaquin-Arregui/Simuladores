import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import xml.etree.ElementTree as ET

from simulator.parser import parse_bpmn_elements
from simulator.generateScript import generateScript
from simulator.validation import validate_diagram_xml, validate_simulation


DEFAULT_TIMEOUT_SECONDS = 300


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


def processSimulation(rules: str, *, diagram_xml=None, timeout_seconds=None) -> str:
    """Validate and run BPMN rules; return XES only when execution completes."""
    if not isinstance(rules, str) or not rules.strip():
        raise ValueError("Faltan las reglas de simulación en content.")
    if timeout_seconds is None:
        timeout_seconds = get_simulation_timeout()
    if isinstance(timeout_seconds, bool) or not isinstance(timeout_seconds, int) or timeout_seconds <= 0:
        raise SimulationConfigurationError("El límite de ejecución debe ser un entero positivo.")
    if diagram_xml is not None:
        validate_diagram_xml(diagram_xml)
    elements, process, starts, message_starts = parse_bpmn_elements(rules)
    validate_simulation(elements, process, starts, message_starts)
    script, _ = generateScript(elements, process, starts, message_starts)

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
        return result
