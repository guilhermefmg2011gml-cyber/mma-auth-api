import { datajudPOST } from "../clients/datajudHttp.js";
// Varredura em lote com paginação por search_after
export async function datajudScroll(alias, dsl, onPage) {
    let search_after;
    for (;;) {
        const body = {
            size: dsl.size ?? 200,
            query: dsl.query ?? { match_all: {} },
            sort: [{ "@timestamp": { order: "asc" } }],
            ...(search_after ? { search_after } : {}),
        };
        const json = await datajudPOST(alias, "/_search", body);
        const page = (json?.hits?.hits ?? []);
        if (!page.length)
            break;
        await onPage(page);
        const lastItem = page[page.length - 1];
        search_after = lastItem?.sort;
        if (!search_after)
            break;
    }
}
export default { datajudScroll };
