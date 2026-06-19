import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';

// Suppress React act() warnings from async state updates in useEffect hooks.
// These warnings do not indicate actual test failures; they occur because
// React's scheduler and @testing-library's act() cannot perfectly synchronize
// async state updates triggered by native Promise microtasks or MessageChannel.
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const firstArg = args[0];
  if (typeof firstArg === 'string' && firstArg.includes('not wrapped in act(')) {
    return;
  }
  originalConsoleError.call(console, ...args);
};
