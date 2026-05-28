export async function onRequest(context) {
  const githubToken = context.env.GITHUB_TOKEN;
  const cfToken = context.env.CF_API_TOKEN;
  const cfAccountId = context.env.CF_ACCOUNT_ID;

  try {
    // Fetch config.json from the same repo
    const configRes = await fetch(
      'https://api.github.com/repos/preritjaiswal-elecnor/sharepoint-github-dashboard/contents/config.json',
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: 'application/vnd.github.raw+json',
          'User-Agent': 'elecnor-github-dashboard'
        }
      }
    );
    const config = await configRes.json();
    const { org, repos } = config;

    // Fetch all Cloudflare Pages projects once
    const cfPagesRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/pages/projects`,
      {
        headers: {
          Authorization: `Bearer ${cfToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    const cfPages = await cfPagesRes.json();
    const cfProjects = cfPages.result || [];

    // DEBUG: return CF API response to diagnose matching issue
    if (context.request.url.includes('?debug')) {
      return new Response(JSON.stringify({
        cfSuccess: cfPages.success,
        cfErrors: cfPages.errors,
        cfProjectNames: cfProjects.map(p => ({
          name: p.name,
          subdomain: p.subdomain,
          source_repo: p.source?.config?.repo_name
        }))
      }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const results = await Promise.all(repos.map(async (repo) => {
      const headers = {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'elecnor-github-dashboard'
      };
      const base = `https://api.github.com/repos/${org}/${repo}`;

      const [repoRes, commitsRes, issuesRes, languagesRes, contributorsRes] = await Promise.all([
        fetch(base, { headers }),
        fetch(`${base}/commits?per_page=10`, { headers }),
        fetch(`${base}/issues?state=open&per_page=20`, { headers }),
        fetch(`${base}/languages`, { headers }),
        fetch(`${base}/contributors?per_page=10`, { headers })
      ]);

      const [repoData, commits, issues, languages, contributors] = await Promise.all([
        repoRes.json(),
        commitsRes.json(),
        issuesRes.json(),
        languagesRes.json(),
        contributorsRes.json()
      ]);

      const prs = Array.isArray(issues) ? issues.filter(i => i.pull_request) : [];
      const openIssues = Array.isArray(issues) ? issues.filter(i => !i.pull_request) : [];

      const cfProject = cfProjects.find(p =>
        p.name === repo ||
        p.source?.config?.repo_name === repo ||
        p.source?.config?.repo_name?.endsWith(`/${repo}`)
      );

      let deployments = [];
      if (cfProject) {
        const depRes = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/pages/projects/${cfProject.name}/deployments?per_page=5`,
          {
            headers: {
              Authorization: `Bearer ${cfToken}`,
              'Content-Type': 'application/json'
            }
          }
        );
        const depData = await depRes.json();
        deployments = (depData.result || []).slice(0, 5).map(d => ({
          id: d.id?.slice(0, 8),
          environment: d.environment,
          status: d.latest_stage?.status || d.stages?.[d.stages.length - 1]?.status || 'unknown',
          createdAt: d.created_on,
          url: d.url,
          branch: d.deployment_trigger?.metadata?.branch || 'main',
          commitMessage: d.deployment_trigger?.metadata?.commit_message?.split('\n')[0] || ''
        }));
      }

      return {
        name: repo,
        description: repoData.description || '',
        stars: repoData.stargazers_count || 0,
        forks: repoData.forks_count || 0,
        openIssuesCount: openIssues.length,
        openPRsCount: prs.length,
        lastPush: repoData.pushed_at,
        cfProjectName: cfProject?.name || null,
        cfProjectUrl: cfProject ? `https://${cfProject.subdomain}` : null,
        commits: Array.isArray(commits) ? commits.slice(0, 5).map(c => ({
          sha: c.sha?.slice(0, 7),
          message: c.commit?.message?.split('\n')[0],
          author: c.commit?.author?.name,
          date: c.commit?.author?.date
        })) : [],
        deployments,
        languages,
        contributors: Array.isArray(contributors) ? contributors.slice(0, 5).map(c => ({
          login: c.login,
          avatar: c.avatar_url,
          contributions: c.contributions
        })) : []
      };
    }));

    return new Response(JSON.stringify({ org, repos: results, fetchedAt: new Date().toISOString() }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300'
      }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
