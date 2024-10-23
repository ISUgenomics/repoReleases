// popup.js

const jsonUrl = chrome.runtime.getURL('releases_data.json');

fetch(jsonUrl)
  .then(response => response.json())
  .then(data => {
    const softwareColumn = document.getElementById('software-name-column');
    const releaseNotesColumn = document.getElementById('release-notes-column');
    const issuesColumn = document.getElementById('issues-column');

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
  })
  .catch(error => console.error('Error fetching release data:', error));

