/**
 * Synthetic GitHub webhook payload fixtures — no real tokens, no real repo
 * data. Field sets are trimmed to exactly what `src/routes/webhooks.ts`
 * reads.
 */

export function installationCreatedPayload() {
  return {
    action: 'created',
    installation: {
      id: 5001,
      account: { id: 900, login: 'wnston', type: 'User' },
    },
    repositories: [
      { id: 7001, name: 'client-platform', full_name: 'wnston/client-platform', private: true },
      { id: 7002, name: 'gitcert', full_name: 'wnston/gitcert', private: false },
    ],
  };
}

export function installationDeletedPayload() {
  return {
    action: 'deleted',
    installation: {
      id: 5001,
      account: { id: 900, login: 'wnston', type: 'User' },
    },
  };
}

export function installationSuspendPayload() {
  return {
    action: 'suspend',
    installation: {
      id: 5001,
      account: { id: 900, login: 'wnston', type: 'User' },
    },
  };
}

export function installationUnsuspendPayload() {
  return {
    action: 'unsuspend',
    installation: {
      id: 5001,
      account: { id: 900, login: 'wnston', type: 'User' },
    },
  };
}

export function installationRepositoriesAddedPayload() {
  return {
    action: 'added',
    installation: {
      id: 5001,
      account: { id: 900, login: 'wnston', type: 'User' },
    },
    repositories_added: [
      { id: 7003, name: 'new-repo', full_name: 'wnston/new-repo', private: true },
    ],
  };
}

export function installationRepositoriesRemovedPayload() {
  return {
    action: 'removed',
    installation: {
      id: 5001,
      account: { id: 900, login: 'wnston', type: 'User' },
    },
    repositories_removed: [
      { id: 7001, name: 'client-platform', full_name: 'wnston/client-platform', private: true },
    ],
  };
}

export function repositoryRenamedPayload() {
  return {
    action: 'renamed',
    repository: {
      id: 7001,
      name: 'client-platform-v2',
      private: true,
      owner: { login: 'wnston' },
    },
    changes: { repository: { name: { from: 'client-platform' } } },
  };
}
