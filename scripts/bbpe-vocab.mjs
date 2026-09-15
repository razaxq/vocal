/**
 * 从 sentencepiece 的 .model 里抽出 sherpa 要的 bpe.vocab 文本表。
 *
 * 为什么需要：byte-level BPE 的模型（比如离线 Zipformer 中英）要支持热词，
 * sherpa 必须拿到 modelingUnit='bbpe' + bpeVocab=<一个文本词表>。
 * 而上游的 tar 包里**只有 bbpe.model（二进制），没有 .vocab**。
 * 没有它，热词会在编码阶段失败 —— sherpa 只往 stderr 打一行
 * 「Encode hotwords failed, skipping」然后当作没有热词继续跑，
 * 应用层什么都察觉不到。又是一次沉默失效。
 *
 * 正规做法是用 sentencepiece 导出，但那是个 Python 依赖，
 * 而这个项目的硬约束是零编译、零额外运行时。
 * 好在只需要 (piece, score) 两个字段，protobuf 这部分结构极简单：
 *
 *   ModelProto.pieces          field 1, repeated, wire type 2（长度前缀）
 *     SentencePiece.piece      field 1, wire type 2（字符串）
 *     SentencePiece.score      field 2, wire type 5（32 位浮点）
 *
 * 所以手写一个只认这三个字段的读取器就够了，不到 40 行，没有依赖。
 * 输出格式和 sentencepiece 自己导出的完全一致（已逐行比对验证）。
 */

/** 读一个 varint，返回 [值, 新游标]。 */
function varint(buf, i) {
  let result = 0n
  let shift = 0n
  for (;;) {
    const b = buf[i++]
    result |= BigInt(b & 0x7f) << shift
    if ((b & 0x80) === 0) break
    shift += 7n
  }
  return [Number(result), i]
}

/** 解析 sentencepiece 模型，返回 [{piece, score}]。 */
export function parseSentencePieceModel(buf) {
  const out = []
  let i = 0
  while (i < buf.length) {
    const [key, next] = varint(buf, i)
    i = next
    const field = key >> 3
    const wire = key & 7

    if (field === 1 && wire === 2) {
      // pieces：一条 SentencePiece 记录
      const [len, n2] = varint(buf, i)
      i = n2
      out.push(readPiece(buf, i, i + len))
      i += len
      continue
    }

    // 其它字段直接跳过
    i = skip(buf, i, wire)
  }
  return out
}

function readPiece(buf, i, end) {
  let piece = ''
  let score = 0
  while (i < end) {
    const [key, next] = varint(buf, i)
    i = next
    const field = key >> 3
    const wire = key & 7

    if (field === 1 && wire === 2) {
      const [len, n2] = varint(buf, i)
      i = n2
      piece = buf.toString('utf8', i, i + len)
      i += len
    } else if (field === 2 && wire === 5) {
      score = buf.readFloatLE(i)
      i += 4
    } else {
      i = skip(buf, i, wire)
    }
  }
  return { piece, score }
}

function skip(buf, i, wire) {
  if (wire === 0) return varint(buf, i)[1]
  if (wire === 1) return i + 8
  if (wire === 5) return i + 4
  if (wire === 2) {
    const [len, n] = varint(buf, i)
    return n + len
  }
  throw new Error(`不认识的 protobuf wire type ${wire}`)
}

/**
 * 直接生成 sherpa 要的那份文本：每行「piece score」。
 *
 * 整数分数补上 .0 —— sentencepiece 自己导出时是这个样子，
 * 虽然 sherpa 解析成 float 两种都吃，但对得上才好逐行比对验证。
 */
export function toVocabText(buf) {
  return parseSentencePieceModel(buf)
    .map(({ piece, score }) => `${piece} ${Number.isInteger(score) ? score.toFixed(1) : score}`)
    .join('\n') + '\n'
}
