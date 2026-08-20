import { useCallback, useEffect, useState } from 'react'

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  const contentType = response.headers.get('content-type') ?? ''
  const data: unknown = contentType.includes('application/json') ? await response.json() : await response.text()
  if (!response.ok) {
    const message = typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
      ? data.error : `请求失败：${response.status}`
    throw new ApiError(message, response.status)
  }
  return data as T
}

export function jsonRequest(method: 'POST' | 'PUT', body?: unknown): RequestInit {
  return {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
}

// The response type is supplied by each API consumer because fetch has no runtime generic inference.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function useApi<T>(url: string): {
  data: T | undefined
  error: string | undefined
  loading: boolean
  reload: () => void
} {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const reload = useCallback(() => setRevision(value => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(undefined)
    void request<T>(url, { signal: controller.signal }).then(setData).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [url, revision])

  return { data, error, loading, reload }
}
