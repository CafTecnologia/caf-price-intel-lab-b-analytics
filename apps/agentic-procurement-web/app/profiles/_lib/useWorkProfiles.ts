"use client";

import { useCallback, useEffect, useState } from "react";
import {
  appPath,
  type Launch,
  type OdooConnection,
  type TestCase,
  type WorkProfile,
  type WorkProfileRun
} from "./shared";

type Options = { withTestCases?: boolean };

/**
 * Estado compartido por las tres rutas: perfiles publicados, ejecuciones del
 * proyecto y, solo para el laboratorio, el banco de pruebas.
 */
export function useWorkProfiles(launch: Launch | null, options: Options = {}) {
  const withTestCases = options.withTestCases ?? false;
  const [profiles, setProfiles] = useState<WorkProfile[]>([]);
  const [runs, setRuns] = useState<WorkProfileRun[]>([]);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [loaded, setLoaded] = useState(false);

  const projectId = launch?.project?.id;
  const processNumber = launch?.project?.processNumber;

  const refresh = useCallback(async () => {
    const runQuery = new URLSearchParams();
    if (projectId) runQuery.set("projectId", projectId);
    else if (processNumber) runQuery.set("processNumber", processNumber);
    const runPath = `/api/work-runs${runQuery.size ? `?${runQuery}` : ""}`;

    const requests: Promise<Response>[] = [
      fetch(appPath("/api/work-profiles"), { cache: "no-store" }),
      fetch(appPath(runPath), { cache: "no-store" })
    ];
    if (withTestCases) requests.push(fetch(appPath("/api/work-profile-test-cases"), { cache: "no-store" }));

    const responses = await Promise.all(requests);
    const [profileData, runData, testCaseData] = await Promise.all(responses.map((response) => response.json()));
    setProfiles(profileData.profiles || []);
    setRuns(runData.runs || []);
    if (withTestCases) setTestCases(testCaseData?.cases || []);
    setLoaded(true);
  }, [projectId, processNumber, withTestCases]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { profiles, runs, testCases, loaded, refresh };
}

/**
 * Lee el lanzamiento de Odoo desde la URL. Devuelve null mientras no exista un
 * launchToken valido, que es el caso de las rutas de administracion.
 */
export function useOdooLaunch(onError?: (message: string) => void) {
  const [launch, setLaunch] = useState<Launch | null>(null);
  const [connection, setConnection] = useState<OdooConnection | null>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("launchToken") || "";
    const baseUrl = (params.get("odooBaseUrl") || "").replace(/\/+$/, "");
    const db = params.get("odooDb") || "";
    if (!token || !baseUrl || !db) { setResolved(true); return; }
    const current = { token, baseUrl, db };
    setConnection(current);
    const query = new URLSearchParams(current);
    void fetch(appPath(`/api/odoo/launch?${query}`))
      .then((response) => response.json())
      .then((data) => {
        if (!data.launch) throw new Error(data.error || "Odoo no devolvio el proyecto.");
        setLaunch(data.launch);
      })
      .catch((cause) => onError?.(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setResolved(true));
    // onError se omite a proposito: solo debe leerse el lanzamiento una vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { launch, connection, resolved };
}

export type ProviderHealth = {
  ok: boolean;
  status: string;
  provider: { id: string; label: string; description: string; model?: string };
  diagnostic?: { code: string; title: string; detail: string; userAction: string };
};

/** Proveedores disponibles con su estado real, para no ofrecer uno caido. */
export function useProviders() {
  const [providers, setProviders] = useState<ProviderHealth[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void fetch(appPath("/api/providers"), { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => setProviders(data.providers || []))
      .catch(() => setProviders([]))
      .finally(() => setLoaded(true));
  }, []);
  return { providers, providersLoaded: loaded };
}
