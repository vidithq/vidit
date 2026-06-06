import { Composition } from "remotion";
import { Demo, DEMO_DURATION } from "./Demo";

export const RemotionRoot = () => {
  return (
    <Composition
      id="Demo"
      component={Demo}
      durationInFrames={DEMO_DURATION}
      fps={60}
      width={1920}
      height={1080}
    />
  );
};
