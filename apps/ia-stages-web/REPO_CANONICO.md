# Repo canónico del equipo

El **Git principal** de la suite IA + financiero vive en:

`C:\Users\Cande\gestion-proyectos\prueba\ia-financial-suite`

Esta carpeta (`ia-app-financial-bridge-20260502-151500`) sigue siendo la **fuente de trabajo** hasta que migren el día a día al monorepo; para sincronizar hacia el repo unificado:

```powershell
cd ..\..\ia-financial-suite
powershell -ExecutionPolicy Bypass -File .\scripts\sync-from-sources.ps1
```

Ver `ia-financial-suite\docs\LINEAGE.md` para forks y snapshots históricos (no se borraron).
