/**
 * Call our API and return the JSON response.
 *
 * Important: fetch() does NOT throw on 4xx/5xx responses, only on network
 * failures. So we check res.ok ourselves and turn API errors into thrown
 * Errors, which lets components handle every failure in one catch.
 */
export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null; // No Content (e.g. after DELETE)

  const data = await res.json().catch(() => null); // body might not be JSON

  if (!res.ok) {
    // Our API sends { errors: [...] } for 400s and { error: "..." } otherwise.
    const error = new Error(
      data?.errors?.join(", ") ??
        data?.error ??
        `Request failed (${res.status})`,
    );
    error.status = res.status;
    error.errors = data?.errors ?? [];
    throw error;
  }
  return data;
}
