/**
 * 通用 LAD 证据分析（不写死某台机床地址）
 * 依据：符号注释模式 + 助记符网路；输出「已证实 / 待人工 / 线索」
 */
import { analyzeAddressPairInterlock } from './fanucMnemonic.mjs'

function normAddr(a) {
  const s = String(a || '').trim().toUpperCase()
  const m = s.match(/^([XYFGRAKTCDL])(\d{1,5})(?:\.(\d))?$/i)
  if (!m) return s
  const bit = m[3] !== undefined ? `.${m[3]}` : ''
  return `${m[1].toUpperCase()}${m[2].padStart(4, '0')}${bit}`
}

function commentOf(sym) {
  return String(sym?.comment || '')
}

function findByComment(symbols, re, { types = null, limit = 40 } = {}) {
  const out = []
  for (const s of symbols || []) {
    if (types && !types.includes(s.addr[0])) continue
    if (re.test(commentOf(s))) out.push(s)
    if (out.length >= limit) break
  }
  return out
}

function netSample(net, n = 10) {
  return (net?.raw || []).slice(0, n).join(' | ')
}

/** 线圈所在网（修复多 WRT 同网后更准确） */
export function netsWriting(mnemonic, addr) {
  const a = normAddr(addr)
  if (!mnemonic?.ok || !a) return []
  return (mnemonic.nets || []).filter((n) => n.coils.some((c) => c.addr === a))
}

/** 该地址作为触点出现在哪些网，以及那些网写了什么线圈 */
export function usageAsContact(mnemonic, addr) {
  const a = normAddr(addr)
  if (!mnemonic?.ok || !a) return []
  const out = []
  for (const n of mnemonic.nets || []) {
    const hit = n.contacts.find((c) => c.addr === a)
    if (!hit) continue
    out.push({
      net: n.id,
      not: hit.not,
      op: hit.op,
      coils: n.coils.map((c) => c.addr),
      sample: netSample(n),
    })
  }
  return out
}

/**
 * 按注释模式自动发现「应对立/互锁」的符号对（不绑死地址）
 */
