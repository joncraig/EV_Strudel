// Strudel builds a reverb impulse response on the main thread whenever a reverb's
// settings change: seconds of noise with Math.random() and Math.pow() per sample. That
// blocked the main thread for 100-260ms and made the scheduler skip notes ("too
// late"). This replaces BaseAudioContext.prototype.createReverb (Strudel's own
// extension) with a version that:
//   - builds the noise in a Web Worker (off the main thread),
//   - shapes it with the same low-pass sweep in an OfflineAudioContext (async),
//   - caches the result per setting, so the same reverb is never built twice.
// Sample-based IRs (the `ir` option) still use Strudel's own path.

import IrWorker from './irWorker?worker'

type Convolver = ConvolverNode & {
  duration?: number
  fade?: number
  lp?: number
  dim?: number
  ir?: AudioBuffer
  irspeed?: number
  irbegin?: number
  generate?: (...args: unknown[]) => void
}

type ReverbProto = BaseAudioContext & {
  createReverb?: (...args: unknown[]) => Convolver
  adjustLength?: (duration: number, ir: AudioBuffer, speed?: number, begin?: number) => AudioBuffer
  __evFastReverb?: boolean
}

let worker: Worker | null = null
let nextId = 0
const waiting = new Map<number, (data: Float32Array[]) => void>()

function noise(sampleRate: number, decayTime: number, fadeInTime: number): Promise<Float32Array[]> {
  if (!worker) {
    worker = new IrWorker()
    worker.onmessage = (e: MessageEvent<{ id: number; data: Float32Array[] }>) => {
      waiting.get(e.data.id)?.(e.data.data)
      waiting.delete(e.data.id)
    }
  }
  const id = nextId++
  return new Promise((resolve) => {
    waiting.set(id, resolve)
    worker!.postMessage({ id, sampleRate, decayTime, fadeInTime, channels: 2 })
  })
}

const cache = new WeakMap<BaseAudioContext, Map<string, Promise<AudioBuffer>>>()

function impulse(ctx: BaseAudioContext, decay: number, fade: number, lp: number, dim: number): Promise<AudioBuffer> {
  let byKey = cache.get(ctx)
  if (!byKey) cache.set(ctx, (byKey = new Map()))
  const key = `${decay}|${fade}|${lp}|${dim}`
  let p = byKey.get(key)
  if (!p) {
    p = (async () => {
      const data = await noise(ctx.sampleRate, decay, fade)
      const raw = new AudioBuffer({ numberOfChannels: data.length, length: data[0].length, sampleRate: ctx.sampleRate })
      data.forEach((d, c) => raw.copyToChannel(d as Float32Array<ArrayBuffer>, c))
      if (!lp) return raw
      // Low-pass sweep from lp down to dim over the decay, as Strudel does.
      const off = new OfflineAudioContext(raw.numberOfChannels, raw.length, raw.sampleRate)
      const src = off.createBufferSource()
      src.buffer = raw
      const filter = off.createBiquadFilter()
      const nyquist = raw.sampleRate / 2
      filter.type = 'lowpass'
      filter.Q.value = 0.0001
      filter.frequency.setValueAtTime(Math.min(lp, nyquist), 0)
      filter.frequency.linearRampToValueAtTime(Math.min(dim || lp, nyquist), decay)
      src.connect(filter).connect(off.destination)
      src.start()
      return off.startRendering()
    })()
    byKey.set(key, p)
    p.catch(() => byKey!.delete(key))
  }
  return p
}

export function installFastReverb(): void {
  const proto = BaseAudioContext.prototype as ReverbProto
  const original = proto.createReverb
  if (!original || proto.__evFastReverb) return
  proto.__evFastReverb = true
  proto.createReverb = function (this: ReverbProto, ...args: unknown[]): Convolver {
    const conv = this.createConvolver() as Convolver
    conv.generate = (duration = 2, fade = 0.1, lp = 15000, dim = 1000, ir?, irspeed?, irbegin?) => {
      Object.assign(conv, { duration, fade, lp, dim, ir, irspeed, irbegin })
      if (ir) {
        conv.buffer = this.adjustLength!(duration as number, ir as AudioBuffer, irspeed as number, irbegin as number)
        return
      }
      const want = `${duration}|${fade}|${lp}|${dim}`
      impulse(this, duration as number, fade as number, lp as number, dim as number).then((buffer) => {
        // Settings may have moved on while it was being built.
        if (`${conv.duration}|${conv.fade}|${conv.lp}|${conv.dim}` === want && !conv.ir) conv.buffer = buffer
      })
    }
    conv.generate(...args)
    return conv
  }
}
