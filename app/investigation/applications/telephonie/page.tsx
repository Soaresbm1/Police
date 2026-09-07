import { TelephonieApp } from "@/components/investigation/apps/TelephonieApp";

export default async function TelephoniePage({ searchParams }: { searchParams: Promise<{ tel?: string }> }) {
  const params = await searchParams;
  return <TelephonieApp initialQuery={params.tel} />;
}
