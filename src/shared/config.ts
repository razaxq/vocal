/** 配置的默认值与校验。主进程用 zod 校验后写入 electron-store。 */
import { z } from 'zod'
import type { AppConfig } from './ipc'
import { ALL_RECORDABLE_KEYS, DEFAULT_HOTKEY_KEY } from './hotkeys'
import { STREAMING_IDS, OFFLINE_IDS, DEFAULT_MODEL_IDS, MODEL_NONE } from './modelRegistry'

/** 段级轻润色：只修错别字，不改写句式。默认不用。 */
export const DEFAULT_PROMPT = [
  '你是中文语音输入的后处理器。输入是语音识别的原始结果，可能有错别字、缺标点。',
  '只做两件事，不要回答内容、不要扩写、不要解释：',
  '1. 补全和修正标点；',
  '2. 纠正明显的同音错别字和识别错误。',
  '保留说话人的原话和语序，中英混排时保持英文原样。',
  '直接输出修改后的文本，不要加任何前后缀。'
].join('\n')

/** 会话级整理：口语转书面。这是长输入结束后跑的那一趟。 */
export const DEFAULT_CONSOLIDATE_PROMPT = [
  '你是中文口述稿的整理编辑。输入是一段语音听写的文字，口语痕迹很重。',
  '请把它整理成可以直接使用的书面文字：',
  '1. 把口语句式改写成书面表达（「这个东西它不太行」→「该方案存在不足」）；',
  '2. 合并被停顿切碎的句子，理顺语序；',
  '3. 删除重复、自我修正的痕迹（「我觉得…不对，应该说…」只保留最终意思）；',
  '4. 按语义分段，段落之间空一行；',
  '5. 标点规范化。',
  '',
  '严格约束：',
  '- 不得增加原文没有的信息，不得发表评论或回答问题；',
  '- 保留所有专有名词、人名、数字、代码标识符、英文术语的原样；',
  '- 如果输入本身已经是书面语，原样返回即可。',
  '直接输出整理后的正文，不要加任何说明、标题或前后缀。'
].join('\n')

