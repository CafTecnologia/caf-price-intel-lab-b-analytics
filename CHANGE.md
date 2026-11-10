# Simplificación del estudio financiero CAF

Pedido de Carlos, 10 de noviembre de 2026: comprobar los archivos de la carpeta,
encargar el estudio a la IA con su skill y recibir una entrega válida para Finanzas.

El candidato elimina del recorrido inicial la fase obligatoria de inventario, el
bloqueo del navegador durante esa fase y el segundo motor de recuperación por
bloques con reglas propias. La skill conserva la responsabilidad de leer,
investigar y guardar. Los avances existentes se restauran con la identidad del
mismo expediente y quedan legibles para el usuario del ejecutor.

También retira el corte de 25 documentos, los rechazos por longitud del texto del
estudio y la exigencia fija de modelo/esfuerzo en el contrato de entrada. La
paginación de Drive entrega todos los archivos de la carpeta; conserva los
controles de acceso, identidad y límites físicos del transporte/parser.

El mensaje Odoo se reduce al encargo y al formato de entrega; se eliminan las
reglas comerciales paralelas que ese mensaje repetía o añadía a la skill. El
validador final usa el esquema real de Finanzas. Un archivo de inventario temporal
no impide importar una entrega final válida. JSON inválido o ausente sigue siendo
un fallo de entrega. La skill y su esquema no se editan.

La pasarela recibe la carpeta real del ejecutor en cada petición de inferencia,
incluso al compactar. El proveedor recibe una separación explícita entre su
entorno temporal y el entorno donde se ejecutan las herramientas. Esta información
no crea otra autorización ni otra compuerta de negocio.

Validación en Cloud y VPS DEV (dev2): 9 casos Node y 4 Python pasan, incluidos archivos >25, texto >350000
caracteres, paginación y subcarpetas, cantidades/unidades desconocidas,
restauración, contexto contaminado, contrato real válido y rechazo de JSON
inválido. Pruebas de sintaxis y whitespace correctas. No se lanzó IA ni se
reinició un análisis de negocio; la respuesta real del modelo tras la
compactación debe verificarse después de activar el candidato.

El mismo candidato aislado está en Cloud y en DEV: `/opt/caf-dev/worktrees/financial-simple-cloud-20261110`. Está construido sobre las fuentes
servidas de CAF. No se ha instalado en los servicios vivos. Los JSON
*-snapshot.json registran rutas y hashes de preimagen; no son configuración.
Los contratos de Salud se actualizan en el candidato, sin otro monitor.

La instalación debe usar los publicadores y gates existentes, comparar las
preimágenes, conservar cambios concurrentes y promover solo los archivos del
delta. La lista revisable y el patch están en candidate-manifest.json y change.patch.

Ampliación comprobada: conserva captura_documental.json e investigacion_checkpoint.json, presentes en el proyecto SENA Distrito Capital CSF. Los 13 casos vuelven a pasar. El supervisor vigente previo a publicación devuelve cero fallos.

Corrección de recuperación: una entrega final válida se conserva y valida sin exigir inventory.json, incluso si el proceso agotó su tiempo. Dos regresiones nuevas; 11 casos Node y 4 Python pasan. Mantiene el rechazo del JSON inválido.

Causa confirmada del rechazo de publicación: host.outcome.dev_test_api_gateway conservaba un pin estricto del registro global completo, además del pin de su propio contrato. Se aplica el helper canónico ya existente repair_gateway_bindings50.migrate para retirar dos referencias comunes no ejecutables. Permanecen los pins ejecutables, el contrato propio y el cierre de la pasarela. Seis comprobaciones sintéticas prueban el rechazo anterior, aceptación de cambios ajenos y rechazo de alteración propia/exposición. No se modifica el código del supervisor ni se excluye su check.
