import { ChromaClient } from 'chromadb'
import { v4 as uuidv4 } from 'uuid'

interface SalvarMemoriaInput {
  texto: string
  vetor: number[]
  clienteId?: string
  processoId?: string
}

interface BuscarMemoriaInput {
  consulta: string
  vetor: number[]
  clienteId?: string
  processoId?: string
  topK?: number
}

const COLLECTION_NAME = 'pecas_memoria'

export class MemoriaService {
  private static client = new ChromaClient({ path: 'https://api.trychroma.com' })

  private static async getCollection() {
    return this.client.getOrCreateCollection({ name: COLLECTION_NAME })
  }

  static async salvar({ texto, vetor, clienteId, processoId }: SalvarMemoriaInput) {
    if (!texto?.trim() || !Array.isArray(vetor) || !vetor.length) {
      return
    }
      const metadados: Record<string, string> = {}
    if (clienteId) metadados.clienteId = clienteId
    if (processoId) metadados.processoId = processoId

    const collection = await this.getCollection()
    await collection.add({
      ids: [uuidv4()],
      documents: [texto],
      embeddings: [vetor],
      metadatas: [metadados],
    })
  }

  static async buscar({ consulta, vetor, clienteId, processoId, topK = 5 }: BuscarMemoriaInput) {
    if (!consulta?.trim() || !Array.isArray(vetor) || !vetor.length) {
      return []
    }

    const filtro: Record<string, string> = {}
    if (clienteId) filtro.clienteId = clienteId
    if (processoId) filtro.processoId = processoId

    const collection = await this.getCollection()
    const resultado = await collection.query({
      queryTexts: [consulta],
      queryEmbeddings: [vetor],
      nResults: topK,
      where: Object.keys(filtro).length ? filtro : undefined,
    })

    const documentos = resultado.documents?.[0] ?? []
    const distancias = resultado.distances?.[0] ?? []
    const metadados = resultado.metadatas?.[0] ?? []

    return documentos.map((texto, index) => ({
      texto,
      distancia: distancias[index],
      metadados: metadados[index],
    }));
  }
}