export function discoverInterlockPairCandidates(symbols) {
  const ys = (symbols || []).filter((s) => s.addr.startsWith('Y') || s.addr.startsWith('R'))
  const xs = (symbols || []).filter((s) => s.addr.startsWith('X'))
  const pairs = []
  const pushPair = (kind, a, b, note) => {
    if (!a || !b || a.addr === b.addr) return
    const key = [a.addr, b.addr].sort().join('|')
    if (pairs.some((p) => p.key === key && p.kind === kind)) return
    pairs.push({ key, kind, a, b, note })
  }

  const pick = (list, re) => list.filter((s) => re.test(commentOf(s)))

  // 星三角
  for (const star of pick(ys, /\bSTAR\b|\bSTATOR\b|星/i)) {
    const delta = pick(ys, /\bDELTA\b|三角/i).find((d) => {
      // 同前缀簇：WH1 / WH 1 / WH2
      const m = commentOf(star).match(/(WH\s*[12]|WHEEL\s*[12]|MTR|MOTOR)/i)
      if (!m) return true
      return new RegExp(m[1].replace(/\s+/g, '\\s*'), 'i').test(commentOf(d))
    })
    if (delta) {
      pushPair('星三角互锁', star, delta, '同电机星/三角接触器是否互锁，须对照电气图；助记符可核常闭互锁线索')
    }
  }

  // CW / CCW（优先 Y 输出，避免内部 AUX 脉冲刷屏）
  for (const cw of pick(ys.filter((s) => s.addr.startsWith('Y')), /\bCW\b|正转/i)) {
    const ccw = pick(ys.filter((s) => s.addr.startsWith('Y')), /\bCCW\b|反转/i).find((d) => {
      const m = commentOf(cw).match(/(WH\s*[12]|WHEEL|SPINDLE|GW|RW)/i)
      if (!m) return Math.abs(Number(cw.addr.replace(/\D/g, '')) - Number(d.addr.replace(/\D/g, ''))) < 20
      return new RegExp(m[1].replace(/\s+/g, '\\s*'), 'i').test(commentOf(d))
    })
    if (ccw) pushPair('正反转互锁', cw, ccw, '正反转输出不可同时接通')
  }

  // FRONT / BACK 阀或位（优先 Y）
  for (const front of pick(ys.filter((s) => s.addr.startsWith('Y')), /\bFRONT\b/i)) {
    const back = pick(ys.filter((s) => s.addr.startsWith('Y')), /\bBACK\b|\bREAR\b/i).find((d) => {
      const stem = commentOf(front).replace(/\bFRONT\b|\bBACK\b|\bREAR\b/gi, '').trim()
      if (stem.length < 3) return false
      return commentOf(d).replace(/\bFRONT\b|\bBACK\b|\bREAR\b/gi, '').includes(stem.slice(0, 6))
    })
    if (back) pushPair('前后位/阀互锁', front, back, '前后动作是否互锁')
  }

  // AUTO / JOG：优先模式灯（Y），其次模式键（X）
  const autoY = pick(ys, /^AUTO\s+MODE\s*L\b|\bAUTO\s+MODE\s*L\b/i)[0]
  const jogY = pick(ys, /^JOG\s+MODE\s*L\b|\bJOG\s+MODE\s*L\b/i)[0]
  if (autoY && jogY) {
    pushPair('自动/点动模式互斥', autoY, jogY, '模式灯输出是否互斥')
  } else {
    const auto = pick([...xs, ...ys], /\bAUTO\b.*\b(MODE|KEY|L)\b|\b(MODE|KEY|L)\b.*\bAUTO\b|^AUTO\s+(KEY|MODE|L)\b/i)
    const jog = pick([...xs, ...ys], /\bJOG\b.*\b(MODE|KEY|L)\b|\b(MODE|KEY|L)\b.*\bJOG\b|^JOG\s+(KEY|MODE|L)\b/i)
    if (auto[0] && jog[0] && auto[0].addr[0] === jog[0].addr[0]) {
      pushPair('自动/点动模式互斥', auto[0], jog[0], '模式输出或键是否互斥（CNC 侧也可能处理）')
    }
  }

  // 仅当注释明确写 MODE1/2/3
  const m1 = pick(xs, /\bMODE\s*1\b/i)[0]
  const m2 = pick(xs, /\bMODE\s*2\b/i)[0]
  const m3 = pick(xs, /\bMODE\s*3\b/i)[0]
  if (m1 && m2) pushPair('MODE 编码互斥', m1, m2, '模式编码是否互斥映到 CNC')
  if (m1 && m3) pushPair('MODE 编码互斥', m1, m3, '模式编码是否互斥映到 CNC')

  // DRESS vs GRIND：优先带 CYCLE 的输入
  const dress =
    pick(xs, /DRESS.*CYCLE|CYCLE.*DRESS/i)[0] || pick(xs, /\bDRESS\b/i)[0]
  const grind =
    pick(xs, /GRIND.*CYCLE|CYCLE.*GRIND/i)[0] ||
    pick(xs, /\bGRIND\b.*\b(RUN|CYCLE|KEY)\b/i)[0]
  if (dress && grind) {
    pushPair('修整/磨削互斥（线索）', dress, grind, '修整与磨削循环是否互锁，避免同时有效')
  }

  return pairs
}

/**
 * 急停 / *ESP / *SP 链路（注释发现 + 助记符追溯）
 */
