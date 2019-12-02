import { resolve, dirname, relative } from "path"
import { addFilter, applyFilters } from "@factor/tools/filters"


import fs from "fs-extra"

// Add static folder copy config to webpack copy plugin
addFilter("webpack-copy-files-config", (_: CopyItemConfig[]) => [
  ..._,
  ...staticCopyConfig()
])
addFilter("webpack-aliases", (_: Record<string, string>) => {
  return {
    ..._,
    __SRC__: getPath("source"),
    __CWD__: getPath("app"),
    __FALLBACK__: getPath("app")
  }
})

export function getPath(key: string): string {
  const rel = relativePath(key)
  const full = typeof rel != "undefined" ? resolve(CWD(), rel) : ""

  return full
}

function relativePath(key: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { main = "index.js" } = require(resolve(CWD(), "package.json"))
  const sourceDirectory = dirname(resolve(CWD(), main))

  const app = "."

  const source = relative(CWD(), sourceDirectory)
  const dist = [app, "dist"]
  const generated = [app, ".factor"]
  const coreApp = dirname(require.resolve("@factor/app"))

  const paths = applyFilters("paths", {
    app,
    source,
    dist,
    generated,
    coreApp,
    static: [source, "static"],
    "entry-browser": [coreApp, "entry-browser"],
    "entry-server": [coreApp, "entry-server"],
    "config-file-public": [app, "factor-config.json"],
    "config-file-private": [app, ".env"],
    "loader-app": [...generated, "loader-app.js"],
    "loader-server": [...generated, "loader-server.js"],
    "loader-settings": [...generated, "loader-settings.js"],
    "loader-styles": [...generated, "loader-styles.less"],
    "client-manifest": [...dist, "factor-client.json"],
    "server-bundle": [...dist, "factor-server.json"]
  })

  const p = paths[key]

  return Array.isArray(p) ? p.join("/") : p
}

function CWD(): string {
  return process.env.FACTOR_CWD || process.cwd()
}

interface CopyItemConfig {
  from: string;
  to: string;
  ignore: string[];
}

// Returns configuration array for webpack copy plugin
// if static folder is in app or theme, contents should copied to dist
function staticCopyConfig(): CopyItemConfig[] {
  const themeRoot = getPath("theme")
  const themePath = themeRoot ? resolve(themeRoot, "static") : ""
  const appPath = getPath("static")

  const paths = [themePath, appPath]
  const copyItems: CopyItemConfig[] = []

  paths.forEach(p => {
    if (fs.pathExistsSync(p)) copyItems.push({ from: p, to: "", ignore: [".*"] })
  })

  return copyItems
}
