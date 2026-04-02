const express = require('express');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static('public'));

function getDateString(daysAgo) {
  const date = new Date();
  date.setHours(12, 0, 0, 0); // use noon to avoid DST boundary issues
  date.setDate(date.getDate() - daysAgo);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCommits(repoPath, since, until) {
  try {
    const output = execFileSync(
      'git',
      ['-C', repoPath, 'log', `--since=${since} 00:00:00`, `--until=${until} 23:59:59`, '--pretty=format:%s\t%an'],
      { encoding: 'utf-8', timeout: 10000 }
    );
    if (!output.trim()) return [];
    return output.trim().split('\n')
      .filter(line => line.trim())
      .map(line => {
        const [message, author] = line.split('\t');
        return { message, author };
      })
      .filter(entry => entry.message && entry.author);
  } catch (error) {
    console.error('Error fetching commits:', error.message);
    throw error;
  }
}

app.post('/api/standup', (req, res) => {
  const { repoPath } = req.body;

  if (!repoPath) {
    return res.status(400).json({ error: 'Repository path is required' });
  }

  // Resolve symlinks to get the real path
  let resolvedPath;
  try {
    resolvedPath = fs.realpathSync(repoPath);
  } catch (error) {
    return res.status(400).json({ error: 'Path does not exist or cannot be accessed' });
  }

  // Validate against allowlist when ALLOWED_DIRS is configured
  const allowedDirs = process.env.ALLOWED_DIRS
    ? process.env.ALLOWED_DIRS.split(path.delimiter)
    : [];
  if (allowedDirs.length > 0) {
    const allowed = allowedDirs.some(dir => {
      const rel = path.relative(dir, resolvedPath);
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    });
    if (!allowed) {
      return res.status(403).json({ error: 'Repository path is not in an allowed directory' });
    }
  }

  // Re-verify the resolved path has not changed before executing git (guard against TOCTOU)
  try {
    const reVerifiedPath = fs.realpathSync(repoPath);
    if (reVerifiedPath !== resolvedPath) {
      return res.status(400).json({ error: 'Repository path changed during request' });
    }
  } catch (error) {
    return res.status(400).json({ error: 'Path is no longer accessible' });
  }

  // Check if it's a git repository
  const gitDir = path.join(resolvedPath, '.git');
  if (!fs.existsSync(gitDir)) {
    return res.status(400).json({ error: 'Not a git repository' });
  }

  const today = getDateString(0);
  const yesterday = getDateString(1);

  let todayCommits, yesterdayCommits;
  try {
    todayCommits = getCommits(resolvedPath, today, today);
    yesterdayCommits = getCommits(resolvedPath, yesterday, yesterday);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to retrieve commits' });
  }

  res.json({
    yesterday: yesterdayCommits,
    today: todayCommits
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
