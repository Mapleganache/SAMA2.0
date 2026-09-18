/**
 * TaskRunner：Observe → Act → Verify → Retry / Fallback
 * 不绕过 PermissionManager：每步仍走 runDesktopTool。
 */
import { runDesktopTool } from './desktopToolManager.mjs'
import { getToolPermission } from './permissionManager.mjs'
import { observeDesktop, summarizeObservation } from './observer.mjs'
import { verifyCondition } from './verifier.mjs'
import { logDesktopOperation } from './operationLogger.mjs'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, Math.min(Math.max(ms, 0), 15000)))
}

/** 计划中是否含需确认步骤 */
export function planNeedsConfirm(steps = []) {
  return steps.some((s) => {
    const tool = s.tool || s.action
    const level = getToolPermission(tool)
    return level === 'CONFIRM' || level === 'ADMIN' || level === 'BLOCK'
  })
}

/**
 * 对单步执行：主工具 → 失败则 fallbacks；每轮可带 verify
 */
async function runStepWithRetry(step, { approved, approvalId, dryRun }) {
  const retries = Math.min(Math.max(Number(step.retries) || 1, 1), 4)
  const attempts = []
  const actions = [
    { tool: step.tool, args: step.args || {} },
    ...((step.fallbacks || []).map((f) => ({
      tool: f.tool,
      args: f.args || {},
    })) || []),
  ]

  for (let attempt = 1; attempt <= retries; attempt++) {
    for (let ai = 0; ai < actions.length; ai++) {
      const action = actions[ai]
      if (dryRun) {
        const fake = {
          success: true,
          tool: action.tool,
          dryRun: true,
          data: { planned: true, args: action.args },
          permission: getToolPermission(action.tool),
        }
        attempts.push({ attempt, actionIndex: ai, result: fake })
        if (step.verify) {
          const v = await verifyCondition(step.verify, { lastResult: fake })
          attempts[attempts.length - 1].verify = v
          if (v.ok) return { ok: true, result: fake, attempts, usedFallback: ai > 0 }
        } else {
          return { ok: true, result: fake, attempts, usedFallback: ai > 0 }
        }
        continue
      }

      // 观察（可选）
      let observation = null
      if (step.observeBefore) {
        observation = await observeDesktop(
          typeof step.observeBefore === 'object' ? step.observeBefore : { screenshot: false },
        )
      }

      const result = await runDesktopTool({
        tool: action.tool,
        args: action.args,
        approved: !!approved,
        approvalId: approvalId || undefined,
        // 父计划已批准：子步骤不再二次弹确认（仅进程内；IPC 会剥离）
        skipPermissionGate: !!approved,
      })

      // 若本步需要批准且尚未批准，立刻返回
      if (result.requiresApproval) {
        return {
          ok: false,
          requiresApproval: true,
          result,
          attempts: [...attempts, { attempt, actionIndex: ai, result, observation }],
        }
      }

      let verify = null
      if (step.verify) {
        if (step.verifyDelayMs) await sleep(step.verifyDelayMs)
        verify = await verifyCondition(step.verify, { lastResult: result })
      } else {
        verify = { ok: !!result.success, type: 'tool.success', detail: result.success ? 'ok' : result.error?.message }
      }

      attempts.push({ attempt, actionIndex: ai, result, verify, observation })

      if (result.success && verify.ok) {
        if (step.observeAfter) {
          const after = await observeDesktop(
            typeof step.observeAfter === 'object' ? step.observeAfter : { screenshot: false },
          )
          return {
            ok: true,
            result,
            verify,
            observationAfter: after,
            attempts,
            usedFallback: ai > 0,
          }
        }
        return { ok: true, result, verify, attempts, usedFallback: ai > 0 }
      }
    }
    if (attempt < retries) await sleep(step.retryDelayMs || 400)
  }

  const last = attempts[attempts.length - 1]
  return {
    ok: false,
    result: last?.result || null,
    verify: last?.verify || null,
    attempts,
    error: {
      code: 'STEP_FAILED',
      message: `步骤失败: ${step.id || step.tool}（已重试/回退）`,
    },
  }
}

/**
 * 执行多步计划
 * @param {{ goal?: string, steps: array, dryRun?: boolean, approved?: boolean, approvalId?: string, observeStart?: boolean, observeEnd?: boolean, stopOnFailure?: boolean }} plan
 */
