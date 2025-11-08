import { datajudPOST } from "../clients/datajudHttp.js";

export interface DatajudScrollDsl {
  size?: number;
  query?: Record<string, unknown>;
}

export type DatajudHit<T = unknown> = T;

export type DatajudScrollPage<T = DatajudHit> = T[];

export type DatajudPageHandler<T = DatajudHit> = (page: DatajudScrollPage<T>) => Promise<void> | void;

// Varredura em lote com paginação por search_after
export async function datajudScroll<T = DatajudHit>(alias: string, dsl: DatajudScrollDsl, onPage: DatajudPageHandler<T>): Promise<void> {
  let search_after: unknown;
  for (;;) {
    const body = {
      size: dsl.size ?? 200,
      query: dsl.query ?? { match_all: {} },
      sort: [{ "@timestamp": { order: "asc" } }],
      ...(search_after ? { search_after } : {}),
    };
    const json = await datajudPOST<T>(alias, "/_search", body);
    const page = (json?.hits?.hits ?? []) as T[];
    if (!page.length) break;
    await onPage(page);
    const lastItem = page[page.length - 1] as { sort?: unknown } | undefined;
    search_after = lastItem?.sort;
    if (!search_after) break;
  }
}

export default { datajudScroll };