export function analyzeSafetyChains(symbols, mnemonic) {
  const findings = [] // { tier: 'confirmed'|'pending'|'info', title, evidence, advice }
  const estopXs = findByComment(symbols, /E-?STOP|ESTOP|EMERG|急停/i, { types: ['X'] })
  const subEstop = findByComment(symbols, /SUB\s*E-?STOP|SUB\s*ESTOP|副.?急停/i, { types: ['X'] })
  const espGs = findByComment(symbols, /\*?ESP|NC\s*\*?ESP|E-?STOP/i, { types: ['G'] })
  const spGs = findByComment(symbols, /^\*?SP\b|\*SP\b|FEED\s*HOLD|CYCLE\s*STOP/i, { types: ['G'] })
  const bypasses = findByComment(symbols, /BYPASS|\bBYP\b|BAPSS/i, { limit: 30 })

  if (!estopXs.length && !espGs.length) {
    findings.push({
      tier: 'info',
      title: '符号表未见明显急停/*ESP 注释',
      evidence: '未匹配到 E-STOP / *ESP 类注释（可能命名不同）',
      advice: '对照电气图与接口表核对急停点名',
    })
  }

  if (mnemonic?.ok) {
    /** 沿写线圈网向上追溯若干层，收集触点地址 */
    const collectUpstreamContacts = (startAddr, maxDepth = 3) => {
      const seen = new Set()
      const allContacts = []
      const queue = [{ addr: normAddr(startAddr), depth: 0 }]
      while (queue.length) {
        const { addr, depth } = queue.shift()
        if (!addr || seen.has(addr) || depth > maxDepth) continue
        seen.add(addr)
        for (const net of netsWriting(mnemonic, addr)) {
          for (const c of net.contacts) {
            if (!c.addr) continue
            allContacts.push({ addr: c.addr, depth, net: net.id, sample: netSample(net), not: c.not })
            if (c.addr.startsWith('R') && depth < maxDepth) {
              queue.push({ addr: c.addr, depth: depth + 1 })
            }
          }
        }
      }
      return allContacts
    }

    for (const esp of espGs.slice(0, 4)) {
      const nets = netsWriting(mnemonic, esp.addr)
      if (!nets.length) {
        findings.push({
          tier: 'pending',
          title: `${esp.addr}（${esp.comment}）助记符未见写线圈`,
          evidence: '符号存在，但当前助记符未解析到 WRT 该地址（可能在未导出级/功能指令）',
          advice: '用 LADDER-III 搜索该地址',
        })
        continue
      }

      const upstream = collectUpstreamContacts(esp.addr, 3)
      const upAddrs = new Set(upstream.map((u) => u.addr))
      const hitsEstop = estopXs.filter((x) => upAddrs.has(normAddr(x.addr)))
      const hitsSub = subEstop.filter((x) => upAddrs.has(normAddr(x.addr)))
      const pathSamples = upstream
        .filter((u) => [...hitsEstop, ...hitsSub].some((x) => normAddr(x.addr) === u.addr))
        .slice(0, 2)

      if (hitsEstop.length || hitsSub.length) {
        const direct = nets.some((n) =>
          n.contacts.some((c) =>
            [...hitsEstop, ...hitsSub].some((x) => c.addr === normAddr(x.addr)),
          ),
        )
        findings.push({
          tier: 'confirmed',
          title: direct
            ? `急停输入直接参与驱动 ${esp.addr}`
            : `急停经内部继电器间接驱动 ${esp.addr}`,
          evidence: `接口 ${esp.addr}=${esp.comment}；上游命中 ${[...hitsEstop, ...hitsSub]
            .map((s) => `${s.addr}(${s.comment})`)
            .join('、')}；样例：${pathSamples[0]?.sample || netSample(nets[0])}`,
          advice: '硬线串并联仍须电气图确认；PMC 侧至少已引用这些输入',
        })
      } else {
        const contactAddrs = nets[0].contacts.map((c) => c.addr).filter(Boolean)
        findings.push({
          tier: 'pending',
          title: `${esp.addr} 驱动条件未见机侧 E-STOP 触点`,
          evidence: `写 ${esp.addr} 的网触点：${contactAddrs.slice(0, 12).join(', ') || '（空）'}；上游继电器已展开 ${upstream.length} 个触点仍未见 E-STOP 注释点；样例：${netSample(nets[0])}`,
          advice: '可能经未命名内部位或硬线；用 LADDER-III 沿触点反查',
        })
      }
    }

    // *SP 是否与 machine ready / esp 链路有关
    for (const sp of spGs.slice(0, 3)) {
      const nets = netsWriting(mnemonic, sp.addr)
      for (const net of nets.slice(0, 2)) {
        const addrs = net.contacts.map((c) => c.addr)
        const usesReady = addrs.some((a) => {
          const sym = (symbols || []).find((s) => normAddr(s.addr) === a)
          return sym && /READY|READ\.?\s*AU|MACHINE\s*READ/i.test(commentOf(sym))
        })
        const usesEspRelated = addrs.some((a) => espGs.some((g) => normAddr(g.addr) === a))
        if (usesReady || usesEspRelated) {
          findings.push({
            tier: 'confirmed',
            title: `${sp.addr}（${sp.comment}）条件关联机床就绪/急停链`,
            evidence: `样例：${netSample(net)}`,
            advice: '急停打断就绪时，PMC 侧可能同时影响 *SP；仍须确认伺服/主轴硬件制动',
          })
        }
      }
    }

    // 旁路：若作为触点出现在写 *ESP / READY / *SP 的网，或出现在其上游 → 升为确认关注
    for (const bp of bypasses) {
      const uses = usageAsContact(mnemonic, bp.addr)
      if (!uses.length) continue
      const hot = uses.filter((u) =>
        u.coils.some((c) => {
          const sym = (symbols || []).find((s) => normAddr(s.addr) === c)
          const cm = commentOf(sym)
          return (
            /\*?ESP|E-?STOP|READY|\*?SP|INTERLOCK|\*IT|BYPASS/i.test(cm) ||
            espGs.some((g) => normAddr(g.addr) === c) ||
            spGs.some((g) => normAddr(g.addr) === c)
          )
        }),
      )
      // 也检查旁路是否在 ESP 上游触点集合里
      let inEspUpstream = false
      for (const esp of espGs.slice(0, 2)) {
        const up = collectUpstreamContacts(esp.addr, 3)
        if (up.some((u) => u.addr === normAddr(bp.addr))) {
          inEspUpstream = true
          break
        }
      }
      if (hot.length || inEspUpstream) {
        findings.push({
          tier: 'confirmed',
          title: `旁路点 ${bp.addr}（${bp.comment}）参与安全相关条件`,
          evidence: hot.length
            ? hot
                .slice(0, 2)
                .map((h) => `写 ${h.coils.join(',')}；样例：${h.sample}`)
                .join(' || ')
            : `出现在 *ESP 上游触点链中`,
          advice: '现场保护失效时优先查该旁路置位条件与钥匙开关',
        })
      }
    }
  } else {
    if (estopXs.length && espGs.length) {
      findings.push({
        tier: 'pending',
        title: '急停符号成对存在，但无助记符无法核验链路',
        evidence: `输入：${estopXs
          .slice(0, 3)
          .map((s) => `${s.addr}=${s.comment}`)
          .join('；')} → 接口：${espGs
          .slice(0, 2)
          .map((s) => `${s.addr}=${s.comment}`)
          .join('；')}`,
        advice: '放置同目录助记符或允许 LADDER-III 导出后再生成报告',
      })
    }
    if (bypasses.length >= 2) {
      findings.push({
        tier: 'info',
        title: `符号表存在 ${bypasses.length} 处旁路类注释`,
        evidence: bypasses
          .slice(0, 8)
          .map((s) => `${s.addr}=${s.comment}`)
          .join('；'),
        advice: '有助记符后可判断旁路是否接入急停/互锁网',
      })
    }
  }

  // 润滑压力类：有助记符时看是否进就绪
  const lub = findByComment(symbols, /LUB.*PRESS|PRESS.*LUB|润滑.*压/i, { types: ['X'], limit: 8 })
  if (mnemonic?.ok && lub.length) {
    for (const x of lub.slice(0, 3)) {
      const uses = usageAsContact(mnemonic, x.addr)
      const toReady = uses.filter((u) =>
        u.coils.some((c) => {
          const sym = (symbols || []).find((s) => normAddr(s.addr) === c)
          return sym && /READY|READ\.?\s*AU|SERVO/i.test(commentOf(sym))
        }),
      )
      if (toReady.length) {
        findings.push({
          tier: 'confirmed',
          title: `润滑压力 ${x.addr} 参与就绪/相关输出条件`,
          evidence: toReady[0].sample,
          advice: '核对延时与丢失压力时是否断 *SP/进给',
        })
      }
    }
  }

  // 冷却泵：Y 有 COOL PUMP 时，看驱动条件是否含磨削/修整阀
  const coolPump = findByComment(symbols, /COOL\s*PUMP|冷却泵/i, { types: ['Y'], limit: 4 })
  if (mnemonic?.ok && coolPump[0]) {
    const nets = netsWriting(mnemonic, coolPump[0].addr)
    if (nets[0]) {
      findings.push({
        tier: 'info',
        title: `冷却泵 ${coolPump[0].addr} 驱动条件（助记符）`,
        evidence: netSample(nets[0], 12),
        advice: '确认磨削启动是否要求冷却已建立（反馈/延时）',
      })
    }
  }

  return { findings, estopXs, espGs, spGs, bypasses }
}

