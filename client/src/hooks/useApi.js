import { useEffect, useState } from "react";
import { api } from "../api.js";

/**
 * Load JSON from our API, and re-load whenever `path` changes
 * (for example when a filter changes the query string).
 *
 * Returns { data, error, loading }.
 */
export function useApi(path) {
  // Remember WHICH path the current result belongs to.
  const [result, setResult] = useState({ path: null, data: null, error: null });

  useEffect(() => {
    let ignore = false;
    api(path).then(
      (data) => {
        if (!ignore) setResult({ path, data, error: null });
      },
      (err) => {
        if (!ignore) setResult({ path, data: null, error: err.message });
      },
    );

    // If path changes again before this response arrives, ignore the old
    // response. Otherwise a slow old request could overwrite newer results.
    return () => {
      ignore = true;
    };
  }, [path]); // ← "dependencies": re-run this effect when path changes

  // DERIVED, not stored: we're loading whenever our result is for a
  // different path than the one being asked for. While loading we keep
  // showing the previous data, so the table doesn't flash empty.
  const loading = result.path !== path;
  return { data: result.data, error: loading ? null : result.error, loading };
}
