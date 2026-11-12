# Plantilla Excel - Carga Humana

La plantilla está pensada para que una persona pegue datos en el orden normal de una licitación:

1. datos del ítem;
2. fuente 1;
3. fuente 2;
4. fuente 3.
5. servicio o costo asociado al ítem (si aplica).

La segunda hoja, `Costos generales`, registra costos del proyecto que no pertenecen a un ítem.

## Columnas

| Grupo | Columna | Nivel | Qué escribir |
| --- | --- | --- | --- |
| Ítem | Item | Opcional | Número o código del ítem. |
| Ítem | Nombre | Obligatorio | Nombre corto del producto o servicio. |
| Ítem | Descripción | Opcional | Ficha técnica o detalle ampliado. |
| Ítem | Und de medida | Recomendado | UND, M, KG, HORA, CAJA, etc. |
| Ítem | Cant | Recomendado | Cantidad. |
| Ítem | Precio techo unitario | Recomendado | Precio máximo unitario permitido. |
| Ítem | Notas del ítem | Opcional | Comentarios generales. |
| Fuente 1 | Proveedor 1 | Recomendado | Nombre del proveedor o fuente. |
| Fuente 1 | Precio proveedor 1 | Recomendado | Precio unitario encontrado. |
| Fuente 1 | Moneda proveedor 1 | Recomendado | COP o USD. Si queda vacío, se asume COP. |
| Fuente 1 | URL proveedor 1 | Opcional | Link de trazabilidad. |
| Fuente 1 | Notas proveedor 1 | Opcional | Comparabilidad, alerta o comentario. |
| Fuente 1 | TRM proveedor 1 | Opcional | Solo si esa fuente está en USD y trae TRM propia. |
| Fuente 2 | Proveedor 2 | Recomendado | Segunda fuente. |
| Fuente 2 | Precio proveedor 2 | Recomendado | Precio unitario. |
| Fuente 2 | Moneda proveedor 2 | Recomendado | COP o USD. |
| Fuente 2 | URL proveedor 2 | Opcional | Link. |
| Fuente 2 | Notas proveedor 2 | Opcional | Comentario. |
| Fuente 2 | TRM proveedor 2 | Opcional | TRM específica. |
| Fuente 3 | Proveedor 3 | Recomendado | Tercera fuente. |
| Fuente 3 | Precio proveedor 3 | Recomendado | Precio unitario. |
| Fuente 3 | Moneda proveedor 3 | Recomendado | COP o USD. |
| Fuente 3 | URL proveedor 3 | Opcional | Link. |
| Fuente 3 | Notas proveedor 3 | Opcional | Comentario. |
| Fuente 3 | TRM proveedor 3 | Opcional | TRM específica. |
| Costo de ítem | Tiene costo asociado | Opcional | Sí/No. Si es Sí y falta el valor, queda pendiente en la app. |
| Costo de ítem | Servicio o costo asociado | Opcional | Nombre del servicio o costo; una entrada por ítem en Excel. |
| Costo de ítem | Valor costo asociado | Opcional | Valor conocido; en blanco conserva el pendiente. |
| Costo de ítem | Tipo costo asociado | Opcional | `service`, `logistics` u `other`. Por defecto `service`. |
| Costo de ítem | Aplicación costo asociado | Opcional | `fixed` una vez o `per_unit` por unidad. Por defecto `fixed`. |

En `Costos generales`, cada fila diligenciada necesita `Nombre` y `Valor` numérico no negativo. `Categoría` (`service`, `logistics`, `other`) y `Nota` son opcionales. Para **varios costos asociados a un mismo ítem**, usar JSON `additional_costs`; la plantilla Excel admite uno por fila.

La plantilla descargable incluye colores suaves por sección y una hoja de instrucciones.

## Qué no debe traer Excel

No debe traer costos calculados, costo manual, fuente elegida, modo de costo/oferta, descuentos, utilidad, margen, alertas ni totales. Eso lo calcula o lo ajusta el simulador.
