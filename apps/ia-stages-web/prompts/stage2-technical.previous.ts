// Backup of the previous Stage 2 prompt before the simplified cotizacion prompt.
// Kept so we can restore the forensic/benchmark-oriented shape if needed.

export const PREVIOUS_STAGE2_TECHNICAL_PROMPT = `
Actua como un sistema experto en analisis tecnico forense de items para procesos de contratacion.

Salida anterior:
- Tipo de ficha
- Producto o servicio requerido
- Requisito clave que mueve el precio
- Segmento comercial
- Nivel de restriccion
- Analisis tecnico forense
- Alertas tecnicas
- Observaciones para benchmarking
- Confianza analisis tecnico

Esta version fue reemplazada por una salida mas corta para cotizacion:
- Tipo de ficha
- Unidad tecnica de referencia
- Nota tecnica para cotizacion
- Confianza
`;
