import { VehiculesApp } from "@/components/investigation/apps/VehiculesApp";

export default async function VehiculesPage({ searchParams }: { searchParams: Promise<{ plate?: string }> }) {
  const params = await searchParams;
  return <VehiculesApp initialQuery={params.plate} />;
}
