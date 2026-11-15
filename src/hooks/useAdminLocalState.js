import { useEffect, useState } from "react";

export function useAdminLocalState(name, initialValue) {
  const key = `handy.admin.${name}`;
  const [value, setValue] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem(key)) ?? initialValue;
    } catch {
      return initialValue;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Keep the current session usable when browser storage is unavailable.
    }
  }, [key, value]);
  return [value, setValue];
}
