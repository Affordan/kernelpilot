import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import * as KernelPilotPlugin from '../src/harness/plugin.js'

describe('DeepSeek Harness rc.7 compatibility', () => {
  it('loads as a Cordis plugin and registers five tools plus nine skills', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(KernelPilotPlugin, { workspaceRoot: process.cwd(), stateRoot: '.kernelpilot/tests' })
    expect(ctx.tools.schemas().map(tool => tool.name).sort()).toEqual([
      'apply_source_patch', 'compile_cuda', 'profile_kernel', 'run_benchmark', 'validate_kernel',
    ])
    expect((await ctx.skills.list()).map(skill => skill.name)).toHaveLength(9)
  })
})
