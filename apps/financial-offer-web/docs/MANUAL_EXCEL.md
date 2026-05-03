# Carga Manual Y Plantilla Excel

La app permite trabajar sin IA y sin integracion automatica.

## Crear calculo manual

1. Abre la pantalla principal.
2. Crea un borrador.
3. Entra al calculo.
4. Agrega filas.
5. Escribe los datos editables en la tabla.
6. Usa `Guardar`.

Los campos calculados no se editan directamente.

En modo manual puedes:

- agregar 1 item o 5 filas;
- editar nombre, ficha, cantidad, unidad, precio techo y costo manual;
- escoger el costo aplicado por item;
- ajustar la oferta por descuento, utilidad objetivo o valor manual;
- guardar el calculo para retomarlo despues.

## Descargar plantilla

```text
GET /api/template
```

## Columnas principales

| Columna | Que escribir |
| --- | --- |
| `item` | Numero o codigo del item. |
| `description` | Nombre del producto o servicio. |
| `technical_description` | Detalle tecnico si existe. |
| `quantity` | Cantidad. |
| `unit` | Unidad. |
| `reference_unit` | Precio techo unitario. |
| `notes` | Observaciones. |

## Fuentes

Para cada item se pueden escribir hasta 3 fuentes:

| Columna | Que escribir |
| --- | --- |
| `source_1_name` | Proveedor, tienda o fuente. |
| `source_1_price` | Precio unitario. |
| `source_1_currency` | `COP` o `USD`. |
| `source_1_url` | Enlace si existe. |
| `source_1_trm` | TRM especifica si la fuente esta en USD. |
| `source_1_import_pct` | Importacion especifica, por defecto 30. |

Repite lo mismo con `source_2_*` y `source_3_*`.

## Ejemplo

| item | description | quantity | unit | reference_unit | source_1_price | source_1_currency | source_2_price | source_2_currency |
| --- | --- | ---: | --- | ---: | ---: | --- | ---: | --- |
| 1 | Taladro percutor profesional | 2 | UND | 350000 | 210000 | COP | 55 | USD |
| 2 | Caja de tornillos | 5 | CAJA | 42000 | 28000 | COP | 31000 | COP |

## Ejemplo completo de la app

El boton `Usar ejemplo` carga un laboratorio con 8 items. Sirve para probar:

- fuente COP;
- fuente USD con importacion;
- item incompleto sin costo;
- item incompleto sin techo;
- costo mayor al techo;
- item exento de IVA.

La app calcula los escenarios financieros. La plantilla solo debe traer datos normalizados de entrada.

## Importante

- Si faltan costos, la app muestra parcial y bloquea total.
- La TRM global se puede ajustar en la barra del simulador.
- La calculadora TRM del encabezado es una herramienta de apoyo.
- La plantilla Excel descargable se genera desde el mismo ejemplo base para mantener los campos alineados.
