import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  OffthreadVideo,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { BrowserChrome } from "./BrowserChrome";
import type { DropInClip } from "../clips-manifest";

// The bot beat, two modes:
//
// 1. DROP-IN (final): public/clips/bot-x-capture.mp4, the maintainer's real
//    recording of the real exchange on X. Plays verbatim.
//
// 2. MOCK TWEET (current): a composed X-dark post card. The analyst's
//    geolocation tweet carries the strict bot format INLINE (T: title,
//    C: coordinates, S: source, @viditbot tag in the tweet itself), with
//    the real media still (public/clips/bot-tweet-media.jpg, extracted
//    from the demo take's promoted event). The beat then plays the
//    product behavior: once the import lands, the bot's in-thread reply
//    appears with the real compose_reply copy (linkless by contract).
//    No like: the ack gesture was cut from the product (the reply lands
//    seconds later anyway and the like was the costliest API call).

const X_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const X_BORDER = "#2f3336";
const X_TEXT = "#e7e9ea";
const X_DIM = "#71767b";
const X_BLUE = "#1d9bf0";
const X_PINK = "#f91880";
const ORANGE = "#f97316";

// lucide "bot" glyph (ISC license), inlined: the bot's avatar mark.
function BotGlyph({ size = 22, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  );
}

// X-style action-bar icons in the real bar's order: reply, repost, like,
// views, bookmark, share.
const Icon: React.FC<{ d: React.ReactNode; color?: string; fill?: string }> = ({
  d,
  color = X_DIM,
  fill = "none",
}) => (
  <svg
    width="17"
    height="17"
    viewBox="0 0 24 24"
    fill={fill}
    stroke={color}
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {d}
  </svg>
);

const ReplyIcon = () => <Icon d={<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />} />;
const RepostIcon = () => (
  <Icon
    d={
      <>
        <path d="m2 9 3-3 3 3" />
        <path d="M13 18H7a2 2 0 0 1-2-2V6" />
        <path d="m22 15-3 3-3-3" />
        <path d="M11 6h6a2 2 0 0 1 2 2v10" />
      </>
    }
  />
);
const HeartIcon = ({ filled }: { filled: boolean }) => (
  <Icon
    color={filled ? X_PINK : X_DIM}
    fill={filled ? X_PINK : "none"}
    d={
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    }
  />
);
const ViewsIcon = () => (
  <Icon
    d={
      <>
        <line x1="18" x2="18" y1="20" y2="10" />
        <line x1="12" x2="12" y1="20" y2="4" />
        <line x1="6" x2="6" y1="20" y2="14" />
      </>
    }
  />
);
const BookmarkIcon = () => (
  <Icon d={<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />} />
);
const ShareIcon = () => (
  <Icon
    d={
      <>
        <path d="M12 2v13" />
        <path d="m16 6-4-4-4 4" />
        <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
      </>
    }
  />
);

const ActionBar: React.FC<{
  liked?: boolean;
  likeScale?: number;
  likeCount?: string;
  replyCount?: string;
}> = ({ liked = false, likeScale = 1, likeCount = "", replyCount = "" }) => (
  <div
    style={{
      marginTop: 12,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      maxWidth: 420,
      color: X_DIM,
      fontSize: 12.5,
    }}
  >
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <ReplyIcon />
      {replyCount}
    </span>
    <RepostIcon />
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        color: liked ? X_PINK : X_DIM,
      }}
    >
      <span style={{ display: "inline-flex", transform: `scale(${likeScale})` }}>
        <HeartIcon filled={liked} />
      </span>
      {likeCount}
    </span>
    <ViewsIcon />
    <span style={{ display: "inline-flex", gap: 14 }}>
      <BookmarkIcon />
      <ShareIcon />
    </span>
  </div>
);

const Avatar: React.FC<{ bg?: string; src?: string; children?: React.ReactNode }> = ({
  bg = "#16181c",
  src,
  children,
}) => (
  <div
    style={{
      width: 42,
      height: 42,
      borderRadius: "50%",
      background: bg,
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 16,
      fontWeight: 700,
      fontFamily: X_FONT,
      flexShrink: 0,
      overflow: "hidden",
    }}
  >
    {src ? (
      <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    ) : (
      children
    )}
  </div>
);

