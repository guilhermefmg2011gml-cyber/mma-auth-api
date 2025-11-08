export interface DatajudResponse<T = unknown> {
  hits?: {
    hits?: T[];
  };
}

export async function datajudPOST<T = unknown>(_alias: string, _path: string, _body: unknown): Promise<DatajudResponse<T>> {
  throw new Error("datajudPOST is not implemented in this environment");
}