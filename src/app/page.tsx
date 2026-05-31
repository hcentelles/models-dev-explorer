import { ModelsTable } from "@/components/models-table";

const SOURCE_URL = "https://models.dev/api.json";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  let payload = null;
  let error = null;

  try {
    const response = await fetch(SOURCE_URL, {
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`models.dev returned ${response.status}`);
    }

    payload = await response.json();
  } catch (loadError) {
    error = loadError instanceof Error ? loadError.message : "Unable to load data";
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <ModelsTable
        initialError={error}
        initialFetchedAt={payload ? new Date().toISOString() : null}
        initialPayload={payload}
      />
    </main>
  );
}
