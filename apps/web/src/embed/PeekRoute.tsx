import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { defaultDeps, makeEmbedApi } from './deps';
import { mintPeekToken, parsePeekParams, type PeekDeps } from './peek';
import { PeekApp } from './PeekApp';

/** The peek's real wiring: the embed's own partitioned store, the browser's parent window. */
export function defaultPeekDeps(): PeekDeps {
  const d = defaultDeps();
  return { store: d.store, makeApi: makeEmbedApi, mintToken: (req) => mintPeekToken(req), parent: d.parent, referrer: d.referrer, ancestorOrigins: d.ancestorOrigins };
}

/** `/embed/peek?shop=pk_…&product=…` — transparent page, sized by its content (the SDK sets the frame height). */
export function PeekRoute(): ReactNode {
  const { search } = useLocation();
  const [params] = useState(() => parsePeekParams(search));
  const [deps] = useState<PeekDeps>(defaultPeekDeps);
  useEffect(() => {
    document.documentElement.classList.add('curtain-peek');
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.minHeight = '0';
  }, []);
  return <PeekApp params={params} deps={deps} />;
}
