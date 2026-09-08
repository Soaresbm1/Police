import type { Evidence, EvidenceReliability } from "@/lib/game-engine/types/evidence";
import { formatGameTime } from "@/lib/game-engine/types/time";
import { hashSeed, pickRange } from "./hash";
import { rendererKindForEvidence, type EvidenceRendererKind } from "./evidence-kind";
import { buildCCTVFrameDescriptor } from "./cctv";
import { buildCCTVFrameSvg } from "./cctv-renderer";

export { rendererKindForEvidence };

export const EVIDENCE_KIND_LABEL: Record<EvidenceRendererKind, string> = {
  weapon: "Photographie d'arme",
  forensic_physical: "Fiche de comparaison forensique",
  digital_communication: "Extraction de communication",
  digital_technical: "Relevé technique numérique",
  geolocation: "Relevé de géolocalisation",
  camera_footage: "Image de vidéosurveillance",
  financial: "Relevé financier",
  witness_statement: "Transcription de témoignage",
  tampering: "Photographie d'altération",
};

const RELIABILITY_TONE: Record<EvidenceReliability, string> = {
  reliable: "#6c9c72",
  partial: "#c9a23d",
  ambiguous: "#c9a23d",
  contaminated: "#b8493e",
  falsified: "#b8493e",
};

function evidenceCode(id: string): string {
  return `EV-${((hashSeed(id) % 9000) + 1000).toString()}`;
}

function frame(children: string, bg = "#0b0c0f"): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160"><rect width="240" height="160" fill="${bg}" />${children}<rect x="0.5" y="0.5" width="239" height="159" fill="none" stroke="#40444d" stroke-width="1" /></svg>`;
}

function weaponSvg(evidence: Evidence): string {
  const seed = hashSeed(evidence.id);
  const angle = -18 + (seed % 36);
  const tone = RELIABILITY_TONE[evidence.reliability];
  return frame(
    `<g transform="translate(120 80) rotate(${angle})">` +
      `<rect x="-70" y="-4" width="140" height="8" rx="0" fill="#8c8f97" fill-opacity="0.5" />` +
      `<rect x="40" y="-9" width="24" height="18" fill="#5c5f66" fill-opacity="0.6" />` +
      `</g>` +
      `<line x1="10" y1="140" x2="230" y2="140" stroke="${tone}" stroke-width="1" />` +
      Array.from({ length: 12 }, (_, i) => `<line x1="${10 + i * 20}" y1="136" x2="${10 + i * 20}" y2="140" stroke="${tone}" stroke-width="1" />`).join(""),
    "#100e0c",
  );
}

function forensicSvg(evidence: Evidence): string {
  const seed = hashSeed(evidence.id);
  const dots = Array.from({ length: 40 }, (_, i) => {
    const x = 14 + ((seed + i * 37) % 100);
    const y = 14 + ((seed + i * 53) % 130);
    return `<circle cx="${x}" cy="${y}" r="0.6" fill="#e8e6de" fill-opacity="0.5" />`;
  }).join("");
  return frame(
    `<rect x="10" y="10" width="104" height="140" fill="none" stroke="#40444d" stroke-dasharray="3 2" />` +
      `<rect x="126" y="10" width="104" height="140" fill="none" stroke="#40444d" stroke-dasharray="3 2" />` +
      dots +
      `<text x="62" y="158" font-family="ui-monospace, monospace" font-size="8" fill="#8c8f97" text-anchor="middle">ÉCHANTILLON</text>` +
      `<text x="178" y="158" font-family="ui-monospace, monospace" font-size="8" fill="#8c8f97" text-anchor="middle">RÉFÉRENCE</text>`,
  );
}

function communicationSvg(): string {
  return frame(
    `<rect x="16" y="12" width="208" height="136" fill="#17191e" />` +
      `<rect x="28" y="24" width="150" height="26" fill="#2a2d34" />` +
      `<rect x="62" y="58" width="150" height="26" fill="#3a3020" />` +
      `<rect x="28" y="92" width="120" height="26" fill="#2a2d34" />` +
      Array.from({ length: 4 }, (_, i) => `<line x1="16" y1="${140 - i * 8}" x2="224" y2="${140 - i * 8}" stroke="#0b0c0f" stroke-opacity="0.3" />`).join(""),
  );
}

function technicalSvg(evidence: Evidence): string {
  const seed = hashSeed(evidence.id);
  const rows = Array.from({ length: 8 }, (_, i) => {
    const w = 40 + ((seed + i * 19) % 140);
    return `<rect x="16" y="${16 + i * 16}" width="${w}" height="6" fill="#5c8ab0" fill-opacity="${0.15 + (i % 3) * 0.1}" />`;
  }).join("");
  return frame(rows);
}

