import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOdooConnection } from "../lib/odoo-proxy";

test("el puente Odoo acepta solo el origen DEV configurado", () => {
  const connection = normalizeOdooConnection({
    baseUrl: "http://127.0.0.1:18069/",
    db: "caf_prod_clone",
    token: "1234567890abcdef1234567890abcdef"
  });
  assert.deepEqual(connection, {
    baseUrl: "http://127.0.0.1:18069",
    db: "caf_prod_clone",
    token: "1234567890abcdef1234567890abcdef"
  });
});

test("el puente Odoo rechaza destinos arbitrarios y bases inválidas", () => {
  assert.throws(
    () => normalizeOdooConnection({
      baseUrl: "https://example.com",
      db: "caf_prod_clone",
      token: "1234567890abcdef1234567890abcdef"
    }),
    /no está autorizado/
  );
  assert.throws(
    () => normalizeOdooConnection({
      baseUrl: "http://127.0.0.1:18069",
      db: "../otra-base",
      token: "1234567890abcdef1234567890abcdef"
    }),
    /base Odoo no es válida/
  );
});
