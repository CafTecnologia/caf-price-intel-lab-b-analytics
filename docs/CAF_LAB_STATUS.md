# CAF Price Intelligence Lab

Laboratorio **B** del producto unico **CAF Price Intelligence**.

## Identidad

- Letra: **B**
- Nombre actual: `caf-price-intel-lab-b-analytics`
- Proyecto original: `procurement-analytics`
- Rol: Prototipo mas trabajado y amplio; tiene mas piezas pero tambien mas errores.
- Madurez: Alta en alcance, pendiente de estabilizacion

## Regla de trabajo

Este laboratorio NO se envia directo a produccion.

Se usa para comparar resultados, rescatar lo mejor y construir despues un producto unico:

```text
caf-price-intelligence
```

## Relacion con Odoo

La logica principal debe poder vivir fuera de Odoo.
Odoo debe conectarse mediante un modulo/conector, no absorber todo el laboratorio.

## Notas

Prioridad alta para rescatar UI, flujos, analitica y estructura de producto.

## Flujo Git

- `main`: foto inicial/importada estable.
- `dev/lab-evaluation`: rama de trabajo y evaluacion.
- Nuevas mejoras: usar ramas `feature/...` o `fix/...`.
