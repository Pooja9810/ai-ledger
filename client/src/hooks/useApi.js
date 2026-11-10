import { useEffect, useState } from "react";
import { api } from "../api.js";

/**
 * Load JSON from our API, and re-load whenever `path` changes
 * (for example when a filter changes the query string).
 *
 * `version` is an optional counter: bump it to force a re-load of the same
 * path (for example after saving a new transaction).
 *
 * Returns { data, error, loading }.
 */
export function useApi(path, version = 0) {
  // Remember WHICH request (path + version) the current result belongs to.
  const [result, setResult] = useState({
    key: null,
    data: null,
    error: null,
  });
  const key = `${version}:${path}`;

  useEffect(() => {
    let ignore = false;
    api(path).then(
      (data) => {
        if (!ignore) setResult({ key, data, error: null });
      },
      (err) => {
        if (!ignore) setResult({ key, data: null, error: err.message });
      },
    );

    // If the request changes again before this response arrives, ignore the
    // old response. Otherwise a slow old request could overwrite newer results.
    return () => {
      ignore = true;
    };
  }, [key, path]); // ← re-run when the path or version changes

  // DERIVED, not stored: we're loading whenever our result belongs to a
  // different request. Meanwhile we keep showing the previous data, so the
  // screen doesn't flash empty.
  const loading = result.key !== key;
  return { data: result.data, error: loading ? null : result.error, loading };
}
