# DEPLOY TO PROD CHECKLIST

Antes de pasar algo a produccion:

- Pruebas pasadas en DEV.
- Pruebas pasadas en el clon de produccion si aplica.
- Cambios en rama Git, no directo en main.
- Commit limpio con solo los archivos del cambio.
- Push a GitHub o patch auditado si GitHub no esta disponible.
- Revision humana del diff.
- Backup de PROD hecho.
- Backup externo en Drive verificado.
- Cambios confirmados en Git.
- Rama revisada por humano.
- Version etiquetada.
- Instrucciones de rollback listas.
- Ventana de mantenimiento definida.
- Confirmacion humana final.

Flujo permitido:

1. DEV: desarrollar en rama, probar y commitear.
2. GitHub: publicar rama/tag aprobado.
3. PROD: hacer backup, traer codigo desde GitHub, actualizar modulo Odoo, validar.
4. DEV: traer el mismo commit aprobado para que el clon quede alineado.

Reglas para agentes IA:

- No usar SSH a produccion sin aprobacion explicita del humano para ese despliegue.
- No copiar carpetas o archivos sueltos a produccion saltandose Git.
- No ejecutar comandos destructivos sin aprobacion explicita.
- No mostrar ni guardar secretos en repositorios, logs o documentacion.
- Antes de actualizar Odoo en produccion, confirmar base de datos, modulo, commit y rollback.
