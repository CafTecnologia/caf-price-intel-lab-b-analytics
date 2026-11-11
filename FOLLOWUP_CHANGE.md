# Conservación del soporte y continuación de estudios v3

Se conserva soporte_finanzas.md como respaldo de una entrega cuando soporte.md no contiene texto. El mismo archivo se incluye en el checkpoint y su restauración, sin eliminar las verificaciones de archivo regular, tamaño y hash.

El contexto de una solicitud posterior acepta versiones2 y3, igual que el estudio inicial. Conserva validación, coincidencia de proyecto/tarea/revisión/cálculo y verificación de la entrega previa. No cambia la autorización de escritura.

Nueve regresiones con fixture sintética y validador real pasan, incluyendo guardado/reapertura, solicitud repetida sin duplicados, conservación del estudio inicial y denegación de proyecto distinto. El código anterior falló en los casos nuevos; el runner inicial --test no pudo lanzar su subproceso y se utilizó ejecución inline Node con el mismo rol dev2 sin cambiar permisos.

Sin cambios productivos ni datos financieros modificados. Promover únicamente el delta de ai/study-runs.mjs y ai/finance-dialogue-context.mjs sobre las preimágenes del manifiesto. Los symlinks de dependencias se usan solo para el ensayo DEV y no forman parte del paquete.
