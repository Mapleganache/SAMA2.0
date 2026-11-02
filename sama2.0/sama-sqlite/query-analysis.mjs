// 只影响检索排序；原始问题仍用于型号、准入、精确ID和安全边界判断。
export function normalize(text) {
 return String(text||'').toLowerCase().replaceAll('粘','黏')
}

export function analyzeQuery(query) {
 const raw=normalize(query)
 // 缺失测量和回答限制不是已观察到的故障。按标点截取，避免抹去其他句子的正面现象。
 const positive=raw.split(/([，,。；;！？?!\n]|但是|然而|不过|但)/).map(part=>
  /^(?:(?:尚无|没有|缺少|未有)(?:相关|本机)?(?:油品检测|油液检测|压力实测|摩擦|实测|测量|测温|测压|读数|数据|资料|记录|手册|依据|型号|工况)|未测|尚未测|未经测|不要直接|不要给|不要推荐|不直接|不能直接)/.test(part.trim())
   ? ' ' : part
 ).join('')
 const expansions=[]
 const lubrication=/油|液压|润滑/.test(positive)
 // 关联词仅作为低权重检索线索，不声称设备发生了这些故障。
 if(lubrication && (/(?:冬季|冬天|寒冷|低温|冷天|天冷)/.test(positive) || /(?:升温|变暖|气温回升).{0,12}(?:恢复|正常)/.test(positive)))
  expansions.push('低温','黏温','润滑油')
 if(/导轨/.test(positive) && /爬行|爬动|运动不平稳|卡顿/.test(positive) && /油|润滑/.test(positive))
  expansions.push('润滑','润滑剂','选择','速度','载荷')
 return {raw,positive,expansions}
}