export const configSchema = z.object({
  hotkey: z.object({
    mode: z.enum(['hold', 'toggle', 'doubleTap']).default('hold'),
    // 必须是 uiohook 认识的键名。写错了要到注册热键那一刻才炸，所以在这里就挡住。
    key: z.enum(ALL_RECORDABLE_KEYS as [string, ...string[]]).catch(DEFAULT_HOTKEY_KEY).default(DEFAULT_HOTKEY_KEY),
    accelerator: z.string().default('Control+Shift+Space'),
    doubleTapWindowMs: z.number().int().min(150).max(800).default(350),
    debounceMs: z.number().int().min(0).max(2000).default(300),
    minHoldMs: z.number().int().min(0).max(2000).default(200)
  }).prefault({}),

  /**
   * 选哪套本地模型。'none' 表示不使用该层。
   * 引擎档位不再是独立设置 —— 它由这两个选择推导出来（见 deriveProfile）。
   */
  models: z.object({
    streaming: z.enum([MODEL_NONE, ...STREAMING_IDS] as [string, ...string[]])
      .catch(DEFAULT_MODEL_IDS.streaming).default(DEFAULT_MODEL_IDS.streaming),
    offline: z.enum([MODEL_NONE, ...OFFLINE_IDS] as [string, ...string[]])
      .catch(DEFAULT_MODEL_IDS.offline).default(DEFAULT_MODEL_IDS.offline)
  }).prefault({}),

  /** 识别行为里跟模型无关的那部分。 */
  asr: z.object({
    /**
     * 停顿多久算「这句说完了」。给流式模型的 endpoint 规则和
     * final-only 档位的静音切段器共用。
     * 默认 1.5s —— sherpa 的出厂值是 1.2s，实测想一下措辞就被切断。
     */
    endpointSilenceMs: z.number().int().min(400).max(5000).default(1500),

    /**
     * 空闲多少分钟后把识别模型从内存里放掉。0 = 一直常驻。
     * 常驻是为了「按下热键立刻能说」；但一个后台挂一整天的工具
     * 为了那几次输入白占几百 MB，对大多数人不划算。
     * 卸载后下次按热键会多等一两秒（面板显示「准备中」）。
     */
    idleUnloadMin: z.number().int().min(0).max(240).default(10)
  }).prefault({}),

  injection: z.object({
    strategy: z.enum(['unicode', 'clipboard', 'auto']).default('auto'),
    clipboardThreshold: z.number().int().min(1).default(80),
    charDelayMs: z.number().int().min(0).max(50).default(0),
    restoreClipboard: z.boolean().default(true),
    clipboardOnlyApps: z.array(z.string()).default(['WINWORD.EXE', 'EXCEL.EXE'])
  }).prefault({}),

  streaming: z.object({
    /**
     * segment：每段定稿后追加上屏（默认）。文字每隔几秒出现一批，不会回退改写。
     * live：流式 partial 也上屏，靠退格差分改写，最像输入法但风险高。
     */
    injectMode: z.enum(['segment', 'live']).default('segment'),
    /** 面板上始终显示实时文本，与上不上屏无关 */
    showLivePanel: z.boolean().default(true)
  }).prefault({}),

  /** 规则层清洗。不需要任何模型，微秒级，默认开。 */
  cleanup: z.object({
    level: z.enum(['off', 'light', 'standard']).catch('standard').default('standard'),
    /** 额外要过滤的词，每行一个 */
    extraFillers: z.array(z.string()).default([]),
    /** 热词表是否自动纳入保护词（避免专有名词被当成填充词删掉） */
    protectHotwords: z.boolean().default(true)
  }).prefault({}),

  /** 长输入结束后的 LLM 整理。需要 llm.enabled 且配了 key 才会真的跑。 */
  consolidation: z.object({
    mode: z.enum(['off', 'onFinish', 'rolling']).default('onFinish'),
    /** 低于这个字数不整理 —— 短句整理纯属浪费时间和 token */
    minChars: z.number().int().min(0).default(120),
    /** rolling 模式下，每积累这么多字整理一次 */
    rollingChars: z.number().int().min(50).default(300),
    /**
     * 整理结果替换已上屏文本时，最多允许退格多少字符。
     * 超过就不替换，只在面板上显示整理结果让用户自己取用 ——
     * 退格几千次既慢又危险。
     */
    maxReplaceChars: z.number().int().min(0).default(1500)
  }).prefault({}),

  llm: z.object({
    enabled: z.boolean().default(false),
    baseUrl: z.string().default('https://dashscope.aliyuncs.com/compatible-mode/v1'),
    apiKey: z.string().default(''),
    model: z.string().default('qwen-flash'),
    prompt: z.string().default(DEFAULT_PROMPT),
    consolidatePrompt: z.string().default(DEFAULT_CONSOLIDATE_PROMPT),
    timeoutMs: z.number().int().min(500).max(60000).default(8000)
  }).prefault({}),

  audio: z.object({
    deviceId: z.string().nullable().default(null),
    echoCancellation: z.boolean().default(true),
    noiseSuppression: z.boolean().default(true),
    autoGainControl: z.boolean().default(true)
  }).prefault({}),

  hotwords: z.array(z.string()).default([]),
  networkHotwords: z.object({
    enabled: z.boolean().default(true),
    autoUpdate: z.boolean().default(true)
  }).prefault({}),

  ui: z.object({
    theme: z.enum(['system', 'light', 'dark']).default('system'),
    followCaret: z.boolean().default(true),
    launchAtLogin: z.boolean().default(false)
  }).prefault({}),

  update: z.object({
    /** 启动及运行期间自动检查；用户点击后才下载并安装。 */
    auto: z.boolean().default(true)
  }).prefault({})
})

export const defaultConfig = (): AppConfig => configSchema.parse({}) as AppConfig
