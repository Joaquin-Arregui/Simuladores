#!/usr/bin/env python3
"""Ejecuta los modelos de referencia y congela su XES en pruebas/esperado/.

    python3 pruebas/congelar.py

Dos fases, y el orden importa: primero ejecuta TODOS los modelos en memoria, y
solo escribe si todos han pasado. Un congelado a medias es peor que ninguno,
porque la regresion compararia contra una mezcla de referencias viejas y nuevas
sin que nadie se entere.

Que cuenta como pasar depende de la categoria (ver banco.py): un modelo de
`modelos/` tiene que correr sin un solo aviso; uno de `modelos-con-avisos/`
tiene que correr emitiendo alguno, y sus avisos se congelan junto al XES; uno de
`modelos-con-error/` tiene que fallar, y se congela el tipo y el mensaje del
error. Un error interno no se congela: es un fallo del motor, no un diagnostico,
asi que deja el banco en rojo y no se escribe nada.
"""
import banco


def ejecuta_todos():
    """Devuelve (resultados, problemas) sin tocar el disco."""
    resultados, problemas = [], []
    for ruta, admite_avisos in banco.modelos():
        nombre = banco.etiqueta(ruta, admite_avisos)
        try:
            resultado = banco.ejecuta(ruta)
        except Exception as error:
            print("%-34s ERROR   %s: %s" % (nombre, type(error).__name__, error))
            problemas.append(nombre)
            continue
        if resultado.warnings and not admite_avisos:
            print("%-34s AVISOS INESPERADOS" % nombre)
            for aviso in resultado.warnings:
                print("         %s" % aviso)
            problemas.append(nombre)
            continue
        if admite_avisos and not resultado.warnings:
            print("%-34s NO AVISA   esta en modelos-con-avisos pero no emite ninguno" % nombre)
            problemas.append(nombre)
            continue
        print("%-34s ok      %d trazas, %d eventos%s" %
              (nombre, resultado.simulation.count("<trace>"), resultado.simulation.count("<event>"),
               ", %d aviso(s)" % len(resultado.warnings) if admite_avisos else ""))
        resultados.append((ruta, admite_avisos, resultado))
    return resultados, problemas


def ejecuta_los_de_error():
    """Devuelve (referencias, problemas) de los modelos que tienen que fallar."""
    referencias, problemas = [], []
    for ruta in banco.modelos_con_error():
        nombre = banco.etiqueta_error(ruta)
        texto, previsto = banco.ejecuta_con_error(ruta)
        if texto is None:
            print("%-34s TERMINA BIEN   esta en modelos-con-error y no falla" % nombre)
            problemas.append(nombre)
            continue
        if not previsto:
            print("%-34s ERROR INTERNO  %s" % (nombre, texto))
            print("         solo se congelan los errores previstos: %s"
                  % ", ".join(banco.ERRORES_PREVISTOS))
            problemas.append(nombre)
            continue
        print("%-34s ok      %s" % (nombre, texto))
        referencias.append((ruta, texto))
    return referencias, problemas


def main():
    problemas = banco.faltan_grupos(*banco.GRUPOS_DEL_BANCO)
    if problemas:
        for problema in problemas:
            print("Falta un grupo del banco: %s." % problema)
        print("No se congela nada: un banco incompleto no puede dar referencias.")
        return 1

    resultados, problemas = ejecuta_todos()
    errores, problemas_error = ejecuta_los_de_error()
    problemas = problemas + problemas_error
    if not resultados and not errores and not problemas:
        print("No hay ningun modelo que congelar.")
        return 1
    if problemas:
        print()
        print("No se ha escrito nada. Han fallado: %s." % ", ".join(problemas))
        print("Las referencias de esperado/ se quedan como estaban.")
        return 1

    banco.ESPERADO.mkdir(exist_ok=True)
    banco.ESPERADO_CON_AVISOS.mkdir(parents=True, exist_ok=True)
    if errores:
        banco.ESPERADO_CON_ERROR.mkdir(parents=True, exist_ok=True)
    for ruta, admite_avisos, resultado in resultados:
        banco.ruta_xes(ruta, admite_avisos).write_text(resultado.simulation, encoding="utf-8")
        if admite_avisos:
            banco.escribe_avisos(ruta, resultado.warnings)
    for ruta, texto in errores:
        banco.escribe_error(ruta, texto)
    print()
    print("Congeladas %d referencias." % (len(resultados) + len(errores)))
    huerfanas = banco.referencias_huerfanas()
    if huerfanas:
        print("Quedan referencias sin modelo (borralas a mano): %s"
              % ", ".join(str(p) for p in huerfanas))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
