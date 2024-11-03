// popup.js

// Configure Marked options
marked.setOptions({
  gfm: true,
  breaks: true,
  smartLists: true,
  smartypants: true,
});

// Functions to get and set the GitHub token in storage
function getGitHubToken() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['githubToken'], function (result) {
      resolve(result.githubToken || '');
    });
  });
}

function setGitHubToken(token) {
  chrome.storage.sync.set({ githubToken: token }, function () {
    console.log('GitHub token saved.');
  });
}

// Function to read input.txt and return an array of repository URLs
async function readInputFile() {
  const inputUrl = chrome.runtime.getURL('input.txt');
  const response = await fetch(inputUrl);
  if (response.ok) {
    const text = await response.text();
    // Split the text into lines and filter out empty lines
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } else {
    console.error('Failed to read input.txt');
    return [];
  }
}

// Function to extract owner and repo from URL
function extractOwnerRepo(url) {
  const match = url.match(/https?:\/\/github\.com\/([^\/]+)\/([^\/]+)/);
  if (match) {
    return { owner: match[1], repo: match[2] };
  } else {
    return null;
  }
}

// Function to fetch releases from GitHub API, with limit per repository
async function fetchReleases(owner, repo, token, perRepoReleaseCount = null) {
  let releasesUrl = `https://api.github.com/repos/${owner}/${repo}/releases`;

  const params = new URLSearchParams();

  // If perRepoReleaseCount is specified, set per_page parameter
  if (perRepoReleaseCount) {
    params.append('per_page', perRepoReleaseCount);
  }

  if (params.toString()) {
    releasesUrl += `?${params.toString()}`;
  }

  const headers = {
    Accept: 'application/vnd.github.v3+json',
    ...(token && { Authorization: `token ${token}` }),
  };

  try {
    const response = await fetch(releasesUrl, { headers });
    if (response.ok) {
      return await response.json();
    } else {
      // Log detailed error information
      const errorData = await response.json();
      console.error(`Failed to fetch releases for ${owner}/${repo}`);
      console.error(`Status: ${response.status} ${response.statusText}`);
      // Get rate limit headers
      const rateLimit = response.headers.get('X-RateLimit-Limit');
      const rateRemaining = response.headers.get('X-RateLimit-Remaining');
      const rateReset = response.headers.get('X-RateLimit-Reset');
      console.error(`Rate Limit: ${rateLimit}`);
      console.error(`Rate Remaining: ${rateRemaining}`);
      console.error(`Rate Reset: ${new Date(rateReset * 1000)}`);
      console.error('Error Data:', errorData);
      return [];
    }
  } catch (error) {
    console.error(`Error fetching releases for ${owner}/${repo}:`, error);
    return [];
  }
}

// Function to fetch issue or discussion details from GitHub API
async function fetchIssueOrDiscussion(owner, repo, issueNumber, token) {
  // Try to fetch as an Issue first
  const issueUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`;
  const headers = {
    Accept: 'application/vnd.github.v3+json',
    ...(token && { Authorization: `token ${token}` }),
  };
  try {
    let response = await fetch(issueUrl, { headers });
    if (response.ok) {
      const issueData = await response.json();
      return { ...issueData, type: 'issue' };
    } else {
      // Try to fetch as a Pull Request
      const prUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${issueNumber}`;
      response = await fetch(prUrl, { headers });
      if (response.ok) {
        const prData = await response.json();
        return { ...prData, type: 'pull_request' };
      } else {
        // Try to fetch as a Discussion via GraphQL API
        const discussionData = await fetchDiscussion(owner, repo, issueNumber, token);
        if (discussionData) {
          // Return a similar object to issueData
          return { ...discussionData, type: 'discussion' };
        } else {
          // Reference not found; simply return null without logging an error
          return null;
        }
      }
    }
  } catch (error) {
    console.error(
      `Error fetching issue/PR/discussion #${issueNumber} for ${owner}/${repo}:`,
      error
    );
    return null;
  }
}

