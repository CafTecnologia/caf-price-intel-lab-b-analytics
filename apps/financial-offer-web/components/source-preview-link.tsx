"use client";

import { useState } from "react";

import { appPath } from "@offer/lib/base-path";

type Preview = { title: string; description: string; image: string | null; hostname: string };

export function SourcePreviewLink(props: { href: string; label?: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);

  async function load() {
    if (loaded) return;
    setLoaded(true);
    setMessage("Consultando vista previa...");
    const response = await fetch(appPath(`/api/source-preview?url=${encodeURIComponent(props.href)}`));
    const data = await response.json();
    if (response.ok) {
      setPreview(data);
      setMessage("");
    } else setMessage(data.error ?? "Vista previa no disponible.");
  }

  return (
    <span className="source-preview" onMouseEnter={() => void load()} onFocus={() => void load()}>
      <a href={props.href} target="_blank" rel="noreferrer">{props.label ?? "Abrir"}</a>
      <span className="source-preview-card" role="tooltip">
        {preview?.image ? <img src={preview.image} alt="" loading="lazy" /> : null}
        {preview ? <><strong>{preview.title}</strong><small>{preview.hostname}</small><span>{preview.description || "Sin descripcion publicada."}</span></> : <span>{message || "Acerca el puntero para consultar."}</span>}
      </span>
    </span>
  );
}
