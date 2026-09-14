import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Phase U3.6 — the Unity WebGL runtime under public/unity/cctv/Build/ is
  // pre-compressed with Brotli (see unity-cctv-host.ts). Next.js's static
  // file serving has no notion of pre-compressed assets: it would otherwise
  // serve these .br files as opaque bytes with no Content-Encoding header,
  // leaving the browser to treat them as raw (garbage) data instead of
  // transparently inflating them. These three narrow rules — scoped only to
  // the exact Unity build filenames — are the minimum needed to fix that;
  // nothing else on the site is affected. Content-Type values match what
  // Unity's own generated index.html would serve for an uncompressed build
  // of the same files (verified in WebBuildBrotli/index.html and the
  // loader's own MIME-mismatch error messages), since Content-Encoding
  // alone does not change what content the browser expects underneath it.
  // Inert until NEXT_PUBLIC_UNITY_CCTV_ENABLED is true for a given
  // environment — these headers only ever affect requests for the Unity
  // build files themselves, never triggered unless the flag is on.
  async headers() {
    return [
      {
        source: "/unity/cctv/Build/WebBuild.wasm.br",
        headers: [
          { key: "Content-Encoding", value: "br" },
          { key: "Content-Type", value: "application/wasm" },
        ],
      },
      {
        source: "/unity/cctv/Build/WebBuild.framework.js.br",
        headers: [
          { key: "Content-Encoding", value: "br" },
          { key: "Content-Type", value: "application/javascript" },
        ],
      },
      {
        source: "/unity/cctv/Build/WebBuild.data.br",
        headers: [
          { key: "Content-Encoding", value: "br" },
          { key: "Content-Type", value: "application/octet-stream" },
        ],
      },
    ];
  },
};

export default nextConfig;
