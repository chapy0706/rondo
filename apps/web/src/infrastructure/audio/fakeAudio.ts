/**
 * テスト用の偽の AudioContext（issue-63）。呼び出しを記録するだけで、音は出さない。
 */

import type {
	AudioBufferLike,
	AudioContextLike,
	AudioNodeLike,
	AudioParamLike,
	BufferSourceLike,
	GainNodeLike,
} from "./engine";

export class FakeParam implements AudioParamLike {
	value: number;
	readonly calls: string[] = [];
	constructor(value: number) {
		this.value = value;
	}
	setValueAtTime(value: number, time: number): void {
		this.calls.push(`set ${value} @${time}`);
		this.value = value;
	}
	linearRampToValueAtTime(value: number, time: number): void {
		this.calls.push(`ramp ${value} @${time}`);
		this.value = value;
	}
	cancelScheduledValues(time: number): void {
		this.calls.push(`cancel @${time}`);
	}
}

export class FakeNode implements AudioNodeLike {
	readonly connections: AudioNodeLike[] = [];
	disconnected = false;
	connect(node: AudioNodeLike): void {
		this.connections.push(node);
	}
	disconnect(): void {
		this.disconnected = true;
	}
}

export class FakeGain extends FakeNode implements GainNodeLike {
	readonly gain = new FakeParam(1);
}

export class FakeSource extends FakeNode implements BufferSourceLike {
	buffer: AudioBufferLike | null = null;
	loop = false;
	loopStart = 0;
	loopEnd = 0;
	readonly playbackRate = new FakeParam(1);
	onended: ((event: Event) => unknown) | null = null;
	started: {
		when: number;
		offset: number;
		duration?: number | undefined;
	} | null = null;
	stoppedAt: number | null = null;
	start(when = 0, offset = 0, duration?: number): void {
		this.started = { when, offset, duration };
	}
	stop(when = 0): void {
		this.stoppedAt = when;
	}
	/** 鳴り終わったことにする。 */
	end(): void {
		this.onended?.(new Event("ended"));
	}
}

export class FakeContext implements AudioContextLike {
	currentTime = 0;
	state = "suspended";
	readonly destination = new FakeNode();
	readonly gains: FakeGain[] = [];
	readonly sources: FakeSource[] = [];
	readonly decoded: number[] = [];
	resumes = 0;
	suspends = 0;
	closed = false;
	/** 展開を失敗させるか。 */
	failDecode = false;
	createGain(): FakeGain {
		const gain = new FakeGain();
		this.gains.push(gain);
		return gain;
	}
	createBufferSource(): FakeSource {
		const source = new FakeSource();
		this.sources.push(source);
		return source;
	}
	createBuffer(): AudioBufferLike {
		return { duration: 0 };
	}
	decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike> {
		if (this.failDecode) return Promise.reject(new Error("壊れている"));
		this.decoded.push(data.byteLength);
		// 1 バイトを 1 秒として扱う（長さを確かめやすくするため）。
		return Promise.resolve({ duration: data.byteLength });
	}
	resume(): Promise<void> {
		this.resumes += 1;
		this.state = "running";
		return Promise.resolve();
	}
	suspend(): Promise<void> {
		this.suspends += 1;
		this.state = "suspended";
		return Promise.resolve();
	}
	close(): Promise<void> {
		this.closed = true;
		this.state = "closed";
		return Promise.resolve();
	}
}
