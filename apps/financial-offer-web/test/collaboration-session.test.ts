import { describe, expect, it } from "vitest";
import { isOdooLoginRedirect } from "../lib/odoo-collaboration";

describe("sesión de colaboración del cálculo", () => {
  it("reconoce el redireccionamiento de Odoo al login antes de interpretar JSON", () => {
    expect(isOdooLoginRedirect(new Response(null, { status: 303, headers: { Location: "/web/login" } }))).toBe(true);
    expect(isOdooLoginRedirect(new Response("{}", { status: 200 }))).toBe(false);
  });
});