// Function to fetch a discussion via GraphQL API
async function fetchDiscussion(owner, repo, discussionNumber, token) {
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `bearer ${token}` }), // Note 'bearer' instead of 'token'
  };

  const query = `
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        discussion(number: $number) {
          number
          title
          url
          body
        }
      }
    }
  `;

  const variables = {
    owner: owner,
    repo: repo,
    number: parseInt(discussionNumber),
  };

  try {
    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ query: query, variables: variables }),
    });

    if (response.ok) {
      const json = await response.json();
      if (
        json.data &&
        json.data.repository &&
        json.data.repository.discussion
      ) {
        return json.data.repository.discussion;
      } else {
        // Discussion not found; return null without logging an error
        return null;
      }
    } else {
      // Handle GraphQL errors gracefully
      return null;
    }
  } catch (error) {
    console.error(
      `Error fetching discussion #${discussionNumber} for ${owner}/${repo}:`,
      error
    );
    return null;
  }
}

// Function to fetch all data
async function fetchAllData(token, perRepoReleaseCount = null) {
  const inputRepos = await readInputFile();
  const allReleasesData = [];

  for (const repoUrl of inputRepos) {
    const ownerRepo = extractOwnerRepo(repoUrl);
    if (!ownerRepo) continue;
    const { owner, repo } = ownerRepo;

    const releases = await fetchReleases(
      owner,
      repo,
      token,
      perRepoReleaseCount
    );

    for (const release of releases) {
      const releaseBody = release.body || '';

      // Extract issue references from the release body
      const issueReferences = [];
      const regex = /(\b[\w\-]+\/[\w\-]+)?#(\d+)/g;
      let match;

      while ((match = regex.exec(releaseBody)) !== null) {
        const fullRepo = match[1]; // May be undefined
        const issueNumber = match[2];

        let issueOwner = owner;
        let issueRepo = repo;

        if (fullRepo) {
          const [refOwner, refRepo] = fullRepo.split('/');
          issueOwner = refOwner;
          issueRepo = refRepo;
        }

        issueReferences.push({
          owner: issueOwner,
          repo: issueRepo,
          number: issueNumber,
        });
      }

      // Remove duplicate issue references
      const uniqueIssueReferences = issueReferences.filter(
        (v, i, a) =>
          a.findIndex(
            (t) =>
              t.owner === v.owner && t.repo === v.repo && t.number === v.number
          ) === i
      );

      const issuesInfo = [];

      for (const issueRef of uniqueIssueReferences) {
        const issueData = await fetchIssueOrDiscussion(
          issueRef.owner,
          issueRef.repo,
          issueRef.number,
          token
        );
        if (issueData) {
          issuesInfo.push({
            number: issueData.number,
            title: issueData.title,
            url: issueData.html_url || issueData.url,
            owner: issueRef.owner,
            repo: issueRef.repo,
            type: issueData.type,
          });
        }
        // If issueData is null, continue without adding
      }

      allReleasesData.push({
        owner: owner,
        repo: repo,
        release_name: release.name || 'No Release Name',
        release_body: releaseBody,
        issues: issuesInfo,
        published_at: release.published_at || release.created_at,
      });
    }
  }

  return allReleasesData;
}

