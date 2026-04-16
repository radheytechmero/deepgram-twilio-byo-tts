module.exports = {
  apps: [
    {
      name: 'deepgram-twillio',
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'cluster',
      watch: false,
      env: {
        NODE_ENV: 'development',
        PORT: 443
      },
      env_production: {
        NODE_ENV: 'production'
      },
      exp_backoff_restart_delay: 100,
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '1G'
    }
  ]
};