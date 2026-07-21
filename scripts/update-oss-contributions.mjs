import { readFile, writeFile } from "node:fs/promises";

const START_MARKER = "<!-- OSS-CONTRIBUTIONS:START -->";
const END_MARKER = "<!-- OSS-CONTRIBUTIONS:END -->";
const README_PATH = new URL("../README.md", import.meta.url);

const username = process.env.GITHUB_USERNAME?.trim();
const token = process.env.GITHUB_TOKEN?.trim();

if (!username) {
  throw new Error("GITHUB_USERNAME environment variable is required.");
}

if (!token) {
  throw new Error("GITHUB_TOKEN environment variable is required.");
}

const query = `is:pr author:${username} is:merged is:public`;
const searchUrl = new URL("https://api.github.com/search/issues");

searchUrl.searchParams.set("q", query);
searchUrl.searchParams.set("sort", "updated");
searchUrl.searchParams.set("order", "desc");
searchUrl.searchParams.set("per_page", "100");

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "User-Agent": `${username}-profile-readme`,
  "X-GitHub-Api-Version": "2022-11-28",
};

async function githubFetch(url) {
  const response = await fetch(url, { headers });

  if (!response.ok) {
    const details = await response.text();

    throw new Error(
      `GitHub API request failed (${response.status} ${response.statusText}): ${details}`,
    );
  }

  return response.json();
}

const searchResults = [];

for (const page of [1, 2]) {
  searchUrl.searchParams.set("page", String(page));

  const result = await githubFetch(searchUrl);
  searchResults.push(...result.items);

  if (result.items.length < 100) {
    break;
  }
}

const pullRequests = await Promise.all(
  searchResults.map((item) => githubFetch(item.pull_request.url)),
);

const contributions = pullRequests
  .filter((pullRequest) => {
    const repositoryOwner = pullRequest.base.repo.owner.login;

    return (
      pullRequest.merged_at &&
      pullRequest.base.repo.private === false &&
      repositoryOwner.toLowerCase() !== username.toLowerCase()
    );
  })
  .sort((a, b) => new Date(b.merged_at) - new Date(a.merged_at))
  .slice(0, 110);

function formatContribution(pullRequest) {
  const repository = pullRequest.base.repo;

  return `- **[${repository.full_name}](${repository.html_url})** — [#${pullRequest.number}: ${pullRequest.title}](${pullRequest.html_url})`;
}

const visibleContributions = contributions.slice(0, 10);
const additionalContributions = contributions.slice(10);

let contributionList = visibleContributions.length
  ? visibleContributions.map(formatContribution).join("\n")
  : "_No merged open-source pull requests found yet._";

if (additionalContributions.length > 0) {
  contributionList += `

<details>
<summary>Show ${additionalContributions.length} more contributions</summary>

${additionalContributions.map(formatContribution).join("\n")}

</details>`;
}

const readme = await readFile(README_PATH, "utf8");
const startIndex = readme.indexOf(START_MARKER);
const endIndex = readme.indexOf(END_MARKER);

if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
  throw new Error(
    `README.md must contain ${START_MARKER} followed by ${END_MARKER}.`,
  );
}

const contentStart = startIndex + START_MARKER.length;

const updatedReadme =
  `${readme.slice(0, contentStart)}\n` +
  `${contributionList}\n` +
  readme.slice(endIndex);

await writeFile(README_PATH, updatedReadme, "utf8");

console.log(
  `Updated README.md with ${contributions.length} contribution(s).`,
);