export async function runDesktopPlan(plan = {}) {
  const started = Date.now()
  const steps = Array.isArray(plan.steps) ? plan.steps : []
  if (!steps.length) {
    return {
      success: false,
      tool: 'desktop.runPlan',
      error: { code: 'EMPTY_PLAN', message: '计划 steps 为空' },
      data: null,
      permission: 'SAFE',
      timestamp: new Date().toISOString(),
      durationMs: 0,
    }
  }

  // BLOCK 步骤直接拒绝整单
  for (const s of steps) {
    if (getToolPermission(s.tool) === 'BLOCK') {
      return {
        success: false,
        tool: 'desktop.runPlan',
        error: { code: 'COMMAND_BLOCKED', message: `计划含禁止工具: ${s.tool}` },
        data: { goal: plan.goal, steps: steps.map((x) => x.tool) },
        permission: 'BLOCK',
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - started,
      }
    }
  }

  const needsConfirm = planNeedsConfirm(steps)
  // 整单确认：任一 CONFIRM 步骤且未带合法批准时，由外层 runDesktopTool('desktop.runPlan') 处理；
  // 这里若作为内部调用，仍检查 approved
  if (needsConfirm && !plan.approved && !plan.dryRun) {
    // 交给 desktopToolManager 的 permission 层；若直接调用本函数则返回 need allow 提示
    return {
      success: false,
      tool: 'desktop.runPlan',
      requiresApproval: true,
      error: { code: 'NEED_ALLOW', message: '计划含需确认步骤' },
      data: {
        goal: plan.goal,
        steps: steps.map((s, i) => ({
          index: i,
          tool: s.tool,
          permission: getToolPermission(s.tool),
        })),
      },
      permission: 'CONFIRM',
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - started,
    }
  }

  const trace = []
  let startObs = null
  if (plan.observeStart !== false) {
    startObs = await observeDesktop({ screenshot: !!plan.screenshot })
    trace.push({ phase: 'observe.start', summary: summarizeObservation(startObs) })
  }

  const stepResults = []
  for (let i = 0; i < steps.length; i++) {
    const step = { id: `step-${i + 1}`, ...steps[i] }
    trace.push({ phase: 'act', step: step.id, tool: step.tool })
    const r = await runStepWithRetry(step, {
      approved: plan.approved || plan.dryRun,
      approvalId: plan.stepApprovals?.[i] || plan.approvalId,
      dryRun: !!plan.dryRun,
    })
    stepResults.push({ index: i, step: step.id, tool: step.tool, ...r })

    if (r.requiresApproval) {
      return {
        success: false,
        tool: 'desktop.runPlan',
        requiresApproval: true,
        approvalId: r.result?.approvalId,
        preview: r.result?.preview,
        error: { code: 'NEED_ALLOW', message: `步骤 ${step.id} 需要确认: ${step.tool}` },
        data: {
          goal: plan.goal,
          dryRun: !!plan.dryRun,
          completed: stepResults.filter((s) => s.ok).length,
          failedAt: i,
          stepResults,
          trace,
          startObservation: startObs,
        },
        permission: 'CONFIRM',
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - started,
      }
    }

    if (!r.ok) {
      const stop = plan.stopOnFailure !== false
      if (stop) {
        let endObs = null
        if (plan.observeEnd !== false) {
          endObs = await observeDesktop({ screenshot: !!plan.screenshotOnFail })
        }
        const out = {
          success: false,
          tool: 'desktop.runPlan',
          error: r.error || { code: 'PLAN_FAILED', message: `计划在 ${step.id} 失败` },
          data: {
            goal: plan.goal,
            dryRun: !!plan.dryRun,
            completed: stepResults.filter((s) => s.ok).length,
            total: steps.length,
            failedAt: i,
            stepResults,
            trace,
            startObservation: startObs,
            endObservation: endObs,
            endSummary: summarizeObservation(endObs),
          },
          permission: needsConfirm ? 'CONFIRM' : 'SAFE',
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - started,
        }
        logDesktopOperation({
          tool: 'desktop.runPlan',
          args: { goal: plan.goal, stepCount: steps.length },
          permission: out.permission,
          success: false,
          error: out.error,
          durationMs: out.durationMs,
        })
        return out
      }
    }
  }

  let endObs = null
  if (plan.observeEnd !== false) {
    endObs = await observeDesktop({ screenshot: !!plan.screenshot })
    trace.push({ phase: 'observe.end', summary: summarizeObservation(endObs) })
  }

  const out = {
    success: true,
    tool: 'desktop.runPlan',
    data: {
      goal: plan.goal || '',
      dryRun: !!plan.dryRun,
      completed: stepResults.filter((s) => s.ok).length,
      total: steps.length,
      stepResults,
      trace,
      startObservation: startObs,
      endObservation: endObs,
      endSummary: summarizeObservation(endObs),
    },
    error: null,
    permission: needsConfirm ? 'CONFIRM' : 'SAFE',
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - started,
  }
  logDesktopOperation({
    tool: 'desktop.runPlan',
    args: { goal: plan.goal, stepCount: steps.length, dryRun: !!plan.dryRun },
    permission: out.permission,
    success: true,
    durationMs: out.durationMs,
  })
  return out
}

/**
 * 从用户自然语言推断简单多步计划（有限启发式，不声称万能）
 */
