import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { defaultDeps, type EmbedDeps } from './deps';
import { EmbedApp } from './EmbedApp';
import { BlockedScreen, EmbedFrame, ProductHeader } from './EmbedScreens';

/** `/embed/:token` — one EmbedApp per token, with the browser's real parent window and storage. */
export function EmbedRoute(): ReactNode {
  const { token = '' } = useParams();
  const [deps] = useState<EmbedDeps>(() => defaultDeps());
  return <EmbedApp key={token} token={token} deps={deps} />;
}

/** `/embed` without a token, or any unknown path under it. */
export function EmbedNotFound(): ReactNode {
  return (
    <EmbedFrame>
      <ProductHeader shop={null} garment={null} />
      <main className="flex flex-1 flex-col px-4 py-4">
        <BlockedScreen kind="expired" onRetry={null} onClose={null} />
      </main>
    </EmbedFrame>
  );
}
