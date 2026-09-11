"use client";

import { useState } from "react";
import { AppFrame } from "./AppFrame";
import type { VictimPhoneView } from "@/lib/game-session/victim-phone-view";
import { playSound } from "@/lib/sound/sound-manager";

type Tab = "messages" | "calls" | "contacts";

const TAB_LABEL: Record<Tab, string> = { messages: "Messages", calls: "Appels", contacts: "Contacts" };

const STATUS_TEXT: Record<Exclude<VictimPhoneView["status"], "ready">, string> = {
  not_found: "Aucun appareil recensé pour l'instant. Examinez la scène de crime pour le localiser.",
  found: "Appareil découvert — envoyez-le au laboratoire pour extraction (onglet Preuves).",
  extracting: "Extraction des données en cours…",
};

/**
 * "MOBIFORENSIC" — a read-only viewer over the already-extracted forensic
 * copy of the victim's phone (req. 21). Deliberately NOT a modern
 * messaging-app clone: police-workstation visual language, no send box,
 * no online status, no read receipts — the player is looking at a static
 * extraction report, not a live device.
 */
export function PhoneApp({ view }: { view: VictimPhoneView }) {
  const [tab, setTab] = useState<Tab>("messages");
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const selectedConv = view.conversations.find((c) => c.id === selectedConvId) ?? null;

  if (view.status !== "ready") {
    return (
      <AppFrame title="Extraction mobile" system="MOBIFORENSIC — Copie forensique du téléphone" accent="blue">
        <div className="panel p-4 text-sm text-muted">{STATUS_TEXT[view.status]}</div>
      </AppFrame>
    );
  }

  return (
    <AppFrame title="Extraction mobile" system="MOBIFORENSIC — Copie forensique du téléphone de la victime" accent="blue">
      <div className="flex gap-1 border-b border-border">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => {
              playSound("click");
              setTab(t);
            }}
            className={`px-3 py-2 font-data text-[11px] uppercase tracking-wide ${
              tab === t ? "border-b-2 border-link text-link" : "text-muted hover:text-foreground"
            }`}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === "messages" && (
        <div className="grid gap-3 sm:grid-cols-[240px_1fr]">
          <div className={`flex-col gap-1 ${selectedConv ? "hidden sm:flex" : "flex"}`}>
            {view.conversations.length === 0 && <p className="panel-sunken border-dashed p-3 text-sm text-muted">Aucune conversation.</p>}
            {view.conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => {
                  playSound("click");
                  setSelectedConvId(conv.id);
                }}
                className={`panel-sunken flex flex-col gap-0.5 p-2.5 text-left text-sm ${conv.id === selectedConvId ? "border-l-2 border-l-link" : ""}`}
              >
                <p className="font-medium text-foreground">{conv.contact.displayName}</p>
                <p className="truncate text-xs text-muted">{conv.lastMessagePreview}</p>
                <p className="font-data text-[10px] text-muted">{conv.messages[conv.messages.length - 1].timeLabel}</p>
              </button>
            ))}
          </div>

          <div className={`flex-col gap-2 ${selectedConv ? "flex" : "hidden sm:flex"}`}>
            {selectedConv ? (
              <>
                <button onClick={() => setSelectedConvId(null)} className="btn btn-ghost self-start !px-2 !py-1 !text-xs sm:hidden">
                  ← Retour
                </button>
                <p className="field-label">{selectedConv.contact.displayName}</p>
                <div className="panel-sunken flex max-h-[60vh] flex-col gap-2 overflow-y-auto p-3">
                  {selectedConv.messages.map((m) => (
                    <div key={m.id} className={`flex flex-col gap-0.5 ${m.direction === "from_victim" ? "items-end" : "items-start"}`}>
                      <span className="font-data text-[9px] uppercase tracking-wide text-muted">
                        {m.direction === "from_victim" ? "Victime" : selectedConv.contact.displayName}
                      </span>
                      <span
                        className={`max-w-[80%] px-2.5 py-1.5 text-sm ${
                          m.direction === "from_victim" ? "bg-link/15 text-foreground" : "bg-surface-sunken text-foreground"
                        }`}
                      >
                        {m.content}
                      </span>
                      <span className="font-data text-[9px] text-muted">{m.timeLabel}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="panel-sunken hidden border-dashed p-3 text-sm text-muted sm:block">Sélectionnez une conversation.</p>
            )}
          </div>
        </div>
      )}

      {tab === "calls" && (
        <div className="panel-sunken overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="field-label !text-[10px] px-3 py-2 font-normal">Horodatage</th>
                <th className="field-label !text-[10px] px-3 py-2 font-normal">Contact</th>
                <th className="field-label !text-[10px] px-3 py-2 font-normal">Sens</th>
                <th className="field-label !text-[10px] px-3 py-2 font-normal">Durée</th>
              </tr>
            </thead>
            <tbody>
              {view.calls.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-muted">
                    Aucun appel enregistré.
                  </td>
                </tr>
              )}
              {view.calls.map((call) => (
                <tr key={call.id} className="border-t border-border align-top odd:bg-white/[0.015]">
                  <td className="font-data whitespace-nowrap px-3 py-2 text-muted">{call.timeLabel}</td>
                  <td className="px-3 py-2 text-foreground">{call.contact.displayName}</td>
                  <td className="px-3 py-2 text-muted">{call.direction === "incoming" ? "Entrant" : "Sortant"}</td>
                  <td className="px-3 py-2 text-muted">{call.answered ? call.durationLabel : "Sans réponse"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "contacts" && (
        <div className="flex flex-col gap-2">
          {view.conversations.length === 0 && view.calls.length === 0 && (
            <p className="panel-sunken border-dashed p-3 text-sm text-muted">Aucun contact.</p>
          )}
          {[...new Map([...view.conversations.map((c) => c.contact), ...view.calls.map((c) => c.contact)].map((c) => [c.id, c])).values()].map(
            (contact) => (
              <div key={contact.id} className="panel-sunken flex items-center justify-between p-2.5 text-sm">
                <span className="text-foreground">{contact.displayName}</span>
                <span className="font-data text-xs text-muted">{contact.phoneNumber}</span>
              </div>
            ),
          )}
        </div>
      )}
    </AppFrame>
  );
}
