// The minimum password length set in Security Center (GET /auth/password-policy, readable before sign-in).
import { useEffect, useState } from 'react';
import { getPasswordPolicy } from './api';
import { PASSWORD_MIN_LENGTH } from './password-policy';

export function usePasswordMinLength(): number {
  const [min, setMin] = useState(PASSWORD_MIN_LENGTH);
  useEffect(() => {
    let live = true;
    // if it cannot be read the standard minimum is shown; the server enforces the real one either way
    void getPasswordPolicy()
      .then((p) => {
        if (live && Number.isInteger(p?.passwordMinLength)) setMin(p.passwordMinLength);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return min;
}
