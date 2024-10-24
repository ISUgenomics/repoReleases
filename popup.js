// popup.js

// Functions to get and set the GitHub token in storage
function getGitHubToken() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['githubToken'], function(result) {
      resolve(result.githubToken || '');
    });
  });
}

function setGitHubToken(token) {
  chrome.storage.sync.set({ 'githubToken': token }, function() {
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
    return text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
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
    'Accept': 'application/vnd.github.v3+json',
    ...(token && { 'Authorization': `token ${token}` })
  };

  const response = await fetch(releasesUrl, { headers });
  if (response.ok) {
    return await response.json();
  } else {
    console.error(`Failed to fetch releases for ${owner}/${repo}`);
    return [];
  }
}

// Function to fetch issue details from GitHub API
async function fetchIssue(owner, repo, issueNumber, token) {
  const issueUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`;
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    ...(token && { 'Authorization': `token ${token}` })
  };
  const response = await fetch(issueUrl, { headers });
  if (response.ok) {
    return await response.json();
  } else {
    console.error(`Failed to fetch issue #${issueNumber} for ${owner}/${repo}`);
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

    const releases = await fetchReleases(owner, repo, token, perRepoReleaseCount);

    for (const release of releases) {
      const releaseBody = release.body || '';
      // Extract issue numbers from the release body
      const issueNumbers = [...new Set((releaseBody.match(/#(\d+)/g) || []).map(s => s.slice(1)))];

      const issuesInfo = [];

      for (const issueNumber of issueNumbers) {
        const issueData = await fetchIssue(owner, repo, issueNumber, token);
        if (issueData) {
          issuesInfo.push({
            'number': issueData.number,
            'title': issueData.title,
            'url': issueData.html_url
          });
        }
      }

      allReleasesData.push({
        'repo': repo,
        'release_name': release.name || 'No Release Name',
        'release_body': releaseBody,
        'issues': issuesInfo,
        'published_at': release.published_at || release.created_at, // Include release date
      });
    }
  }

  return allReleasesData;
}

// Function to render the data
function renderData(data, options = {}) {
  const {
    searchQuery = '',
    dateFilter = 'all',
    customDate = null,
  } = options;
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
      filteredData = filteredData.filter(release => {
        const releaseDate = new Date(release.published_at);
        return releaseDate >= cutoffDate;
      });
    }
  }

  // Filter by search query
  if (searchQuery) {
    const searchText = searchQuery.toLowerCase();
    filteredData = filteredData.filter(release => {
      return (
        release.repo.toLowerCase().includes(searchText) ||
        release.release_name.toLowerCase().includes(searchText) ||
        release.release_body.toLowerCase().includes(searchText) ||
        release.issues.some(issue => issue.title.toLowerCase().includes(searchText))
      );
    });
  }

  // Group releases by repository
  const releasesByRepo = {};
  filteredData.forEach(release => {
    if (!releasesByRepo[release.repo]) {
      releasesByRepo[release.repo] = [];
    }
    releasesByRepo[release.repo].push(release);
  });

  // Sort releases in each repository by date (most recent first)
  for (const repo in releasesByRepo) {
    releasesByRepo[repo].sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
  }

  // Render the data
  let hasData = false;
  for (const repo in releasesByRepo) {
    const releases = releasesByRepo[repo];

    releases.forEach(release => {
      hasData = true;

      // Software Name Cell
      const softwareCell = document.createElement('div');
      softwareCell.className = 'cell';
      softwareCell.textContent = repo;
      kanbanBoard.appendChild(softwareCell);

      // Release Notes Cell
      const releaseNotesCell = document.createElement('div');
      releaseNotesCell.className = 'cell';
      releaseNotesCell.innerHTML = `<strong>${release.release_name}</strong><br>${release.release_body}`;
      kanbanBoard.appendChild(releaseNotesCell);

      // Issues Fixed Cell
      const issuesCell = document.createElement('div');
      issuesCell.className = 'cell';
      release.issues.forEach(issue => {
        const issueLink = document.createElement('a');
        issueLink.href = issue.url;
        issueLink.target = '_blank';
        issueLink.textContent = `#${issue.number}: ${issue.title}`;
        issuesCell.appendChild(issueLink);
        issuesCell.appendChild(document.createElement('br'));
      });
      kanbanBoard.appendChild(issuesCell);
    });
  }

  // If no releases are found, display a message
  if (!hasData) {
    kanbanBoard.innerHTML += '<div class="cell" style="grid-column: span 3; text-align: center;">No releases found.</div>';
  }
}

// Global variable to store fetched data
let fetchedData = [];

// Event listener for the Save Token button
document.getElementById('save-token-button').addEventListener('click', () => {
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

    document.getElementById('status').textContent = 'Fetching data...';

    // Get release count per repository from input
    const releaseCountInput = document.getElementById('release-count').value;
    const perRepoReleaseCount = releaseCountInput ? parseInt(releaseCountInput) : null;

    const data = await fetchAllData(token, perRepoReleaseCount);

    fetchedData = data; // Store data globally for filtering

    renderData(fetchedData);

    document.getElementById('status').textContent = 'Data fetched successfully';

  } catch (error) {
    console.error('Error fetching data:', error);
    document.getElementById('status').textContent = 'Error fetching data. See console for details.';
  }
});

// Event listener for the Search button
document.getElementById('search-button').addEventListener('click', () => {
  const searchQuery = document.getElementById('search-input').value.trim();
  const dateFilter = document.getElementById('date-filter').value;
  const customDate = document.getElementById('custom-date').value;

  renderData(fetchedData, { searchQuery, dateFilter, customDate });
});

// Event listener for the Reset button
document.getElementById('reset-button').addEventListener('click', () => {
  document.getElementById('search-input').value = '';
  document.getElementById('date-filter').value = 'all';
  document.getElementById('custom-date').value = '';
  document.getElementById('custom-date').style.display = 'none';
  document.getElementById('release-count').value = '';
  renderData(fetchedData);
});

// Show/hide custom date input based on date filter selection
document.getElementById('date-filter').addEventListener('change', (event) => {
  const dateFilter = event.target.value;
  const customDateInput = document.getElementById('custom-date');
  if (dateFilter === 'custom') {
    customDateInput.style.display = 'inline-block';
  } else {
    customDateInput.style.display = 'none';
  }
});

// Initialize the extension
document.addEventListener('DOMContentLoaded', () => {
  // Do not load the token into the input field to prevent it from being visible
  // Other initialization tasks can go here if needed
});

