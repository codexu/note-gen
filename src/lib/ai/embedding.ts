import { Store } from "@tauri-apps/plugin-store";
import { AiConfig } from "@/app/core/setting/config";
import { handleAIError } from "./utils";
import { invokeAiJson } from "./tauri-client";

// 嵌入请求响应类型
interface EmbeddingResponse {
  object: string;
  model: string;
  data: Array<{
    object: string;
    embedding: number[];
    index: number;
  }>;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

/**
 * 获取嵌入模型信息
 */
async function getEmbeddingModelInfo() {
  const store = await Store.load('store.json');
  const embeddingModel = await store.get<string>('embeddingModel');
  if (!embeddingModel) return null;
  
  const aiModelList = await store.get<AiConfig[]>('aiModelList');
  if (!aiModelList) return null;
  
  // 在新的数据结构中，需要找到包含指定模型ID的配置
  for (const config of aiModelList) {
    // 检查新的 models 数组结构
    if (config.models && config.models.length > 0) {
      const targetModel = config.models.find(model => 
        model.id === embeddingModel && model.modelType === 'embedding'
      );
      if (targetModel) {
        // 返回合并了模型配置的 AiConfig
        return {
          ...config,
          model: targetModel.model,
          modelType: targetModel.modelType,
          temperature: targetModel.temperature,
          topP: targetModel.topP,
          voice: targetModel.voice,
          enableStream: targetModel.enableStream
        };
      }
    } else {
      // 向后兼容：处理旧的单模型结构
      if (config.key === embeddingModel && config.modelType === 'embedding') {
        return config;
      }
    }
  }
  
  return null;
}

/**
 * 获取重排序模型信息
 */
export async function getRerankModelInfo() {
  const store = await Store.load('store.json');
  const rerankModel = await store.get<string>('rerankingModel');
  if (!rerankModel) return null;
  
  const aiModelList = await store.get<AiConfig[]>('aiModelList');
  if (!aiModelList) return null;
  
  // 在新的数据结构中，需要找到包含指定模型ID的配置
  for (const config of aiModelList) {
    // 检查新的 models 数组结构
    if (config.models && config.models.length > 0) {
      const targetModel = config.models.find(model => 
        model.id === rerankModel && model.modelType === 'rerank'
      );
      if (targetModel) {
        // 返回合并了模型配置的 AiConfig
        return {
          ...config,
          model: targetModel.model,
          modelType: targetModel.modelType,
          temperature: targetModel.temperature,
          topP: targetModel.topP,
          voice: targetModel.voice,
          enableStream: targetModel.enableStream
        };
      }
    } else {
      // 向后兼容：处理旧的单模型结构
      if (config.key === rerankModel && config.modelType === 'rerank') {
        return config;
      }
    }
  }
  
  return null;
}

/**
 * 检查是否有重排序模型可用
 */
export async function checkRerankModelAvailable(): Promise<boolean> {
  try {
    // 获取重排序模型信息
    const modelInfo = await getRerankModelInfo();
    if (!modelInfo) return false;
    
    const { baseURL, apiKey, model } = modelInfo;
    if (!baseURL || !model) return false;
    
    // 测试重排序模型
    const testQuery = '测试查询';
    const testDocuments = [
      '这是一个测试文档', 
      '这是另一个测试文档'
    ];
    
    // 发送测试请求
    const data = await invokeAiJson<any>({
      config: {
        baseUrl: baseURL,
        apiKey: apiKey || undefined,
        customHeaders: modelInfo.customHeaders,
      },
      path: '/rerank',
      method: 'POST',
      body: {
        model,
        query: testQuery,
        documents: testDocuments,
      }
    });
    return !!(data && data.results);
  } catch (error) {
    console.error('重排序模型检查失败:', error);
    return false;
  }
}

/**
 * 请求嵌入向量
 * @param text 需要嵌入的文本
 * @returns 嵌入向量结果，如果失败则返回null
 */
export async function fetchEmbedding(text: string): Promise<number[] | null> {
  try {
    if (text.length) {
      // 获取嵌入模型信息
      const modelInfo = await getEmbeddingModelInfo();
      if (!modelInfo) {
        throw new Error('未配置嵌入模型或模型配置不正确');
      }
      
      const { baseURL, apiKey, model } = modelInfo;

      if (!baseURL || !model) {
        throw new Error('嵌入模型配置不完整');
      }
      
      // 发送嵌入请求
      const data = await invokeAiJson<EmbeddingResponse>({
        config: {
          baseUrl: baseURL,
          apiKey: apiKey || undefined,
          customHeaders: modelInfo.customHeaders,
        },
        path: '/embeddings',
        method: 'POST',
        body: {
          model,
          input: text,
          encoding_format: 'float'
        }
      });
      if (!data || !data.data || !data.data[0] || !data.data[0].embedding) {
        throw new Error('嵌入结果格式不正确');
      }
      
      return data.data[0].embedding;
    }
    
    return null;
  } catch (error) {
    handleAIError(error);
    return null;
  }
}

/**
 * 使用重排序模型重新排序检索的文档
 * @param query 用户查询
 * @param documents 要重新排序的文档列表
 * @returns 重新排序后的文档列表
 */
export async function rerankDocuments(
  query: string,
  documents: {id: number, filename: string, content: string, similarity: number}[]
): Promise<{id: number, filename: string, content: string, similarity: number}[]> {
  try {
    if (!documents.length) {
      return documents;
    }

    const modelInfo = await getRerankModelInfo();
    if (!modelInfo) {
      return documents;
    }

    const { baseURL, apiKey, model } = modelInfo;

    if (!baseURL || !model) {
      return documents;
    }

    const passages = documents.map(doc => doc.content);

    const data = await invokeAiJson<any>({
      config: {
        baseUrl: baseURL,
        apiKey: apiKey || undefined,
        customHeaders: modelInfo.customHeaders,
      },
      path: '/rerank',
      method: 'POST',
      body: {
        model,
        query,
        documents: passages
      }
    });

    if (!data || !data.results) {
      throw new Error('重排序结果格式不正确');
    }

    // 计算最高 rerank 分数，用于判断是否使用 rerank 结果
    const maxRerankScore = Math.max(...data.results.map((r: any) => r.relevance_score || r.score || 0));
    const RERANK_THRESHOLD = 0.1;

    // 如果 rerank 模型认为没有相关文档（最高分太低），返回原始排序
    if (maxRerankScore < RERANK_THRESHOLD) {
      return documents;
    }

    const rerankResults = data.results.map((result: any, index: number) => {
      const docIndex = result.document_index ?? result.index ?? index;
      const originalDoc = documents[docIndex];
      return {
        ...originalDoc,
        similarity: result.relevance_score || result.score || documents[index].similarity
      };
    }).filter((doc: any): doc is {id: number, filename: string, content: string, similarity: number} => doc !== undefined);

    return rerankResults.sort((a: {similarity: number}, b: {similarity: number}) => b.similarity - a.similarity);
  } catch (error) {
    console.error('[Rerank] 重排序失败:', error);
    return documents;
  }
}
