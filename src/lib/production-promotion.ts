const api = "https://api.github.com/repos/Parkgod98/Hamster_Algorithm";
const domain = "hamsteralgorithm.vercel.app";
const botId = 35613825;

type Actor = { id?: number; login?: string };
type Deployment = { id: number; sha: string; environment: string; creator?: Actor };
type Status = { state: string; environment_url: string; created_at: string; creator?: Actor };
type Environment = Record<string, string | undefined>;
const fromVercel = (actor?: Actor) => actor?.id === botId && actor.login === "vercel[bot]";

export function liveDeployment(request: Request, env: Environment) {
  const sha = env.VERCEL_GIT_COMMIT_SHA, host = env.VERCEL_URL;
  if (env.VERCEL_ENV !== "production" || env.VERCEL_GIT_COMMIT_REF !== "main" || !sha || !/^[a-f\d]{40}$/.test(sha) ||
      !host || !/^hamsteralgorithm-[a-z0-9]+-parkgod\.vercel\.app$/.test(host) ||
      new URL(request.url).origin !== "https://" + domain || request.headers.get("x-hamster-release-sha") !== sha) return null;
  return {sha, host};
}

// Read GitHub's public, Vercel-authored success record independently. Inputs
// are fixed by the server's live deployment. The caller cannot select a date.
export async function promotionTime(live: {sha: string; host: string}, request: typeof fetch = fetch, now = Date.now()) {
  async function list<T>(path: string): Promise<T[]> {
    const response = await request(api + path, {headers: {Accept: "application/vnd.github+json", "User-Agent": "hamster-release-check"},
      redirect: "error", signal: AbortSignal.timeout(5000), next: {revalidate: 30}});
    if (!response.ok) throw new Error("GitHub deployment evidence unavailable");
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error("Invalid GitHub deployment response");
    return rows;
  }
  const deployments = await list<Deployment>("/deployments?environment=Production&per_page=5&sha=" + live.sha);
  for (const deployment of deployments) {
    if (!Number.isSafeInteger(deployment.id) || deployment.id <= 0 || deployment.sha !== live.sha ||
        deployment.environment !== "Production" || !fromVercel(deployment.creator)) continue;
    const statuses = await list<Status>("/deployments/" + deployment.id + "/statuses?per_page=30");
    // GitHub returns newest first. A re-promotion after an inactive or failed
    // interval must never inherit a successful timestamp from that interval.
    let success = NaN;
    for (const row of statuses) {
      if (row.state !== "success" || !fromVercel(row.creator) || row.environment_url !== "https://" + live.host) break;
      success = Date.parse(row.created_at);
    }
    if (Number.isFinite(success) && success <= now + 30_000) return new Date(success).toISOString();
  }
  throw new Error("No confirmed production promotion");
}
