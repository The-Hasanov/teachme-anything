import type { Register } from 'claude-code'

import { isDoctor, lessonBandText, lessonGuard, lessonRegister, lessonSection, lessonStarted, lessonTutor, registerLesson } from './lesson'

export const register: Register = (on, options) => {
  registerLesson(on, options)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'tutor', description: 'Show the Teach Me lesson pane' })
    await lessonRegister($).catch(() => undefined)
    const started = await next(e)
    await lessonStarted($, e.cwd).catch(() => undefined)
    return started
  })

  on('command.run', { command: 'tutor' }, async $ => (await lessonTutor($)) ?? { text: 'No course here yet. Say "teach me <subject>" to start one.' })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as { file_path?: string; notebook_path?: string; command?: string }
    const denied = lessonGuard(e.tool, input) && lessonGuard(e.tool, input, await isDoctor($, e.agentId))
    return denied ? { deny: denied } : next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const section = lessonSection()
    return section ? { sections: [...composed.sections, section] } : composed
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const text = e.props.hasSurvey ? undefined : await lessonBandText($)
    if (!text) return next(e)
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{text}</Text>
  })
}
