const SOURCE_URL = "https://models.dev/api.json";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const upstream = await fetch(SOURCE_URL, {
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
    });

    if (!upstream.ok) {
      return Response.json(
        {
          error: `models.dev returned ${upstream.status}`,
          source: SOURCE_URL,
        },
        {
          status: 502,
          headers: {
            "Cache-Control": "no-store, max-age=0",
          },
        },
      );
    }

    const data = await upstream.json();

    return Response.json(data, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Unable to load data",
        source: SOURCE_URL,
      },
      {
        status: 502,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }
}