// The mocked exchange: the analyst's geolocation tweet with the strict
// bot format inline, then the bot's in-thread reply.
const MockTweet: React.FC<{ bodyWidth: number; bodyHeight: number }> = ({
  bodyWidth,
  bodyHeight,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = (sec: number) =>
    spring({
      frame: frame - Math.round(sec * fps),
      fps,
      config: { damping: 18, stiffness: 110, mass: 0.7 },
    });

  const tweetIn = at(0.15);
  const BOT_AT = 3.4;
  const botIn = at(BOT_AT);

  // Sized so tweet + media + the bot reply all fit the chrome body with no
  // bottom clipping.
  const W = Math.min(580, bodyWidth - 80);
  const left = (bodyWidth - W) / 2;

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <div
        style={{
          position: "absolute",
          left,
          top: Math.max(12, bodyHeight * 0.025),
          display: "flex",
          flexDirection: "column",
          gap: 10,
          fontFamily: X_FONT,
        }}
      >
        {/* The analyst's geolocation tweet, bot format inline. */}
        <div
          style={{
            opacity: tweetIn,
            transform: `translateY(${(1 - tweetIn) * 14}px)`,
            width: W,
            background: "#000",
            border: `1px solid ${X_BORDER}`,
            borderRadius: 16,
            padding: "14px 18px",
            boxSizing: "border-box",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Avatar src={staticFile("clips/geoimint-avatar.jpg")} />
            <div style={{ lineHeight: 1.25 }}>
              <div style={{ color: X_TEXT, fontSize: 15.5, fontWeight: 700 }}>GEOIMINT</div>
              <div style={{ color: X_DIM, fontSize: 14 }}>@GEOIMINT</div>
            </div>
          </div>
          <div
            style={{
              color: X_TEXT,
              fontSize: 15,
              lineHeight: "21px",
              marginTop: 10,
              whiteSpace: "pre-line",
            }}
          >
            Geolocation of the U.S. airstrike on a Russian-supplied Tor-M1
            air defense system in Iranian service. Matched terrain and
            revetments on satellite.
            {"\n\n"}T: U.S. airstrike on a Tor-M1 in Iranian service
            {"\n"}C: 31.464112, 48.603639
            {"\n"}S:{" "}
            <span style={{ color: X_BLUE }}>x.com/Osinttechnical/status/20284…</span>
            {"\n"}
            <span style={{ color: X_BLUE }}>@viditbot</span>
          </div>
          <Img
            src={staticFile("clips/bot-tweet-proof.jpg")}
            style={{
              width: "100%",
              borderRadius: 14,
              border: `1px solid ${X_BORDER}`,
              marginTop: 12,
              display: "block",
            }}
          />
          <ActionBar replyCount={frame >= BOT_AT * fps ? "1" : ""} />
        </div>

        {/* The bot's in-thread reply, real compose_reply copy (linkless). */}
        <div
          style={{
            opacity: botIn,
            transform: `translateY(${(1 - botIn) * 18}px)`,
            width: W,
            background: "#000",
            border: `1px solid ${X_BORDER}`,
            borderRadius: 16,
            padding: "12px 18px",
            boxSizing: "border-box",
            marginLeft: 34,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Avatar src={staticFile("clips/bot-avatar.png")} />
            <div style={{ lineHeight: 1.25 }}>
              <div style={{ color: X_TEXT, fontSize: 15, fontWeight: 700 }}>Vidit</div>
              <div style={{ color: X_DIM, fontSize: 14 }}>
                @viditbot · replying to <span style={{ color: X_BLUE }}>@GEOIMINT</span>
              </div>
            </div>
          </div>
          <div
            style={{
              color: X_TEXT,
              fontSize: 15,
              lineHeight: "20px",
              marginTop: 8,
              whiteSpace: "pre-line",
            }}
          >
            {"Vidit: 1 geolocation draft saved · ref 94183d44\nReview it from your profile (link in bio)."}
          </div>
          <ActionBar />
        </div>
      </div>
    </AbsoluteFill>
  );
};

const DropIn: React.FC<{ clip: DropInClip }> = ({ clip }) => (
  <OffthreadVideo
    src={staticFile(clip.src)}
    muted
    style={{
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      objectFit: "cover",
    }}
  />
);

export const BotBeat: React.FC<{
  width: number;
  height: number;
  capture: DropInClip | null;
}> = ({ width, height, capture }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.quad),
  });
  // BrowserChrome's body is the frame minus its 60px header.
  const bodyHeight = height - 60;
  return (
    <AbsoluteFill style={{ opacity: enter }}>
      <BrowserChrome url="x.com" width={width} height={height}>
        {capture ? (
          <DropIn clip={capture} />
        ) : (
          <MockTweet bodyWidth={width} bodyHeight={bodyHeight} />
        )}
      </BrowserChrome>
    </AbsoluteFill>
  );
};
