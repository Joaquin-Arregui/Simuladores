#!/usr/bin/env python3
"""Los diagramas del banco contra el esquema oficial de BPMN 2.0 (5.2).

    python3 pruebas/valida_esquema.py

Que un fichero abra en otra herramienta no lo dice solo bpmn-moddle, que es
tolerante; una herramienta estricta lo compara con el esquema XSD de la
especificacion, y lo que no cumple no lo acepta. Aqui se hace lo mismo con los
ficheros de pruebas/esquema-bpmn/ -los de OMG para BPMN 2.0, espacio de nombres
20100524-:

- `integracion/` -- tienen que cumplir el esquema todos: son lo que guarda el
  Modeler, y desde la 5.2 las listas de personas van en bpmn:extensionElements,
  el unico sitio donde el esquema admite elementos de otros espacios de nombres.
- `integracion-con-error/` -- tambien: estan rotos para el simulador, no para
  BPMN. Salvo el que no es XML a proposito, `--xml-mal-formado`, que tiene que
  seguir sin poder leerse.
- `exportadas/` -- tambien: son esos mismos diagramas tal como los guarda el
  Modeler, con su propio codigo (exporta_reglas.mjs, 5.4).
- `Modeler/ejemplos/` -- tambien: estan dibujados y guardados en el Modeler
  (5.6), y son lo primero que abrira quien empiece a usarlo.
- `formato-anterior/` -- NO pueden cumplirlo, y el primer error tiene que ser
  una lista de personas del Modeler fuera de extensionElements: es la razon de
  la 5.2, y lo que demuestra que esta comprobacion distingue un fichero bueno
  de uno malo.

Necesita lxml, que viene con PM4Py (pip install lxml).
"""
from pathlib import Path

from lxml import etree

AQUI = Path(__file__).resolve().parent
ESQUEMA = AQUI / "esquema-bpmn" / "BPMN20.xsd"
# Los espacios de nombres de los descriptores del Modeler (Modeler/descriptors/).
DEL_MODELER = ("http://user", "http://lane", "http://participantWithoutLane", "http://model",
               "http://collaboration", "http://sequenceFlow")
GRUPOS = ((AQUI / "integracion", "cumple"), (AQUI / "integracion-con-error", "cumple"),
          (AQUI / "exportadas", "cumple"), (AQUI.parent.parent / "Modeler" / "ejemplos", "cumple"),
          (AQUI / "formato-anterior", "no cumple"))


def errores(esquema, ruta):
    """Los errores de un fichero contra el esquema, o None si no es XML."""
    try:
        documento = etree.parse(str(ruta), etree.XMLParser(resolve_entities=False, no_network=True))
    except etree.XMLSyntaxError:
        return None
    esquema.validate(documento)
    return list(esquema.error_log)


def main():
    if not ESQUEMA.exists():
        print(f"No esta el esquema de BPMN 2.0: {ESQUEMA}.")
        return 1
    esquema = etree.XMLSchema(etree.parse(str(ESQUEMA)))
    fallos = total = 0
    for ruta_carpeta, previsto in GRUPOS:
        # En la salida, las del banco por su nombre y los ejemplos desde la raiz.
        carpeta = (ruta_carpeta.name if ruta_carpeta.parent == AQUI
                   else ruta_carpeta.relative_to(AQUI.parent.parent).as_posix())
        ficheros = sorted(ruta_carpeta.glob("*.bpmn"))
        if not ficheros:
            # Una carpeta vacia no es una validacion correcta: es haber perdido los diagramas.
            print(f"{carpeta + '/':38} FALTA  no hay ningun diagrama .bpmn")
            fallos += 1
        for ruta in ficheros:
            total += 1
            nombre = f"{carpeta}/{ruta.name}"
            lista = errores(esquema, ruta)
            if lista is None:
                if ruta.stem.endswith("--xml-mal-formado"):
                    print(f"{nombre:38} ok      no es XML, como se pretende")
                else:
                    print(f"{nombre:38} NO ES XML")
                    fallos += 1
            elif previsto == "cumple":
                if lista:
                    print(f"{nombre:38} NO CUMPLE el esquema")
                    for error in lista[:5]:
                        print(f"         linea {error.line}: {error.message}")
                    fallos += 1
                else:
                    print(f"{nombre:38} ok      cumple el esquema de BPMN 2.0")
            elif not lista:
                print(f"{nombre:38} CUMPLE  y tenia que tener las listas fuera de extensionElements")
                fallos += 1
            elif not any(f"{{{ns}}}" in lista[0].message for ns in DEL_MODELER):
                print(f"{nombre:38} OTRO ERROR  {lista[0].message}")
                fallos += 1
            else:
                print(f"{nombre:38} ok      no cumple, por una lista del Modeler fuera de extensionElements")
    print()
    if fallos:
        print(f"Esquema en rojo: {fallos} problema(s).")
        return 1
    print(f"Esquema en verde: {total} diagramas.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
