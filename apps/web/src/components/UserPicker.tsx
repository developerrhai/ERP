// Typeahead user filter (combobox): searches GET /users?q= as you type (debounced) instead of
// loading a capped list of users, so it works for any number of accounts.
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { listUsers } from '../pages/users/usersApi';
import type { User } from '../types';

export interface PickedUser {
  id: string;
  label: string;
}

interface Props {
  value: PickedUser | null;
  onChange: (user: PickedUser | null) => void;
  label?: string;
  debounceMs?: number;
}

export const userLabel = (u: Pick<User, 'name' | 'loginId'>): string => `${u.name} (${u.loginId})`;

export function UserPicker({ value, onChange, label = 'Filter by user', debounceMs = 250 }: Props) {
  const listId = useId();
  const [text, setText] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    const q = text.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let alive = true;
    const id = setTimeout(() => {
      listUsers({ q, role: '', status: '', page: 1, size: 10 })
        .then((r) => {
          if (!alive) return;
          setResults(r.users);
          setActive(0);
          setError('');
        })
        .catch(() => {
          if (alive) setError('Could not search users.');
        });
    }, debounceMs);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [text, debounceMs]);

  const pick = (u: User): void => {
    onChange({ id: u.id, label: userLabel(u) });
    setText('');
    setOpen(false);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && open && results[active]) {
      e.preventDefault();
      pick(results[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  if (value) {
    return (
      <span className="chip user-chip">
        User: {value.label}
        <button
          type="button"
          className="chip-clear"
          aria-label={`Clear user filter (${value.label})`}
          onClick={() => onChange(null)}
        >
          ✕
        </button>
      </span>
    );
  }

  const showList = open && text.trim() !== '';
  return (
    <span className="user-picker">
      <input
        type="search"
        role="combobox"
        aria-label={label}
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
        placeholder="User name or login ID…"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKey}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {showList ? (
        <ul className="user-picker-list" role="listbox" id={listId}>
          {results.map((u, i) => (
            <li
              key={u.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(u);
              }}
            >
              {userLabel(u)}
            </li>
          ))}
          {results.length === 0 ? (
            <li className="user-picker-empty" role="presentation">
              {error || 'No matching users.'}
            </li>
          ) : null}
        </ul>
      ) : null}
    </span>
  );
}
