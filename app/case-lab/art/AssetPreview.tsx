"use client";

import { useState } from "react";

/**
 * Dev-only preview for one `ready` generated asset: a clickable thumbnail
 * (opens the full signed URL) plus a client-side dimension check — the
 * browser decodes the REAL stored bytes fetched from Supabase Storage
 * (not a fresh Cloudflare response) and reports `naturalWidth`/
 * `naturalHeight`, so a stale/assumed value recorded in `generated_assets`
 * at generation time (e.g. an old hardcoded fallback) is visibly caught
 * without ever calling the provider again.
 */
export function AssetPreview({ src, dbWidth, dbHeight }: { src: string; dbWidth: number | null; dbHeight: number | null }) {
  const [actual, setActual] = useState<{ width: number; height: number } | null>(null);

  const mismatch = actual && dbWidth && dbHeight && (actual.width !== dbWidth || actual.height !== dbHeight);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <a href={src} target="_blank" rel="noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          width={40}
          height={40}
          style={{ objectFit: "cover", border: "1px solid #484f58" }}
          onLoad={(e) => setActual({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
        />
      </a>
      <span style={{ fontSize: 11, color: mismatch ? "#b8493e" : "#8a94a6" }}>
        {actual ? `${actual.width}×${actual.height} réel` : "décodage…"}
        {mismatch && ` (DB: ${dbWidth}×${dbHeight})`}
      </span>
    </div>
  );
}
