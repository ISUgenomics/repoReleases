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

// Function to fetch releases from GitHub API
async function fetchReleases(owner, repo, token) {
  const releasesUrl = `https://api.github.com/repos/${owner}/${repo}/releases`;
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
async function fetchAllData(token) {
  const inputRepos = await readInputFile();
  const allReleasesData = [];

  for (const repoUrl of inputRepos) {
    const ownerRepo = extractOwnerRepo(repoUrl);
    if (!ownerRepo) continue;
    const { owner, repo } = ownerRepo;

    const releases = await fetchReleases(owner, repo, token);

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
        'issues': issuesInfo
      });
    }
  }

  return allReleasesData;
}

// Function to render the data
function renderData(data) {
  const softwareColumn = document.getElementById('software-name-column');
  const releaseNotesColumn = document.getElementById('release-notes-column');
  const issuesColumn = document.getElementById('issues-column');

  // Clear existing content
  softwareColumn.innerHTML = '<h2>Software</h2>';
  releaseNotesColumn.innerHTML = '<h2>Release Notes</h2>';
  issuesColumn.innerHTML = '<h2>Issues Fixed</h2>';

  data.forEach(release => {
    // Software Name
    const softwareItem = document.createElement('div');
    softwareItem.className = 'item';
    softwareItem.textContent = release.repo;
    softwareColumn.appendChild(softwareItem);

    // Release Notes
    const releaseItem = document.createElement('div');
    releaseItem.className = 'item';
    releaseItem.innerHTML = `<strong>${release.release_name}</strong><br>${release.release_body}`;
    releaseNotesColumn.appendChild(releaseItem);

    // Issues Fixed
    const issuesItem = document.createElement('div');
    issuesItem.className = 'item';
    release.issues.forEach(issue => {
      const issueLink = document.createElement('a');
      issueLink.href = issue.url;
      issueLink.target = '_blank';
      issueLink.textContent = `#${issue.number}: ${issue.title}`;
      issuesItem.appendChild(issueLink);
      issuesItem.appendChild(document.createElement('br'));
    });
    issuesColumn.appendChild(issuesItem);
  });
}

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

    const data = await fetchAllData(token);

    renderData(data);

    document.getElementById('status').textContent = 'Data fetched successfully';

  } catch (error) {
    console.error('Error fetching data:', error);
    document.getElementById('status').textContent = 'Error fetching data. See console for details.';
  }
});

// Initialize the extension
document.addEventListener('DOMContentLoaded', () => {
  // Do not load the token into the input field to prevent it from being visible
  // Other initialization tasks can go here if needed
});