// Function to render the data
function renderData(data, options = {}) {
  const { searchQuery = '', dateFilter = 'all', customDate = null } = options;
  const kanbanBoard = document.getElementById('kanban-board');

  // Clear existing content except headers
  kanbanBoard.innerHTML = `
    <div class="cell header">Software</div>
    <div class="cell header">Release Notes</div>
    <div class="cell header">Issues Fixed</div>
  `;

  // Filter data based on options
  let filteredData = data;

  // Filter by date
  if (dateFilter !== 'all') {
    const now = new Date();
    let cutoffDate;
    if (dateFilter === 'last_month') {
      cutoffDate = new Date();
      cutoffDate.setMonth(now.getMonth() - 1);
    } else if (dateFilter === 'last_6_months') {
      cutoffDate = new Date();
      cutoffDate.setMonth(now.getMonth() - 6);
    } else if (dateFilter === 'custom' && customDate) {
      cutoffDate = new Date(customDate);
    }

    if (cutoffDate) {
      filteredData = filteredData.filter((release) => {
        const releaseDate = new Date(release.published_at);
        return releaseDate >= cutoffDate;
      });
    }
  }

  // Filter by search query
  if (searchQuery) {
    const searchText = searchQuery.toLowerCase();
    filteredData = filteredData.filter((release) => {
      return (
        release.repo.toLowerCase().includes(searchText) ||
        (release.release_name &&
          release.release_name.toLowerCase().includes(searchText)) ||
        (release.release_body &&
          release.release_body.toLowerCase().includes(searchText)) ||
        release.issues.some(
          (issue) =>
            issue.title.toLowerCase().includes(searchText) ||
            `${issue.owner}/${issue.repo}#${issue.number}`
              .toLowerCase()
              .includes(searchText)
        )
      );
    });
  }

  // Group releases by repository and track the most recent release date
  const releasesByRepo = {};
  filteredData.forEach((release) => {
    if (!releasesByRepo[release.repo]) {
      releasesByRepo[release.repo] = {
        releases: [],
        mostRecentDate: new Date(release.published_at),
      };
    }

    releasesByRepo[release.repo].releases.push(release);

    // Update the most recent release date if necessary
    const releaseDate = new Date(release.published_at);
    if (releaseDate > releasesByRepo[release.repo].mostRecentDate) {
      releasesByRepo[release.repo].mostRecentDate = releaseDate;
    }
  });

  // Sort releases in each repository by date (most recent first)
  for (const repo in releasesByRepo) {
    releasesByRepo[repo].releases.sort(
      (a, b) => new Date(b.published_at) - new Date(a.published_at)
    );
  }

  // Create an array of repositories with their releases and most recent release date
  const repoArray = Object.keys(releasesByRepo).map((repo) => ({
    repoName: repo,
    releases: releasesByRepo[repo].releases,
    mostRecentDate: releasesByRepo[repo].mostRecentDate,
  }));

  // Sort the array of repositories by most recent release date (most recent first)
  repoArray.sort((a, b) => b.mostRecentDate - a.mostRecentDate);

  // Render the data
  let hasData = false;
  repoArray.forEach((repoData) => {
    const { repoName, releases } = repoData;

    releases.forEach((release) => {
      hasData = true;

      // Software Name Cell
      const softwareCell = document.createElement('div');
      softwareCell.className = 'cell';

      // Create software name element as a link
      const softwareNameLink = document.createElement('a');
      softwareNameLink.className = 'software-name';
      softwareNameLink.textContent = `${release.owner}/${release.repo}`;
      softwareNameLink.href = `https://github.com/${release.owner}/${release.repo}`;
      softwareNameLink.target = '_blank';

      // Create release number element
      const releaseNumber = document.createElement('div');
      releaseNumber.className = 'release-number';
      releaseNumber.textContent = release.release_name || 'No Release Name';

      // Create release date element
      const releaseDate = document.createElement('div');
      releaseDate.className = 'release-date';
      const releaseDateObj = new Date(release.published_at);
      releaseDate.textContent = releaseDateObj.toLocaleDateString();

      // Append elements to software cell
      softwareCell.appendChild(softwareNameLink);
      softwareCell.appendChild(releaseNumber);
      softwareCell.appendChild(releaseDate);

      kanbanBoard.appendChild(softwareCell);

      // Release Notes Cell
      const releaseNotesCell = document.createElement('div');
      releaseNotesCell.className = 'cell markdown-content';

      // Parse and sanitize the release notes
      const releaseNotesMarkdown = release.release_body || 'No release notes.';
      const releaseNotesHTML = DOMPurify.sanitize(
        marked.parse(releaseNotesMarkdown)
      );
      releaseNotesCell.innerHTML = releaseNotesHTML;
      kanbanBoard.appendChild(releaseNotesCell);

      // Issues Fixed Cell
      const issuesCell = document.createElement('div');
      issuesCell.className = 'cell';
      if (release.issues.length > 0) {
        release.issues.forEach((issue) => {
          const issueLink = document.createElement('a');
          issueLink.href = issue.url;
          issueLink.target = '_blank';

          let issueTypeLabel = '';
          if (issue.type === 'issue') {
            issueTypeLabel = 'Issue';
          } else if (issue.type === 'pull_request') {
            issueTypeLabel = 'Pull Request';
          } else if (issue.type === 'discussion') {
            issueTypeLabel = 'Discussion';
          } else {
            issueTypeLabel = 'Item';
          }

          let issueText = `${issueTypeLabel} #${issue.number}: ${issue.title}`;
          if (issue.owner !== release.owner || issue.repo !== release.repo) {
            issueText = `${issue.owner}/${issue.repo} ${issueTypeLabel} #${issue.number}: ${issue.title}`;
          }

          issueLink.textContent = issueText;
          issuesCell.appendChild(issueLink);
          issuesCell.appendChild(document.createElement('br'));
        });
      } else {
        issuesCell.textContent = 'No issues linked.';
      }
      kanbanBoard.appendChild(issuesCell);
    });
  });

  // If no releases are found, display a message
  if (!hasData) {
    kanbanBoard.innerHTML +=
      '<div class="cell" style="grid-column: span 3; text-align: center;">No releases found.</div>';
  }
}

