export async function onRequest(context) {
  const token = context.env.GITHUB_TOKEN;
  const origin = context.request.headers.get('Origin') || '*';

  try {
    // Fetch config.json from the same repo
    const configRes = await fetch(
      'https://api.github.com/repos/preritjaiswal-elecnor/sharepoint-github-dashboard/contents/config.json',
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.raw+json',
          'User-Agent': 'elecnor-github-dashboard'
        }
      }
    );
    const config = await configRes.json();
    const { org, repos } = config;

    const results = await Promise.all(repos.map(async (repo) => {
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'elecnor-github-dashboard'
      };
      const base = `https://api.github.com/repos/${org}/${repo}`;

      const [repoRes, commitsRes, issuesRes, deploymentsRes, languagesRes, contributorsRes] = await Promise.all([
        fetch(base, { headers }),
        fetch(`${base}/commits?per_page=10`, { headers }),
        fetch(`${base}/issues?state=open&per_page=20`, { headers }),
        fetch(`${base}/deployments?per_page=5`, { headers }),
        fetch(`${base}/languages`, { headers }),
        fetch(`${base}/contributors?per_page=10`, { headers })
      ]);

      const [repoData, commits, issues, deployments, languages, contributors] = await Promise.all([
        repoRes.json(),
        commitsRes.json(),
        issuesRes.json(),
        deploymentsRes.json(),
        languagesRes.json(),
        contributorsRes.json()
      ]);

      const prs = Array.isArray(issues) ? issues.filter(i => i.pull_request) : [];
      const openIssues = Array.isArray(issues) ? issues.filter(i => !i.pull_request) : [];

      return {
        name: repo,
        description: repoData.description || '',
        stars: repoData.stargazers_count || 0,
        forks: repoData.forks_count || 0,
        openIssuesCount: openIssues.length,
        openPRsCount: prs.length,
        lastPush: repoData.pushed_at,
        commits: Array.isArray(commits) ? commits.slice(0, 5).map(c => ({
          sha: c.sha?.slice(0, 7),
          message: c.commit?.message?.split('\n')[0],
          author: c.commit?.author?.name,
          date: c.commit?.author?.date
        })) : [],
        deployments: Array.isArray(deployments) ? deployments.slice(0, 3).map(d => ({
          environment: d.environment,
          createdAt: d.created_at,
          status: d.task
        })) : [],
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
        'Access-Control-Allow-Origin': origin,
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