export function inferPlanFromUser(userText) {
  const t = String(userText || '')
  const steps = []

  // 打开记事本然后截图
  if (/打开.{0,6}(记事本|notepad)/i.test(t) && /截图|screenshot/i.test(t)) {
    steps.push({
      tool: 'application.launch',
      args: { name: 'notepad' },
      verify: { type: 'window.titleContains', value: '记事本' },
      retries: 2,
      verifyDelayMs: 600,
      fallbacks: [],
      observeAfter: true,
    })
    // 英文环境兜底：校验放宽为 notepad 进程
    steps[0].verify = { type: 'process.running', name: 'notepad' }
    steps.push({
      tool: 'screenshot.window',
      args: { title: '记事本' },
      retries: 2,
      fallbacks: [{ tool: 'screenshot.window', args: { title: 'Notepad' } }, { tool: 'screenshot.screen', args: {} }],
      verify: { type: 'tool.success' },
    })
  }

  // 打开记事本并聚焦
  if (/打开.{0,6}(记事本|notepad)/i.test(t) && /聚焦|切换到|前置/i.test(t) && !steps.length) {
    steps.push({
      tool: 'application.launch',
      args: { name: 'notepad' },
      verify: { type: 'process.running', name: 'notepad' },
      retries: 2,
      verifyDelayMs: 500,
    })
    steps.push({
      tool: 'window.focus',
      args: { title: '记事本' },
      retries: 2,
      fallbacks: [{ tool: 'window.focus', args: { title: 'Notepad' } }],
      verify: { type: 'tool.success' },
    })
  }

  // 木木/模拟器 + 安装 APK（高层单工具，内部含等待 ADB）
  if (
    !steps.length &&
    /安装/.test(t) &&
    /\.apk/i.test(t) &&
    /(木木|mumu|模拟器|android|安卓)/i.test(t)
  ) {
    const apk =
      t.match(/((?:桌面|Desktop)[\\/][^\s"'`]+\.apk)/i)?.[1] ||
      t.match(/([A-Za-z]:\\[^\s"'`]+\.apk)/i)?.[1] ||
      t.match(/([^\s"'`]+\.apk)/i)?.[1]
    if (apk) {
      return {
        goal: t.slice(0, 200),
        steps: [
          {
            tool: 'android.installApk',
            args: {
              apk,
              emulator: /木木|mumu/i.test(t) ? '木木模拟器' : '木木模拟器',
              openEmulator: true,
              waitTimeoutMs: 90000,
            },
            retries: 1,
            verify: { type: 'tool.success' },
          },
        ],
        observeStart: true,
        observeEnd: true,
        stopOnFailure: true,
      }
    }
  }

  // 备份 NC → workspace/cnc-backup
  if (!steps.length && /备份/.test(t) && /\.(nc|cnc|mpf|gcode)/i.test(t)) {
    const nc =
      t.match(/((?:桌面|Desktop|文档|下载|workspace)[\\/][^\s"'`]+\.(?:nc|cnc|mpf|gcode))/i)?.[1] ||
      t.match(/([A-Za-z]:\\[^\s"'`]+\.(?:nc|cnc|mpf|gcode))/i)?.[1] ||
      t.match(/([^\s"'`]+\.(?:nc|cnc|mpf|gcode))/i)?.[1]
    if (nc) {
      return {
        goal: t.slice(0, 200),
        steps: [
          {
            tool: 'cnc.backupNc',
            args: { source: nc },
            verify: { type: 'tool.success' },
            retries: 1,
          },
        ],
        observeStart: false,
        observeEnd: false,
        stopOnFailure: true,
      }
    }
  }

  // 打开梯子软件 + 可选打开指定 LAD
  if (
    !steps.length &&
    /打开/.test(t) &&
    /(梯子|梯形|ladder|fladder|ladder-?iii)/i.test(t)
  ) {
    const lad =
      t.match(/((?:桌面|Desktop|文档|下载|workspace)[\\/][^\s"'`]+\.lad)/i)?.[1] ||
      t.match(/([A-Za-z]:\\[^\s"'`]+\.lad)/i)?.[1] ||
      t.match(/([^\s"'`]+\.lad)/i)?.[1]
    if (lad) {
      return {
        goal: t.slice(0, 200),
        steps: [
          {
            tool: 'cnc.openLad',
            args: { lad },
            verify: { type: 'tool.success' },
            retries: 1,
          },
        ],
        observeStart: true,
        observeEnd: true,
        stopOnFailure: true,
      }
    }
    return {
      goal: t.slice(0, 200),
      steps: [
        {
          tool: 'cnc.openApp',
          args: { name: 'ladder3' },
          verify: { type: 'tool.success' },
          retries: 1,
          fallbacks: [],
        },
      ],
      observeStart: true,
      observeEnd: true,
      stopOnFailure: true,
    }
  }

  if (!steps.length) return null
  return {
    goal: t.slice(0, 200),
    steps,
    observeStart: true,
    observeEnd: true,
    stopOnFailure: true,
  }
}
