const express = require('express');
const { execFileSync } = require('child_process');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static('public'));

function getDateString(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCommits(repoPath, since, until) {
  const output = execFileSync(
    'git',
    [
      '-C',
      repoPath,
      'log',
      `--since=${since} 00:00:00`,
      `--until=${until} 23:59:59`,
      '--pretty=format:%s%x1f%an%x1e'
    ],
    { encoding: 'utf-8', timeout: 10000, maxBuffer: 10 * 1024 * 1024 }
  );

  if (!output.trim()) {
    return [];
  }

  return output
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const delimiterIndex = record.lastIndexOf('\x1f');
      if (delimiterIndex === -1) {
        return {
          message: record.trim(),
          author: ''
        };
      }
      const message = record.substring(0, delimiterIndex);
      const author = record.substring(delimiterIndex + 1);
      return {
        message: message.trim(),
        author: author.trim()
      };
    });
}

function resolveAndValidateRepoPath(inputPath) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) {
    return { error: 'Repository path is required' };
  }

  const trimmedPath = inputPath.trim();
  let resolvedPath;
  try {
    resolvedPath = fs.realpathSync(trimmedPath);
  } catch {
    return { error: 'Path does not exist or cannot be accessed' };
  }

  // SECURITY NOTE: In production, add directory allowlist validation here:
  // const ALLOWED_DIRS = ['/home/user/repos', '/opt/projects'];
  // if (!ALLOWED_DIRS.some(dir => resolvedPath.startsWith(dir + '/'))) {
  //   return { error: 'Repository path not in allowed directory' };
  // }

  try {
    const stats = fs.statSync(resolvedPath);
    if (!stats.isDirectory()) {
      return { error: 'Repository path must be a directory' };
    }
  } catch {
    return { error: 'Path does not exist or cannot be accessed' };
  }

  try {
    const output = execFileSync(
      'git',
      ['-C', resolvedPath, 'rev-parse', '--is-inside-work-tree'],
      { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }
    );

    if (output.trim() !== 'true') {
      return { error: 'Not a git repository' };
    }
  } catch {
    return { error: 'Not a git repository' };
  }

  return { resolvedPath };
}

app.post('/api/standup', (req, res) => {
  const { repoPath } = req.body || {};
  const { resolvedPath, error } = resolveAndValidateRepoPath(repoPath);
  if (error) {
    return res.status(400).json({ error });
  }

  try {
    const today = getDateString(0);
    const yesterday = getDateString(1);

    const todayCommits = getCommits(resolvedPath, today, today);
    const yesterdayCommits = getCommits(resolvedPath, yesterday, yesterday);

    return res.status(200).json({
      yesterday: yesterdayCommits,
      today: todayCommits,
      blockers: []
    });
  } catch (err) {
    console.error('Failed to generate standup:', err.message);
    return res.status(500).json({ error: 'Failed to generate standup from git history' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
