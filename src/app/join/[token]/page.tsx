import type { Metadata } from "next";
import { Suspense } from "react";
import { JoinScreen, JoinSkeleton } from "./join-screen";

export const metadata: Metadata = { title: "Join a household" };

/** The invite token is only known per request, so it is read inside a Suspense boundary. */
export default function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={<JoinSkeleton />}>
      <Join params={params} />
    </Suspense>
  );
}

async function Join({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let decoded = token;
  try {
    decoded = decodeURIComponent(token);
  } catch {
    /* malformed escape: the invite check will say it isn't valid */
  }
  return <JoinScreen token={decoded} />;
}
