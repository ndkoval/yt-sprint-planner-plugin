/**
 * Tiny logging helpers shared by all build/test tooling scripts.
 * ESM, zero dependencies. Timestamps + a script tag keep CI logs readable.
 */

function ts() {
  return new Date().toISOString();
}

/** Create a tagged logger for a script. */
export function createLogger(tag) {
  const prefix = `[${tag}]`;
  return {
    info: (...args) => console.log(ts(), prefix, ...args),
    warn: (...args) => console.warn(ts(), prefix, 'WARN', ...args),
    error: (...args) => console.error(ts(), prefix, 'ERROR', ...args),
    step: (...args) => console.log(`\n${ts()} ${prefix} ==>`, ...args),
  };
}

/**
 * Wrap a script's async main so any rejection prints and exits non-zero.
 * Usage: runMain('clean', async (log) => { ... }).
 */
export function runMain(tag, main) {
  const log = createLogger(tag);
  main(log)
    .then(() => {
      log.info('done');
    })
    .catch((err) => {
      log.error(err && err.stack ? err.stack : String(err));
      process.exitCode = 1;
    });
}
