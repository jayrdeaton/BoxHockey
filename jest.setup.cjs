globalThis.IS_REACT_ACT_ENVIRONMENT = true

const handleUnhandledRejection = (reason) => {
  // eslint-disable-next-line no-console
  console.error('UnhandledRejection in tests:', reason)
}

const handleUncaughtException = (err) => {
  // eslint-disable-next-line no-console
  console.error('UncaughtException in tests:', err)
}

if (typeof process !== 'undefined' && process && process.on) {
  process.on('unhandledRejection', handleUnhandledRejection)
  process.on('uncaughtException', handleUncaughtException)
}
