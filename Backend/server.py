from simulator.main import (
    processSimulation,
    get_simulation_timeout,
    SimulationConfigurationError,
    SimulationExecutionError,
    SimulationInternalError,
    SimulationTimeoutError,
)
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)


@app.route('/simulation-config', methods=['GET'])
def simulationConfig():
    try:
        return jsonify({"timeoutSeconds": get_simulation_timeout()})
    except SimulationConfigurationError as error:
        app.logger.error("Invalid simulation configuration: %s", error)
        return jsonify({"error": str(error)}), 500


@app.route('/simulate', methods=['POST'])
def startSimulation():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Se esperaba un objeto JSON."}), 400

    rules = data.get("content")
    if not isinstance(rules, str) or not rules.strip():
        return jsonify({"error": "content debe contener las reglas de simulación."}), 400

    diagram_xml = data.get("diagramXML")
    if "diagramXML" in data and (not isinstance(diagram_xml, str) or not diagram_xml.strip()):
        return jsonify({"error": "diagramXML debe contener un documento BPMN válido."}), 400

    try:
        result = processSimulation(rules.strip(), diagram_xml=diagram_xml)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except SimulationTimeoutError as error:
        return jsonify({"error": str(error)}), 504
    except SimulationExecutionError as error:
        return jsonify({"error": str(error)}), 422
    except SimulationConfigurationError as error:
        app.logger.error("Invalid simulation configuration: %s", error)
        return jsonify({"error": str(error)}), 500
    except (SimulationInternalError, OSError):
        app.logger.exception("Simulation failed.")
        return jsonify({"error": "No se pudo completar la simulación. Consulta la consola del Backend."}), 500
    except Exception:
        app.logger.exception("Unexpected simulation error.")
        return jsonify({"error": "Error interno del simulador. Consulta la consola del Backend."}), 500

    return jsonify({"simulation": result.simulation, "warnings": result.warnings})

if __name__ == '__main__':
    app.run(port=3000, debug=False)
