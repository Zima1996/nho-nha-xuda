const staticConfig = require('./app.json').expo;

module.exports = () => {
  const repository = process.env.GITHUB_REPOSITORY?.split('/')[1];
  const isUserSite = repository?.endsWith('.github.io');
  const baseUrl = repository && !isUserSite ? `/${repository}` : undefined;

  return {
    ...staticConfig,
    ...(baseUrl
      ? { experiments: { ...staticConfig.experiments, baseUrl } }
      : {}),
  };
};