function geolocationSvg(): string {
  return frame(
    `<circle cx="120" cy="80" r="14" fill="none" stroke="#5c8ab0" stroke-opacity="0.5" />` +
      `<circle cx="120" cy="80" r="34" fill="none" stroke="#5c8ab0" stroke-opacity="0.3" />` +
      `<circle cx="120" cy="80" r="54" fill="none" stroke="#5c8ab0" stroke-opacity="0.15" />` +
      `<path d="M 120 60 L 128 84 L 120 78 L 112 84 Z" fill="#d4a256" />`,
  );
}

function financialSvg(evidence: Evidence): string {
  const seed = hashSeed(evidence.id);
  const rows = Array.from({ length: 5 }, (_, i) => {
    const amount = 40 + ((seed + i * 97) % 900);
    return (
      `<line x1="16" y1="${30 + i * 24}" x2="224" y2="${30 + i * 24}" stroke="#2a2d34" />` +
      `<text x="216" y="${26 + i * 24}" font-family="ui-monospace, monospace" font-size="9" fill="#8c8f97" text-anchor="end">CHF ${amount}.–</text>`
    );
  }).join("");
  return frame(rows);
}

function witnessSvg(): string {
  return frame(
    `<text x="20" y="30" font-family="ui-monospace, monospace" font-size="26" fill="#40444d">“</text>` +
      Array.from({ length: 5 }, (_, i) => `<rect x="20" y="${44 + i * 16}" width="${140 + (i % 3) * 30}" height="4" fill="#e8e6de" fill-opacity="0.18" />`).join(""),
  );
}

function tamperingSvg(evidence: Evidence): string {
  const seed = hashSeed(evidence.id);
  const cx = 80 + (seed % 80);
  const cy = 60 + (seed % 40);
  return frame(
    `<circle cx="${cx}" cy="${cy}" r="22" fill="none" stroke="#b8493e" stroke-width="1.5" stroke-dasharray="3 2" />` +
      `<line x1="${cx}" y1="${cy - 30}" x2="${cx}" y2="${cy - 24}" stroke="#b8493e" stroke-width="1.5" />` +
      `<text x="120" y="150" font-family="ui-monospace, monospace" font-size="8" fill="#b8493e" text-anchor="middle" letter-spacing="1">ALTÉRATION DÉTECTÉE</text>`,
  );
}

function cameraSvg(evidence: Evidence): string {
  const descriptor = buildCCTVFrameDescriptor(evidence);
  const svg = buildCCTVFrameSvg(descriptor, pickRange(`${evidence.id}:count`, 1, 2));
  // The CCTV renderer already returns a complete, framed SVG at its own
  // aspect ratio — reuse it directly rather than wrapping it again.
  return svg;
}

const RENDERERS: Record<EvidenceRendererKind, (evidence: Evidence) => string> = {
  weapon: weaponSvg,
  forensic_physical: forensicSvg,
  digital_communication: communicationSvg,
  digital_technical: technicalSvg,
  geolocation: geolocationSvg,
  camera_footage: cameraSvg,
  financial: financialSvg,
  witness_statement: witnessSvg,
  tampering: tamperingSvg,
};

export function buildEvidenceVisualSvg(evidence: Evidence): string {
  const kind = rendererKindForEvidence(evidence.type);
  return RENDERERS[kind](evidence);
}

export function evidenceVisualDataUri(evidence: Evidence): string {
  return `data:image/svg+xml,${encodeURIComponent(buildEvidenceVisualSvg(evidence))}`;
}

/** Server-renderable presentational visual for one evidence item — a
 * specialized look per `EvidenceRendererKind` instead of one generic card
 * (req. 8), always stamped with the evidence's own id/timestamp/family so
 * it reads as a real forensic exhibit rather than decoration. */
export function EvidenceVisual({ evidence, className }: { evidence: Evidence; className?: string }) {
  const kind = rendererKindForEvidence(evidence.type);
  return (
    <div className={`relative overflow-hidden border border-border-strong bg-surface-sunken ${className ?? ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={evidenceVisualDataUri(evidence)} alt="" className="block h-full w-full" />
      <span className="data-id absolute left-1.5 top-1 bg-background-deep/70 px-1 text-[9px]">{evidenceCode(evidence.id)}</span>
      <span className="absolute bottom-1 right-1.5 bg-background-deep/70 px-1 font-data text-[8px] uppercase tracking-wide text-muted">
        {EVIDENCE_KIND_LABEL[kind]}
      </span>
    </div>
  );
}

export function evidenceTimestampLabel(evidence: Evidence): string {
  return formatGameTime(evidence.timestamp);
}
