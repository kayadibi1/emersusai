// worker/logger.js
// Structured stderr logger for the worker. Uses JSON lines so pm2 logs
// can be grepped or piped to a log collector later. One line per record.
export function createLogger(workerId) {
  function write(level, message, extra = {}) {
    const record = {
      ts: new Date().toISOString(),
      worker: workerId,
      level,
      msg: message,
      ...extra,
    };
    process.stderr.write(JSON.stringify(record) + "\n");
  }
  return {
    info:  (m, e) => write("info",  m, e),
    warn:  (m, e) => write("warn",  m, e),
    error: (m, e) => write("error", m, e),
  };
}
