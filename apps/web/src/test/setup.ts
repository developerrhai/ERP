// Vitest setup: jest-dom matchers and a clean auth state between tests so module-level
// session/refresh state never leaks from one test into another.
import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { closeChannelForTests } from '../auth/channel';
import { resetSessionForTests } from '../auth/session';
import { resetMenuForTests } from '../lib/menu';

// The full shell renders ~250 menu links; under parallel load 1 s is too tight for findBy*.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  resetSessionForTests();
  resetMenuForTests();
  closeChannelForTests();
});
