"use client";

import { useMemo, useState } from "react";

export interface PersonOption {
  id: string;
  name: string;
  detail: string;
}

export function PersonPicker({
  people,
  onSelect,
  placeholder = "Nom de famille...",
}: {
  people: PersonOption[];
  onSelect: (personId: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return people.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8);
  }, [query, people]);

  return (
    <div className="panel p-4">
      <label className="field-label">Rechercher une personne</label>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className="mt-2 w-full border border-border-strong bg-surface-sunken px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
      />
      {query.trim().length >= 2 && (
        <div className="mt-2 flex flex-col gap-1">
          {matches.length === 0 ? (
            <p className="text-xs text-muted">Aucune correspondance dans le fichier central de la population.</p>
          ) : (
            matches.map((p) => (
              <button
                key={p.id}
                onClick={() => onSelect(p.id)}
                className="border border-border-strong px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:border-accent hover:bg-surface-raised"
              >
                {p.name} <span className="text-xs text-muted">— {p.detail}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