/**
 * 对发现的成对项做助记符互锁标注
 */
export function enrichPairsWithMnemonic(pairs, mnemonic) {
  const STATUS_LABEL = {
    interlock_seen: '助记符已见互锁',
    no_interlock_seen: '助记符未见互锁接触',
    risk_same_net: '助记符同网双线圈（风险）',
    no_coil: '助记符未见对应线圈',
    unavailable: '无助记符',
  }
  return (pairs || []).map((p0) => {
    const r = analyzeAddressPairInterlock(mnemonic, p0.a.addr, p0.b.addr)
    const lab = STATUS_LABEL[r.status] || r.status
    let kind = p0.kind
    let note = p0.note
    let tier = 'pending'
    if (r.status === 'interlock_seen') {
      kind = `${p0.kind}（${lab}）`
      note = `${p0.note} 【${lab}】${r.evidence[0]?.sample ? `例：${r.evidence[0].sample}` : ''}`
      tier = 'confirmed'
    } else if (r.status === 'risk_same_net') {
      kind = `${p0.kind}（${lab}）`
      note = `${p0.note} 【${lab}】`
      tier = 'confirmed'
    } else if (mnemonic?.ok && r.status !== 'unavailable') {
      kind = `${p0.kind}（${lab}·仍待人工）`
      note = `${p0.note} 【${lab}】`
      tier = 'pending'
    } else {
      kind = `${p0.kind}（待证）`
      tier = 'pending'
    }
    return { ...p0, kind, note, tier, mnemonicStatus: r.status, mnemonicEvidence: r.evidence }
  })
}

export { findByComment, normAddr }
