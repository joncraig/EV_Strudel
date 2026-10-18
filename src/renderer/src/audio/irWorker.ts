// Builds reverb impulse responses off the main thread: decaying stereo noise with an
// optional fade-in. Same curve as Strudel's generateReverb (decays to -60dB over
// decayTime, buffer 1.5x as long), but with a running multiply instead of
// Math.pow per sample.

interface Request {
  id: number
  sampleRate: number
  decayTime: number
  fadeInTime: number
  channels: number
}

self.onmessage = (e: MessageEvent<Request>) => {
  const { id, sampleRate, decayTime, fadeInTime, channels } = e.data
  const decaySamples = Math.round(decayTime * sampleRate)
  const length = Math.max(1, Math.round(decayTime * 1.5 * sampleRate))
  const fade = Math.round(fadeInTime * sampleRate)
  const step = Math.pow(1 / 1000, 1 / Math.max(1, decaySamples))
  const data: Float32Array[] = []
  for (let c = 0; c < channels; c++) {
    const out = new Float32Array(length)
    let g = 1
    for (let i = 0; i < length; i++) {
      out[i] = (Math.random() * 2 - 1) * g
      g *= step
    }
    for (let i = 0; i < fade && i < length; i++) out[i] *= i / fade
    data.push(out)
  }
  ;(self as unknown as Worker).postMessage({ id, data }, data.map((d) => d.buffer))
}
