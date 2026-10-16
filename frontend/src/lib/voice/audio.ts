/** Browser audio plumbing for the voice assistant (works on Chrome and Safari 14.1+). */

const WORKLET = `
class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;   // downsample whatever the device gives us to 16 kHz
    this.acc = 0; this.sum = 0; this.cnt = 0;
    this.out = new Int16Array(800);    // 50 ms chunks
    this.n = 0; this.energy = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.sum += ch[i]; this.cnt++; this.acc += 1;
      if (this.acc >= this.ratio) {
        this.acc -= this.ratio;
        let v = this.sum / this.cnt; this.sum = 0; this.cnt = 0;
        v = Math.max(-1, Math.min(1, v));
        this.energy += v * v;
        this.out[this.n++] = v < 0 ? v * 32768 : v * 32767;
        if (this.n === 800) {
          const rms = Math.sqrt(this.energy / 800);
          const buf = this.out.buffer.slice(0);
          this.port.postMessage({ pcm: buf, rms }, [buf]);
          this.n = 0; this.energy = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("mic-processor", MicProcessor);
`;

export function voiceSupported(): boolean {
  if (typeof window === "undefined") return false;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return typeof navigator.mediaDevices?.getUserMedia === "function" && !!AC
    && typeof AudioWorkletNode !== "undefined" && "WebSocket" in window;
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export type MicError = "denied" | "no_device" | "unsupported" | "failed";
export class MicFailure extends Error { constructor(public kind: MicError) { super(kind); } }

/** One AudioContext for both mic and speaker (Safari is happiest that way). Create it inside a click handler. */
export class AudioIO {
  readonly ctx: AudioContext;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private outGain: GainNode;
  private analyser: AnalyserNode;
  private sources = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private micLevel = 0;
  private outBuf = new Uint8Array(256);
  onMic: ((pcm: ArrayBuffer, rms: number) => void) | null = null;
  onPlaybackEnd: (() => void) | null = null;

  constructor() {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    void this.ctx.resume(); // must happen in the user gesture on iOS
    this.outGain = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.outGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  async startMic(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new MicFailure("unsupported");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (e) {
      const name = (e as DOMException)?.name;
      if (name === "NotAllowedError" || name === "SecurityError") throw new MicFailure("denied");
      if (name === "NotFoundError" || name === "OverconstrainedError") throw new MicFailure("no_device");
      throw new MicFailure("failed");
    }
    try {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
      await this.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      this.src = this.ctx.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.ctx, "mic-processor");
      this.node.port.onmessage = (ev: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
        this.micLevel = Math.min(1, ev.data.rms * 6);
        this.onMic?.(ev.data.pcm, ev.data.rms);
      };
      this.src.connect(this.node); // not connected to destination: we never play the mic back
    } catch {
      this.stopMic();
      throw new MicFailure("unsupported");
    }
  }

  /** Mic permission can be revoked or the device unplugged mid-call. */
  onMicLost(cb: () => void) {
    this.stream?.getAudioTracks().forEach((t) => { t.onended = cb; });
  }

  stopMic() {
    this.node?.port.close();
    this.node?.disconnect();
    this.src?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.node = null; this.src = null; this.stream = null; this.micLevel = 0;
  }

  /** Queue 24 kHz mono PCM16 for gapless playback. */
  play(pcm16: Uint8Array) {
    const samples = Math.floor(pcm16.byteLength / 2);
    if (!samples) return;
    const view = new DataView(pcm16.buffer, pcm16.byteOffset, samples * 2);
    const buf = this.ctx.createBuffer(1, samples, 24000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < samples; i++) ch[i] = view.getInt16(i * 2, true) / 32768;
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.connect(this.outGain);
    const start = Math.max(this.ctx.currentTime + 0.03, this.nextTime);
    s.start(start);
    this.nextTime = start + buf.duration;
    this.sources.add(s);
    s.onended = () => {
      this.sources.delete(s);
      if (this.sources.size === 0) this.onPlaybackEnd?.();
    };
  }

  /** Barge-in: silence the assistant immediately. */
  stopPlayback() {
    for (const s of this.sources) { s.onended = null; try { s.stop(); } catch { /* already stopped */ } }
    this.sources.clear();
    this.nextTime = 0;
  }

  get playing(): boolean { return this.sources.size > 0 && this.nextTime > this.ctx.currentTime; }

  levels(): { mic: number; out: number } {
    this.analyser.getByteTimeDomainData(this.outBuf);
    let sum = 0;
    for (let i = 0; i < this.outBuf.length; i++) { const v = (this.outBuf[i] - 128) / 128; sum += v * v; }
    return { mic: this.micLevel, out: Math.min(1, Math.sqrt(sum / this.outBuf.length) * 5) };
  }

  async close() {
    this.stopPlayback();
    this.stopMic();
    try { await this.ctx.close(); } catch { /* already closed */ }
  }
}
