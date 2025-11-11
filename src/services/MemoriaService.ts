import { ChromaClient } from 'chromadb';
import { v4 as uuidv4 } from 'uuid';

interface VetorPeca {
  id?: string;
  tipo: 'tese' | 'jurisprudencia' | 'doutrina' | 'topico';
  titulo: string;
  texto: string;
  contexto?: Record<string, any>;
}

export class MemoriaService {
  private client: ChromaClient;
  private collectionName = 'memoria_juridica';

  constructor(apiKey: string) {
    this.client = new ChromaClient({ path: 'https://api.trychroma.com', apiKey });
  }

  async iniciar() {
    const collections = await this.client.listCollections();
    const existe = collections.some((c) => c.name === this.collectionName);

    if (!existe) {
      await this.client.createCollection({ name: this.collectionName });
    }
  }

  async salvar(vetor: VetorPeca): Promise<string> {
    const id = vetor.id || uuidv4();
    const collection = await this.client.getCollection({ name: this.collectionName });

    await collection.add({
      ids: [id],
      documents: [vetor.texto],
      metadatas: [{ tipo: vetor.tipo, titulo: vetor.titulo, ...vetor.contexto }],
    });

    return id;
  }

  async buscar(query: string, tipo?: VetorPeca['tipo']) {
    const collection = await this.client.getCollection({ name: this.collectionName });

    const result = await collection.query({
      queryTexts: [query],
      nResults: 5,
      where: tipo ? { tipo } : undefined,
    });

    return result.documents[0].map((texto, i) => ({
      texto,
      metadados: result.metadatas[0][i],
      distancia: result.distances[0][i],
    }));
  }
}