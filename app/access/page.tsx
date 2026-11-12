import { headers } from "next/headers";

export default async function AccessPage(props: { searchParams: Promise<{ reason?: string }> }) {
  const [requestHeaders, params] = await Promise.all([headers(), props.searchParams]);
  const host = requestHeaders.get("host") ?? "";
  const local = /^(127\.0\.0\.1|localhost):18030$/.exec(host);
  const loginUrl = local ? `http://${local[1]}:18069/web/login` : "/web/login";
  const unavailable = params.reason === "unavailable";
  const forbidden = params.reason === "forbidden";
  const title = unavailable ? "No pudimos verificar tu sesión" : forbidden ? "Tu usuario no tiene acceso a Finanzas" : "Inicia sesión en Odoo";
  const detail = unavailable
    ? "Odoo no respondió. Vuelve a intentar cuando esté disponible; Finanzas permanece cerrada mientras tanto."
    : forbidden
      ? "Solicita a tu administrador el acceso interno a Odoo y al módulo de Finanzas."
      : "Abre Odoo, inicia sesión y luego vuelve a esta pestaña para actualizarla.";
  return (
    <main style={{ maxWidth: 520, margin: "12vh auto", padding: "24px", fontFamily: "system-ui, sans-serif", color: "#24392b" }}>
      <section style={{ padding: "28px", border: "1px solid #cfd9d0", borderRadius: 14, background: "#fffefa" }}>
        <h1 style={{ marginTop: 0, fontSize: "1.6rem" }}>{title}</h1>
        <p style={{ lineHeight: 1.55 }}>{detail}</p>
        {!unavailable && !forbidden ? (
          <a href={loginUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", padding: "11px 16px", borderRadius: 8, background: "#27613f", color: "white", fontWeight: 700, textDecoration: "none" }}>
            Abrir Odoo{local ? " DEV" : ""}
          </a>
        ) : null}
      </section>
    </main>
  );
}
