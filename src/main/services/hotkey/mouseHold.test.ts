import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { MouseHoldTrigger } from './mouseHold.ts'

function setup(t: TestContext, delay = 1000) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 })
  const events: string[] = []
  const trigger = new MouseHoldTrigger(delay, 300, {
    onStart: () => events.push('start'), onStop: () => events.push('stop')
  })
  return { trigger, events, tick: (ms: number) => t.mock.timers.tick(ms) }
}

for (const delay of [100, 1000, 3500]) {
  for (const first of [1, 2]) {
    test(`鼠标顺序 ${first} 优先，持续按住 ${delay} 毫秒后开始，任意键松开只结束一次`, t => {
      const { trigger, events, tick } = setup(t, delay)
      trigger.down(first, 50, 50)
      tick(100)
      trigger.down(3 - first, 50, 50)
      tick(delay - 1)
      assert.deepEqual(events, [])
      tick(1)
      assert.deepEqual(events, ['start'])
      trigger.move(500, 500) // 开始录音后移动不截断录音。
      trigger.up(first)
      trigger.up(3 - first)
      assert.deepEqual(events, ['start', 'stop'])
    })
  }
}

test('提前松开不录音，必须两键都松开才能重新触发', t => {
  const { trigger, events, tick } = setup(t)
  trigger.down(1, 0, 0); trigger.down(2, 0, 0)
  tick(999); trigger.up(2); trigger.down(2, 0, 0); tick(2000)
  assert.deepEqual(events, [])
  trigger.up(1); trigger.up(2)
  trigger.down(1, 0, 0); trigger.down(2, 0, 0); tick(1000)
  assert.deepEqual(events, ['start'])
})

test('等待期间拖动或滚轮取消触发，轻微抖动允许', t => {
  const { trigger, events, tick } = setup(t)
  trigger.down(1, 0, 0); trigger.down(2, 0, 0)
  trigger.move(7, 0); trigger.move(0, 0); tick(1000)
  assert.deepEqual(events, [])
  trigger.up(1); trigger.up(2)
  trigger.down(1, 0, 0); trigger.down(2, 0, 0)
  trigger.cancelWaiting(); tick(1000)
  assert.deepEqual(events, [])
  trigger.up(1); trigger.up(2)
  trigger.down(1, 0, 0); trigger.down(2, 0, 0)
  trigger.move(3, 4); tick(1000)
  assert.deepEqual(events, ['start'])
})

test('单键、侧键、先长按再补第二键都不触发', t => {
  const { trigger, events, tick } = setup(t)
  trigger.down(4, 0, 0); trigger.down(5, 0, 0); tick(2000)
  trigger.down(1, 0, 0); tick(251); trigger.down(2, 0, 0); tick(2000)
  assert.deepEqual(events, [])
})

test('重复按下事件不延长等待，不重复开始', t => {
  const { trigger, events, tick } = setup(t)
  trigger.down(1, 0, 0); trigger.down(2, 0, 0)
  tick(500); trigger.down(1, 0, 0); trigger.down(2, 0, 0)
  tick(500)
  assert.deepEqual(events, ['start'])
  trigger.down(1, 0, 0); tick(2000)
  assert.deepEqual(events, ['start'])
})

test('结束后重复触发间隔生效', t => {
  const { trigger, events, tick } = setup(t)
  trigger.down(1, 0, 0); trigger.down(2, 0, 0); tick(1000)
  trigger.up(1); trigger.up(2)
  tick(299); trigger.down(1, 0, 0); trigger.down(2, 0, 0); tick(1000)
  assert.deepEqual(events, ['start', 'stop'])
  trigger.up(1); trigger.up(2)
  trigger.down(1, 0, 0); trigger.down(2, 0, 0); tick(1000)
  assert.deepEqual(events, ['start', 'stop', 'start'])
})

test('切换配置或退出时清理等待计时器，已开始的录音正常结束', t => {
  const { trigger, events, tick } = setup(t)
  const active = new MouseHoldTrigger(100, 0, {
    onStart: () => events.push('start'), onStop: () => events.push('stop')
  })
  trigger.down(1, 0, 0); trigger.down(2, 0, 0); tick(999)
  trigger.dispose(); tick(1000)
  assert.deepEqual(events, [])
  active.down(1, 0, 0); active.down(2, 0, 0); tick(100)
  active.dispose(); active.dispose(); tick(1000)
  assert.deepEqual(events, ['start', 'stop'])
})
