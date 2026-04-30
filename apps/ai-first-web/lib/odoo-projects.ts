import "server-only";

export type OdooProjectOption = {
  id: number;
  name: string;
};

export async function fetchOdooProjectOptions(params: { id?: number | string; q?: string; limit?: number } = {}): Promise<OdooProjectOption[]> {
  const upstream = new URL(
    process.env.ODOO_PROJECTS_API_URL ??
      "http://caf-dev-odoo:8069/caf_financial_analysis_b/api/projects",
  );
  upstream.searchParams.set("limit", String(params.limit ?? 120));
  if (params.id) {
    upstream.searchParams.set("id", String(params.id));
  }
  if (params.q?.trim()) {
    upstream.searchParams.set("q", params.q.trim());
  }

  const response = await fetch(upstream, {
    cache: "no-store",
    headers: {
      "X-Odoo-Database": process.env.ODOO_DATABASE ?? "caf_prod_clone",
    },
  });
  if (!response.ok) {
    throw new Error(`No fue posible consultar proyectos de Odoo: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { projects?: unknown };
  if (!Array.isArray(payload.projects)) {
    return [];
  }

  return payload.projects
    .map((project) => {
      if (!project || typeof project !== "object") {
        return null;
      }
      const id = "id" in project && typeof project.id === "number" ? project.id : null;
      const name = "name" in project && typeof project.name === "string" ? project.name : null;
      return id && name ? { id, name } : null;
    })
    .filter((project): project is OdooProjectOption => Boolean(project));
}

export async function fetchOdooProjectOptionById(id: number | string): Promise<OdooProjectOption | null> {
  const projects = await fetchOdooProjectOptions({ id, limit: 1 });
  return projects[0] ?? null;
}
