import { permanentRedirect } from "next/navigation";

/** The feed was called the timeline; this route keeps published links working. */
export default function TimelineRedirect() {
  permanentRedirect("/feed");
}
