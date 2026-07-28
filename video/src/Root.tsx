import { Composition } from "remotion";
import { Demo, DEMO_DURATION } from "./Demo";
import { PromoV04, PROMO_V04_DURATION } from "./PromoV04";
import { FeatureImport, FEATURE_IMPORT_DURATION } from "./FeatureImport";

export const RemotionRoot = () => {
  return (
    <>
      {/* The 0.3 promo (kept renderable for reference). */}
      <Composition
        id="Demo"
        component={Demo}
        durationInFrames={DEMO_DURATION}
        fps={60}
        width={1920}
        height={1080}
      />
      {/* The v0.4 promo (see record-v04.js + PromoV04.tsx). */}
      <Composition
        id="PromoV04"
        component={PromoV04}
        durationInFrames={PROMO_V04_DURATION}
        fps={60}
        width={1920}
        height={1080}
      />
      {/* Groundwork for the follow-up archive-import feature video; renders
          once public/clips/x-export-capture.mp4 exists (see FeatureImport.tsx). */}
      <Composition
        id="FeatureImport"
        component={FeatureImport}
        durationInFrames={FEATURE_IMPORT_DURATION}
        fps={60}
        width={1920}
        height={1080}
      />
    </>
  );
};
