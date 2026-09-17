import { describe, expect, it } from "vitest";
import {
  InteractionRuntime,
  VelocityTracker,
  clampDeadzone,
  velocityBetween,
  quatFromAxisAngle,
  type InputSourceSnapshot,
  type PoseTuple,
} from "@realitycollective/webxr-interactions";
import { FakeProvider, handSource, raySource } from "./helpers.js";

const IDENTITY: PoseTuple = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };

function pose(x: number, y = 0, z = 0, quaternion = IDENTITY.quaternion): PoseTuple {
  return { position: [x, y, z], quaternion };
}

function moving(id: string, x: number): InputSourceSnapshot {
  return handSource(id, { gripPose: pose(x, 1, -0.5) });
}

describe("velocityBetween, re-exported from the input contracts", () => {
  it("differentiates position over dt", () => {
    const { linear } = velocityBetween(pose(0), pose(0.5), 0.5);
    expect(linear).toEqual([1, 0, 0]);
  });

  it("reports the rotation rate about the turn axis", () => {
    const half = Math.PI / 2;
    const { angular } = velocityBetween(
      { position: [0, 0, 0], quaternion: quatFromAxisAngle([0, 1, 0], 0) },
      { position: [0, 0, 0], quaternion: quatFromAxisAngle([0, 1, 0], half) },
      0.5,
    );
    expect(angular[0]).toBeCloseTo(0);
    expect(angular[1]).toBeCloseTo(half / 0.5);
    expect(angular[2]).toBeCloseTo(0);
  });

  it("takes the shortest arc past half a turn", () => {
    const turn = Math.PI * 1.5;
    const { angular } = velocityBetween(
      { position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      { position: [0, 0, 0], quaternion: quatFromAxisAngle([0, 1, 0], turn) },
      1,
    );
    // 270 degrees one way is 90 the other, about the flipped axis.
    expect(Math.abs(angular[1])).toBeCloseTo(Math.PI / 2);
    expect(angular[1]).toBeLessThan(0);
  });

  it("reports zero angular velocity when the pose did not rotate", () => {
    const { angular } = velocityBetween(pose(0), pose(1), 1);
    expect(angular).toEqual([0, 0, 0]);
  });

  it("returns zeros for a non-positive or non-finite dt", () => {
    expect(velocityBetween(pose(0), pose(1), 0)).toEqual({ linear: [0, 0, 0], angular: [0, 0, 0] });
    expect(velocityBetween(pose(0), pose(1), -1)).toEqual({ linear: [0, 0, 0], angular: [0, 0, 0] });
    expect(velocityBetween(pose(0), pose(1), Number.NaN)).toEqual({
      linear: [0, 0, 0],
      angular: [0, 0, 0],
    });
  });
});

describe("clampDeadzone", () => {
  it("zeroes below the threshold and passes the rest through", () => {
    expect(clampDeadzone(0.05, 0.1)).toBe(0);
    expect(clampDeadzone(-0.05, 0.1)).toBe(0);
    expect(clampDeadzone(0.5, 0.1)).toBe(0.5);
    expect(clampDeadzone(-0.5, 0.1)).toBe(-0.5);
    expect(clampDeadzone(0.1, 0.1)).toBe(0.1);
  });
});

describe("VelocityTracker", () => {
  it("reports nothing on a source's first frame", () => {
    const tracker = new VelocityTracker();
    const [first] = tracker.update([moving("right-hand", 0)], 1 / 60);
    expect(first?.linearVelocity).toBeUndefined();
    expect(first?.angularVelocity).toBeUndefined();
  });

  it("measures velocity from the second frame on", () => {
    const tracker = new VelocityTracker();
    tracker.update([moving("right-hand", 0)], 0.5);
    const [second] = tracker.update([moving("right-hand", 1)], 0.5);
    expect(second?.linearVelocity).toEqual([2, 0, 0]);
    expect(second?.angularVelocity).toEqual([0, 0, 0]);
  });

  it("stores the pose but writes nothing when dt is zero", () => {
    const tracker = new VelocityTracker();
    tracker.update([moving("right-hand", 0)], 1 / 60);
    const [stalled] = tracker.update([moving("right-hand", 1)], 0);
    expect(stalled?.linearVelocity).toBeUndefined();
    // The stalled frame's pose is the new baseline, so the next frame
    // measures from 1, not from 0.
    const [next] = tracker.update([moving("right-hand", 2)], 1);
    expect(next?.linearVelocity).toEqual([1, 0, 0]);
  });

  it("starts fresh when a source vanishes and comes back", () => {
    const tracker = new VelocityTracker();
    tracker.update([moving("right-hand", 0)], 1);
    expect(tracker.update([moving("right-hand", 1)], 1)[0]?.linearVelocity).toEqual([1, 0, 0]);
    tracker.update([], 1);
    const [returned] = tracker.update([moving("right-hand", 9)], 1);
    expect(returned?.linearVelocity).toBeUndefined();
  });

  it("forgets everything on reset", () => {
    const tracker = new VelocityTracker();
    tracker.update([moving("right-hand", 0)], 1);
    tracker.reset();
    const [after] = tracker.update([moving("right-hand", 1)], 1);
    expect(after?.linearVelocity).toBeUndefined();
  });

  it("converges on the raw velocity when smoothing is on", () => {
    const tracker = new VelocityTracker({ smoothing: 0.5 });
    // Two still frames, then a steady 1 m/s. The average starts at the
    // measured 0 and closes half the remaining gap each frame.
    tracker.update([moving("right-hand", 0)], 1);
    expect(tracker.update([moving("right-hand", 0)], 1)[0]?.linearVelocity).toEqual([0, 0, 0]);

    const speeds: number[] = [];
    for (let frame = 1; frame <= 6; frame++) {
      const [source] = tracker.update([moving("right-hand", frame)], 1);
      speeds.push(source?.linearVelocity?.[0] ?? Number.NaN);
    }
    expect(speeds[0]).toBeCloseTo(0.5);
    expect(speeds[1]).toBeCloseTo(0.75);
    for (let i = 1; i < speeds.length; i++) {
      expect(speeds[i] as number).toBeGreaterThan(speeds[i - 1] as number);
      expect(speeds[i] as number).toBeLessThan(1);
    }
    expect(speeds[speeds.length - 1]).toBeCloseTo(1, 1);
  });

  it("treats an out-of-range smoothing factor as no smoothing", () => {
    const tracker = new VelocityTracker({ smoothing: 0 });
    tracker.update([moving("right-hand", 0)], 1);
    expect(tracker.update([moving("right-hand", 1)], 1)[0]?.linearVelocity).toEqual([1, 0, 0]);
  });

  it("leaves provider-supplied velocity alone", () => {
    const tracker = new VelocityTracker();
    const supplied = (x: number): InputSourceSnapshot => ({
      ...moving("right-hand", x),
      linearVelocity: [9, 9, 9],
    });
    tracker.update([supplied(0)], 1);
    const [second] = tracker.update([supplied(1)], 1);
    expect(second?.linearVelocity).toEqual([9, 9, 9]);
    // The half the provider did not supply is still filled in.
    expect(second?.angularVelocity).toEqual([0, 0, 0]);
  });

  it("fills in only the half the provider left out", () => {
    const tracker = new VelocityTracker();
    const supplied = (x: number): InputSourceSnapshot => ({
      ...moving("right-hand", x),
      angularVelocity: [0, 5, 0],
    });
    tracker.update([supplied(0)], 1);
    const [second] = tracker.update([supplied(1)], 1);
    expect(second?.angularVelocity).toEqual([0, 5, 0]);
    expect(second?.linearVelocity).toEqual([1, 0, 0]);
  });

  it("returns the source untouched when the provider supplied both", () => {
    const tracker = new VelocityTracker();
    const supplied: InputSourceSnapshot = {
      ...moving("right-hand", 0),
      linearVelocity: [1, 0, 0],
      angularVelocity: [0, 1, 0],
    };
    tracker.update([supplied], 1);
    expect(tracker.update([supplied], 1)[0]).toBe(supplied);
  });

  it("passes sources without a grip pose through untouched", () => {
    const tracker = new VelocityTracker();
    const bare = raySource("right-controller");
    tracker.update([bare], 1);
    const [second] = tracker.update([bare], 1);
    expect(second).toBe(bare);
    expect(second?.linearVelocity).toBeUndefined();
  });
});

describe("runtime velocity", () => {
  function runtimeWith(velocity?: false) {
    const provider = new FakeProvider();
    const runtime = new InteractionRuntime({
      provider,
      ...(velocity === false ? { velocity: false as const } : {}),
    });
    return { provider, runtime };
  }

  it("publishes measured velocity through onSample", () => {
    const { provider, runtime } = runtimeWith();
    const frames: InputSourceSnapshot[][] = [];
    runtime.onSample((sources) => frames.push([...sources]));

    provider.sources = [moving("right-hand", 0)];
    runtime.update(1);
    provider.sources = [moving("right-hand", 2)];
    runtime.update(1);

    expect(frames).toHaveLength(2);
    expect(frames[0]?.[0]?.linearVelocity).toBeUndefined();
    expect(frames[1]?.[0]?.linearVelocity).toEqual([2, 0, 0]);
  });

  it("delivers the same stream through the deprecated onSourcesSampled", () => {
    // Kept working for existing callers until a later major release. Nothing
    // inside this package calls it any more, so it is covered directly here
    // rather than incidentally through another feature's tests.
    const { provider, runtime } = runtimeWith();
    const viaDeprecated: InputSourceSnapshot[][] = [];
    const viaCurrent: InputSourceSnapshot[][] = [];
    const stop = runtime.onSourcesSampled((sources) => viaDeprecated.push([...sources]));
    runtime.onSample((sources) => viaCurrent.push([...sources]));

    provider.sources = [moving("right-hand", 0)];
    runtime.update(1);
    provider.sources = [moving("right-hand", 2)];
    runtime.update(1);

    expect(viaDeprecated).toEqual(viaCurrent);
    expect(viaDeprecated[1]?.[0]?.linearVelocity).toEqual([2, 0, 0]);

    stop();
    runtime.update(1);
    expect(viaDeprecated).toHaveLength(2);
    expect(viaCurrent).toHaveLength(3);
  });

  it("stops publishing after unsubscribe", () => {
    const { provider, runtime } = runtimeWith();
    let calls = 0;
    const unsubscribe = runtime.onSample(() => calls++);
    provider.sources = [moving("right-hand", 0)];
    runtime.update(1);
    unsubscribe();
    runtime.update(1);
    expect(calls).toBe(1);
  });

  it("getSource returns the last sample and forgets sources that stop reporting", () => {
    const { provider, runtime } = runtimeWith();
    expect(runtime.getSource("right-hand")).toBeUndefined();

    provider.sources = [moving("right-hand", 0)];
    runtime.update(1);
    provider.sources = [moving("right-hand", 3)];
    runtime.update(1);
    expect(runtime.getSource("right-hand")?.linearVelocity).toEqual([3, 0, 0]);

    provider.sources = [];
    runtime.update(1);
    expect(runtime.getSource("right-hand")).toBeUndefined();
  });

  it("skips tracking entirely when velocity is false", () => {
    const { provider, runtime } = runtimeWith(false);
    provider.sources = [moving("right-hand", 0)];
    runtime.update(1);
    provider.sources = [moving("right-hand", 2)];
    runtime.update(1);
    expect(runtime.getSource("right-hand")?.linearVelocity).toBeUndefined();
  });

  it("clears the last sample on dispose", () => {
    const { provider, runtime } = runtimeWith();
    provider.sources = [moving("right-hand", 0)];
    runtime.update(1);
    runtime.dispose();
    expect(runtime.getSource("right-hand")).toBeUndefined();
  });
});