// Global variable to store fetched data
let fetchedData = [];

// Initialize the extension after the DOM has fully loaded
document.addEventListener('DOMContentLoaded', () => {
  // Event listener for the Save Token button
  document
    .getElementById('save-token-button')
    .addEventListener('click', () => {
      const token = document.getElementById('token-input').value.trim();
      setGitHubToken(token);
      alert('GitHub token saved.');
      // Clear the token input field after saving
      document.getElementById('token-input').value = '';
    });

  // Event listener for the Fetch All Releases button
  document.getElementById('fetch-button').addEventListener('click', async () => {
    try {
      const token = await getGitHubToken();

      if (!token) {
        alert(
          'GitHub token is missing. Please enter your token and click "Save Token".'
        );
        return;
      }

      document.getElementById('status').textContent = 'Fetching data...';

      // Get release count per repository from input
      const releaseCountInput = document.getElementById('release-count').value;
      const perRepoReleaseCount = releaseCountInput
        ? parseInt(releaseCountInput)
        : null;

      const data = await fetchAllData(token, perRepoReleaseCount);

      fetchedData = data; // Store data globally for filtering

      renderData(fetchedData);

      document.getElementById('status').textContent = 'Data fetched successfully';
    } catch (error) {
      console.error('Error fetching data:', error);
      document.getElementById('status').textContent =
        'Error fetching data. See console for details.';
    }
  });

  // Get references to the search input and date filter elements
  const searchInput = document.getElementById('search-input');
  const dateFilterSelect = document.getElementById('date-filter');
  const customDateInput = document.getElementById('custom-date');

  // Add event listener to the search input for real-time filtering
  searchInput.addEventListener('input', () => {
    const searchQuery = searchInput.value.trim();
    const dateFilter = dateFilterSelect.value;
    const customDate = customDateInput.value;

    renderData(fetchedData, { searchQuery, dateFilter, customDate });
  });

  // Add event listeners to date filters for real-time filtering
  dateFilterSelect.addEventListener('change', () => {
    const searchQuery = searchInput.value.trim();
    const dateFilter = dateFilterSelect.value;
    const customDate = customDateInput.value;

    // Show/hide custom date input based on date filter selection
    if (dateFilter === 'custom') {
      customDateInput.style.display = 'inline-block';
    } else {
      customDateInput.style.display = 'none';
    }

    renderData(fetchedData, { searchQuery, dateFilter, customDate });
  });

  customDateInput.addEventListener('input', () => {
    const searchQuery = searchInput.value.trim();
    const dateFilter = dateFilterSelect.value;
    const customDate = customDateInput.value;

    renderData(fetchedData, { searchQuery, dateFilter, customDate });
  });

  // Event listener for the Reset button
  document
    .getElementById('reset-button')
    .addEventListener('click', () => {
      searchInput.value = '';
      dateFilterSelect.value = 'all';
      customDateInput.value = '';
      customDateInput.style.display = 'none';
      document.getElementById('release-count').value = '1'; // Set default value if needed
      renderData(fetchedData);
    });
});
