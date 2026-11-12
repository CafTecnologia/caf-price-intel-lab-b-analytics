# VPS Workflow (Canonico)

Este proyecto se opera en modo VPS-first:

- Codigo fuente canonico: /opt/caf-dev/repos/caf-price-intel-lab-b-analytics/apps/financial-offer-web
- Runtime canonico: contenedor caf-dev-app-financial-offer-web (puerto 18030 en loopback).
- La PC se usa como cliente (chat/editor/tunel), no como runtime de la app.
- No dar tareas por cerradas sin validar en VPS (curl http://127.0.0.1:18030/).

Relacion con la suite:
- Extraccion de datos estrategicos: /opt/caf-dev/repos/caf-price-intel-lab-b-analytics/apps/ia-stages-web (puerto 18031).
